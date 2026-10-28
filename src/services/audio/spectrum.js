// 频谱采集与 FFT：移植自所有者 sigmarebase 的 MusicManager/JavaFFT 频谱实现。
// AudioWorklet 每攒满一个 MP3 帧（1152 采样/声道）回调一次 1024 个交错 Int16 采样，
// 对帧首采样做 1024 点 FFT，得到 sigmarebase 频谱 HUD 使用的 114 个幅度值。
const BAR_COUNT = 114;
const FFT_SIZE = 1024;

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

let context = null;
let sourceNode = null;
let tapNode = null;
let starting = null;
let enabled = false;
let getSong = null;
let isPlaying = null;
let sendFn = null;
let idleTimer = null;
let lastBlockAt = 0;
let metaKey = '';

const currentSong = () => getSong?.() || null;
const currentPlaying = () => !!isPlaying?.();

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

  if (!currentPlaying()) {
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

  // 直接发送当前帧，避免队列带来的音画延迟；HUD 侧仍按 sigmarebase 0.335 平滑
  sendSpectrum(rawLevels);
};

const ensureGraph = async (audio) => {
  if (!audio || typeof window === 'undefined') return false;
  if (context) {
    if (context.state === 'suspended') await context.resume();
    return true;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;

  try {
    context = new AudioContextClass();
    const workletUrl = new URL('spectrum-tap.js', window.location.href).href;
    await context.audioWorklet.addModule(workletUrl);

    const frameSize = Math.max(1, Math.round((1152 * context.sampleRate) / 44100));
    sourceNode = context.createMediaElementSource(audio);
    tapNode = new AudioWorkletNode(context, 'spectrum-tap', {
      numberOfOutputs: 1,
      processorOptions: { frameSize }
    });

    sourceNode.connect(tapNode);
    tapNode.connect(context.destination);
    sourceNode.connect(context.destination);
    tapNode.port.onmessage = (event) => handleBlock(event.data);

    if (context.state === 'suspended') await context.resume();
    return true;
  } catch (error) {
    console.warn('[spectrum] 音频频谱初始化失败:', error.message);
    try {
      await context?.close();
    } catch {
      /* ignore */
    }
    context = null;
    sourceNode = null;
    tapNode = null;
    return false;
  }
};

export const startSpectrum = async (audio, handlers = {}) => {
  getSong = handlers.getSong || null;
  isPlaying = handlers.isPlaying || null;
  sendFn = handlers.send || null;
  if (!sendFn) return false;

  enabled = true;
  if (!starting) {
    starting = ensureGraph(audio).finally(() => {
      starting = null;
    });
  }
  const ready = await starting;
  if (!ready) {
    enabled = false;
    return false;
  }
  if (!enabled) return false;

  metaKey = '';
  sendSpectrum(rawLevels, true);

  if (!idleTimer) {
    idleTimer = setInterval(() => {
      if (!enabled) return;
      if (performance.now() - lastBlockAt < 2000) return;
      sendSpectrum(rawLevels, true);
    }, 1000);
  }
  return true;
};

export const refreshSpectrum = () => {
  if (!enabled) return;
  if (!currentPlaying()) rawLevels.fill(0);
  sendSpectrum(rawLevels);
};

export const stopSpectrum = (send) => {
  enabled = false;
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
  rawLevels.fill(0);
  try {
    (send || sendFn)?.({ levels: Array.from(rawLevels), playing: false, reset: true });
  } catch {
    /* ignore */
  }
};

export const isSpectrumRunning = () => enabled;
