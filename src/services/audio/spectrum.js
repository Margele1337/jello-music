// 频谱采集与 FFT：移植自所有者 sigmarebase 的 MusicManager/JavaFFT 频谱实现。
//
// 两条链路（按歌曲无缝二选一，回退静默无提示）：
// 1) 自解码链路（主链路，mp3/flac，对齐 MusicManager 解码循环 ~:383-407）：
//    player.js 把整首歌字节 fetch 一次，可听路径用 blob URL 喂现有 audio 元素，
//    分析路径由 mp3DecodeWorker.js 用 Chromium 内建 WebCodecs AudioDecoder 解成
//    原生采样率 PCM，逐帧做 2048 点 FFT（mp3 帧 2304 交错采样、FLAC 常规块
//    4096/ch = 8192 交错采样，都截断到 2048，复刻原版 AAC 整帧 FFT 的几何），
//    幅度按 Int16 量级传回主线程。flac 需要 config.description 携带
//    'fLaC'+元数据块前缀（Chromium 从 STREAMINFO 初始化解码器）。
//    主线程 line buffer（≈4s，超出 hold Worker = SourceDataLine.write 阻塞背压的
//    类比物）+ 门控（frameTime <= element.currentTime + B*frameDuration，
//    B = round(421.7ms/frameDuration)+17，44.1kHz mp3 下 33）把帧放入 18 深显示队列
//    （add；>18 shift），渲染读 queue[0] 不弹出（MusicManager:134）——
//    净视觉领先 (B-17) 帧 ≈ 421.7ms，且由 currentTime 派生，seek/暂停自校正。
//    门控/队列/领先推导/Int16 标度全部格式无关（帧时长=每帧样本数/原生采样率）。
//    playbackRate 由可听元素处理；解码链路恒 1x（原版无倍速功能）。
// 2) tap 回退链路（保持原样）：AudioWorklet 每攒满一个 MP3 帧回调 1024 个交错
//    Int16 采样，对帧首做 1024 点 FFT；预读元素领先 avDelayMs 播放同一 URL 喂频谱。
//    非 mp3/flac / fetch 失败 / WebCodecs 不可用 / 解析或解码器错误时走这条。
import { createSpectrumFft } from './fft.js';
import {
  SigmaDisplayQueue,
  decideSelfDecode,
  deriveGateFrames,
  findFirstFlacFrame,
  findFirstMp3Frame,
  gateFrontierSeconds,
  lineBufferCapFrames,
  releaseGatedFrames
} from './mp3Frame.js';

const BAR_COUNT = 114;
const FFT_SIZE = 1024;
const QUEUE_MAX = 4;
const BATCH_SECONDS = 0.25;
const BATCH_MAX = 12;
const FRAME_SECONDS = 1152 / 44100;
const AV_DELAY_DEFAULT_MS = 590;

const spectrumFft = createSpectrumFft(FFT_SIZE);
const rawLevels = new Float32Array(BAR_COUNT);
const samples = new Float32Array(FFT_SIZE);
const realOut = new Float32Array(FFT_SIZE);
const imagOut = new Float32Array(FFT_SIZE);
const sigmaQueue = [];
const pendingFrames = [];

let context = null;
let sourceNode = null;
let volumeGainNode = null;
let loudnessGainNode = null;
let tapNode = null;
let mainTapGainNode = null;
let lookaheadAudio = null;
let lookaheadSourceNode = null;
let lookaheadTapGainNode = null;
let starting = null;
let enabled = false;
let sourceBound = false;
let audioListeners = [];
let getSong = null;
let isPlaying = null;
let getVolume = null;
let getMuted = null;
let sendFn = null;
let idleTimer = null;
let lastBlockAt = 0;
let metaKey = '';
let batchAccumulator = BATCH_SECONDS;
let avDelayMs = AV_DELAY_DEFAULT_MS;
let spectrumScale = 1;
let spectrumSmoothing = 0.335;

