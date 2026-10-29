// mp3/FLAC/AAC(mp4) 帧与容器解析、精确 seek 映射、频谱门控纯逻辑：
// 主线程（spectrum.js）与自解码 Worker 共用，全部无 DOM/浏览器依赖，可在 Node 单测。
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

// ===== mp3 VBR 头（Xing / Info / VBRI）：精确 seek 重锚的字节映射 =====
// 原版是 MP4/AAC 顺序解码 + jaad 的 track.seek(time)（容器样本表精确），mp3 是
// 我们自己的扩展；这里用帧头里的 VBR 头把「时间 → 字节」做成精确映射，
// 取代按首帧码率的 CBR 线性估算。取不到（无 VBR 头 / 字段矛盾 / TOC 不合理）
// 一律返回 null，由调用方回退到码率估算。
//
// Xing/Info 位于首帧帧头之后的边信息末尾：
//   MPEG1 Layer3 立体声 4+32、单声道 4+17；MPEG2/2.5 立体声 4+21、单声道 4+13。
// VBRI（少数编码器）在同一区域，固定 4+32 起更常见，这里在首帧前 64 字节内
// 搜索四种标签，命中即按对应布局解析（搜不到就判没有，不做猜测）。
const XING_MAGIC = new Set(['Xing', 'InfO', 'XInO']);
const XING_FLAG_FRAMES = 0x1;
const XING_FLAG_BYTES = 0x2;
const XING_FLAG_TOC = 0x4;
const MP3_TOC_ENTRIES = 100;

const mp3SideInfoBytes = (header) => (header.version === 1
  ? (header.channels === 2 ? 32 : 17)
  : (header.channels === 2 ? 21 : 9));

// Xing TOC 的 100 个字节是「百分数」，语义上相对整个音频流；
// 这里统一换算成绝对文件偏移（锚在首帧起点，跨度取实际持有的音频字节），
// 再校验单调不减且落在文件内——任何异常都判 TOC 不可用。
const normalizeXingToc = (bytes, tocPos, { baseOffset, audioBytes, fileBytes }) => {
  const toc = new Array(MP3_TOC_ENTRIES);
  let previous = baseOffset;
  for (let i = 0; i < MP3_TOC_ENTRIES; i += 1) {
    const percent = bytes[tocPos + i];
    const offset = baseOffset + (percent / 100) * audioBytes;
    if (!(offset >= previous) || offset > fileBytes) return null;
    previous = offset;
    toc[i] = offset;
  }
  return toc;
};

const parseXingHeader = (bytes, frame, pos, frameEnd) => {
  if (pos + 8 > frameEnd) return null;
  const flags = readU32Be(bytes, pos + 4);
  let at = pos + 8;
  let frames = 0;
  let declaredBytes = 0;
  let tocPos = -1;
  if (flags & XING_FLAG_FRAMES) {
    if (at + 4 > frameEnd) return null;
    frames = readU32Be(bytes, at);
    at += 4;
  }
  if (flags & XING_FLAG_BYTES) {
    if (at + 4 > frameEnd) return null;
    declaredBytes = readU32Be(bytes, at);
    at += 4;
  }
  if (flags & XING_FLAG_TOC) {
    if (at + MP3_TOC_ENTRIES > frameEnd) return null;
    tocPos = at;
  }
  const { offset: baseOffset } = frame;
  const fileAudioBytes = Math.max(1, bytes.byteLength - baseOffset);
  // Xing 的 bytes 字段按规范含头部，跨度只用作合理性参考，主体仍以真实文件长度
  const audioBytes = declaredBytes > 0 && declaredBytes >= baseOffset
    ? Math.min(Math.max(1, declaredBytes - baseOffset), fileAudioBytes)
    : fileAudioBytes;
  const context = { baseOffset, audioBytes, fileBytes: bytes.byteLength };
  const toc = tocPos >= 0 ? normalizeXingToc(bytes, tocPos, context) : null;
  return {
    kind: 'xing',
    frames,
    baseOffset,
    audioBytes,
    toc,
    hasToc: !!toc
  };
};

