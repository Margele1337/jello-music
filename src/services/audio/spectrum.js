// 频谱采集与 FFT：移植自所有者 sigmarebase 的 MusicManager/JavaFFT 频谱实现。
//
// 两条链路（按歌曲无缝二选一，回退静默无提示）：
// 1) 自解码链路（主链路，mp3/flac/aac(mp4)，对齐 MusicManager 解码循环 ~:383-407）：
//    可听路径立即用远程 URL 出声（边下边播），整首字节由 player.js 后台 fetch，
//    备好后由 mp3DecodeWorker.js 用 Chromium 内建 WebCodecs AudioDecoder 解成
//    原生采样率 PCM，逐帧做 2048 点 FFT，幅度按 Int16 量级传回主线程——分析
//    接管只换频谱来源，不动可听元素（startDecodeAnalysis 会锚定当前进度）。
//    mp4 候选例外：闸门预探测成功的 blob 直接作为可听路径（立即使用）。
//    窗几何与原版的对应关系：aac 帧 = 1024 采样/声道 → 2048 交错采样**正好**
//    是原版 jaad 整帧 FFT 的窗口（不截断）；mp3 帧 2304、FLAC 常规块 8192
//    交错采样则截断到 2048 保持 2 的幂窗（2 的幂 FFT 是既有决定）。
//    flac 需要 config.description 携带 'fLaC'+元数据块前缀（Chromium 从
//    STREAMINFO 初始化解码器）；aac 需要 mp4Demux.js 从 moov 里取出的
//    AudioSpecificConfig（esds→DecoderSpecificInfo）+ 逐样本字节表。
//    主线程 line buffer（≈4s，超出 hold Worker = SourceDataLine.write 阻塞背压的
//    类比物）+ 门控（frameTime <= element.currentTime + B*frameDuration，
//    B = round(421.7ms/frameDuration)+17，44.1kHz mp3 下 33）把帧放入 18 深显示队列
//    （add；>18 shift），渲染读 queue[0] 不弹出（MusicManager:134）——
//    净视觉领先 (B-17) 帧 ≈ 421.7ms，且由 currentTime 派生，seek/暂停自校正。
//    门控/队列/领先推导/Int16 标度全部格式无关（帧时长=每帧样本数/原生采样率）。
//    seek 重锚用精确映射：mp3 走 Xing/VBRI 的 TOC、flac 走 SEEKTABLE（无表时
//    让 Worker 增量扫帧到目标样本所在帧）、aac 走 stts/stsz/stsc 展开的样本表；
//    全部取不到才回退首帧/平均码率线性估算。
//    playbackRate 由可听元素处理；解码链路恒 1x（原版无倍速功能）。
// 2) tap 回退链路（保持原样）：AudioWorklet 每攒满一个 MP3 帧回调 1024 个交错
//    Int16 采样，对帧首做 1024 点 FFT；预读元素领先 avDelayMs 播放同一 URL 喂频谱。
//    非 mp3/flac/aac / fetch 失败 / WebCodecs 不可用 / 解析或解码器错误时走这条。
//
// 采样率策略（对齐原版）：Java 侧 SourceDataLine 按**曲目自身采样率**开行缓冲，
// 浏览器里等价物是「元素原生解码 → AudioContext 按设备混音率」，中间只重采样一次。
// 所以可听路径不再强制 44.1kHz（原版也没有重采样这一步）；自解码分析链路始终用
// 曲目原生采样率，是严格同构的那一条。tap 回退链路的窗宽随设备率变化，见 ensureGraph。
import { createSpectrumFft } from './fft.js';
import {
  SigmaDisplayQueue,
  createLoudnessNormalizer,
  decideSelfDecode,
  deriveGateFrames,
  findFirstFlacFrame,
  findFirstMp3Frame,
  flacSeekByteOffset,
  gateFrontierSeconds,
  lineBufferCapFrames,
  mp3TimeToByteOffset,
  parseMp3VbrHeader,
  releaseGatedFrames,
  validateFlacSeekTable
} from './mp3Frame.js';
import {
  mp4SampleIndexAt,
  mp4SampleTimeSeconds,
  parseMp4Audio
} from './mp4Demux.js';
import { SPECTRUM_PRESET_VALUES } from '../../../shared/settings.js';

const BAR_COUNT = 114;
const FFT_SIZE = 1024;
const QUEUE_MAX = 4;
const AV_DELAY_DEFAULT_MS = 590;