// ===== 自解码链路状态（mp3/flac，WebCodecs；tap+预读回退链路的状态在上方）=====
let decodeActive = false;
let decodeWorker = null;
let decodeElement = null;
let decodeRaf = 0;
let decodeListeners = [];
let lineBuffer = [];                              // 主线程 line buffer（SourceDataLine 的类比物）
let displayQueue = new SigmaDisplayQueue();       // 18 深显示队列（visualizerData）
const decodeZeroLevels = new Float32Array(BAR_COUNT);
let decodeAccumTime = 0;                          // 下一解码帧的歌曲绝对时间（秒）
let decodeGateFrames = 33;                        // B = round(421.7ms/帧时长)+17（44.1kHz 下 33）
let decodeFrameDuration = FRAME_SECONDS;
let decodeCapFrames = 154;                        // line buffer 上限 ≈4s
let decodeBitrate = 0;                            // 首帧码率（CBR 估算 seek 字节偏移用）
let decodeFirstOffset = 0;                        // 首个音频帧的字节偏移（ID3 之后）
let workerHeld = false;                           // 已通知 Worker 暂停拉取（背压）
let currentBlobUrl = null;                        // 当前歌曲的 blob URL（可听路径）
let pendingRevokeUrls = [];                       // 仍被 element.src 引用的旧 blob，延后回收

const currentSong = () => getSong?.() || null;
const currentPlaying = () => !!isPlaying?.();

const resetQueue = () => {
  sigmaQueue.length = 0;
  pendingFrames.length = 0;
  batchAccumulator = BATCH_SECONDS;
};

const sendSpectrum = (levels, forceMeta = false) => {
  if (!sendFn) return;
  const song = currentSong();
  const key = `${song?.hash || ''}|${song?.img || ''}`;
  const changed = key !== metaKey;
  const payload = {
    levels: Array.from(levels),
    playing: currentPlaying()
  };
  if (changed || forceMeta) {
    metaKey = key;
    payload.reset = true;
    payload.cover = song?.img || '';
    payload.title = song?.name || '';
    payload.author = song?.author || '';
  }
  sendFn(payload);
};

const handleBlock = (block) => {
  if (!enabled) return;
  // 自解码链路激活时 tap 数据作废（worklet 仍在音频图里透传，只是不驱动频谱）
  if (decodeActive) return;
  lastBlockAt = performance.now();

  const song = currentSong();
  const key = `${song?.hash || ''}|${song?.img || ''}`;
  if (key !== metaKey) resetQueue();

  if (!currentPlaying()) {
    resetQueue();
    rawLevels.fill(0);
    sendSpectrum(rawLevels);
    return;
  }

  for (let i = 0; i < FFT_SIZE; i += 1) samples[i] = block[i];
  spectrumFft(samples, realOut, imagOut);
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const re = realOut[i];
    const im = imagOut[i];
    rawLevels[i] = Math.sqrt(re * re + im * im);
  }

  pendingFrames.push(Float32Array.from(rawLevels));
  batchAccumulator += FRAME_SECONDS;
  if (batchAccumulator >= BATCH_SECONDS || pendingFrames.length >= BATCH_MAX) {
    for (const frame of pendingFrames) {
      sigmaQueue.push(frame);
      if (sigmaQueue.length > QUEUE_MAX) sigmaQueue.shift();
    }
    pendingFrames.length = 0;
    batchAccumulator -= BATCH_SECONDS;
    if (batchAccumulator < 0) batchAccumulator = 0;
  }

  sendSpectrum(sigmaQueue.length ? sigmaQueue[0] : rawLevels);
};

const isLookaheadReady = () => !!lookaheadAudio?.src && lookaheadAudio.readyState >= 2;

// 预读数据可用时用预读喂频谱，否则退回主播放器（保证频谱始终有数据）。
// 自解码链路激活时不动路由（handleBlock 已被 decodeActive 短路）。
const updateTapRouting = () => {
  if (decodeActive) return;
  const ready = isLookaheadReady();
  if (mainTapGainNode) mainTapGainNode.gain.value = ready ? 0 : 1;
  if (lookaheadTapGainNode) lookaheadTapGainNode.gain.value = ready ? 1 : 0;
};

