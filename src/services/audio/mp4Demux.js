// 最小 MP4（ISO/IEC 14496-14 / m4a）音频解封装：为频谱自解码链路取出
// AAC 的 AudioSpecificConfig（esds → DecoderSpecificInfo）与逐样本字节范围
// （stts/stsz/stsc/stco|co64），一条样本 = 一个 AAC 帧 = 1024 采样/声道。
//
// 为什么需要它：所有者 sigmarebase 的解码循环（MusicManager.java ~:360-407）
// 用 jaad 解 MP4/AAC——aac 是原版**唯一**的自解码格式，整帧 1024×2ch = 2048
// 交错采样直接进 2048 点 FFT（无截断，几何精确）。本模块复刻它的解封装侧，
// 解码侧交给 Chromium WebCodecs AudioDecoder（codec 'mp4a.40.2'）。
//
// 严格模式：任何结构意外（盒子越界/尺寸不铺满父盒子、必需盒子缺失、
// 样本表自相矛盾、非 AAC-LC、HE-AAC/SBR/PS、多重样本描述、样本偏移越界）
// 一律返回 null，由调用方（spectrum.js#prepareSelfDecode）静默回退。
// 不引入任何第三方解封装器，无 DOM 依赖，可在 Node 单测。
//
// 已知不处理（一律判为意外 → null）：fragmented mp4（样本表不在 moov 里）、
// sample_description_index > 1、esds 里带 OCR/优先级标志、非 'mp4a' 的样本
// 描述（alac/ac-3/…）、显式 SBR/PS（HE-AAC，每帧样本数不是 1024）、
// 音频字节落在 4GB 之外（Worker 拿到的是整首字节，不支持这种量级）。
// elst 编辑列表按「无编辑」处理：priming 帧照常解码，与原版的顺序解码一致。

const AAC_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
  16000, 12000, 11025, 8000, 7350
];
export const AAC_SAMPLES_PER_FRAME = 1024;
const MAX_MP4_SAMPLE_COUNT = 500000;   // 样本表内存上限（约 6000 秒 AAC）
const MAX_MP4_CHUNK_COUNT = 2000000;
const MAX_SUPPORTED_BYTE_OFFSET = 0xFFFFFFFF;   // 样本偏移表用 Uint32Array

const fail = (reason) => {
  const error = new Error(reason);
  error.mp4Reason = reason;
  return error;
};

const toBytes = (input) => {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return null;
};

// ===== 盒子骨架 =====
// size(4) + type(4)；size==1 → 尾部 8 字节 64 位 largesize（头共 16 字节）；
// size==0 → 延伸到父盒子末尾。size 必须 >= 头长且不得越出父盒子。
const boxTypeAt = (view, start) => String.fromCharCode(
  view.getUint8(start + 4), view.getUint8(start + 5),
  view.getUint8(start + 6), view.getUint8(start + 7)
);

const readBox = (view, start, parentEnd) => {
  if (start + 8 > parentEnd) return null;
  const size32 = view.getUint32(start);
  let headerSize = 8;
  let size = size32;
  if (size32 === 1) {
    if (start + 16 > parentEnd) return null;
    size = view.getUint32(start + 8) * 4294967296 + view.getUint32(start + 12);
    headerSize = 16;
  } else if (size32 === 0) {
    size = parentEnd - start;
  }
  if (!Number.isFinite(size) || size < headerSize || start + size > parentEnd) return null;
  return { type: boxTypeAt(view, start), start, headerSize, end: start + size };
};

// 遍历容器的子盒子；visitor 返回 false 提前结束；
// 子盒子结构非法（无法铺满父盒子）抛错——结构意外即整曲回退
const eachChild = (view, container, visitor) => {
  let pos = container.start + container.headerSize;
  while (pos < container.end) {
    const child = readBox(view, pos, container.end);
    if (!child) throw fail(`bad-box-at-${pos}`);
    if (visitor(child) === false) return;
    pos = child.end;
  }
};

const findChild = (view, container, type) => {
  let found = null;
  eachChild(view, container, (child) => {
    if (child.type === type) { found = child; return false; }
    return true;
  });
  return found;
};

