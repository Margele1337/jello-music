// mp3 帧解析与频谱门控纯逻辑：主线程（spectrum.js）与自解码 Worker 共用，
// 全部无 DOM/浏览器依赖，可在 Node 单测。
//
// 常量对齐所有者 sigmarebase MusicManager.java：
// - 解码循环（~:383-407）：decode → sourceDataLine.write(pcm) → fft(整帧) →
//   visualizerData.add；size > 18 时 remove(0)。
// - 渲染循环（~:133-146）：每帧读 visualizerData.get(0)（不弹出）并向其平滑。
// SourceDataLine.write() 的阻塞使解码器恒定领先可听位置一个行缓冲，
// 叠加 18 深队列读 0 号位，实测净视觉领先 421.7ms——本模块的 B 门控复刻该领先量。

export const SIGMA_QUEUE_MAX = 18;        // visualizerData 上限（>18 remove(0)）
export const SIGMA_NET_LEAD_MS = 421.7;   // 原版实测净视觉领先
export const LINE_BUFFER_SECONDS = 4;     // 主线程 line buffer 上限（SourceDataLine 的类比物）
export const MP3_BAR_COUNT = 114;         // calculateAmplitudes 前半幅度取前 114 个

// MPEG1 Layer III 码率表（kbps，索引 1..14；0=free 不支持，15=bad）
const BITRATES_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
// MPEG2/2.5 Layer III 码率表
const BITRATES_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
// 采样率表按版本位索引：3=MPEG1，2=MPEG2，0=MPEG2.5（1=保留）
const SAMPLE_RATES = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000]
};

// 解析 offset 处的 mp3 帧头；无效返回 null。
// 仅支持 Layer III（酷狗音源均为 Layer III），free 码率帧不支持。
export const parseMp3FrameHeader = (bytes, offset = 0) => {
  if (!bytes || offset < 0 || offset + 4 > bytes.byteLength) return null;
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 !== 0xFF || (b1 & 0xE0) !== 0xE0) return null;          // 11 位帧同步
  const versionBits = (b1 >> 3) & 0x03;
  if (versionBits === 1) return null;                              // 保留版本位
  const layerBits = (b1 >> 1) & 0x03;
  if (layerBits !== 1) return null;                                // 只解 Layer III
  const bitrateIndex = (b2 >> 4) & 0x0F;
  if (bitrateIndex === 0 || bitrateIndex === 15) return null;      // free/bad
  const sampleRateIndex = (b2 >> 2) & 0x03;
  if (sampleRateIndex === 3) return null;                          // 保留采样率位
  const rates = SAMPLE_RATES[versionBits];
  if (!rates) return null;
  const mpeg1 = versionBits === 3;
  const samplesPerFrame = mpeg1 ? 1152 : 576;
  const bitrate = (mpeg1 ? BITRATES_MPEG1_L3[bitrateIndex] : BITRATES_MPEG2_L3[bitrateIndex]) * 1000;
  const sampleRate = rates[sampleRateIndex];
  const padding = (b2 >> 1) & 1;
  const frameSize = Math.floor((samplesPerFrame / 8) * bitrate / sampleRate) + padding;
  if (frameSize < 4) return null;
  const channelMode = (b3 >> 6) & 0x03;
  return {
    version: mpeg1 ? 1 : (versionBits === 2 ? 2 : 2.5),
    sampleRate,
    channels: channelMode === 3 ? 1 : 2,
    bitrate,
    samplesPerFrame,
    frameSize,
    frameDuration: samplesPerFrame / sampleRate,
    offset
  };
};

// ID3v2 标签长度：'ID3' + 版本(2B) + flags(1B) + 28 位 synchsafe 大小
export const skipId3Tag = (bytes) => {
  if (!bytes || bytes.byteLength < 10) return 0;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  const size = ((bytes[6] & 0x7F) << 21) | ((bytes[7] & 0x7F) << 14)
    | ((bytes[8] & 0x7F) << 7) | (bytes[9] & 0x7F);
  return Math.min(10 + size, bytes.byteLength);
};