const spectrumFft = createSpectrumFft(FFT_SIZE);
const rawLevels = new Float32Array(BAR_COUNT);
const samples = new Float32Array(FFT_SIZE);
const realOut = new Float32Array(FFT_SIZE);
const imagOut = new Float32Array(FFT_SIZE);
const sigmaQueue = [];
// tap 链路 FFT 输入的响度归一化（与自解码 Worker 共用算法，对齐原版响度量级）。
// 必须每首歌重建：内部慢 RMS 估计（EMA k=0.02，τ≈1.2s）跨歌保留会让同一首歌
// 的增益轨迹取决于之前播过什么——表现为「同一首歌再播频谱形态不一样」。
let tapLoudnessNormalizer = createLoudnessNormalizer();

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
// 频谱预设（original/wide）：prepareSelfDecode 时烘进 decode 对象，下一首生效
let decodePreset = 'original';
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
let avDelayMs = AV_DELAY_DEFAULT_MS;
let spectrumScale = 1;
let spectrumSmoothing = 0.335;

// ===== 自解码链路状态（mp3/flac/aac，WebCodecs；tap+预读回退链路的状态在上方）=====
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
let decodeFrameDuration = 1152 / 44100;
let decodeCapFrames = 154;                        // line buffer 上限 ≈4s
// seek 重锚的映射资料：格式、原生采样率、每帧样本数、首帧字节偏移、文件字节数、
// 兜底码率，以及各格式的精确映射（mp3 vbr / flac seektable / aac 样本表）
let decodeSeek = null;
let workerHeld = false;                           // 已通知 Worker 暂停拉取（背压）
let currentBlobUrl = null;                        // 当前歌曲的 blob URL（可听路径）
let pendingRevokeUrls = [];                       // 仍被 element.src 引用的旧 blob，延后回收
let preparedCache = null;                         // 已备好的字节/blob（候选探测与 player.js 共用，避免整首下载两次）

const currentSong = () => getSong?.() || null;
const currentPlaying = () => !!isPlaying?.();

const resetQueue = () => {
  sigmaQueue.length = 0;
  // 归一化慢估计一并归零：换歌/停止后不允许把上一首的 RMS 记忆带进下一首
  tapLoudnessNormalizer = createLoudnessNormalizer();
};

