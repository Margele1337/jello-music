// 频谱采集与 FFT：移植自所有者 sigmarebase 的 MusicManager/JavaFFT 频谱实现。
// AudioWorklet 每攒满一个 MP3 帧（1152 采样/声道）回调一次 1024 个交错 Int16 采样，
// 对帧首采样做 1024 点 FFT，得到 sigmarebase 频谱 HUD 使用的 114 个幅度值。
// 预读播放器与音画差补偿同样按旧实现移植：预读元素领先 leadMs 播放同一 URL，
// 它的 PCM 喂频谱（输出静音），复刻 sigmarebase 的音画关系。
const BAR_COUNT = 114;
const FFT_SIZE = 1024;
const QUEUE_MAX = 4;
const BATCH_SECONDS = 0.25;
const BATCH_MAX = 12;
const FRAME_SECONDS = 1152 / 44100;
const AV_DELAY_DEFAULT_MS = 590;

const createSpectrumFft = (size) => {
  const bits = Math.round(Math.log2(size));
  const reverseIndices = new Uint16Array(size);
  for (let i = 0; i < size; i += 1) {
    let reversed = 0;
    for (let bit = 0; bit < bits; bit += 1) reversed = (reversed << 1) | ((i >> bit) & 1);
    reverseIndices[i] = reversed;
  }

  return (realIn, realOut, imagOut) => {
    for (let i = 0; i < size; i += 1) realOut[reverseIndices[i]] = realIn[i];
    imagOut.fill(0);

    let blockEnd = 1;
    for (let blockSize = 2; blockSize <= size; blockSize <<= 1) {
      const deltaAngle = (2 * Math.PI) / blockSize;
      const sm2 = -Math.sin(-2 * deltaAngle);
      const sm1 = -Math.sin(-deltaAngle);
      const cm2 = Math.cos(-2 * deltaAngle);
      const cm1 = Math.cos(-deltaAngle);
      const w = 2 * cm1;

      for (let i = 0; i < size; i += blockSize) {
        let ar2 = cm2;
        let ar1 = cm1;
        let ai2 = sm2;
        let ai1 = sm1;
        for (let j = i, n = 0; n < blockEnd; j += 1, n += 1) {
          const ar0 = w * ar1 - ar2;
          ar2 = ar1;
          ar1 = ar0;
          const ai0 = w * ai1 - ai2;
          ai2 = ai1;
          ai1 = ai0;
          const k = j + blockEnd;
          const tr = ar0 * realOut[k] - ai0 * imagOut[k];
          const ti = ar0 * imagOut[k] + ai0 * realOut[k];
          realOut[k] = realOut[j] - tr;
          imagOut[k] = imagOut[j] - ti;
          realOut[j] += tr;
          imagOut[j] += ti;
        }
      }
      blockEnd = blockSize;
    }
  };
};

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

// 预读数据可用时用预读喂频谱，否则退回主播放器（保证频谱始终有数据）
const updateTapRouting = () => {
  const ready = isLookaheadReady();
  if (mainTapGainNode) mainTapGainNode.gain.value = ready ? 0 : 1;
  if (lookaheadTapGainNode) lookaheadTapGainNode.gain.value = ready ? 1 : 0;
};

const setLookaheadSource = (url) => {
  if (!lookaheadAudio) return;
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

// 与主播放器同步：位置领先 avDelayMs，播放/暂停/倍速跟随；force=true 强制重新定位
export const syncLookahead = (currentTime, playing, rate = 1, force = false) => {
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
    volumeGain.connect(localContext.destination);
    localSource.connect(mainTapGain);
    mainTapGain.connect(tap);
    lookaheadSource.connect(lookaheadTapGain);
    lookaheadTapGain.connect(tap);
    tap.connect(localContext.destination);

    // 提交到模块级状态（MediaElementSource 绑定后不可撤销，只有全部成功才赋值）
    context = localContext;
    sourceNode = localSource;
    volumeGainNode = volumeGain;
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
      sendSpectrum(sigmaQueue.length ? sigmaQueue[0] : rawLevels, true);
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
  }
  sendSpectrum(sigmaQueue.length ? sigmaQueue[0] : rawLevels, true);
};

export const stopSpectrum = (send) => {
  enabled = false;
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
  resetQueue();
  rawLevels.fill(0);
  audioListeners = [];
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
    avDelayMs = Math.max(0, Math.min(2000, settings.spectrumAvDelayMs));
  }
};

export const isSpectrumRunning = () => enabled;
