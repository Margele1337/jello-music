// mp3/FLAC 帧解析与频谱门控纯逻辑：主线程（spectrum.js）与自解码 Worker 共用，
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

// ===== FLAC 帧解析（与 mp3 同一管线的格式感知扩展）=====
// 文件结构：'fLaC' 魔数 + 元数据块链（首块必为 STREAMINFO，末块置 last 标志）
// + 音频帧序列（同步字 0xFFF8 固定块长 / 0xFFF9 可变块长，帧头带 CRC-8）。
// WebCodecs 的 flac 解码器要求 config.description 携带 'fLaC'+元数据块前缀
// （Chromium 从 STREAMINFO 取采样率/声道初始化 ffmpeg 解码器），parseFlacStream
// 返回的 descriptionStart/End 就是这个字节范围。

// FLAC 帧头采样率位（0=取 STREAMINFO，13=保留，14/15=帧头尾部 8 位 kHz / 16 位 Hz）
const FLAC_SAMPLE_RATES = [
  0, 88200, 176400, 192000, 8000, 16000, 22050, 24000,
  32000, 44100, 48000, 50000, 55125, -1, -2, -3
];
// 帧头样本位宽位（0=取 STREAMINFO，3=保留）
const FLAC_BITS_PER_SAMPLE = [0, 8, 12, -1, 16, 20, 24, 32];

// FLAC 帧头 CRC-8：多项式 x^8+x^2+x+1（0x07），初值 0，不反转——逐字节即可，
// 帧头最长 16 字节，无需查表
const flacCrc8 = (bytes, from, to) => {
  let crc = 0;
  for (let i = from; i < to; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
    }
  }
  return crc;
};

// FLAC 风格变长整数（1..7 字节 UTF-8 样式，36 位上限）：帧号（固定块长）
// 或样本号（可变块长）。非法续字节返回 null
const readFlacUtf8Int = (bytes, pos) => {
  if (pos >= bytes.byteLength) return null;
  const first = bytes[pos];
  let length;
  let value;
  if ((first & 0x80) === 0) { length = 1; value = first; }
  else if ((first & 0xE0) === 0xC0) { length = 2; value = first & 0x1F; }
  else if ((first & 0xF0) === 0xE0) { length = 3; value = first & 0x0F; }
  else if ((first & 0xF8) === 0xF0) { length = 4; value = first & 0x07; }
  else if ((first & 0xFC) === 0xF8) { length = 5; value = first & 0x03; }
  else if ((first & 0xFE) === 0xFC) { length = 6; value = first & 0x01; }
  else if (first === 0xFE) { length = 7; value = 0; }
  else return null;
  if (pos + length > bytes.byteLength) return null;
  for (let i = 1; i < length; i += 1) {
    const cont = bytes[pos + i];
    if ((cont & 0xC0) !== 0x80) return null;
    value = value * 64 + (cont & 0x3F);
  }
  return { value, end: pos + length };
};

// 解析 STREAMINFO 块负载（34 字节）；长度不足或采样率为 0 返回 null
const parseFlacStreamInfoBlock = (bytes, pos, len) => {
  if (len < 34 || pos + 34 > bytes.byteLength) return null;
  const minBlockSize = (bytes[pos] << 8) | bytes[pos + 1];
  const maxBlockSize = (bytes[pos + 2] << 8) | bytes[pos + 3];
  const minFrameSize = (bytes[pos + 4] << 16) | (bytes[pos + 5] << 8) | bytes[pos + 6];
  const maxFrameSize = (bytes[pos + 7] << 16) | (bytes[pos + 8] << 8) | bytes[pos + 9];
  // 64 位字段：采样率 20 位 | 声道数-1 3 位 | 位宽-1 5 位 | 总样本数 36 位
  const sampleRate = (bytes[pos + 10] << 12) | (bytes[pos + 11] << 4) | (bytes[pos + 12] >> 4);
  const channels = ((bytes[pos + 12] >> 1) & 0x07) + 1;
  const bitsPerSample = (((bytes[pos + 12] & 0x01) << 4) | (bytes[pos + 13] >> 4)) + 1;
  if (!(sampleRate > 0) || !(minBlockSize > 0) || !(maxBlockSize > 0)) return null;
  return {
    sampleRate,
    channels,
    bitsPerSample,
    minBlockSize,
    maxBlockSize,
    minFrameSize,
    maxFrameSize,
    // 36 位总样本数按高低两段拼（位运算只有 32 位）
    totalSamples: ((bytes[pos + 13] & 0x0F) * 4294967296)
      + ((bytes[pos + 14] << 24) >>> 0) + (bytes[pos + 15] << 16) + (bytes[pos + 16] << 8) + bytes[pos + 17]
  };
};