const requireChild = (view, container, type) => {
  const child = findChild(view, container, type);
  if (!child) throw fail(`missing-${type}`);
  return child;
};

// FullBox 内容起点：version/flags 必须全 0（本链路不接受带标志的表盒子）
const fullBoxBody = (view, box) => {
  const content = box.start + box.headerSize;
  if (content + 4 > box.end) throw fail(`short-fullbox-${box.type}`);
  if (view.getUint32(content) !== 0) throw fail(`flags-set-${box.type}`);
  return content + 4;
};

const entryAt = (view, box, pos, label) => {
  if (pos + 4 > box.end) throw fail(`short-${label}`);
  return view.getUint32(pos);
};

// 校验「表体长度 == 声明条目数 × 条目字节数」，多余/不足都算结构意外
const expectExactBody = (box, body, entries, entryBytes, label) => {
  if (entries > 0 && box.end - body > 0xFFFFFFFF) throw fail(`huge-${label}`);
  if (box.end - body !== entries * entryBytes) throw fail(`bad-${label}-length`);
};

// ===== AudioSpecificConfig =====
// 5 位 audioObjectType + 4 位采样率索引（15 → 24 位显式 Hz）+ 4 位声道配置，
// 共 13 位（不足 2 字节判截断）。AAC-LC 之后若还剩 >=5 位且值为 31，说明
// 显式带 SBR/PS 扩展（HE-AAC）——按意外拒绝。
const parseAudioSpecificConfig = (asc) => {
  if (!asc || asc.length < 2) throw fail('asc-too-short');
  let pos = 0;
  let acc = 0;
  let bits = 0;
  const take = (count) => {
    while (bits < count) {
      if (pos >= asc.length) throw fail('asc-truncated');
      acc = (acc << 8) | asc[pos];
      pos += 1;
      bits += 8;
    }
    bits -= count;
    const value = (acc >> bits) & ((1 << count) - 1);
    acc = bits > 0 ? acc & ((1 << bits) - 1) : 0;
    return value;
  };

  const audioObjectType = take(5);
  if (audioObjectType !== 2) throw fail(`audio-object-type-${audioObjectType}`);
  const rateIndex = take(4);
  const sampleRate = rateIndex === 15 ? take(24) : (AAC_SAMPLE_RATES[rateIndex] || 0);
  const channelConfig = take(4);
  const usedBits = pos * 8 - bits;
  // 剩余位不足 5 位 → 不可能带 syntacticType 31，纯 AAC-LC
  if (asc.length * 8 - usedBits >= 5 && take(5) === 31) throw fail('he-aac');

  if (!(sampleRate > 0)) throw fail('asc-sample-rate-unknown');
  if (channelConfig > 8) throw fail('asc-channel-config-bad');
  return { sampleRate, channels: channelConfig };
};

// ===== esds → DecoderSpecificInfo =====
// 描述符头：tag(1) + 可扩展长度（1..4 字节，高位 0x80 表示续读）
const readDescriptor = (bytes, bounds, pos, tag) => {
  if (pos >= bounds.end) throw fail('descriptor-missing');
  const actualTag = bytes[pos];
  if (actualTag !== tag) throw fail(`descriptor-tag-${actualTag}`);
  pos += 1;
  let length = 0;
  let done = false;
  for (let round = 0; round < 4; round += 1) {
    if (pos >= bounds.end) throw fail('descriptor-length-truncated');
    const byte = bytes[pos];
    pos += 1;
    length = length * 128 + (byte & 0x7F);
    if ((byte & 0x80) === 0) { done = true; break; }
  }
  if (!done) throw fail('descriptor-length-too-long');
  if (length <= 0 || pos + length > bounds.end) throw fail('descriptor-length-out-of-range');
  return { body: pos, length, end: pos + length };
};