const setLookaheadSource = (url) => {
  if (!lookaheadAudio || decodeActive) return;
  const next = url || '';
  if (lookaheadAudio.getAttribute('src') === next) return;
  if (!next) {
    lookaheadAudio.removeAttribute('src');
    lookaheadAudio.load();
  } else {
    lookaheadAudio.src = next;
  }
  updateTapRouting();
};

// 与主播放器同步：位置领先 avDelayMs，播放/暂停/倍速跟随；force=true 强制重新定位。
// 自解码链路激活时预读元素闲置（频谱由 Worker 解码驱动）。
export const syncLookahead = (currentTime, playing, rate = 1, force = false) => {
  if (decodeActive) return;
  if (!lookaheadAudio || !lookaheadAudio.src) return;
  // 音频图未就绪（没有 MediaElementSource）时不能播放预读，否则会真的出声
  if (!lookaheadSourceNode) return;
  const expected = Math.max(0, (Number(currentTime) || 0) + avDelayMs / 1000);
  if (force || Math.abs(lookaheadAudio.currentTime - expected) > 0.08) {
    try {
      lookaheadAudio.currentTime = expected;
    } catch {
      /* ignore */
    }
  }
  if (Number.isFinite(rate) && lookaheadAudio.playbackRate !== rate) {
    lookaheadAudio.playbackRate = rate;
  }
  if (playing && lookaheadAudio.paused && !lookaheadAudio.ended) {
    lookaheadAudio.play().catch(() => {});
  } else if (!playing && !lookaheadAudio.paused) {
    lookaheadAudio.pause();
  }
  updateTapRouting();
};

export { setLookaheadSource };

// ===== mp3 自解码频谱链路（WebCodecs AudioDecoder，无需任何 npm 依赖）=====
// 对齐所有者 sigmarebase MusicManager：解码领先可听位置一个 line buffer（≈4s，
// 代替 SourceDataLine.write() 的阻塞背压），叠加 18 深显示队列读 0 号位不弹出，
// 复刻实测 421.7ms 净视觉领先。任何一步失败都静默回退到 tap+预读链路。

// spectrumAvDelayMs 在自解码链路里是「用户微调」：默认 590 对应 0 微调，
// 净领先 = 421.7ms(B-17 帧) + (avDelayMs-590)ms
const decodeTrimSeconds = () => (avDelayMs - AV_DELAY_DEFAULT_MS) / 1000;

// 估算 anchorTime 对应的字节偏移（mp3 按首帧码率 CBR 近似；flac 按全文件平均
// 码率。VBR/变块长有偏差但 seek 少见，门控由 currentTime 派生会逐步自校正）。
// 首帧偏移之后按码率线性推算。
const estimateByteOffset = (anchorTime) => {
  const bytesPerSecond = decodeBitrate > 0 ? decodeBitrate / 8 : 0;
  if (!bytesPerSecond || !(anchorTime > 0)) return decodeFirstOffset;
  return decodeFirstOffset + Math.floor(anchorTime * bytesPerSecond);
};

// line buffer 低于半容量时恢复 Worker 拉取（背压释放）
const maybeResumeWorker = () => {
  if (!decodeActive || !decodeWorker) return;
  const lowWater = Math.max(1, decodeCapFrames >> 1);
  if (workerHeld && lineBuffer.length <= lowWater) {
    workerHeld = false;
    try { decodeWorker.postMessage({ type: 'resume' }); } catch { /* ignore */ }
  }
};

const handleDecodeMessage = (event) => {
  const data = event?.data;
  if (!decodeActive || !data) return;
  if (data.type === 'frame') {
    const magnitudes = data.magnitudes;
    if (!(magnitudes instanceof Float32Array) || magnitudes.length === 0) return;
    const frameSamples = Number(data.frameSamples) || 1152;
    const frameRate = Number(data.sampleRate) || 44100;
    const frameDuration = frameSamples / frameRate;
    lineBuffer.push({ time: decodeAccumTime, magnitudes });
    decodeAccumTime += frameDuration;
    // line buffer 满（≈4s）→ 通知 Worker 暂停拉取（SourceDataLine.write 阻塞的类比）
    if (!workerHeld && lineBuffer.length >= decodeCapFrames) {
      workerHeld = true;
      try { decodeWorker?.postMessage({ type: 'hold' }); } catch { /* ignore */ }
    }
    return;
  }
  if (data.type === 'error') {
    handleDecodeFailure(data.message);
  }
};