// 从 from 起扫描第一个「真」帧同步：ID3 填充/垃圾数据里可能出现伪 0xFFE*，
// 因此要求 offset+frameSize 处（若字节足够）也能解析出帧头才算命中。
const scanForValidFrame = (bytes, from) => {
  for (let offset = Math.max(0, from); offset + 4 <= bytes.byteLength; offset += 1) {
    const header = parseMp3FrameHeader(bytes, offset);
    if (!header) continue;
    const next = offset + header.frameSize;
    if (next + 4 <= bytes.byteLength && !parseMp3FrameHeader(bytes, next)) continue;
    return { offset, header };
  }
  return null;
};

// 跳过 ID3 后定位首个有效帧；找不到返回 null（→ 静默回退 tap 链路）
export const findFirstMp3Frame = (bytes) => {
  if (!bytes) return null;
  return scanForValidFrame(bytes, skipId3Tag(bytes));
};

// 伪同步后重新对齐（Worker 解码中途字节损坏时用）；找不到返回 -1
export const findNextFrameOffset = (bytes, from) => {
  const found = scanForValidFrame(bytes, from);
  return found ? found.offset : -1;
};

// 门控帧数 B：frameTime <= currentTime + B*frameDuration 时放入显示队列。
// B = round(421.7ms / frameDuration) + 17：队列满 18 时读 0 号位比门控前沿
// 落后 17 帧，净领先 = (B-17) 帧 ≈ 421.7ms（44.1kHz 下 B = 33）。
export const deriveGateFrames = (sampleRate, samplesPerFrame = 1152) => {
  const frameDurationMs = (samplesPerFrame / sampleRate) * 1000;
  return Math.round(SIGMA_NET_LEAD_MS / frameDurationMs) + SIGMA_QUEUE_MAX - 1;
};

// 门控前沿（秒）：currentTime + B*frameDuration + 用户微调
export const gateFrontierSeconds = (currentTime, gateFrames, frameDuration, trimSeconds = 0) => (
  Math.max(0, Number(currentTime) || 0) + gateFrames * frameDuration + (Number(trimSeconds) || 0)
);

// 把 line buffer 中 time <= 前沿的帧依序放入显示队列（add；>18 shift，对齐原版）
export const releaseGatedFrames = (lineBuffer, frontierSeconds, displayQueue) => {
  let released = 0;
  while (lineBuffer.length && lineBuffer[0].time <= frontierSeconds) {
    displayQueue.add(lineBuffer.shift().magnitudes);
    released += 1;
  }
  return released;
};

// 18 深显示队列：add 后超限 shift(0)，渲染读 get(0) 不弹出（MusicManager:134）
export class SigmaDisplayQueue {
  constructor(max = SIGMA_QUEUE_MAX) {
    this.max = max;
    this.frames = [];
  }

  add(frame) {
    this.frames.push(frame);
    while (this.frames.length > this.max) this.frames.shift();
  }

  peek() {
    return this.frames.length ? this.frames[0] : null;
  }

  get size() {
    return this.frames.length;
  }

  clear() {
    this.frames.length = 0;
  }
}

// line buffer 帧数上限（≈4 秒），超出即通知 Worker 暂停拉取（背压）
export const lineBufferCapFrames = (sampleRate, samplesPerFrame = 1152) => (
  Math.max(1, Math.ceil((LINE_BUFFER_SECONDS * sampleRate) / samplesPerFrame))
);

// 自解码链路准入判定（回退矩阵第一层；fetch/CORS、帧头解析、解码器错误
// 属运行时失败，由调用方 try/catch 静默回退）
export const decideSelfDecode = ({ extName, hasAudioDecoder, spectrumEnabled }) => {
  if (!spectrumEnabled) return { ok: false, reason: 'spectrum-disabled' };
  if (String(extName || '').toLowerCase() !== 'mp3') return { ok: false, reason: 'ext-not-mp3' };
  if (!hasAudioDecoder) return { ok: false, reason: 'webcodecs-unavailable' };
  return { ok: true, reason: '' };
};