// esds 内容：version/flags(4) → 0x03 ES_Descriptor → 0x04 DecoderConfigDescriptor
// → 0x05 DecoderSpecificInfo（负载即 AudioSpecificConfig）
const readAscFromEsds = (bytes, view, esds) => {
  const body = fullBoxBody(view, esds);
  const bounds = { start: body, end: esds.end };
  const es = readDescriptor(bytes, bounds, body, 0x03);
  if (es.end !== esds.end) throw fail('es-descriptor-not-whole-box');
  let pos = es.body;
  if (pos + 3 > es.end) throw fail('es-descriptor-short');
  const esId = view.getUint16(pos);
  const esFlags = bytes[pos + 2];
  // 0x80 OCR / 0x40 内联句柄 / 0x20 streamState / 0x10 priority：本链路一律拒绝
  if (esFlags !== 0) throw fail('es-descriptor-flags-unexpected');
  if (esId === 0) throw fail('es-id-zero');
  pos += 3;

  const config = readDescriptor(bytes, bounds, pos, 0x04);
  if (config.body + 13 > config.end) throw fail('decoder-config-short');
  const objectTypeIndication = view.getUint8(config.body);
  const streamType = view.getUint8(config.body + 1) >> 2;   // 6 位 streamType + upToStream + 保留
  if (objectTypeIndication !== 0x40) throw fail(`object-type-${objectTypeIndication}`);
  if (streamType !== 5) throw fail(`stream-type-${streamType}`);   // 5 = audio
  const maxBitrate = entryAt(view, esds, config.body + 5, 'max-bitrate');
  const avgBitrate = entryAt(view, esds, config.body + 9, 'avg-bitrate');
  // 固定部分 = objectType(1)+streamType(1)+bufferSizeDB(3)+maxBitrate(4)+avgBitrate(4)
  pos = config.body + 13;

  const specific = readDescriptor(bytes, bounds, pos, 0x05);
  const asc = bytes.slice(specific.body, specific.end);
  // DecoderSpecificInfo 必须是 DecoderConfigDescriptor 的最后一段；
  // 其后允许 ES_Descriptor 里的兄弟描述符（如 0x06 SLConfigDescriptor）
  return { asc, maxBitrate, avgBitrate, trailingDescriptors: specific.end !== config.end };
};

// ===== 样本描述 stsd =====
// SampleEntry 从盒子内容起（无 version/flags）：reserved(6) +
// data_reference_index(2) + channelcount(2) + samplesize(2) + predefined(2)
// + reserved(2) + samplerate(16.16 定点 4 字节) → 子盒子从盒子头 +28 起
const readSampleDescription = (bytes, view, stsd) => {
  const body = fullBoxBody(view, stsd);
  const count = entryAt(view, stsd, body, 'stsd-count');
  if (count !== 1) throw fail(`stsd-entry-count-${count}`);
  const entry = readBox(view, body + 4, stsd);
  if (!entry) throw fail('stsd-entry-box-bad');
  if (entry.type !== 'mp4a') throw fail(`sample-entry-${entry.type}`);
  if (entry.end !== stsd.end) throw fail('stsd-entry-not-whole-box');
  if (entry.start + 28 > entry.end) throw fail('mp4a-entry-short');
  if (view.getUint16(entry.start + 8) !== 0) throw fail('sample-entry-version');
  const dataReferenceIndex = view.getUint16(entry.start + 14);
  if (dataReferenceIndex !== 1) throw fail(`data-reference-index-${dataReferenceIndex}`);
  const channelCount = view.getUint16(entry.start + 16);
  const sampleSize = view.getUint16(entry.start + 18);
  const entrySampleRate = view.getUint32(entry.start + 24) >>> 16;
  const esds = findChild(view, { start: entry.start, headerSize: 28, end: entry.end }, 'esds');
  if (!esds) throw fail('missing-esds');
  const parsed = readAscFromEsds(bytes, view, esds);
  return { ...parsed, channelCount, sampleSize, entrySampleRate };
};

