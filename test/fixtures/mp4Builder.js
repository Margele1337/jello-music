// MP4/AAC 测试夹具：手工拼装 m4a 盒子，供 mp4Demux 单测与调试脚本共用。
const u8 = (v) => [v & 0xFF];
const u16 = (v) => [(v >>> 8) & 0xFF, v & 0xFF];
const u32 = (v) => [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF];
const u64 = (v) => [...u32(Math.floor(v / 4294967296)), ...u32(v % 4294967296)];
const fourcc = (text) => [...text].map((char) => char.charCodeAt(0));
// 盒子内容一律先扁平化：允许直接传子盒子数组（嵌套层数不限）
const box = (type, content) => {
  const body = content.flat(Infinity);
  return [...u32(8 + body.length), ...fourcc(type), ...body];
};
const fullBox = (type, body, versionFlags = 0) => box(type, [...u32(versionFlags), ...body]);

// 描述符一律用 4 字节可扩展长度（高位 0x80 续读），顺带覆盖长度续读分支
const expandLength = (len) => [
  0x80 | ((len >>> 21) & 0x7F),
  0x80 | ((len >>> 14) & 0x7F),
  0x80 | ((len >>> 7) & 0x7F),
  len & 0x7F
];
const descriptor = (tag, payload) => [tag, ...expandLength(payload.length), ...payload];

// AudioSpecificConfig 位打包：AAC-LC 44.1kHz 立体声 = 0x12 0x10
const ascBits = (bits) => {
  while (bits.length % 8 !== 0) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    out.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  return out;
};

const ascFor = ({ objectType = 2, rateIndex = 4, explicitRate = null, channels = 2, sbr = false } = {}) => {
  const bits = [];
  const push = (value, count) => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(objectType, 5);
  push(rateIndex, 4);
  if (explicitRate != null) push(explicitRate, 24);
  push(channels, 4);
  if (sbr) { push(31, 5); push(0, 4); }        // syntacticType=31 + extensionType=SBR
  push(0, 1); push(0, 1); push(0, 1);          // frameLengthFlag / dependsOnCoreCoder / extensionFlag
  return ascBits(bits);
};

const esdsFor = (asc, { objectTypeIndication = 0x40, streamType = 5, esFlags = 0, esId = 1, slConfig = true } = {}) => {
  const specific = descriptor(0x05, asc);
  const config = descriptor(0x04, [
    objectTypeIndication,
    (streamType << 2) | 1,
    0, 0, 0,                                   // bufferSizeDB（3 字节）
    ...u32(256000),
    ...u32(128000),
    ...specific
  ]);
  const esBody = [...u16(esId), esFlags, ...config];
  if (slConfig) esBody.push(...descriptor(0x06, [0x02]));
  return fullBox('esds', descriptor(0x03, esBody));
};

const mp4aEntry = (asc, { format = 'mp4a', channels = 2, sampleRate = 44100, esdsOptions = {} } = {}) => box(format, [
  0, 0, 0, 0, 0, 0,                            // reserved(6)
  ...u16(1),                                   // data_reference_index
  ...u16(channels),
  ...u16(16),                                  // sample size（位）
  ...u16(0), ...u16(0),                        // predefined + reserved
  ...u32(sampleRate * 65536),                  // 16.16 定点采样率
  ...esdsFor(asc, esdsOptions)
]);

// stsc 游程：默认每 chunk perChunk 条样本
const defaultRuns = (sampleCount, perChunk) => {
  const runs = [];
  let chunk = 1;
  let left = sampleCount;
  while (left > 0) {
    const take = Math.min(perChunk, left);
    runs.push([chunk, take, 1]);
    left -= take;
    chunk += 1;
  }
  return runs;
};

const sumSizes = (sizes, from, count) => {
  let total = 0;
  for (let i = from; i < from + count && i < sizes.length; i += 1) total += sizes[i];
  return total;
};