const parseVbriHeader = (bytes, pos, frameEnd) => {
  if (pos + 36 > frameEnd) return null;
  const declaredBytes = readU32Be(bytes, pos + 16);
  const frames = readU32Be(bytes, pos + 20);
  const tocScale = readU16Be(bytes, pos + 24);
  const entryBytes = readU16Be(bytes, pos + 26);
  const declaredEntries = readU16Be(bytes, pos + 28);
  const tocPresent = readU16Be(bytes, pos + 30);
  if (!(frames > 0)) return null;
  const { offset: baseOffset } = frame;
  const fileAudioBytes = Math.max(1, bytes.byteLength - baseOffset);
  const audioBytes = declaredBytes > 0 && declaredBytes <= fileAudioBytes * 2
    ? Math.min(declaredBytes, fileAudioBytes) : fileAudioBytes;
  // VBRI 的 TOC 条目是「相对音频流起点的字节偏移」，按 scale/2^(8*entryBytes) 折算；
  // 常见编码器 scale=65536、entryBytes=2 → 系数 1
  const tocPos = pos + 36;
  let toc = null;
  if ([1, 2, 3, 4].includes(entryBytes)) {
    const usable = Math.min(declaredEntries, Math.floor(tocPresent / entryBytes), MP3_TOC_ENTRIES);
    if (usable >= 2 && tocPos + usable * entryBytes <= frameEnd) {
      const factor = (tocScale || 1) / (2 ** (8 * entryBytes));
      const scaled = new Array(MP3_TOC_ENTRIES);
      let previous = -1;
      let valid = true;
      for (let i = 0; i < usable; i += 1) {
        let value = 0;
        for (let b = 0; b < entryBytes; b += 1) value = value * 256 + bytes[tocPos + i * entryBytes + b];
        const offset = baseOffset + value * factor;
        if (!(offset >= previous) || offset > bytes.byteLength) { valid = false; break; }
        previous = offset;
        scaled[i] = offset;
      }
      if (valid) {
        // 尾部条目沿用最后一个已知值（单调性由 normalize 兜底校验）
        for (let i = usable; i < MP3_TOC_ENTRIES; i += 1) scaled[i] = scaled[usable - 1];
        toc = scaled;
      }
    }
  }
  return { kind: 'vbri', frames, baseOffset, audioBytes, toc, hasToc: !!toc };
};

// 在首帧的边信息区查找 VBR 头；返回 null 表示没有/不可信（→ 用码率估算）
export const parseMp3VbrHeader = (bytes, frame) => {
  if (!bytes || !frame?.header) return null;
  const { offset, header } = frame;
  const frameEnd = Math.min(offset + header.frameSize, bytes.byteLength);
  const preferred = offset + 4 + mp3SideInfoBytes(header);
  let pos = -1;
  let kind = '';
  const probe = (at) => {
    if (at < 0 || at + 4 > frameEnd) return '';
    const magic = fourCc(bytes, at);
    if (XING_MAGIC.has(magic)) return 'xing';
    return magic === 'VBRI' ? 'vbri' : '';
  };
  kind = probe(preferred);
  if (kind) pos = preferred;
  else {
    for (let at = offset + 4; at <= Math.min(preferred + 8, offset + 64); at += 1) {
      kind = probe(at);
      if (kind) { pos = at; break; }
    }
  }
  if (pos < 0) return null;
  const parsed = kind === 'vbri'
    ? parseVbriHeader(bytes, pos, frameEnd)
    : parseXingHeader(bytes, frame, pos, frameEnd);
  if (!parsed || !(parsed.frames > 0)) return null;
  // 时间→帧位置需要每帧样本数与采样率，直接绑在映射表上（同一首歌曲内恒定）
  return {
    ...parsed,
    sampleRate: header.sampleRate,
    samplesPerFrame: header.samplesPerFrame
  };
};