// 运行时解码失败：播放继续走 blob（元素原生解码同一份 mp3 字节不受影响），
// 频谱就地降级到 tap+预读链路，不重载、不提示（避免可听卡顿）
const handleDecodeFailure = (message) => {
  if (!decodeActive) return;
  console.warn('[spectrum] 自解码失败，降级到 tap 链路:', message || 'unknown');
  const element = decodeElement;
  teardownDecodeWorker();
  decodeActive = false;
  // 就地启用 tap 链路：预读跟随当前 blob src，增益路由复原
  if (element) {
    setLookaheadSource(element.src);
    syncLookahead(element.currentTime, currentPlaying(), element.playbackRate || 1, true);
  }
  updateTapRouting();
  // 立刻补一帧 tap 数据前的空档：清空显示队列避免残留自解码帧
  displayQueue.clear();
};

const teardownDecodeWorker = () => {
  if (decodeRaf) {
    cancelAnimationFrame(decodeRaf);
    decodeRaf = 0;
  }
  for (const { event, handler } of decodeListeners) {
    try { decodeElement?.removeEventListener(event, handler); } catch { /* ignore */ }
  }
  decodeListeners = [];
  if (decodeWorker) {
    try { decodeWorker.postMessage({ type: 'stop' }); } catch { /* ignore */ }
    try { decodeWorker.terminate(); } catch { /* ignore */ }
    decodeWorker.onmessage = null;
    decodeWorker.onerror = null;
    decodeWorker = null;
  }
  lineBuffer = [];
  displayQueue.clear();
  workerHeld = false;
};

// 每渲染 tick 门控一帧（对齐 MusicManager:134 读 get(0) 不弹出）
const decodeTick = () => {
  if (!decodeActive) return;
  decodeRaf = requestAnimationFrame(decodeTick);
  if (!enabled || !currentPlaying()) {
    // 暂停/停用：对齐原版 visualizerData.clear()，条子由 refreshSpectrum 归零
    return;
  }
  const element = decodeElement;
  if (!element) return;
  const frontier = gateFrontierSeconds(
    element.currentTime, decodeGateFrames, decodeFrameDuration, decodeTrimSeconds()
  );
  releaseGatedFrames(lineBuffer, frontier, displayQueue);
  maybeResumeWorker();
  const frame = displayQueue.peek();
  if (frame) {
    sendSpectrum(frame);
  } else {
    sendSpectrum(decodeZeroLevels);
  }
};

// 重锚到 element.currentTime（seek/resume 时）：清两级缓冲，让 Worker 从估算字节
// 偏移重启解码，帧时间轴以 anchor 重新起算。避免后退 seek 时显示队列卡在旧帧。
const resyncDecode = (anchorTime) => {
  if (!decodeActive || !decodeWorker) return;
  const anchor = Math.max(0, Number(anchorTime) || 0);
  lineBuffer = [];
  displayQueue.clear();
  decodeAccumTime = anchor;
  workerHeld = false;
  try {
    decodeWorker.postMessage({ type: 'restart', offset: estimateByteOffset(anchor) });
  } catch { /* ignore */ }
};

