import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findFirstFlacFrame,
  findNextFlacFrameOffset,
  parseFlacFrameHeader,
  parseFlacStream,
  skipId3Tag
} from '../src/services/audio/mp3Frame.js';

// ===== 合成 FLAC 字节构造器（纯手工字节，无外部媒体）=====

// FLAC 帧头 CRC-8：多项式 0x07，初值 0（独立实现，不复用被测代码）
const crc8 = (arr) => {
  let crc = 0;
  for (const byte of arr) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
    }
  }
  return crc;
};

// FLAC 风格变长整数（帧号/样本号）：各长度的负载位数 7/11/16/21/26/31/36
const encodeFlacUtf8Int = (value) => {
  const specs = [[1, 7, 0x00], [2, 11, 0xC0], [3, 16, 0xE0], [4, 21, 0xF0],
    [5, 26, 0xF8], [6, 31, 0xFC], [7, 36, 0xFE]];
  for (const [len, bits, marker] of specs) {
    if (value < 2 ** bits || len === 7) {
      const out = [marker | (len === 1 ? value : Math.floor(value / 64 ** (len - 1)))];
      for (let i = len - 1; i >= 1; i -= 1) {
        out.push(0x80 | (Math.floor(value / 64 ** (i - 1)) & 0x3F));
      }
      return out;
    }
  }
  throw new Error('value too large');
};

// STREAMINFO 块负载（34 字节）
const buildStreamInfo = ({
  minBlock = 4096, maxBlock = 4096, minFrame = 0, maxFrame = 0,
  sampleRate = 44100, channels = 2, bits = 16, totalSamples = 0
} = {}) => {
  const out = new Array(34).fill(0);
  out[0] = (minBlock >> 8) & 0xFF; out[1] = minBlock & 0xFF;
  out[2] = (maxBlock >> 8) & 0xFF; out[3] = maxBlock & 0xFF;
  out[4] = (minFrame >> 16) & 0xFF; out[5] = (minFrame >> 8) & 0xFF; out[6] = minFrame & 0xFF;
  out[7] = (maxFrame >> 16) & 0xFF; out[8] = (maxFrame >> 8) & 0xFF; out[9] = maxFrame & 0xFF;
  // 64 位字段：采样率 20 | 声道-1 3 | 位宽-1 5 | 总样本 36
  out[10] = (sampleRate >> 12) & 0xFF;
  out[11] = (sampleRate >> 4) & 0xFF;
  out[12] = ((sampleRate & 0x0F) << 4) | ((channels - 1) << 1) | ((bits - 1) >> 4);
  const hi = Math.floor(totalSamples / 2 ** 32) & 0x0F;
  out[13] = (((bits - 1) & 0x0F) << 4) | hi;
  out[14] = Math.floor(totalSamples / 2 ** 24) & 0xFF;
  out[15] = Math.floor(totalSamples / 2 ** 16) & 0xFF;
  out[16] = Math.floor(totalSamples / 2 ** 8) & 0xFF;
  out[17] = totalSamples & 0xFF;
  return out;   // out[18..33] = MD5（全零即可）
};

// 帧头（含正确的 CRC-8）；extraBlocksize/extraRate 为帧号之后的尾部字节
const buildFlacFrameHeader = ({
  frameNumber = 0, blockingStrategy = 0, blockBits = 12, extraBlocksize = null,
  rateBits = 0, extraRate = null, channelAssign = 1, sizeBits = 0, corruptCrc = false
}) => {
  const out = [0xFF, 0xF8 | blockingStrategy, (blockBits << 4) | rateBits,
    (channelAssign << 4) | (sizeBits << 1)];
  out.push(...encodeFlacUtf8Int(frameNumber));
  if (extraBlocksize) out.push(...extraBlocksize);
  if (extraRate) out.push(...extraRate);
  const crc = crc8(out);
  out.push(corruptCrc ? (crc ^ 0xFF) : crc);
  return out;
};

// 完整文件：'fLaC' + STREAMINFO（可选额外元数据块，尊重 last 标志）+ 帧序列
const buildFlacFile = ({
  streaminfo, lastFlag = true, extraBlocks = [], frames = [], trailing = [], magic = [0x66, 0x4C, 0x61, 0x43]
}) => {
  const bytes = [...magic];
  const si = buildStreamInfo(streaminfo);
  const streaminfoLast = lastFlag && extraBlocks.length === 0;
  bytes.push((streaminfoLast ? 0x80 : 0x00) | 0, 0, 0, 34, ...si);
  extraBlocks.forEach((block, index) => {
    const last = lastFlag && index === extraBlocks.length - 1;
    const len = block.payload.length;
    bytes.push((last ? 0x80 : 0) | block.type, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF,
      ...block.payload);
  });
  for (const frame of frames) bytes.push(...frame);
  bytes.push(...trailing);
  return Uint8Array.from(bytes);
};