// 组装 m4a：mdat 数据区按样本顺序摆放，chunk 偏移默认指向各 chunk 首样本
// 返回 { bytes, dataStart, chunkOffsets, sampleOffsets }（偏移均为绝对文件偏移）
const buildM4a = ({
  sizes = [64, 64, 64, 64],
  perChunk = 2,
  stscRuns = null,
  sttsRuns = null,
  timescale = 44100,
  asc = ascFor(),
  esdsOptions = {},
  stsdFormat = 'mp4a',
  handler = 'soun',
  channels = 2,
  sampleRate = 44100,
  chunkType = 'stco',
  moovFirst = false,
  mdatPad = 0,
  uniformSize = 0,
  mdhdVersion = 0,
  chunkOffsetOverride = null,
  stsdOverride = null,
  sttsOverride = null,
  stszOverride = null,
  stscOverride = null,
  chunkOverride = null,
  stblExtra = [],
  trailingBytes = [],
  leadingBytes = []
} = {}) => {
  const count = sizes.length;
  const runs = stscRuns || defaultRuns(count, perChunk);
  const runsToUse = stscOverride ? runs : runs;
  const stts = sttsRuns || [[count, 1024]];

  // chunk 相对 mdat 数据起点的偏移
  const relativeChunkOffsets = [];
  let cursor = 0;
  if (!stscOverride) {
    let sample = 0;
    for (const [, per] of runsToUse) {
      relativeChunkOffsets.push(cursor);
      cursor += sumSizes(sizes, sample, per);
      sample += per;
    }
  } else {
    for (let i = 0; i < (chunkOffsetOverride?.length || runs.length); i += 1) relativeChunkOffsets.push(0);
  }

  const ftyp = box('ftyp', [...fourcc('M4A '), ...u32(0), ...fourcc('M4A '), ...fourcc('mp42')]);
  const buildMoov = (absoluteOffsets) => {
    const stsd = stsdOverride || fullBox('stsd', [...u32(1), ...mp4aEntry(asc, {
      format: stsdFormat, channels, sampleRate, esdsOptions
    })]);
    const sttsBox = sttsOverride || fullBox('stts', (() => {
      const body = [...u32(stts.length)];
      for (const [c, d] of stts) body.push(...u32(c), ...u32(d));
      return body;
    })());
    const stszBox = stszOverride || fullBox('stsz', (() => {
      const body = [...u32(uniformSize || 0), ...u32(count)];
      if (!uniformSize) for (const size of sizes) body.push(...u32(size));
      return body;
    })());
    const stscBox = stscOverride || fullBox('stsc', (() => {
      const body = [...u32(runs.length)];
      for (const [first, per, descriptionIndex] of runs) {
        body.push(...u32(first), ...u32(per), ...u32(descriptionIndex));
      }
      return body;
    })());
    const stride = chunkType === 'co64' ? u64 : u32;
    const chunkBox = chunkOverride || fullBox(chunkType, (() => {
      const body = [...u32(absoluteOffsets.length)];
      for (const offset of absoluteOffsets) body.push(...stride(offset));
      return body;
    })());
    const mdhdBody = mdhdVersion === 0
      ? [
        ...u32(0),                                        // version/flags
        ...u32(0), ...u32(0),                             // creation + modification time
        ...u32(timescale),
        ...u32(Math.round(timescale * count * 1024 / 44100)),
        ...u16(0x55C4), ...u16(0)                          // language + quality
      ]
      : [...u32(0x01000000), ...u64(0), ...u64(0), ...u32(timescale), ...u64(0), ...u16(0x55C4), ...u16(0)];
    const mdhd = box('mdhd', mdhdBody);
    const hdlr = box('hdlr', [...u32(0), ...u32(0), ...fourcc(handler), 0]);
    const stbl = box('stbl', [stsd, sttsBox, stszBox, stscBox, chunkBox, ...stblExtra]);
    const minf = box('minf', [stbl]);
    const mdia = box('mdia', [hdlr, mdhd, minf]);
    const trak = box('trak', [mdia]);
    return box('moov', [trak]);
  };

  // moov 长度与偏移取值无关 → 先用占位偏移求长度，再定位 mdat
  const placeholder = new Array(relativeChunkOffsets.length).fill(0);
  const moovLength = buildMoov(placeholder).length;
  const mdatDataLength = sumSizes(sizes, 0, count) + mdatPad;
  const mdat = [...u32(8 + mdatDataLength), ...fourcc('mdat'), ...new Array(mdatDataLength).fill(0x5A)];
  const mdatStart = moovFirst ? leadingBytes.length + moovLength : leadingBytes.length + ftyp.length;
  const dataStart = mdatStart + 8;
  const absoluteChunkOffsets = chunkOffsetOverride
    || relativeChunkOffsets.map((value) => dataStart + value);
  const moov = buildMoov(absoluteChunkOffsets);

  const bytes = Uint8Array.from(moovFirst
    ? [...leadingBytes, ...moov, ...mdat, ...ftyp, ...trailingBytes]
    : [...leadingBytes, ...ftyp, ...mdat, ...moov, ...trailingBytes]);

  // 逐样本绝对偏移（stsc/stsz 展开的期望值）
  const sampleOffsets = [];
  if (!stscOverride && !chunkOffsetOverride) {
    let sample = 0;
    for (let chunk = 0; chunk < runs.length; chunk += 1) {
      const [, per] = runs[chunk];
      for (let i = 0; i < per; i += 1) sampleOffsets.push(absoluteChunkOffsets[chunk] + sumSizes(sizes, sample, i));
      sample += per;
    }
  }
  return { bytes, dataStart, mdatStart, chunkOffsets: absoluteChunkOffsets, sampleOffsets };
};

// ===== 正常结构 =====

export { u8, u16, u32, u64, fourcc, box, fullBox, expandLength, descriptor, ascBits, ascFor, esdsFor, mp4aEntry, defaultRuns, sumSizes, buildM4a };