// 准入判定 + fetch 字节 + 帧头/解码配置预检；任何一步失败返回 { src: 远程URL, decode: null }
export const prepareSelfDecode = async ({ url, extName, budgetMs = 2500 }) => {
  const decision = decideSelfDecode({
    extName,
    hasAudioDecoder: typeof globalThis.AudioDecoder === 'function',
    spectrumEnabled: enabled
  });
  if (!decision.ok || !url) return { src: url, decode: null };
  const format = decision.format;
  // 取字节预算：blob 路径要等整首下完才能出声，弱网下会拖慢播放开始。
  // 超预算即中止并静默回退远程 URL + tap 链路，播放可靠性优先于频谱同构。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal });
    if (!response.ok) return { src: url, decode: null };
    const buffer = await response.arrayBuffer();
    const bytesView = new Uint8Array(buffer);
    let parsed;
    let header;
    let description = null;
    let streaminfo = null;
    let config;
    if (format === 'flac') {
      parsed = findFirstFlacFrame(bytesView);
      if (!parsed) return { src: url, decode: null };
      const { stream } = parsed;
      streaminfo = stream.streaminfo;
      // description = 'fLaC'+全部元数据块前缀（Chromium flac 解码器靠 STREAMINFO
      // 初始化）。slice 复制一份：buffer 稍后整体转移给 Worker，不能共享视图
      description = bytesView.slice(stream.descriptionStart, stream.descriptionEnd);
      // 与 mp3 帧头同构的「header」：samplesPerFrame=块长（门控 B / line buffer
      // 上限推导用），bitrate=全文件平均码率（seek 重锚的字节偏移估算用）
      header = {
        sampleRate: parsed.header.sampleRate,
        channels: parsed.header.channels,
        samplesPerFrame: parsed.header.blocksize,
        frameDuration: parsed.header.frameDuration,
        bitrate: Math.round(stream.averageBitrate)
      };
      config = {
        codec: 'flac',
        sampleRate: header.sampleRate,
        numberOfChannels: header.channels,
        description
      };
    } else {
      parsed = findFirstMp3Frame(bytesView);
      if (!parsed) return { src: url, decode: null };
      header = parsed.header;
      config = { codec: 'mp3', sampleRate: header.sampleRate, numberOfChannels: header.channels };
    }
    if (typeof globalThis.AudioDecoder.isConfigSupported === 'function') {
      const support = await globalThis.AudioDecoder.isConfigSupported(config);
      if (support && support.supported === false) return { src: url, decode: null };
    }
    const blobUrl = URL.createObjectURL(new Blob([buffer], {
      type: format === 'flac' ? 'audio/flac' : 'audio/mpeg'
    }));
    return {
      src: blobUrl,
      decode: {
        blobUrl, buffer, offset: parsed.offset, config, header,
        format, description, streaminfo
      }
    };
  } catch {
    return { src: url, decode: null };
  } finally {
    clearTimeout(timer);
  }
};

// 启动自解码分析（player.js 在 element.src 设为 blob 后调用）
export const startDecodeAnalysis = (element, decode) => {
  stopDecodeAnalysis();   // 清上一首 + 回收旧 blob
  if (!enabled || !element || !decode?.buffer) return false;
  let worker;
  try {
    worker = new Worker(new URL('./mp3DecodeWorker.js', import.meta.url), { type: 'module' });
  } catch (error) {
    console.warn('[spectrum] 自解码 Worker 启动失败，降级到 tap 链路:', error?.message);
    return false;
  }

  decodeElement = element;
  decodeWorker = worker;
  const { header } = decode;
  decodeFrameDuration = header.frameDuration;
  decodeGateFrames = deriveGateFrames(header.sampleRate, header.samplesPerFrame);
  decodeCapFrames = lineBufferCapFrames(header.sampleRate, header.samplesPerFrame);
  decodeBitrate = header.bitrate;
  decodeFirstOffset = decode.offset;
  decodeAccumTime = 0;
  workerHeld = false;
  lineBuffer = [];
  displayQueue.clear();
  currentBlobUrl = decode.blobUrl;
  decodeActive = true;

  worker.onmessage = handleDecodeMessage;
  worker.onerror = (event) => handleDecodeFailure(event?.message || 'worker error');
  try {
    worker.postMessage({
      type: 'decode',
      buffer: decode.buffer,
      offset: decode.offset,
      sampleRate: header.sampleRate,
      channels: header.channels,
      // 格式感知：flac 需要 description（'fLaC'+元数据块）与 streaminfo
      //（帧头采样率位 0 / 位宽位 0 的回退取值）；mp3 两者为 undefined 不影响
      format: decode.format || 'mp3',
      description: decode.description || null,
      streaminfo: decode.streaminfo || null
    }, [decode.buffer]);   // 转移字节（blob 已在 createObjectURL 时复制）
  } catch (error) {
    handleDecodeFailure(error?.message);
    return false;
  }

  // 自解码链路的事件（独立于 tap 链路的 audioListeners）
  const onPlay = () => { if (decodeActive) resyncDecode(decodeElement?.currentTime || 0); };
  const onPause = () => {
    if (!decodeActive) return;
    // 暂停：清两级缓冲并停 Worker 拉取（对齐原版 visualizerData.clear + write 阻塞）
    lineBuffer = [];
    displayQueue.clear();
    workerHeld = true;
    try { decodeWorker?.postMessage({ type: 'hold' }); } catch { /* ignore */ }
  };
  const onSeeked = () => { if (decodeActive) resyncDecode(decodeElement?.currentTime || 0); };
  decodeListeners = [['play', onPlay], ['pause', onPause], ['seeked', onSeeked]]
    .map(([event, handler]) => {
      element.addEventListener(event, handler);
      return { event, handler };
    });

  decodeRaf = requestAnimationFrame(decodeTick);
  return true;
};