// VBR 头 → anchorTime 对应的字节偏移；TOC 优先（100 段线性插值），
// 退化时按头里的总帧数线性（仍是全文件平均，比首帧码率准）。不可用返回 null。
export const mp3TimeToByteOffset = (vbr, timeSeconds) => {
  if (!vbr || !(vbr.frames > 0) || !(vbr.baseOffset >= 0)) return null;
  const sampleRate = Number(vbr.sampleRate) || 0;
  const samplesPerFrame = Number(vbr.samplesPerFrame) || 0;
  if (!(sampleRate > 0) || !(samplesPerFrame > 0)) return null;
  const seconds = Math.max(0, Number(timeSeconds) || 0);
  const framePosition = Math.min(vbr.frames, (seconds * sampleRate) / samplesPerFrame);
  const fraction = framePosition / vbr.frames;
  if (vbr.toc) {
    const scaled = fraction * MP3_TOC_ENTRIES;
    const index = Math.min(MP3_TOC_ENTRIES - 1, Math.floor(scaled));
    const weight = Math.min(1, Math.max(0, scaled - index));
    const next = vbr.toc[Math.min(MP3_TOC_ENTRIES - 1, index + 1)];
    return Math.round(vbr.toc[index] + (next - vbr.toc[index]) * weight);
  }
  return Math.round(vbr.baseOffset + fraction * vbr.audioBytes);
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

// ===== 大端整数/四字符标签（VBR 头与 SEEKTABLE 共用；字节数组可能是
// Uint8Array 或 Buffer，一律用乘法读取避免 32 位溢出/符号问题）=====
const readU32Be = (bytes, at) => bytes[at] * 2 ** 24 + (bytes[at + 1] << 16)
  + (bytes[at + 2] << 8) + bytes[at + 3];
const readU16Be = (bytes, at) => (bytes[at] << 8) | bytes[at + 1];
const fourCc = (bytes, at) => String.fromCharCode(
  bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]
);

// SEEKTABLE 块（类型 3）负载：条目定长 18 字节 =
// 目标样本偏移(64) + 该帧的绝对字节偏移(64，相对文件开头) + 该帧样本数(32)。
// 严格校验：长度是 18 的整数倍、条目数合理、字节偏移在文件内、
// 样本偏移严格递增（乱序表 = 怪文件，判 null）；0xFFFF... 的「未知样本」占位条目丢弃。
const parseFlacSeekTableBlock = (bytes, pos, len, fileBytes) => {
  if (!(len > 0) || len % 18 !== 0) return null;
  const count = len / 18;
  if (count > 65536) return null;
  const readU64 = (at) => bytes[at] * 2 ** 56 + bytes[at + 1] * 2 ** 48
    + bytes[at + 2] * 2 ** 40 + bytes[at + 3] * 2 ** 32
    + bytes[at + 4] * 2 ** 24 + bytes[at + 5] * 2 ** 16
    + bytes[at + 6] * 2 ** 8 + bytes[at + 7];
  const entries = [];
  let previousSample = -1;
  for (let i = 0; i < count; i += 1) {
    const at = pos + i * 18;
    const sampleOffset = readU64(at);
    const byteOffset = readU64(at + 8);
    const sampleCount = readU32Be(bytes, at + 16);
    const isPlaceholder = (bytes[at] === 0xFF && bytes[at + 1] === 0xFF
      && bytes[at + 8] === 0xFF && bytes[at + 9] === 0xFF);
    if (isPlaceholder) continue;
    if (!(byteOffset > 0) || byteOffset + 4 > fileBytes) return null;
    if (!(sampleOffset > previousSample)) return null;
    previousSample = sampleOffset;
    entries.push({ sampleOffset, byteOffset, sampleCount });
  }
  return entries;
};