// 解析 'fLaC' 魔数 + 元数据块链（尊重 last-metadata-block 标志；ID3v2 前缀先跳过）。
// 返回 { streaminfo, descriptionStart, descriptionEnd, averageBitrate } 或 null。
// descriptionStart..descriptionEnd 即 WebCodecs flac config.description 的字节范围
// （'fLaC'+全部元数据块；正常文件 descriptionStart=0）。
export const parseFlacStream = (bytes) => {
  if (!bytes) return null;
  const descriptionStart = skipId3Tag(bytes);
  let pos = descriptionStart;
  if (pos + 4 > bytes.byteLength) return null;
  if (bytes[pos] !== 0x66 || bytes[pos + 1] !== 0x4C || bytes[pos + 2] !== 0x61
    || bytes[pos + 3] !== 0x43) return null;   // 'fLaC'
  pos += 4;
  let streaminfo = null;
  let last = false;
  while (!last) {
    if (pos + 4 > bytes.byteLength) return null;   // 元数据块头都不完整（截断）
    const flags = bytes[pos];
    last = (flags & 0x80) !== 0;
    const type = flags & 0x7F;
    const len = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    pos += 4;
    if (pos + len > bytes.byteLength) return null;   // 块负载截断
    if (type === 0) {
      streaminfo = parseFlacStreamInfoBlock(bytes, pos, len);
      if (!streaminfo) return null;
    }
    pos += len;
  }
  if (!streaminfo) return null;
  // 平均码率：seek 重锚的字节偏移估算用（FLAC 无 CBR 概念，取全文件均值）
  const audioBytes = Math.max(0, bytes.byteLength - pos);
  const averageBitrate = streaminfo.totalSamples > 0
    ? (audioBytes * 8 * streaminfo.sampleRate) / streaminfo.totalSamples
    : 0;
  return {
    streaminfo,
    descriptionStart,
    descriptionEnd: pos,
    averageBitrate
  };
};