// forceMeta：重推封面/歌名（HUD 窗口迟开/重开时补发元数据），不带 reset；
// forceReset：显式要求渲染端把平滑值立刻吸附到位（换歌/恢复播放）。
// 两者必须分开：idle keep-alive 只需要 forceMeta——周期性带 reset 会让 HUD 的
// 0.335 EMA 平滑被「瞬间吸附」打断，表现为频谱每隔几秒抽搐一次。
const sendSpectrum = (levels, forceMeta = false, forceReset = false) => {
  if (!sendFn) return;
  const song = currentSong();
  const key = `${song?.hash || ''}|${song?.img || ''}`;
  const changed = key !== metaKey;
  const payload = {
    levels: Array.from(levels),
    playing: currentPlaying()
  };
  if (changed || forceReset) {
    metaKey = key;
    payload.reset = true;
    payload.cover = song?.img || '';
    payload.title = song?.name || '';
    payload.author = song?.author || '';
  } else if (forceMeta) {
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
  // 响度归一化（FFT 输入前，与自解码链路同算法）：任意音源 → 原版等效幅度量级
  tapLoudnessNormalizer(samples);
  spectrumFft(samples, realOut, imagOut);
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const re = realOut[i];
    const im = imagOut[i];
    rawLevels[i] = Math.sqrt(re * re + im * im);
  }

  // 每帧直接入队并发送队首（~43Hz，与自解码链路同节拍）。旧的 0.25s 攒批
  // 会让队首每次突进 ~6 帧——运动变成 4Hz 顿挫，是 tap 链路「乱跳」的来源之一。
  sigmaQueue.push(Float32Array.from(rawLevels));
  if (sigmaQueue.length > QUEUE_MAX) sigmaQueue.shift();

  sendSpectrum(sigmaQueue[0]);
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

// 兜底的字节偏移估算：mp3 按首帧码率（CBR 近似）、flac 按全文件平均码率线性推。
// 只在没有任何精确映射时使用；门控由 currentTime 派生，偏差会逐步自校正。
const estimateByteOffset = (anchorTime) => {
  const seek = decodeSeek;
  if (!seek) return 0;
  const bytesPerSecond = seek.bitrate > 0 ? seek.bitrate / 8 : 0;
  if (!bytesPerSecond || !(anchorTime > 0)) return seek.firstOffset;
  const raw = seek.firstOffset + Math.floor(anchorTime * bytesPerSecond);
  return Math.min(raw, Math.max(seek.firstOffset, seek.fileBytes - 4));
};

// seek/resume 重锚的落点：优先各格式的精确映射（原版靠 jaad 的容器样本表 seek，
// 这里用同等精度的表），取不到才回退码率估算。返回值同时给出 Worker 的字节/样本
// 落点与主线程时间轴应锚定的秒数——两者一致时 seek 一次到位。
const resolveSeekAnchor = (anchorTime) => {
  const seconds = Math.max(0, Number(anchorTime) || 0);
  const fallback = { offset: estimateByteOffset(seconds), anchorTime: seconds, sampleIndex: -1, sampleTarget: -1 };
  const seek = decodeSeek;
  if (!seek) return fallback;

  if (seek.format === 'aac' && seek.sampleTable) {
    // 容器样本表就是精确映射：样本下标 ↔ 时间由 stts 前缀和决定，字节由 stsc/stsz 展开
    const index = mp4SampleIndexAt(seek.sampleTable, seconds);
    return {
      offset: seek.sampleTable.offsets[index],
      anchorTime: mp4SampleTimeSeconds(seek.sampleTable, index),
      sampleIndex: index,
      sampleTarget: -1
    };
  }

  if (seek.format === 'flac') {
    const targetSample = Math.round(seconds * seek.sampleRate);
    const point = flacSeekByteOffset(seek.seektable, targetSample);
    if (point) {
      return { offset: point.byteOffset, anchorTime: point.sampleOffset / seek.sampleRate, sampleIndex: -1, sampleTarget: -1 };
    }
    // 无 SEEKTABLE：偏移仍靠估算，但把目标样本交给 Worker——它按帧增量扫到
    // 覆盖该样本的帧边界，再用 'seek' 消息把实际起始样本回报回来
    return { offset: estimateByteOffset(seconds), anchorTime: seconds, sampleIndex: -1, sampleTarget: targetSample };
  }

  const exact = mp3TimeToByteOffset(seek.vbr, seconds);
  if (typeof exact === 'number' && Number.isFinite(exact)) {
    return {
      offset: Math.min(Math.max(0, exact), Math.max(seek.firstOffset, seek.fileBytes - 4)),
      anchorTime: seconds,
      sampleIndex: -1,
      sampleTarget: -1
    };
  }
  return fallback;
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
  if (data.type === 'seek') {
    // Worker 扫帧落定的实际起始样本（仅 flac 无 SEEKTABLE 路径）：时间轴锚到那里，
    // 同一 worker 的消息严格有序，本条一定先于该次 seek 之后的 'frame' 到达
    const rate = Number(data.sampleRate) || decodeSeek?.sampleRate || 44100;
    decodeAccumTime = Math.max(0, Number(data.sample) || 0) / rate;
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
    clearTimeout(decodeRaf);
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
  decodeSeek = null;
};

// 门控 tick 按音频帧节拍均匀调度（frameDuration 定时器），不再绑 rAF：
// 原版显示帧 [0] 的推进由解码线程 write() 阻塞节流驱动，严格 43.1Hz 均匀；
// rAF 与音频帧率不成整数比，每 tick 释放 0~2 帧且换帧时刻带 ±16.7ms 量化抖动，
// 经 τ≈50ms 低通后表现为可见拍频。改为音频时钟节拍后释放节奏与原版一致。
const decodeTick = () => {
  if (!decodeActive) return;
  decodeRaf = setTimeout(decodeTick, Math.max(4, decodeFrameDuration * 1000));
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
  // 自解码链路也在产出数据：刷新活跃度，让 idle keep-alive 定时器保持安静。
  // 之前只有 tap 链路（handleBlock）更新 lastBlockAt，而 handleBlock 在
  // decodeActive 时提前 return——自解码激活 2 秒后 idle 定时器每秒都会以
  // forceMeta 发送（旧实现连带 reset），把平滑值瞬间吸附到目标，造成周期性抽搐。
  lastBlockAt = performance.now();
};

// 重锚到 element.currentTime（seek/resume 时）：清两级缓冲，让 Worker 从算好的
// 字节/样本落点重启解码，帧时间轴以该落点的精确时间重新起算。
// 避免后退 seek 时显示队列卡在旧帧；有精确映射时 seek 一次到位（原版靠容器
// 样本表 seek，这里同精度）。
const resyncDecode = (anchorTime) => {
  if (!decodeActive || !decodeWorker) return;
  const resolved = resolveSeekAnchor(anchorTime);
  lineBuffer = [];
  displayQueue.clear();
  decodeAccumTime = resolved.anchorTime;
  workerHeld = false;
  try {
    decodeWorker.postMessage({
      type: 'restart',
      offset: resolved.offset,
      sampleIndex: resolved.sampleIndex,
      sampleTarget: resolved.sampleTarget
    });
  } catch { /* ignore */ }
};

// blob 归属：mp4 候选放行前由 library.js 调 prepareSelfDecode 做一次性探测，
// 探测成功即把结果暂存（一首一个），player.js 随后用同一 URL 取字节时直接复用，
// 避免整首歌下载两遍。缓存被替换/消费时旧 blob 由本模块回收。
const takePrepared = (url) => {
  if (!preparedCache || preparedCache.url !== url) return null;
  const media = preparedCache.media;
  preparedCache = null;   // 一次性：交出的 blob 由调用方（player.js）负责生命周期
  return media;
};

// player.js 装配播放时同步取走 mp4 闸门探测好的字节（无则 null，走边下边播）
export const consumePreparedMedia = (url) => takePrepared(url);

const stashPrepared = (url, media) => {
  if (preparedCache && preparedCache.url !== url) revokeBlobUrl(preparedCache.media?.src);
  preparedCache = { url, media };
};

// 供 library.js 判定 mp4 候选是否可放行：自解码准备（fetch 整首 + MP4 解封装 +
// AudioDecoder.isConfigSupported）全部成功才 true；任何一步失败 false（继续降档）。
export const probeSelfDecode = async ({ url, extName, budgetMs }) => {
  const media = await prepareSelfDecode({ url, extName, budgetMs });
  if (!media.decode) return false;
  stashPrepared(url, media);
  return true;
};

// 供 player.js 预热下一首：当前歌播放期间把下一首整首取字节 + 帧/容器/解码配置
// 预检，成功则按 URL 暂存。下一首 loadCurrent 的 consumePreparedMedia 命中后
// 直接用 blob 开播并挂自解码——路径从头恒定（不再依赖 0~8s 的后台 fetch 竞赛），
// 起播窗口内也不再有「元素流 + 后台 fetch + 预读」三路并发抢带宽。任何一步
// 失败静默不暂存，下一首回落原有的后台准备流程。
export const prefetchSelfDecode = async ({ url, extName, budgetMs = 8000 }) => {
  if (!url) return;
  try {
    const media = await prepareSelfDecode({ url, extName, budgetMs });
    if (media.decode) stashPrepared(url, media);
  } catch {
    /* 预热失败不影响任何现有行为 */
  }
};

// 准入判定 + fetch 字节 + 帧头/容器/解码配置预检；任何一步失败返回 { src: 远程URL, decode: null }
export const prepareSelfDecode = async ({ url, extName, budgetMs = 2500 }) => {
  const decision = decideSelfDecode({
    extName,
    hasAudioDecoder: typeof globalThis.AudioDecoder === 'function',
    spectrumEnabled: enabled
  });
  if (!decision.ok || !url) return { src: url, decode: null };
  const reused = takePrepared(url);
  if (reused?.decode) return reused;      // mp4 候选探测已备好同一份字节
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
    let offset = 0;                             // 首个可解码帧/样本的字节偏移
    let vbr = null;
    let seektable = null;
    let sampleTable = null;
    let blobType = 'audio/mpeg';
    if (format === 'flac') {
      parsed = findFirstFlacFrame(bytesView);
      if (!parsed) return { src: url, decode: null };
      offset = parsed.offset;
      const { stream } = parsed;
      streaminfo = stream.streaminfo;
      // description = 'fLaC'+全部元数据块前缀（Chromium flac 解码器靠 STREAMINFO
      // 初始化）。slice 复制一份：buffer 稍后整体转移给 Worker，不能共享视图
      description = bytesView.slice(stream.descriptionStart, stream.descriptionEnd);
      // 与 mp3 帧头同构的「header」：samplesPerFrame=块长（门控 B / line buffer
      // 上限推导用），bitrate=全文件平均码率（seek 重锚的兜底估算用）
      header = {
        sampleRate: parsed.header.sampleRate,
        channels: parsed.header.channels,
        samplesPerFrame: parsed.header.blocksize,
        frameDuration: parsed.header.frameDuration,
        bitrate: Math.round(stream.averageBitrate)
      };
      // SEEKTABLE 的字节偏移基准按帧头实测归一（带 ID3v2 前缀的文件里编码器
      // 记的可能是跳过标签之后的偏移），验不出帧头的条目丢弃
      seektable = validateFlacSeekTable(
        bytesView, stream.seektable, streaminfo, stream.descriptionStart
      );
      config = {
        codec: 'flac',
        sampleRate: header.sampleRate,
        numberOfChannels: header.channels,
        description
      };
      blobType = 'audio/flac';
    } else if (format === 'aac') {
      // 原版唯一的自解码格式：MP4 容器 → esds 的 AudioSpecificConfig +
      // stts/stsz/stsc/stco 展开的逐样本字节表（一条样本 = 一帧 = 1024 采样/声道）
      const demux = parseMp4Audio(bytesView);
      if (!demux) return { src: url, decode: null };
      offset = demux.count > 0 ? demux.offsets[0] : 0;
      header = {
        sampleRate: demux.sampleRate,
        channels: demux.channels,
        samplesPerFrame: demux.samplesPerFrame,
        frameDuration: demux.samplesPerFrame / demux.sampleRate,
        // 无 VBR 头可依：seek 一律走样本表精确映射，码率只做兜底（这里取平均）
        bitrate: demux.durationSeconds > 0
          ? Math.round(bytesView.byteLength * 8 / demux.durationSeconds)
          : Math.round(demux.avgBitrate || 0)
      };
      description = { codec: demux.codec, asc: demux.asc };
      sampleTable = {
        count: demux.count,
        offsets: demux.offsets,
        sizes: demux.sizes,
        durationsUs: demux.durationsUs
      };
      config = {
        codec: demux.codec,
        sampleRate: demux.sampleRate,
        numberOfChannels: demux.channels,
        description: demux.asc
      };
      blobType = 'audio/mp4';
    } else {
      parsed = findFirstMp3Frame(bytesView);
      if (!parsed) return { src: url, decode: null };
      offset = parsed.offset;
      header = parsed.header;
      // Xing/Info/VBRI 的 TOC 是 mp3 的精确 seek 映射（对应原版容器样本表）
      vbr = parseMp3VbrHeader(bytesView, parsed);
      config = { codec: 'mp3', sampleRate: header.sampleRate, numberOfChannels: header.channels };
    }
    if (typeof globalThis.AudioDecoder.isConfigSupported === 'function') {
      const support = await globalThis.AudioDecoder.isConfigSupported(config);
      if (support && support.supported === false) return { src: url, decode: null };
    }
    const blobUrl = URL.createObjectURL(new Blob([buffer], { type: blobType }));
    return {
      src: blobUrl,
      decode: {
        blobUrl, buffer, offset, config, header,
        format, description, streaminfo, vbr, seektable, sampleTable,
        fileBytes: bytesView.byteLength,
        preset: decodePreset
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
  // seek 重锚的映射资料。注意必须在 buffer 被转移给 Worker 之前取 fileBytes
  decodeSeek = {
    format: decode.format || 'mp3',
    sampleRate: header.sampleRate,
    samplesPerFrame: header.samplesPerFrame,
    firstOffset: decode.offset,
    fileBytes: Number(decode.fileBytes) || 0,
    bitrate: header.bitrate,
    vbr: decode.vbr || null,
    seektable: decode.seektable || null,
    sampleTable: decode.sampleTable || null
  };
  // 边下边播接管：元素可能已在播放，锚点必须与 decode 消息原子给定——
  // 若先从歌曲开头起泵再补 restart，竞态窗口内起始段帧会以锚点时间轴进
  // 队列（内容错位、条形弹跳）。resolveSeekAnchor 与 seek 同一精度。
  const anchorTime = Number(element.currentTime) || 0;
  const resolved = anchorTime > 0
    ? resolveSeekAnchor(anchorTime)
    : { offset: decode.offset, anchorTime: 0, sampleIndex: -1, sampleTarget: -1 };
  decodeAccumTime = resolved.anchorTime || 0;
  workerHeld = false;
  lineBuffer = [];
  displayQueue.clear();
  currentBlobUrl = decode.blobUrl;
  decodeActive = true;

  // 接管后预读元素已完成使命：它是 tap 链路的采集源，自解码激活后没人读它的
  // 频谱，但它（preload=auto + 跟随播放）会在整首歌剩余时间里继续全速下载
  // 同一文件——与主元素流经同一个 jello-media 代理抢带宽，慢网下直接把主
  // 元素缓冲掏空（「歌曲加载到一半就停」的并发来源之一）。失败回退时
  // handleDecodeFailure 会重新挂上 src，语义对称。
  try {
    if (lookaheadAudio) {
      lookaheadAudio.pause();
      lookaheadAudio.removeAttribute('src');
      lookaheadAudio.load();
    }
  } catch {
    /* ignore */
  }

  worker.onmessage = handleDecodeMessage;
  worker.onerror = (event) => handleDecodeFailure(event?.message || 'worker error');
  try {
    worker.postMessage({
      type: 'decode',
      buffer: decode.buffer,
      offset: resolved.offset,
      firstOffset: decode.offset,
      sampleIndex: resolved.sampleIndex,
      sampleTarget: resolved.sampleTarget,
      sampleRate: header.sampleRate,
      channels: header.channels,
      // 格式感知：flac 需要 description（'fLaC'+元数据块）与 streaminfo
      //（帧头采样率位 0 / 位宽位 0 的回退取值）；aac 需要 description
      //（{codec, asc}）与 sampleTable（MP4 样本表，Worker 只读副本，不转移）；
      // mp3 两者为 null 不影响
      format: decode.format || 'mp3',
      description: decode.description || null,
      streaminfo: decode.streaminfo || null,
      sampleTable: decode.sampleTable || null,
      preset: decode.preset === 'wide' ? 'wide' : 'original'
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

  decodeRaf = setTimeout(decodeTick, 0);
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

// 播放诊断快照：音频图是否绑定、context 状态、各级增益与预读元素状态
export const getAudioGraphDiagnostics = () => ({
  bound: sourceBound,
  context: context ? context.state : 'none',
  volumeGain: volumeGainNode ? volumeGainNode.gain.value : null,
  loudnessGain: loudnessGainNode ? loudnessGainNode.gain.value : null,
  mainTapGain: mainTapGainNode ? mainTapGainNode.gain.value : null,
  lookaheadGain: lookaheadTapGainNode ? lookaheadTapGainNode.gain.value : null,
  lookahead: lookaheadAudio
    ? `${lookaheadAudio.readyState}/${lookaheadAudio.paused ? 'paused' : 'playing'}`
    : 'none',
  decode: decodeActive
});

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
    // 不指定 sampleRate：AudioContext 用设备混音率（通常 48k）。
    // 对齐 sigmarebase——Java 侧 SourceDataLine 按曲目自身采样率开行缓冲，
    // 浏览器里的等价路径是「元素原生解码 → 混音率输出」，全程只重采样一次；
    // 之前强制 44.1k 让 Chromium 在可听路径上多做一次全曲重采样，原版没有这步。
    // 频谱的严格同构由自解码链路保证（Worker 恒用曲目原生采样率）。
    localContext = new AudioContextClass();
    const workletUrl = new URL('spectrum-tap.js', window.location.href).href;
    await localContext.audioWorklet.addModule(workletUrl);

    // tap 回退链路：按设备率折算「一个 MP3 帧」的采样数，块边界仍对齐帧边界
    //（frameSize / context.sampleRate ≡ 1152 / 44100）。
    // 但 1024 点窗覆盖的时长 = 512 帧 / 设备率，其**谱线间隔随设备率变化**：
    // 44.1kHz 下 43.0Hz/条，48kHz 下 46.9Hz/条（96kHz 下 93.8Hz）——同一根柱子
    // 对应的频段比原版偏高。tap 是设备率的降级链路，只在自解码不可用时兜底；
    // 想要严格同构（含 AAC 整帧几何）就走自解码链路，那里不受设备率影响。
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
  // 换歌/恢复播放的主动刷新：显式 reset（跨歌不做渐变过渡，立刻锚到当前帧）
  sendSpectrum(currentDisplayLevels(), true, true);
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
  if (SPECTRUM_PRESET_VALUES.includes(settings.spectrumPreset)) {
    // 只影响之后的 prepareSelfDecode（预设烘进每首歌的 decode 对象），当前歌不变
    decodePreset = settings.spectrumPreset;
  }
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