// ===== STREAMINFO / 元数据块链 =====

test('parseFlacStream reads STREAMINFO and marks the description byte range', () => {
  const bytes = buildFlacFile({
    streaminfo: { sampleRate: 48000, channels: 2, bits: 24, minBlock: 4096, maxBlock: 4096, totalSamples: 960000 }
  });
  const stream = parseFlacStream(bytes);
  assert.ok(stream);
  assert.equal(stream.descriptionStart, 0);
  assert.equal(stream.descriptionEnd, 4 + 4 + 34);   // 'fLaC' + 块头 + STREAMINFO
  assert.equal(stream.streaminfo.sampleRate, 48000);
  assert.equal(stream.streaminfo.channels, 2);
  assert.equal(stream.streaminfo.bitsPerSample, 24);
  assert.equal(stream.streaminfo.minBlockSize, 4096);
  assert.equal(stream.streaminfo.maxBlockSize, 4096);
  assert.equal(stream.streaminfo.totalSamples, 960000);
  // 平均码率 = 音频字节 * 8 * sampleRate / totalSamples（descriptionEnd 之后为 0 字节）
  assert.equal(stream.averageBitrate, 0);
});

test('parseFlacStream honors the last-metadata-block flag across multiple blocks', () => {
  const bytes = buildFlacFile({
    streaminfo: { totalSamples: 882000 },
    lastFlag: true,
    extraBlocks: [
      { type: 1, payload: new Array(20).fill(0) },          // PADDING（非末块）
      { type: 4, payload: [1, 2, 3, 4, 5] }                 // APPLICATION（末块）
    ]
  });
  const stream = parseFlacStream(bytes);
  assert.ok(stream);
  // 4 + 38 + (4+20) + (4+5) = 75
  assert.equal(stream.descriptionEnd, 75);
  // 音频字节 0 → 平均码率 0；有帧数据时按总样本折算
  const withTotal = buildFlacFile({
    streaminfo: { sampleRate: 44100, totalSamples: 441000 },   // 10 秒
    frames: [buildFlacFrameHeader({}), new Array(1000).fill(0)]
  });
  const s2 = parseFlacStream(withTotal);
  // 音频区 = 帧头(6B) + 1000 填充；码率 ≈ 1006*8*44100/441000 ≈ 804.8 bps
  assert.ok(Math.abs(s2.averageBitrate - (1006 * 8 * 44100) / 441000) < 1e-6);
});

test('parseFlacStream skips an ID3v2 prefix and rejects non-FLAC / truncated input', () => {
  const flac = buildFlacFile({ streaminfo: {}, frames: [buildFlacFrameHeader({})] });
  const tag = [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0)];   // ID3 大小=20
  const prefixed = Uint8Array.from([...tag, ...flac]);
  assert.equal(skipId3Tag(prefixed), 30);
  const stream = parseFlacStream(prefixed);
  assert.ok(stream);
  assert.equal(stream.descriptionStart, 30);
  assert.equal(stream.descriptionEnd, 30 + 42);

  assert.equal(parseFlacStream(Uint8Array.from([0xFF, 0xFB, 0x90, 0x00])), null);   // 不是 'fLaC'
  assert.equal(parseFlacStream(Uint8Array.from([0x66, 0x4C, 0x61])), null);          // 魔数截断
  assert.equal(parseFlacStream(flac.subarray(0, 40)), null);                         // STREAMINFO 截断
  assert.equal(parseFlacStream(null), null);
  // 元数据块负载截断（块头声明 34 字节但只剩 10）
  const shortBlock = Uint8Array.from([0x66, 0x4C, 0x61, 0x43, 0x80, 0, 0, 34, ...new Array(10).fill(0)]);
  assert.equal(parseFlacStream(shortBlock), null);
});

// ===== 帧头解析 =====

const si44100 = { sampleRate: 44100, channels: 2, bitsPerSample: 16, minBlockSize: 4096, maxBlockSize: 4096, totalSamples: 0 };

test('parses a fixed-blocksize 4096 frame taking rate/size from STREAMINFO', () => {
  const bytes = Uint8Array.from(buildFlacFrameHeader({ frameNumber: 0, blockBits: 12, rateBits: 0 }));
  const header = parseFlacFrameHeader(bytes, 0, si44100);
  assert.ok(header);
  assert.equal(header.blocksize, 4096);           // 块长位 12 = 256 * 2^(12-8)
  assert.equal(header.samplesPerFrame, 4096);
  assert.equal(header.sampleRate, 44100);         // 采样率位 0 → STREAMINFO
  assert.equal(header.channels, 2);               // 通道分配 1 = 2 独立声道
  assert.equal(header.bitsPerSample, 16);         // 位宽位 0 → STREAMINFO
  assert.equal(header.variableBlocking, false);
  assert.equal(header.headerSize, 6);             // 4 + 帧号 1 字节 + CRC 1 字节
  assert.ok(Math.abs(header.frameDuration - 4096 / 44100) < 1e-12);
});