// 解析 offset 处的 FLAC 帧头（含 CRC-8 校验，垃圾同步几乎必被剔除）；无效返回 null。
// streaminfo 用于采样率位 0 / 位宽位 0 的回退取值（可为 null，此时这两种编码判无效）。
// 返回 { offset, headerSize, blocksize, samplesPerFrame, sampleRate, channels,
//        bitsPerSample, frameDuration, variableBlocking, frameIndex }；
// frameDuration = blocksize / sampleRate（与 mp3 的 samplesPerFrame/sampleRate 同构）。
export const parseFlacFrameHeader = (bytes, offset = 0, streaminfo = null) => {
  if (!bytes || offset < 0 || offset + 5 > bytes.byteLength) return null;
  if (bytes[offset] !== 0xFF) return null;
  const b1 = bytes[offset + 1];
  if ((b1 & 0xFE) !== 0xF8) return null;             // 14 位同步 0x3FFE + 保留位 0
  const variableBlocking = (b1 & 0x01) === 1;        // 0=固定块长 1=可变块长
  const b2 = bytes[offset + 2];
  const blockBits = (b2 >> 4) & 0x0F;
  const rateBits = b2 & 0x0F;
  const b3 = bytes[offset + 3];
  if (b3 & 0x01) return null;                        // 帧头保留位必须为 0
  const channelAssign = (b3 >> 4) & 0x0F;
  const sizeBits = (b3 >> 1) & 0x07;
  if (blockBits === 0 || rateBits === 13 || channelAssign > 10 || sizeBits === 3) return null;

  let pos = offset + 4;
  const id = readFlacUtf8Int(bytes, pos);            // 帧号（固定）或样本号（可变）
  if (!id) return null;
  pos = id.end;

  let blocksize;
  if (blockBits === 1) blocksize = 192;
  else if (blockBits <= 5) blocksize = 576 * (2 ** (blockBits - 2));
  else if (blockBits === 6) {                        // 帧头尾部 8 位值 +1
    if (pos + 1 > bytes.byteLength) return null;
    blocksize = bytes[pos] + 1;
    pos += 1;
  } else if (blockBits === 7) {                      // 帧头尾部 16 位值 +1
    if (pos + 2 > bytes.byteLength) return null;
    blocksize = ((bytes[pos] << 8) | bytes[pos + 1]) + 1;
    pos += 2;
  } else blocksize = 256 * (2 ** (blockBits - 8));

  let sampleRate;
  if (rateBits === 0) {                              // 取 STREAMINFO
    if (!streaminfo) return null;
    sampleRate = streaminfo.sampleRate;
  } else if (rateBits === 14) {                      // 帧头尾部 8 位 kHz
    if (pos + 1 > bytes.byteLength) return null;
    sampleRate = bytes[pos] * 1000;
    pos += 1;
  } else if (rateBits === 15) {                      // 帧头尾部 16 位 Hz
    if (pos + 2 > bytes.byteLength) return null;
    sampleRate = (bytes[pos] << 8) | bytes[pos + 1];
    pos += 2;
  } else {
    sampleRate = FLAC_SAMPLE_RATES[rateBits];
    if (!(sampleRate > 0)) return null;
  }

  if (pos + 1 > bytes.byteLength) return null;       // CRC-8 字节
  if (flacCrc8(bytes, offset, pos) !== bytes[pos]) return null;
  pos += 1;

  const bitsPerSample = sizeBits === 0
    ? (streaminfo ? streaminfo.bitsPerSample : 0)
    : FLAC_BITS_PER_SAMPLE[sizeBits];
  return {
    offset,
    headerSize: pos - offset,
    blocksize,
    samplesPerFrame: blocksize,
    sampleRate,
    channels: channelAssign <= 7 ? channelAssign + 1 : 2,   // 8/9/10 = 侧声道立体声对
    bitsPerSample,
    frameDuration: blocksize / sampleRate,
    variableBlocking,
    frameIndex: id.value
  };
};

// 从 from 起扫描下一个通过 CRC 校验的 FLAC 帧同步；找不到返回 -1。
// 帧字节长度可变且头部不含长度字段，「帧尾=下一帧同步」是唯一切帧依据
export const findNextFlacFrameOffset = (bytes, from, streaminfo = null) => {
  if (!bytes) return -1;
  for (let offset = Math.max(0, from); offset + 5 <= bytes.byteLength; offset += 1) {
    if (bytes[offset] !== 0xFF) continue;
    if ((bytes[offset + 1] & 0xFE) !== 0xF8) continue;
    if (parseFlacFrameHeader(bytes, offset, streaminfo)) return offset;
  }
  return -1;
};

// 定位首个有效 FLAC 帧；找不到返回 null（→ 静默回退 tap 链路）。
// 返回 { offset, header, stream }：stream 内含 descriptionStart/End 与 streaminfo
export const findFirstFlacFrame = (bytes) => {
  const stream = parseFlacStream(bytes);
  if (!stream) return null;
  const offset = findNextFlacFrameOffset(bytes, stream.descriptionEnd, stream.streaminfo);
  if (offset < 0) return null;
  const header = parseFlacFrameHeader(bytes, offset, stream.streaminfo);
  if (!header) return null;
  return { offset, header, stream };
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
// 属运行时失败，由调用方 try/catch 静默回退）。准入格式：mp3 与 flac，
// 二者都走 Chromium WebCodecs AudioDecoder（codec 'mp3' / 'flac'）
const SELF_DECODE_FORMATS = new Set(['mp3', 'flac']);
export const decideSelfDecode = ({ extName, hasAudioDecoder, spectrumEnabled }) => {
  if (!spectrumEnabled) return { ok: false, reason: 'spectrum-disabled' };
  const format = String(extName || '').toLowerCase();
  if (!SELF_DECODE_FORMATS.has(format)) return { ok: false, reason: 'ext-unsupported' };
  if (!hasAudioDecoder) return { ok: false, reason: 'webcodecs-unavailable' };
  return { ok: true, reason: '', format };
};