// ===== stts：逐样本时长（µs），用累计精确时间之差避免逐帧舍入漂移 =====
const readTimeToSample = (view, stts, timescale, expectedCount) => {
  const body = fullBoxBody(view, stts);
  const runs = entryAt(view, stts, body, 'stts-count');
  expectExactBody(stts, body + 4, runs, 8, 'stts');
  if (runs === 0 || runs > MAX_MP4_SAMPLE_COUNT) throw fail('bad-stts-runs');

  const deltas = new Float64Array(runs);
  const counts = new Float64Array(runs);
  let total = 0;
  for (let i = 0; i < runs; i += 1) {
    const at = body + 4 + i * 8;
    counts[i] = view.getUint32(at);
    deltas[i] = view.getUint32(at + 4);
    if (!(counts[i] > 0) || !(deltas[i] > 0)) throw fail('bad-stts-entry');
    total += counts[i];
    if (total > MAX_MP4_SAMPLE_COUNT) throw fail('stts-sample-count-too-large');
  }
  if (expectedCount != null && total !== expectedCount) throw fail('stts-stsz-count-mismatch');

  const durationsUs = new Uint32Array(total);
  let previousUs = 0;
  let cumulativeUnits = 0;
  let cursor = 0;
  for (let i = 0; i < runs; i += 1) {
    for (let n = 0; n < counts[i]; n += 1) {
      cumulativeUnits += deltas[i];
      const us = Math.round(cumulativeUnits * 1e6 / timescale);
      durationsUs[cursor] = us - previousUs;
      previousUs = us;
      cursor += 1;
    }
  }
  return { durationsUs, totalSamples: total, totalUs: previousUs };
};

const readSampleSizes = (view, stsz, expectedCount) => {
  const body = fullBoxBody(view, stsz);
  const uniform = entryAt(view, stsz, body, 'stsz-sample-size');
  const count = entryAt(view, stsz, body + 4, 'stsz-sample-count');
  if (count === 0 || count > MAX_MP4_SAMPLE_COUNT) throw fail('bad-stsz-count');
  if (expectedCount != null && count !== expectedCount) throw fail('stsz-stts-count-mismatch');
  const sizes = new Uint32Array(count);
  if (uniform > 0) {
    expectExactBody(stsz, body + 8, 0, 4, 'stsz');
    for (let i = 0; i < count; i += 1) sizes[i] = uniform;
  } else {
    expectExactBody(stsz, body + 8, count, 4, 'stsz');
    for (let i = 0; i < count; i += 1) {
      const size = view.getUint32(body + 8 + i * 4);
      if (size === 0) throw fail('stsz-zero-sample-size');
      sizes[i] = size;
    }
  }
  return { sizes, count };
};

// stsc：(first_chunk, samples_per_chunk, sample_description_index) 游程
const readSampleToChunk = (view, stsc, chunkCount) => {
  const body = fullBoxBody(view, stsc);
  const runs = entryAt(view, stsc, body, 'stsc-count');
  expectExactBody(stsc, body + 4, runs, 12, 'stsc');
  if (runs === 0 || runs > chunkCount) throw fail('bad-stsc-runs');
  const firstChunks = new Uint32Array(runs);
  const perChunks = new Uint32Array(runs);
  for (let i = 0; i < runs; i += 1) {
    const at = body + 4 + i * 12;
    firstChunks[i] = view.getUint32(at);
    perChunks[i] = view.getUint32(at + 4);
    const descriptionIndex = view.getUint32(at + 8);
    if (descriptionIndex !== 1) throw fail(`sample-description-index-${descriptionIndex}`);
    if (!(perChunks[i] > 0)) throw fail('bad-samples-per-chunk');
    if (i === 0 ? firstChunks[i] !== 1 : firstChunks[i] <= firstChunks[i - 1]) {
      throw fail('bad-stsc-first-chunk');
    }
  }
  if (firstChunks[runs - 1] > chunkCount) throw fail('stsc-first-chunk-beyond-chunks');
  return { firstChunks, perChunks, runs };
};

const readChunkOffsets = (view, stbl) => {
  const co64 = findChild(view, stbl, 'co64');
  const box = co64 || findChild(view, stbl, 'stco');
  if (!box) throw fail('missing-stco');
  if (co64 && findChild(view, stbl, 'stco')) throw fail('both-stco-and-co64');
  const body = fullBoxBody(view, box);
  const count = entryAt(view, box, body, `${box.type}-count`);
  const stride = co64 ? 8 : 4;
  expectExactBody(box, body + 4, count, stride, box.type);
  if (count === 0 || count > MAX_MP4_CHUNK_COUNT) throw fail(`bad-${box.type}-count`);
  const offsets = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const at = body + 4 + i * stride;
    if (co64 && (view.getUint32(at) !== 0 || view.getUint32(at + 4) > MAX_SUPPORTED_BYTE_OFFSET)) {
      throw fail('chunk-offset-over-4gb');
    }
    offsets[i] = co64
      ? view.getUint32(at) * 4294967296 + view.getUint32(at + 4)
      : view.getUint32(at);
  }
  return { offsets, count };
};

