// mp3/FLAC/AAC 自解码 Worker：Chromium 内建 WebCodecs AudioDecoder（无需任何 npm 依赖）。
// 对齐所有者 sigmarebase MusicManager 解码循环（~:383-407）：
//   decode → 写入行缓冲（阻塞背压）→ fft(整帧) → visualizerData.add
// 浏览器里没有 SourceDataLine，背压由主线程 line buffer 上限（≈4s）驱动：
// 主线程发 hold/resume 消息代替 write() 的阻塞。
//
// 每帧流程：EncodedAudioChunk(一个编解码帧) → AudioDecoder → AudioData(f32)
// → 取帧首 2048 个交错采样并缩放到 Int16 量级 → 2048 点 FFT →
// sqrt(re²+im²) 前半幅度取前 114 个 → postMessage 给主线程做门控。
// 原版对 AAC 整帧（1024×2ch = 2048 交错采样）做 FFT：AAC 路径帧样本数正好
// 是 1024/声道，2048 点窗**不截断**，与原版的 FFT 几何完全一致；
// mp3 帧 1152×2ch = 2304 交错采样、FLAC 常规块 4096/ch = 8192 交错采样，
// 都截断到 2048 保持同样的 2 的幂窗几何（2 的幂 FFT 是既有决定，不换 Bluestein）。
// Int16 量级是 HUD 公式 sqrt(x)/12 − 5（上限 2.256e7 / 低音参考 1000/4750）的前提。
//
// 三种格式的帧来源各不相同：
// - mp3：帧头自带 frameSize，逐字节同步（mp3Frame.js parseMp3FrameHeader）
// - flac：帧头无长度字段，帧尾=下一个 CRC 校验通过的同步字；config.description
//   携带 'fLaC'+元数据块前缀（Chromium 的 flac 解码器要从 STREAMINFO 初始化）
// - aac：主线程用 mp4Demux.js 解出的逐样本表（stsz/stsc/stco 展开的
//   offsets/sizes/durationsUs），一条样本 = 一帧 = 1024 采样/声道
//
// 解码恒 1x：倍速由可听元素处理（原版无倍速功能），帧时间轴与倍速无关。
import { createSpectrumFft } from './fft.js';
import {
  createFlacFrameIndex,
  findNextFlacFrameOffset,
  findNextFrameOffset,
  flacFrameForSample,
  mixFrameIntoWindow,
  mixFrameIntoWindowPacked,
  parseFlacFrameHeader,
  parseMp3FrameHeader
} from './mp3Frame.js';

const FFT_SIZE = 2048;          // 预设 2（wide）：全帧真立体声交错
const ORIGINAL_FFT_SIZE = 1024; // 预设 1（original）：原版 1024 点（mp3/flac 帧首
                                // 1024 交错采样；aac 每帧值 = 打包 L,R 对）
const BAR_COUNT = 114;
const MAX_DECODE_QUEUE = 16;   // AudioDecoder 入队上限（帧级背压）
const INT16_SCALE = 32768;     // 与 tap 链路 spectrum-tap.js 的 Int16 量纲一致

const fftCache = new Map();
const getFft = (size) => {
  if (!fftCache.has(size)) fftCache.set(size, createSpectrumFft(size));
  return fftCache.get(size);
};
let fftSize = FFT_SIZE;
let fftRun = getFft(FFT_SIZE);
let windowSamples = new Float32Array(FFT_SIZE);
let realOut = new Float32Array(FFT_SIZE);
let imagOut = new Float32Array(FFT_SIZE);
let original = true;
let decoder = null;
let decoderConfig = null;
let bytes = null;
let format = 'mp3';
let streaminfo = null;
let nextOffset = 0;
let timestampUs = 0;
let hold = false;
let stopped = false;
let flushScheduled = false;
let planeScratch = null;
// AAC：主线程解封装好的样本表 + 当前样本下标
let sampleTable = null;
let nextSample = 0;
// FLAC：无 SEEKTABLE 时精确 seek 用的增量帧索引（从首帧起，样本号绝对）
let flacIndex = null;
let flacSampleRate = 44100;

const postError = (message) => {
  if (stopped) return;
  try {
    self.postMessage({ type: 'error', message: String(message || 'unknown') });
  } catch {
    /* 主线程可能已 terminate */
  }
};

