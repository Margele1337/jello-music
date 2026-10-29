// mp3/FLAC 自解码 Worker：Chromium 内建 WebCodecs AudioDecoder（无需任何 npm 依赖）。
// 对齐所有者 sigmarebase MusicManager 解码循环（~:383-407）：
//   decode → 写入行缓冲（阻塞背压）→ fft(整帧) → visualizerData.add
// 浏览器里没有 SourceDataLine，背压由主线程 line buffer 上限（≈4s）驱动：
// 主线程发 hold/resume 消息代替 write() 的阻塞。
//
// 每帧流程：EncodedAudioChunk(一个编解码帧) → AudioDecoder → AudioData(f32)
// → 取帧首 2048 个交错采样并缩放到 Int16 量级 → 2048 点 FFT →
// sqrt(re²+im²) 前半幅度取前 114 个 → postMessage 给主线程做门控。
// 原版对 AAC 整帧（1024×2ch = 2048 交错采样）做 FFT；mp3 帧 1152×2ch = 2304
// 交错采样，截断到 2048 保持同样的 FFT 几何（2 的幂）。FLAC 常规块长
// 4096/ch（8192 交错采样）同理是「整帧截断到 2048」，窗几何与标度不变。
// Int16 量级是 HUD 公式 sqrt(x)/12 − 5（上限 2.256e7 / 低音参考 1000/4750）的前提。
//
// flac 与 mp3 的差异只有两处：config（codec 'flac' + description='fLaC'+元数据块
// 前缀，Chromium 的 flac 解码器要从 STREAMINFO 初始化）与帧切分（帧头无长度字段，
// 帧尾=下一个 CRC 校验通过的同步字，见 mp3Frame.js findNextFlacFrameOffset）。
//
// 解码恒 1x：倍速由可听元素处理（原版无倍速功能），帧时间轴与倍速无关。
import { createSpectrumFft } from './fft.js';
import {
  findNextFlacFrameOffset,
  findNextFrameOffset,
  parseFlacFrameHeader,
  parseMp3FrameHeader
} from './mp3Frame.js';

const FFT_SIZE = 2048;
const BAR_COUNT = 114;
const MAX_DECODE_QUEUE = 16;   // AudioDecoder 入队上限（帧级背压）
const INT16_SCALE = 32768;     // 与 tap 链路 spectrum-tap.js 的 Int16 量纲一致

const spectrumFft = createSpectrumFft(FFT_SIZE);
const windowSamples = new Float32Array(FFT_SIZE);
const realOut = new Float32Array(FFT_SIZE);
const imagOut = new Float32Array(FFT_SIZE);

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

// 逐帧切分并喂给解码器；hold（主线程 line buffer 满）或解码队列满时暂停拉取，
// 对应 SourceDataLine.write() 的阻塞点
const pump = () => {
  if (stopped || hold || !decoder || !bytes) return;
  try {
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
    if (!flushScheduled && decoder.decodeQueueSize === 0 && nextOffset + 4 > bytes.byteLength) {
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
    // copyTo 按平面取（解码器原生格式可能是 planar），这里自己交错成
    // L0,R0,L1,R1… —— 原版 convertToPCMFloatArray 产出的就是交错布局
    const pairsNeeded = FFT_SIZE / 2;
    const take = Math.min(frameSamples, pairsNeeded);
    if (!planeScratch || planeScratch.length < frameSamples) {
      planeScratch = new Float32Array(frameSamples);
    }
    audioData.copyTo(planeScratch, { planeIndex: 0, format: 'f32' });
    for (let i = 0; i < take; i += 1) {
      const value = planeScratch[i];
      // Int16 量级（带削波保护），保证与 tap 链路及原版幅度标度一致
      windowSamples[i * 2] = (value < -1 ? -1 : value > 1 ? 1 : value) * INT16_SCALE;
    }
    if (channels > 1) {
      audioData.copyTo(planeScratch, { planeIndex: 1, format: 'f32' });
      for (let i = 0; i < take; i += 1) {
        const value = planeScratch[i];
        windowSamples[i * 2 + 1] = (value < -1 ? -1 : value > 1 ? 1 : value) * INT16_SCALE;
      }
    } else {
      for (let i = 0; i < take; i += 1) windowSamples[i * 2 + 1] = windowSamples[i * 2];
    }
    audioData.close();
    for (let i = take * 2; i < FFT_SIZE; i += 1) windowSamples[i] = 0;

    spectrumFft(windowSamples, realOut, imagOut);
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

const startDecode = ({ buffer, offset, sampleRate, channels, format: fmt, description, streaminfo: si }) => {
  try {
    if (typeof AudioDecoder !== 'function') throw new Error('WebCodecs AudioDecoder unavailable');
    bytes = new Uint8Array(buffer);
    format = fmt === 'flac' ? 'flac' : 'mp3';
    streaminfo = si || null;
    decoderConfig = {
      codec: format,
      sampleRate: Number(sampleRate) || 44100,
      numberOfChannels: Number(channels) || 2
    };
    // Chromium 的 flac 解码器要求 description 携带 'fLaC'+元数据块前缀（内含
    // STREAMINFO），否则 configure 失败；mp3 不需要也不接受 description
    if (format === 'flac') {
      decoderConfig.description = description instanceof Uint8Array
        ? description
        : new Uint8Array(description || []);
    }
    nextOffset = Math.max(0, Number(offset) || 0);
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

// 主线程 seek/resume 重锚：从估算字节偏移重建解码器（时间戳归零，
// 主线程以 element.currentTime 重新起算帧时间轴）
const restartDecode = (offset) => {
  if (!bytes || !decoderConfig) return;
  try {
    nextOffset = Math.max(0, Number(offset) || 0);
    timestampUs = 0;
    flushScheduled = false;
    stopped = false;
    hold = false;
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
    restartDecode(data.offset);
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
  }
};