// 逐样本绝对偏移：chunk-major 展开（chunk 内样本字节连续），
// 任何偏移/长度越界、stsc 与 stco 不自洽都算结构意外
const buildSampleOffsets = ({ sizes, count, chunkOffsets, stsc, fileLength }) => {
  const offsets = new Uint32Array(count);
  let run = 0;
  let remainingInChunk = 0;
  let cursor = 0;
  let lastUsedChunk = -1;
  for (let sample = 0; sample < count; sample += 1) {
    if (remainingInChunk === 0) {
      const chunk = lastUsedChunk + 1;
      if (chunk >= chunkOffsets.count) throw fail('too-few-chunks-for-samples');
      // firstChunks 是 1 基的 chunk 号，chunk（0 基）落在哪个游程由它决定
      if (run + 1 < stsc.runs && chunk + 1 >= stsc.firstChunks[run + 1]) run += 1;
      remainingInChunk = stsc.perChunks[run];
      cursor = chunkOffsets.offsets[chunk];
      lastUsedChunk = chunk;
    }
    const end = cursor + sizes[sample];
    if (!(cursor > 0) || end > fileLength || end > MAX_SUPPORTED_BYTE_OFFSET) {
      throw fail('sample-range-out-of-file');
    }
    offsets[sample] = cursor;
    cursor = end;
    remainingInChunk -= 1;
  }
  if (lastUsedChunk + 1 !== chunkOffsets.count) throw fail('stsc-chunk-count-mismatch');
  return offsets;
};

// mdhd：timescale/duration（v0：4/4/4/4；v1：8/8/4/8）
const readMediaHeader = (view, mdhd) => {
  const content = mdhd.start + mdhd.headerSize;
  if (content + 4 > mdhd.end) throw fail('mdhd-short');
  const version = view.getUint8(content);
  if (version > 1) throw fail(`mdhd-version-${version}`);
  // version 之后的 3 字节 flags 必须为 0
  if (view.getUint8(content + 1) !== 0 || view.getUint8(content + 2) !== 0
    || view.getUint8(content + 3) !== 0) throw fail('mdhd-flags-set');
  let timescale;
  let duration;
  if (version === 0) {
    if (content + 20 > mdhd.end) throw fail('mdhd-v0-short');
    timescale = view.getUint32(content + 12);
    duration = view.getUint32(content + 16);
  } else {
    if (content + 32 > mdhd.end) throw fail('mdhd-v1-short');
    timescale = view.getUint32(content + 20);
    duration = view.getUint32(content + 24) * 4294967296 + view.getUint32(content + 28);
  }
  if (!(timescale > 0)) throw fail('mdhd-timescale-zero');
  return { timescale, duration };
};

// hdlr：内容 = version/flags(4) + predefined(4) + handler_type(4) + name
const handlerTypeOf = (view, hdlr) => {
  const content = hdlr.start + hdlr.headerSize;
  if (content + 12 > hdlr.end) throw fail('hdlr-short');
  if (view.getUint32(content) !== 0) throw fail('hdlr-flags-set');
  return String.fromCharCode(
    view.getUint8(content + 8), view.getUint8(content + 9),
    view.getUint8(content + 10), view.getUint8(content + 11)
  );
};

// 找出音频 trak：非音频 trak 允许「缺 mdia/hdlr」（封面/视频轨的怪结构不值得
// 回退整首），一旦确认是 soun 轨，其内部结构必须严格自洽
const findAudioTrak = (view, moov) => {
  let found = null;
  eachChild(view, moov, (child) => {
    if (found || child.type !== 'trak') return true;
    const mdia = findChild(view, child, 'mdia');
    if (!mdia) return true;
    const hdlr = findChild(view, mdia, 'hdlr');
    if (!hdlr || handlerTypeOf(view, hdlr) !== 'soun') return true;
    found = { trak: child, mdia };
    return false;
  });
  if (!found) throw fail('no-audio-track');
  return found;
};