test('handles the 192-blocksize code and the 8/16-bit blocksize multipliers', () => {
  // 块长位 1 = 192
  let bytes = Uint8Array.from(buildFlacFrameHeader({ blockBits: 1 }));
  assert.equal(parseFlacFrameHeader(bytes, 0, si44100).blocksize, 192);
  // 块长位 6 = 尾部 8 位值 + 1
  bytes = Uint8Array.from(buildFlacFrameHeader({ blockBits: 6, extraBlocksize: [199] }));
  let header = parseFlacFrameHeader(bytes, 0, si44100);
  assert.equal(header.blocksize, 200);
  assert.equal(header.headerSize, 7);             // 4 + 1 + 1(块长) + 1(CRC)
  // 块长位 7 = 尾部 16 位值 + 1
  bytes = Uint8Array.from(buildFlacFrameHeader({ blockBits: 7, extraBlocksize: [0x0F, 0xFF] }));
  header = parseFlacFrameHeader(bytes, 0, si44100);
  assert.equal(header.blocksize, 4096);
  assert.equal(header.headerSize, 8);
  // 块长位 2..5 = 576 * 2^(n-2)；8..15 = 256 * 2^(n-8)
  for (const [code, size] of [[2, 576], [3, 1152], [4, 2304], [5, 4608], [8, 256], [15, 32768]]) {
    bytes = Uint8Array.from(buildFlacFrameHeader({ blockBits: code }));
    assert.equal(parseFlacFrameHeader(bytes, 0, si44100).blocksize, size, `blockBits ${code}`);
  }
});

test('handles explicit sample-rate codes including 8-bit kHz and 16-bit Hz tails', () => {
  // 位 9 = 44.1kHz（无需 STREAMINFO）
  let bytes = Uint8Array.from(buildFlacFrameHeader({ rateBits: 9 }));
  assert.equal(parseFlacFrameHeader(bytes, 0, null).sampleRate, 44100);
  // 位 14 = 尾部 8 位 kHz
  bytes = Uint8Array.from(buildFlacFrameHeader({ rateBits: 14, extraRate: [22] }));
  let header = parseFlacFrameHeader(bytes, 0, null);
  assert.equal(header.sampleRate, 22000);
  assert.equal(header.headerSize, 7);
  // 位 15 = 尾部 16 位 Hz
  bytes = Uint8Array.from(buildFlacFrameHeader({ rateBits: 15, extraRate: [0xAC, 0x44] }));
  header = parseFlacFrameHeader(bytes, 0, null);
  assert.equal(header.sampleRate, 44100);
  assert.equal(header.headerSize, 8);
  // 位 0 且无 STREAMINFO → 无法确定采样率，判无效
  bytes = Uint8Array.from(buildFlacFrameHeader({ rateBits: 0 }));
  assert.equal(parseFlacFrameHeader(bytes, 0, null), null);
});

test('maps channel assignments and variable blocking strategy', () => {
  // 0..7 = 独立声道数；8/9/10 = 立体声侧声道对
  for (const [assign, channels] of [[0, 1], [1, 2], [7, 8], [8, 2], [9, 2], [10, 2]]) {
    const bytes = Uint8Array.from(buildFlacFrameHeader({ channelAssign: assign }));
    assert.equal(parseFlacFrameHeader(bytes, 0, si44100).channels, channels, `assign ${assign}`);
  }
  // 可变块长：同步字 0xFFF9，UTF-8 整数是样本号
  const bytes = Uint8Array.from(buildFlacFrameHeader({ frameNumber: 8192, blockingStrategy: 1 }));
  const header = parseFlacFrameHeader(bytes, 0, si44100);
  assert.equal(header.variableBlocking, true);
  assert.equal(header.frameIndex, 8192);
  // 多字节帧号（12345 需 3 字节 UTF-8 样式）
  const wide = Uint8Array.from(buildFlacFrameHeader({ frameNumber: 12345 }));
  const wideHeader = parseFlacFrameHeader(wide, 0, si44100);
  assert.equal(wideHeader.frameIndex, 12345);
  assert.equal(wideHeader.headerSize, 8);         // 4 + 3 + CRC
});