const revokeBlobUrl = (url) => {
  if (!url) return;
  try { URL.revokeObjectURL(url); } catch { /* ignore */ }
};

// 回收已确定不再被 element.src 引用的旧 blob（换歌 src 切换后由本模块自动调用）
const flushPendingRevokes = () => {
  for (const url of pendingRevokeUrls) revokeBlobUrl(url);
  pendingRevokeUrls = [];
};

// 停止自解码分析：终止 Worker、清两级缓冲。
// blob 回收规则：element 仍指向它（如频谱中途关闭）→ 延后到下次换歌回收；
// 已切走（换歌/回退）→ 立即回收。返回是否曾有会话。
export const stopDecodeAnalysis = () => {
  flushPendingRevokes();
  const hadSession = decodeActive || !!decodeWorker || !!currentBlobUrl;
  const blob = currentBlobUrl;
  const elementSrc = decodeElement?.src || '';
  teardownDecodeWorker();
  decodeActive = false;
  decodeElement = null;
  currentBlobUrl = null;
  if (blob) {
    if (elementSrc && elementSrc === blob) pendingRevokeUrls.push(blob);
    else revokeBlobUrl(blob);
  }
  return hadSession;
};

// 供 refreshSpectrum/idle 定时器读取当前应显示的帧：自解码链路读 18 深显示队列
// 0 号位（不弹出，对齐 MusicManager:134）；tap 链路读旧的 sigmaQueue 0 号位
const currentDecodeLevels = () => displayQueue.peek();

const currentDisplayLevels = () => {
  if (decodeActive) return currentDecodeLevels() || decodeZeroLevels;
  return sigmaQueue.length ? sigmaQueue[0] : rawLevels;
};