const parseMp4 = (input) => {
  const bytes = toBytes(input);
  if (!bytes || bytes.byteLength < 16) throw fail('input-too-small');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const root = { type: 'root', start: 0, headerSize: 0, end: bytes.byteLength };

  const moov = requireChild(view, root, 'moov');
  // requireChild 找到 moov 就提前结束遍历，尾部垃圾与截断不会被访问到；
  // 这里补一次完整的顶层遍历，要求盒子严格铺满整个输入
  eachChild(view, root, () => true);
  const { mdia } = findAudioTrak(view, moov);
  const mdhd = requireChild(view, mdia, 'mdhd');
  const { timescale } = readMediaHeader(view, mdhd);
  const minf = requireChild(view, mdia, 'minf');
  const stbl = requireChild(view, minf, 'stbl');

  const description = readSampleDescription(bytes, view, requireChild(view, stbl, 'stsd'));
  if (description.trailingDescriptors) throw fail('esds-trailing-descriptors');
  const { asc, maxBitrate, avgBitrate } = description;
  const { sampleRate, channels } = parseAudioSpecificConfig(asc);
  const stsz = readSampleSizes(view, requireChild(view, stbl, 'stsz'));
  const { durationsUs, totalSamples, totalUs } = readTimeToSample(
    view, requireChild(view, stbl, 'stts'), timescale, stsz.count
  );
  const chunkOffsets = readChunkOffsets(view, stbl);
  const stsc = readSampleToChunk(view, requireChild(view, stbl, 'stsc'), chunkOffsets.count);
  const offsets = buildSampleOffsets({
    sizes: stsz.sizes, count: stsz.count, chunkOffsets, stsc, fileLength: bytes.byteLength
  });

  const channelCount = channels > 0 ? channels : description.channelCount;
  if (!(channelCount > 0)) throw fail('channel-count-unknown');
  // stsd 的 samplerate 与 ASC 不一致时判为意外（原版按轨道采样率开行缓冲，
  // 两者不一致意味着容器与码流自相矛盾，不值得赌）
  if (description.entrySampleRate > 0
    && Math.abs(description.entrySampleRate - sampleRate) >= 1) throw fail('samplerate-mismatch');

  return {
    codec: 'mp4a.40.2',
    sampleRate,
    channels: channelCount,
    asc,
    timescale,
    durationSeconds: totalUs / 1e6,
    samplesPerFrame: AAC_SAMPLES_PER_FRAME,
    maxBitrate,
    avgBitrate,
    count: stsz.count,
    offsets,
    sizes: stsz.sizes,
    durationsUs
  };
};

// 详细版：返回 { ok, value | reason }，便于测试断言具体拒绝原因
export const parseMp4AudioDetailed = (input) => {
  try {
    return { ok: true, value: parseMp4(input) };
  } catch (error) {
    return { ok: false, reason: error?.mp4Reason || error?.message || 'unknown' };
  }
};

// 严格解封装入口：结构意外一律 null（调用方据此回退）
export const parseMp4Audio = (input) => {
  const result = parseMp4AudioDetailed(input);
  return result.ok ? result.value : null;
};

// 时间 → 样本下标（该帧起点 <= 目标时间的最后一帧）：按 stts 展开的
// 逐样本时长做前缀和定位。AAC 常见单游程，但 priming/可变 delta 都会改变
// 映射，所以前缀和是唯一可靠依据。
export const mp4SampleIndexAt = (demux, timeSeconds) => {
  if (!demux || !(demux.count > 0)) return 0;
  const target = Math.max(0, Number(timeSeconds) || 0) * 1e6;
  if (target <= 0) return 0;
  let cumulative = 0;
  for (let i = 0; i < demux.count; i += 1) {
    cumulative += demux.durationsUs[i];
    if (cumulative > target) return i;
  }
  return demux.count - 1;
};

// 样本下标 → 该帧起点的精确时间（秒）
export const mp4SampleTimeSeconds = (demux, index) => {
  if (!demux || !(demux.count > 0)) return 0;
  const clamped = Math.max(0, Math.min(demux.count - 1, Math.trunc(index) || 0));
  let cumulative = 0;
  for (let i = 0; i < clamped; i += 1) cumulative += demux.durationsUs[i];
  return cumulative / 1e6;
};