// 格式感知帧头解析：mp3 帧头自带 frameSize；flac 帧头只有 headerSize（无长度字段）
const parseFrameAt = (offset) => (format === 'flac'
  ? parseFlacFrameHeader(bytes, offset, streaminfo)
  : parseMp3FrameHeader(bytes, offset));

// 伪同步/损坏后重新对齐帧同步
const resyncFrom = (offset) => (format === 'flac'
  ? findNextFlacFrameOffset(bytes, offset, streaminfo)
  : findNextFrameOffset(bytes, offset));

// 帧字节终点：flac 帧长可变且头部无长度，帧尾=下一个 CRC 有效的同步字；
// 末帧到文件尾时裁掉可能存在的 ID3v1 尾标签（128 字节 'TAG'，混进 chunk 会解码报错）
const frameEnd = (header) => {
  if (format !== 'flac') return Math.min(header.offset + header.frameSize, bytes.byteLength);
  const next = findNextFlacFrameOffset(bytes, header.offset + header.headerSize, streaminfo);
  if (next >= 0) return next;
  let end = bytes.byteLength;
  if (end >= 128 && bytes[end - 128] === 0x54 && bytes[end - 127] === 0x41
    && bytes[end - 126] === 0x47) end -= 128;
  return Math.max(header.offset + header.headerSize, end);
};

// 字节流格式（mp3/flac）逐帧切分喂解码器
const pumpStreamFrames = () => {
  while (decoder.decodeQueueSize < MAX_DECODE_QUEUE && nextOffset + 4 <= bytes.byteLength) {
    let header = parseFrameAt(nextOffset);
    if (!header) {
      // 字节流损坏/估算偏移落在帧中间：向前扫描重新对齐帧同步
      const resync = resyncFrom(nextOffset + 1);
      if (resync < 0) break;
      nextOffset = resync;
      header = parseFrameAt(nextOffset);
      if (!header) break;
    }
    const end = frameEnd(header);
    if (end <= nextOffset) break;
    const frameDurationUs = Math.round(header.frameDuration * 1e6);
    decoder.decode(new EncodedAudioChunk({
      type: 'key',
      timestamp: timestampUs,
      duration: frameDurationUs,
      data: bytes.subarray(nextOffset, end)   // EncodedAudioChunk 构造时复制数据
    }));
    timestampUs += frameDurationUs;
    nextOffset = end;
  }
};

// AAC：主线程 mp4Demux.js 展开的逐样本表（一条样本 = 一帧 = 1024 采样/声道），
// 顺序喂解码器——这就是原版 jaad `readNextFrame()` 的等价物，无截断无合并
const pumpAacSamples = () => {
  while (decoder.decodeQueueSize < MAX_DECODE_QUEUE && nextSample < sampleTable.count) {
    const durationUs = sampleTable.durationsUs[nextSample];
    const start = sampleTable.offsets[nextSample];
    const end = start + sampleTable.sizes[nextSample];
    decoder.decode(new EncodedAudioChunk({
      type: 'key',
      timestamp: timestampUs,
      duration: durationUs,
      data: bytes.subarray(start, end)
    }));
    timestampUs += durationUs;
    nextSample += 1;
  }
};

// 字节/样本源是否已到末尾（决定是否 flush 解码器）
const sourceExhausted = () => (format === 'aac'
  ? !sampleTable || nextSample >= sampleTable.count
  : nextOffset + 4 > bytes.byteLength);

// hold（主线程 line buffer 满）或解码队列满时暂停拉取，
// 对应 SourceDataLine.write() 的阻塞点
const pump = () => {
  if (stopped || hold || !decoder || !bytes) return;
  try {
    if (format === 'aac') pumpAacSamples();
    else pumpStreamFrames();
    if (!flushScheduled && decoder.decodeQueueSize === 0 && sourceExhausted()) {
      flushScheduled = true;
      const done = () => { if (!stopped) self.postMessage({ type: 'end' }); };
      decoder.flush().then(done, done);
    }
  } catch (error) {
    postError(error?.message || error);
  }
};