test('rejects garbage syncs, bad CRC, reserved codes and truncated headers', () => {
  // CRC 错误（垃圾同步几乎必被剔除——mp3 只有 12 位同步，FLAC 靠 CRC-8 校验帧头）
  const bad = Uint8Array.from(buildFlacFrameHeader({ corruptCrc: true }));
  assert.equal(parseFlacFrameHeader(bad, 0, si44100), null);
  // 同步字不符 / 保留位为 1
  assert.equal(parseFlacFrameHeader(Uint8Array.from([0xFF, 0xF0, 0x90, 0x00, 0x00, 0x00]), 0, si44100), null);
  assert.equal(parseFlacFrameHeader(Uint8Array.from([0xFF, 0xFA, 0x90, 0x00, 0x00, 0x00]), 0, si44100), null); // 保留位
  // 保留编码：块长位 0 / 采样率位 13 / 通道分配 15 / 位宽位 3
  for (const opts of [{ blockBits: 0 }, { rateBits: 13 }, { channelAssign: 15 }, { sizeBits: 3 }]) {
    const bytes = Uint8Array.from(buildFlacFrameHeader(opts));
    assert.equal(parseFlacFrameHeader(bytes, 0, si44100), null, JSON.stringify(opts));
  }
  // 截断：头部字节不足 / 块长尾部字节缺失
  const full = Uint8Array.from(buildFlacFrameHeader({ blockBits: 7, extraBlocksize: [0x0F, 0xFF] }));
  assert.equal(parseFlacFrameHeader(full.subarray(0, 4), 0, si44100), null);
  assert.equal(parseFlacFrameHeader(full.subarray(0, 6), 0, si44100), null);   // 缺 16 位块长+CRC
  assert.equal(parseFlacFrameHeader(null, 0, si44100), null);
  assert.equal(parseFlacFrameHeader(full, -1, si44100), null);
});

// ===== 文件级定位：首帧 / 下一帧（帧尾=下一同步字）=====

test('findFirstFlacFrame locates the first frame after the metadata prefix', () => {
  const frame1 = buildFlacFrameHeader({ frameNumber: 0 });
  const frame2 = buildFlacFrameHeader({ frameNumber: 1 });
  const bytes = buildFlacFile({
    streaminfo: {},
    frames: [frame1, new Array(300).fill(0), frame2, new Array(300).fill(0)]
  });
  const found = findFirstFlacFrame(bytes);
  assert.ok(found);
  assert.equal(found.offset, 42);
  assert.equal(found.header.blocksize, 4096);
  assert.equal(found.stream.descriptionEnd, 42);
  // 下一帧 = 42 + 6(帧头) + 300(帧体)
  const next = findNextFlacFrameOffset(bytes, found.offset + found.header.headerSize, found.stream.streaminfo);
  assert.equal(next, 348);
  // 填充垃圾里找不到第三帧
  assert.equal(findNextFlacFrameOffset(bytes, next + 6, found.stream.streaminfo), -1);
});

test('findFirstFlacFrame rejects files with no valid frame or broken magic', () => {
  // 有前缀但没有帧
  const empty = buildFlacFile({ streaminfo: {}, frames: [new Array(50).fill(0x55)] });
  assert.equal(findFirstFlacFrame(empty), null);
  // 伪同步：0xFFF8 开头但 CRC 错误
  const garbage = buildFlacFile({ streaminfo: {}, frames: [[0xFF, 0xF8, 0x90, 0x02, 0x00, 0xDE, 0xAD]] });
  assert.equal(findFirstFlacFrame(garbage), null);
  // 帧头被截断（只剩 3 字节）
  const truncated = buildFlacFile({ streaminfo: {}, frames: [[0xFF, 0xF8, 0x90]] });
  assert.equal(findFirstFlacFrame(truncated), null);
  assert.equal(findFirstFlacFrame(Uint8Array.from([0x00, 0x01])), null);
  assert.equal(findFirstFlacFrame(null), null);
});

test('frame scanning walks a multi-frame stream end to end', () => {
  // 前缀 + 4 个帧（帧号 0..3，帧体 50..53 字节填充）
  const prefix = buildFlacFile({ streaminfo: {}, frames: [] });
  const all = [...prefix];
  const expected = [];
  for (let i = 0; i < 4; i += 1) {
    expected.push(all.length);
    all.push(...buildFlacFrameHeader({ frameNumber: i }), ...new Array(50 + i).fill(0));
  }
  const buf = Uint8Array.from(all);
  const stream = parseFlacStream(buf);
  let offset = findNextFlacFrameOffset(buf, stream.descriptionEnd, stream.streaminfo);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(offset, expected[i], `frame ${i}`);
    const header = parseFlacFrameHeader(buf, offset, stream.streaminfo);
    assert.equal(header.frameIndex, i);
    offset = findNextFlacFrameOffset(buf, offset + header.headerSize, stream.streaminfo);
  }
  assert.equal(offset, -1);   // 流末尾
});