// 解析 'fLaC' 魔数 + 元数据块链（尊重 last-metadata-block 标志；ID3v2 前缀先跳过）。
// 返回 { streaminfo, descriptionStart, descriptionEnd, averageBitrate, seektable } 或 null。
// descriptionStart..descriptionEnd 即 WebCodecs flac config.description 的字节范围
// （'fLaC'+全部元数据块；正常文件 descriptionStart=0）。
// seektable 为 SEEKTABLE（类型 3）条目数组，缺省/非法时为 null。
export const parseFlacStream = (bytes) => {
  if (!bytes) return null;
  const descriptionStart = skipId3Tag(bytes);
  let pos = descriptionStart;
  if (pos + 4 > bytes.byteLength) return null;
  if (bytes[pos] !== 0x66 || bytes[pos + 1] !== 0x4C || bytes[pos + 2] !== 0x61
    || bytes[pos + 3] !== 0x43) return null;   // 'fLaC'
  pos += 4;
  let streaminfo = null;
  let seektable = null;
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
    } else if (type === 3 && !seektable) {
      // 非法/矛盾的 SEEKTABLE 判为「没有」，回退到帧扫描/码率估算，不拿它冒险
      seektable = parseFlacSeekTableBlock(bytes, pos, len, bytes.byteLength);
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
    seektable: seektable && seektable.length ? seektable : null,
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

// SEEKTABLE 偏移基准归一化：规范说字节偏移相对流起点，但带 ID3v2 前缀的文件里
// 编码器记的可能是「FLAC 流起点（跳过 ID3 之后）」。用帧头是否能解析出来做实测：
// 先按绝对偏移验，失败再按 +id3Shift 验，都不行就丢弃该条目（不拿它冒险）。
// 有效条目少于 2 个（无从插值/校验单调性）→ 返回 null，调用方回退扫帧/估算。
export const validateFlacSeekTable = (bytes, entries, streaminfo = null, id3Shift = 0) => {
  if (!Array.isArray(entries) || entries.length < 2 || !bytes) return null;
  const out = [];
  for (const entry of entries) {
    let offset = entry.byteOffset;
    if (!parseFlacFrameHeader(bytes, offset, streaminfo)) {
      offset = entry.byteOffset + id3Shift;
      if (!parseFlacFrameHeader(bytes, offset, streaminfo)) continue;
    }
    out.push({ sampleOffset: entry.sampleOffset, byteOffset: offset, sampleCount: entry.sampleCount });
  }
  if (out.length < 2) return null;
  for (let i = 1; i < out.length; i += 1) {
    if (!(out[i].sampleOffset > out[i - 1].sampleOffset)) return null;
    if (!(out[i].byteOffset > out[i - 1].byteOffset)) return null;
  }
  return out;
};

// SEEKTABLE → 目标样本的精确字节落点：取样本偏移不超过目标的最大条目。
// 条目的 byteOffset 一定是真实帧边界（FLAC 规范），所以 Worker 从那里起步
// 一定解得出帧；sampleOffset 给出该帧的精确样本号，主线程据此重设时间轴。
export const flacSeekByteOffset = (seektable, targetSample) => {
  if (!Array.isArray(seektable) || seektable.length === 0) return null;
  const target = Math.max(0, Number(targetSample) || 0);
  let low = 0;
  let high = seektable.length - 1;
  let best = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const entry = seektable[mid];
    if (entry.sampleOffset <= target) {
      best = entry;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (!best) best = seektable[0];   // 目标早于第一个 seek 点：从头开始最稳
  return { byteOffset: best.byteOffset, sampleOffset: best.sampleOffset };
};

// 无 SEEKTABLE 时的精确 seek：字节全量在内存，从首帧起按帧推进建增量索引
// （帧界 = 下一个 CRC 有效的同步字），找到覆盖目标样本的那一帧。
// 只在 Worker 线程调用（整文件字节扫描可达数十 MB，主线程会卡）。
export const createFlacFrameIndex = (firstFrameOffset) => ({
  offsets: [firstFrameOffset],
  samples: [0],
  done: false
});

// 把索引至少推进到「起始样本 > targetSample」的帧（或流末尾）
export const advanceFlacFrameIndex = (bytes, index, streaminfo, targetSample) => {
  if (!bytes || !index) return index;
  while (!index.done) {
    const lastOffset = index.offsets[index.offsets.length - 1];
    const header = parseFlacFrameHeader(bytes, lastOffset, streaminfo);
    if (!header) { index.done = true; break; }
    const nextOffset = findNextFlacFrameOffset(bytes, lastOffset + header.headerSize, streaminfo);
    if (nextOffset < 0) { index.done = true; break; }
    const nextSample = index.samples[index.samples.length - 1] + header.blocksize;
    index.offsets.push(nextOffset);
    index.samples.push(nextSample);
    if (nextSample > targetSample) break;
  }
  return index;
};

// 覆盖 targetSample 的帧：返回 { byteOffset, sample }（sample = 该帧起始样本，
// 一定 <= targetSample，除非目标在流末尾之外）；找不到返回 null
export const flacFrameForSample = (bytes, index, streaminfo, targetSample) => {
  if (!bytes || !index || !index.offsets.length) return null;
  advanceFlacFrameIndex(bytes, index, streaminfo, targetSample);
  const target = Math.max(0, Number(targetSample) || 0);
  let low = 0;
  let high = index.samples.length - 1;
  let best = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (index.samples[mid] <= target) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return { byteOffset: index.offsets[best], sample: index.samples[best] };
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

// 自解码链路准入判定（回退矩阵第一层；fetch/CORS、帧头/容器解析、解码器错误
// 属运行时失败，由调用方 try/catch 静默回退）。准入格式：
// - mp3 / flac：帧切分由 mp3Frame.js 自己做，WebCodecs 走 codec 'mp3' / 'flac'
// - mp4 / m4a / aac：归一化成 'aac'，先由 mp4Demux.js 解封装出 esds 的
//   AudioSpecificConfig 与逐样本字节范围，再走 codec 'mp4a.40.2'。
//   aac 是所有者 sigmarebase 原版的唯一解码格式（jaad 解 MP4/AAC）。
const SELF_DECODE_FORMATS = new Map([
  ['mp3', 'mp3'],
  ['flac', 'flac'],
  ['mp4', 'aac'],
  ['m4a', 'aac'],
  ['aac', 'aac']
]);

// 扩展名 → 自解码格式（不可自解码返回 null）
export const normalizeSelfDecodeFormat = (extName) => (
  SELF_DECODE_FORMATS.get(String(extName || '').toLowerCase()) || null
);

export const decideSelfDecode = ({ extName, hasAudioDecoder, spectrumEnabled }) => {
  if (!spectrumEnabled) return { ok: false, reason: 'spectrum-disabled' };
  const format = normalizeSelfDecodeFormat(extName);
  if (!format) return { ok: false, reason: 'ext-unsupported' };
  if (!hasAudioDecoder) return { ok: false, reason: 'webcodecs-unavailable' };
  return { ok: true, reason: '', format };
};

// ===== AudioData 帧 → 2048 点交错窗（Int16 量级，供 Worker FFT） =====
// readPlane(planeIndex) 按 f32-planar 语义返回单声道平面（frameSamples 个样本）。
// 注意 WebCodecs copyTo 请求 f32（交错）时平面含 frameSamples*channels 个样本，
// 按 frameSamples 分配的目的缓冲在立体声上必然溢出——必须请求 f32-planar。
// take 截断到前 pairsNeeded 对（mp3 1152/flac 4096 截断、aac 1024 恰好填满），
// 尾部补零；mono 复制 L 到 R。
export const mixFrameIntoWindow = ({ readPlane, frameSamples, channels, windowSamples, pairsNeeded, int16Scale }) => {
  const clampScale = (value) => (value < -1 ? -1 : value > 1 ? 1 : value) * int16Scale;
  const take = Math.min(frameSamples, pairsNeeded);
  const plane0 = readPlane(0);
  for (let i = 0; i < take; i += 1) {
    windowSamples[i * 2] = clampScale(plane0[i]);
  }
  if (channels > 1) {
    const plane1 = readPlane(1);
    for (let i = 0; i < take; i += 1) {
      windowSamples[i * 2 + 1] = clampScale(plane1[i]);
    }
  } else {
    for (let i = 0; i < take; i += 1) {
      windowSamples[i * 2 + 1] = windowSamples[i * 2];
    }
  }
  for (let i = take * 2; i < windowSamples.length; i += 1) windowSamples[i] = 0;
  return take;
};