const onAudioFrame = (audioData) => {
  try {
    const frameSamples = audioData.numberOfFrames;
    const channels = audioData.numberOfChannels;
    const sampleRate = audioData.sampleRate;
    const interleaved = frameSamples * channels;
    if (!interleaved) {
      audioData.close();
      return;
    }
    // copyTo 按平面取（f32-planar：每平面正好 frameSamples 个样本）。
    // 之前请求 f32（交错）时平面含 frameSamples*channels 个样本，scratch 按
    // frameSamples 分配，立体声必然 copyTo 抛 "destination is not large enough"
    const readPlane = (planeIndex) => {
      if (!planeScratch || planeScratch.length < frameSamples) {
        planeScratch = new Float32Array(frameSamples);
      }
      audioData.copyTo(planeScratch, { planeIndex, format: 'f32-planar' });
      return planeScratch;
    };
    if (original) {
      // 预设 1（原版）：aac 每帧值 = 打包 L,R 对（值域 ±65534，不削波），
      // mp3/flac 帧首 1024 个交错 Int16 采样——对齐原版 jaad/JLayer 两条路径
      if (format === 'aac') {
        mixFrameIntoWindowPacked({
          readPlane,
          frameSamples,
          channels,
          windowSamples,
          pairsNeeded: fftSize
        });
      } else {
        mixFrameIntoWindow({
          readPlane,
          frameSamples,
          channels,
          windowSamples,
          pairsNeeded: fftSize / 2,
          int16Scale: INT16_SCALE
        });
      }
    } else {
      // 预设 2：全帧真立体声交错，Int16 量级与 tap 链路一致
      mixFrameIntoWindow({
        readPlane,
        frameSamples,
        channels,
        windowSamples,
        pairsNeeded: fftSize / 2,
        int16Scale: INT16_SCALE
      });
    }
    audioData.close();

    fftRun(windowSamples, realOut, imagOut);
    const magnitudes = new Float32Array(BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const re = realOut[i];
      const im = imagOut[i];
      magnitudes[i] = Math.sqrt(re * re + im * im);
    }
    if (stopped) return;
    self.postMessage(
      { type: 'frame', magnitudes, frameSamples, sampleRate },
      [magnitudes.buffer]
    );
    pump();
  } catch (error) {
    try { audioData.close(); } catch { /* ignore */ }
    postError(error?.message || error);
  }
};

// 重建解码器（初次配置 / restart 重锚共用）；配置错误抛给调用方 postError
const initDecoder = () => {
  try {
    if (decoder && decoder.state !== 'closed') decoder.close();
  } catch { /* ignore */ }
  decoder = new AudioDecoder({
    output: onAudioFrame,
    error: (error) => postError(error?.message || error)
  });
  decoder.addEventListener('dequeue', pump);
  decoder.configure(decoderConfig);
};

const normalizeFormat = (value) => (value === 'flac' || value === 'aac' ? value : 'mp3');