// 音量走音频图（音量节点在频谱采集点之后），保证 FFT 输入与音量无关
export const applyOutputVolume = (percent, muted) => {
  const linear = Math.max(0, Math.min(1, Number(percent) || 0));
  if (context && volumeGainNode) {
    const target = muted ? 0 : linear;
    try {
      volumeGainNode.gain.setValueAtTime(target, context.currentTime);
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
};

// ===== 响度规格化（目标 -14 LUFS，与旧版算法一致） =====
let loudnessEnabled = false;
let currentLoudnessGain = 1;

export const setLoudnessEnabled = (value) => {
  loudnessEnabled = value === true;
};

export const getLoudnessGain = () => currentLoudnessGain;

export const applyLoudnessData = (data) => {
  let gain = 1;
  if (loudnessEnabled && data && typeof data === 'object') {
    const volume = Number(data.volume) || 0;
    const volumeGain = Number(data.volumeGain) || 0;
    const volumePeak = Number(data.volumePeak) || 0;
    let adjustment = Math.pow(10, (-14 - volume) / 20);
    if (volumeGain !== 0) adjustment *= Math.pow(10, volumeGain / 20);
    // 防止削波：峰值超 0.95 时限增益
    if (volumePeak > 0 && volumePeak * adjustment > 0.95) adjustment = 0.95 / volumePeak;
    gain = Math.max(0.1, Math.min(3, adjustment));
  }
  currentLoudnessGain = gain;
  if (context && loudnessGainNode) {
    try {
      loudnessGainNode.gain.setValueAtTime(gain, context.currentTime);
    } catch {
      /* ignore */
    }
  }
  return gain;
};

// ===== 输出设备切换（音频图激活时必须切 AudioContext，否则元素 setSinkId 无效） =====
export const setAudioOutputDevice = async (audio, deviceId) => {
  if (!deviceId || deviceId === 'default') return true;
  try {
    if (context && typeof context.setSinkId === 'function') {
      await context.setSinkId(deviceId);
      return true;
    }
    if (audio && typeof audio.setSinkId === 'function') {
      await audio.setSinkId(deviceId);
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

// 独立启用音频图（响度规格化/输出设备切换不需要开频谱）
export const ensureAudioGraph = async (audio) => ensureGraph(audio);

const ensureGraph = async (audio) => {
  if (!audio || typeof window === 'undefined') return false;
  if (context) {
    if (context.state === 'suspended') await context.resume();
    return true;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;

  let localContext = null;
  let localSource = null;
  try {
    // 固定 44.1kHz：sigmarebase 的 JavaFFT 按 44.1kHz MP3 帧取 1024 采样，
    // 设备混音率是 48k/96k 时窗口与频段映射都会偏，这里强制对齐原版。
    try {
      localContext = new AudioContextClass({ sampleRate: 44100 });
    } catch {
      localContext = new AudioContextClass();
    }
    const workletUrl = new URL('spectrum-tap.js', window.location.href).href;
    await localContext.audioWorklet.addModule(workletUrl);

    const frameSize = Math.max(1, Math.round((1152 * localContext.sampleRate) / 44100));
    localSource = localContext.createMediaElementSource(audio);
    sourceBound = true;

    const volumeGain = localContext.createGain();
    volumeGain.gain.value = 1;
    const loudnessGain = localContext.createGain();
    loudnessGain.gain.value = currentLoudnessGain;
    const tap = new AudioWorkletNode(localContext, 'spectrum-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { frameSize }
    });
    tap.port.onmessage = (event) => handleBlock(event.data);

    // 主播放器 / 预读播放器通过增益切换谁喂频谱（默认主播放器，预读就绪后切到预读）
    const mainTapGain = localContext.createGain();
    mainTapGain.gain.value = 1;
    lookaheadAudio = new Audio();
    lookaheadAudio.crossOrigin = 'anonymous';
    lookaheadAudio.preload = 'auto';
    const lookaheadSource = localContext.createMediaElementSource(lookaheadAudio);
    const lookaheadTapGain = localContext.createGain();
    lookaheadTapGain.gain.value = 0;

    localSource.connect(volumeGain);
    volumeGain.connect(loudnessGain);
    loudnessGain.connect(localContext.destination);
    localSource.connect(mainTapGain);
    mainTapGain.connect(tap);
    lookaheadSource.connect(lookaheadTapGain);
    lookaheadTapGain.connect(tap);
    tap.connect(localContext.destination);

    // 提交到模块级状态（MediaElementSource 绑定后不可撤销，只有全部成功才赋值）
    context = localContext;
    sourceNode = localSource;
    volumeGainNode = volumeGain;
    loudnessGainNode = loudnessGain;
    tapNode = tap;
    mainTapGainNode = mainTapGain;
    lookaheadSourceNode = lookaheadSource;
    lookaheadTapGainNode = lookaheadTapGain;

    // 音量切到音频图：元素音量固定 1，FFT 输入与音量无关
    audio.volume = 1;
    audio.muted = false;
    applyOutputVolume(getVolume?.() ?? 1, !!getMuted?.());

    if (context.state === 'suspended') await context.resume();
    return true;
  } catch (error) {
    console.warn('[spectrum] 音频频谱初始化失败:', error.message);
    if (!sourceBound && localContext) {
      // MediaElementSource 尚未绑定，可以安全关闭重试
      try {
        await localContext.close();
      } catch {
        /* ignore */
      }
    }
    // sourceBound = true 时不能 close：element 已绑定到 context，close 会导致永久静音
    return false;
  }
};

export const startSpectrum = async (audio, handlers = {}) => {
  getSong = handlers.getSong || null;
  isPlaying = handlers.isPlaying || null;
  getVolume = handlers.getVolume || null;
  getMuted = handlers.getMuted || null;
  sendFn = handlers.send || null;
  if (!sendFn) return false;

  enabled = true;
  if (!starting) {
    starting = ensureGraph(audio).finally(() => {
      starting = null;
    });
  }
  const ready = await starting;
  if (!ready || !enabled) return false;

  resetQueue();
  metaKey = '';
  sendSpectrum(rawLevels, true);

  if (!idleTimer) {
    idleTimer = setInterval(() => {
      if (!enabled) return;
      if (performance.now() - lastBlockAt < 2000) return;
      sendSpectrum(currentDisplayLevels(), true);
    }, 1000);
  }

  // 预读同步：监听主播放器事件，驱动预读播放器跟随
  if (audio && audioListeners.length === 0) {
    const onPlay = () => { setLookaheadSource(audio.src); syncLookahead(audio.currentTime, true, 1, true); };
    const onPause = () => syncLookahead(audio.currentTime, false, 1);
    const onSeek = () => syncLookahead(audio.currentTime, currentPlaying(), 1, true);
    const onRate = () => syncLookahead(audio.currentTime, currentPlaying(), audio.playbackRate, true);
    audioListeners = [
      ['play', onPlay], ['pause', onPause],
      ['seeking', onSeek], ['seeked', onSeek],
      ['ratechange', onRate]
    ].map(([event, handler]) => {
      audio.addEventListener(event, handler);
      return { event, handler };
    });
  }
  return true;
};

export const refreshSpectrum = () => {
  if (!enabled) return;
  if (!currentPlaying()) {
    resetQueue();
    rawLevels.fill(0);
    // 暂停对齐原版 visualizerData.clear()：自解码的两级缓冲一并清空并停拉取
    if (decodeActive) {
      lineBuffer = [];
      displayQueue.clear();
      if (!workerHeld) {
        workerHeld = true;
        try { decodeWorker?.postMessage({ type: 'hold' }); } catch { /* ignore */ }
      }
    }
    sendSpectrum(rawLevels, true);
    return;
  }
  sendSpectrum(currentDisplayLevels(), true);
};

export const stopSpectrum = (send) => {
  enabled = false;
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
  resetQueue();
  rawLevels.fill(0);
  audioListeners = [];
  // 终止自解码 Worker 并清缓冲；blob 若仍被元素引用则延后到下次换歌回收
  stopDecodeAnalysis();
  try {
    if (lookaheadAudio) {
      lookaheadAudio.pause();
      lookaheadAudio.removeAttribute('src');
      lookaheadAudio.load();
    }
  } catch {
    /* ignore */
  }
  try {
    (send || sendFn)?.({ levels: Array.from(rawLevels), playing: false, reset: true });
  } catch {
    /* ignore */
  }
};

export const updateSpectrumSettings = (settings = {}) => {
  if (Number.isFinite(settings.spectrumScale)) spectrumScale = settings.spectrumScale;
  if (Number.isFinite(settings.spectrumSigmaSmoothing)) spectrumSmoothing = settings.spectrumSigmaSmoothing;
  if (Number.isFinite(settings.spectrumAvDelayMs)) {
    // 音画差补偿（0..2000ms，默认 590）：
    // - tap 回退链路 = 预读元素的领先量（旧语义不变）；
    // - mp3 自解码链路 = 在 421.7ms 净领先（B-17 帧）之上的用户微调，
    //   默认值 590 折算为 0 微调（见 decodeTrimSeconds）。
    avDelayMs = Math.max(0, Math.min(2000, settings.spectrumAvDelayMs));
  }
};

export const isSpectrumRunning = () => enabled;
