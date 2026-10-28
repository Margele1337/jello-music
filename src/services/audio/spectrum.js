import { SPECTRUM_BANDS, SPECTRUM_MAX } from '../../../shared/spectrum.js';

const MIN_HZ = 40;
const MAX_HZ = 16000;

export const computeBands = (data, sampleRate, count = SPECTRUM_BANDS) => {
  const bands = new Array(count).fill(0);
  if (!data?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return bands;

  const nyquist = sampleRate / 2;
  const maxHz = Math.min(MAX_HZ, nyquist);
  const ratio = maxHz / MIN_HZ;

  for (let index = 0; index < count; index += 1) {
    const low = MIN_HZ * Math.pow(ratio, index / count);
    const high = MIN_HZ * Math.pow(ratio, (index + 1) / count);
    const start = Math.max(0, Math.min(data.length - 1, Math.floor((low / nyquist) * data.length)));
    const end = Math.max(start + 1, Math.min(data.length, Math.ceil((high / nyquist) * data.length)));

    let sum = 0;
    for (let bin = start; bin < end; bin += 1) sum += data[bin];
    bands[index] = Math.min(SPECTRUM_MAX, Math.round((sum / (end - start)) * 1.1));
  }

  return bands;
};

let context = null;
let analyser = null;
let source = null;
let frequencyData = null;
let timer = null;
let sendBands = null;
let running = false;

const ensureGraph = (audio) => {
  if (!audio || typeof window === 'undefined') return false;
  if (context) {
    if (context.state === 'suspended') void context.resume();
    return true;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;

  try {
    context = new AudioContextClass();
    source = context.createMediaElementSource(audio);
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);
    analyser.connect(context.destination);
    if (context.state === 'suspended') void context.resume();
    return true;
  } catch (error) {
    console.warn('[spectrum] 音频分析初始化失败:', error.message);
    context = null;
    analyser = null;
    source = null;
    frequencyData = null;
    return false;
  }
};

export const startSpectrum = (audio, send) => {
  if (!ensureGraph(audio)) return false;
  sendBands = send;
  if (running) return true;

  running = true;
  const tick = () => {
    if (!running || !analyser || !frequencyData) return;
    analyser.getByteFrequencyData(frequencyData);
    try {
      sendBands?.(computeBands(frequencyData, context.sampleRate));
    } catch {
      /* IPC can disappear while the window reloads */
    }
  };

  tick();
  timer = setInterval(tick, 33);
  return true;
};

export const stopSpectrum = (send) => {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
  try {
    (send || sendBands)?.(new Array(SPECTRUM_BANDS).fill(0));
  } catch {
    /* ignore */
  }
};

export const isSpectrumRunning = () => running;