const startDecode = ({
  buffer, offset, firstOffset, sampleIndex, sampleTarget, sampleRate, channels,
  format: fmt, description, streaminfo: si, sampleTable: table, preset
}) => {
  try {
    if (typeof AudioDecoder !== 'function') throw new Error('WebCodecs AudioDecoder unavailable');
    // 预设决定窗几何：original（默认）= 原版分格式语义——mp3/flac 取帧首
    // 1024 个交错采样、aac 每帧值 = 打包 L,R 对（L*2 + R/32768），均 1024 点；
    // wide = 全帧真立体声交错 2048 点。窗口/FFT 实例按尺寸缓存
    original = preset !== 'wide';
    fftSize = original ? ORIGINAL_FFT_SIZE : FFT_SIZE;
    if (windowSamples.length !== fftSize) {
      windowSamples = new Float32Array(fftSize);
      realOut = new Float32Array(fftSize);
      imagOut = new Float32Array(fftSize);
    }
    fftRun = getFft(fftSize);
    bytes = new Uint8Array(buffer);
    format = normalizeFormat(fmt);
    streaminfo = si || null;
    flacSampleRate = Number(sampleRate) || 44100;
    decoderConfig = {
      codec: format,
      sampleRate: Number(sampleRate) || 44100,
      numberOfChannels: Number(channels) || 2
    };
    // Chromium 的 flac 解码器要求 description 携带 'fLaC'+元数据块前缀（内含
    // STREAMINFO），否则 configure 失败；mp3 不需要也不接受 description；
    // aac 的 codec 是容器里读出的 'mp4a.40.2'，description 是 esds 里的
    // AudioSpecificConfig 原始字节（不是容器盒子）
    if (format === 'flac') {
      decoderConfig.description = description instanceof Uint8Array
        ? description
        : new Uint8Array(description || []);
      sampleTable = null;
    } else if (format === 'aac') {
      sampleTable = table && table.count > 0 && table.offsets && table.sizes && table.durationsUs
        ? table
        : null;
      if (!sampleTable) throw new Error('AAC 缺少解封装样本表');
      const asc = description?.asc;
      if (!(description?.codec) || !(asc instanceof Uint8Array) || asc.length < 2) {
        throw new Error('AAC 缺少 AudioSpecificConfig');
      }
      decoderConfig.codec = description.codec;
      decoderConfig.description = asc;
      nextSample = 0;
    } else {
      sampleTable = null;
    }
    nextOffset = Math.max(0, Number(offset) || 0);
    // FLAC 增量 seek 索引必须从歌曲第一个帧起建（与 restartDecode 复用语义一致），
    // 之后按锚点目标样本扫帧；锚点由主进程随 decode 消息原子给定（边下边播
    // 接管时不允许「先从头解码再补 restart」的竞态）
    flacIndex = format === 'flac' ? createFlacFrameIndex(Math.max(0, Number(firstOffset) || 0)) : null;
    if (format === 'aac' && sampleTable && Number(sampleIndex) >= 0) {
      nextSample = Math.max(0, Math.min(sampleTable.count - 1, Math.trunc(sampleIndex)));
      nextOffset = sampleTable.offsets[nextSample];
    }
    if (format === 'flac' && flacIndex && Number(sampleTarget) >= 0) {
      const frame = flacFrameForSample(bytes, flacIndex, streaminfo, sampleTarget);
      if (frame) {
        nextOffset = frame.byteOffset;
        self.postMessage({ type: 'seek', sample: frame.sample, sampleRate: flacSampleRate });
      }
    }
    timestampUs = 0;
    flushScheduled = false;
    stopped = false;
    hold = false;
    initDecoder();
    self.postMessage({ type: 'ready' });
    pump();
  } catch (error) {
    postError(error?.message || error);
  }
};

// 主线程 seek/resume 重锚：从主线程算好的字节落点重建解码器（时间戳归零，
// 主线程以该落点的样本号重新起算帧时间轴）。
// - aac：主线程用样本表算出精确下标，直接跳过去
// - flac：给了 sampleTarget 说明没有 SEEKTABLE，由这里增量扫帧找到覆盖该样本
//   的帧边界，并把实际起始样本回报给主线程（时间轴据此锚定，seek 一次到位）
// - mp3：主线程用 Xing/VBRI TOC 或码率估算算好偏移，这里只负责重新对齐同步字
const restartDecode = ({ offset, sampleIndex, sampleTarget }) => {
  if (!bytes || !decoderConfig) return;
  try {
    timestampUs = 0;
    flushScheduled = false;
    stopped = false;
    hold = false;
    if (format === 'aac' && sampleTable) {
      nextSample = Math.max(0, Math.min(sampleTable.count - 1, Math.trunc(sampleIndex) || 0));
      nextOffset = sampleTable.offsets[nextSample];
    } else {
      nextSample = 0;
      nextOffset = Math.max(0, Number(offset) || 0);
      if (format === 'flac' && flacIndex && Number.isFinite(sampleTarget) && sampleTarget >= 0) {
        const frame = flacFrameForSample(bytes, flacIndex, streaminfo, sampleTarget);
        if (frame) {
          nextOffset = frame.byteOffset;
          self.postMessage({ type: 'seek', sample: frame.sample, sampleRate: flacSampleRate });
        }
      }
    }
    initDecoder();
    pump();
  } catch (error) {
    postError(error?.message || error);
  }
};

self.onmessage = (event) => {
  const data = event?.data || {};
  if (data.type === 'decode') {
    startDecode(data);
    return;
  }
  if (data.type === 'restart') {
    restartDecode(data);
    return;
  }
  if (data.type === 'hold') {
    hold = true;
    return;
  }
  if (data.type === 'resume') {
    hold = false;
    pump();
    return;
  }
  if (data.type === 'stop') {
    stopped = true;
    hold = true;
    try { if (decoder && decoder.state !== 'closed') decoder.close(); } catch { /* ignore */ }
    decoder = null;
    bytes = null;
    sampleTable = null;
    flacIndex = null;
  }
};
