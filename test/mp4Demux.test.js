import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mp4SampleIndexAt,
  mp4SampleTimeSeconds,
  parseMp4Audio,
  parseMp4AudioDetailed
} from '../src/services/audio/mp4Demux.js';

// ===== 合成 MP4 字节构造器（纯手工字节，绝不引入真实媒体文件）=====

import { buildM4a, ascFor, fourcc, fullBox, u32, mp4aEntry, box, descriptor, u16, ascBits, u64 } from './fixtures/mp4Builder.js';

test('parses a well-formed m4a: ASC, sample rate, channels and per-sample byte ranges', () => {
  const { bytes, sampleOffsets, dataStart } = buildM4a({ sizes: [64, 64, 64, 64], perChunk: 2 });
  const demux = parseMp4Audio(bytes);
  assert.ok(demux);
  assert.equal(demux.codec, 'mp4a.40.2');
  assert.equal(demux.sampleRate, 44100);
  assert.equal(demux.channels, 2);
  assert.deepEqual(Array.from(demux.asc), ascFor());
  assert.equal(demux.samplesPerFrame, 1024);
  assert.equal(demux.count, 4);
  assert.deepEqual(Array.from(demux.offsets), sampleOffsets);
  assert.deepEqual(Array.from(demux.sizes), [64, 64, 64, 64]);
  // 1024/44100 = 23.22ms：舍入用「累计精确时间之差」，逐样本时长恒为 23220µs
  assert.deepEqual(Array.from(demux.durationsUs), [23220, 23220, 23220, 23220]);
  assert.ok(Math.abs(demux.durationSeconds - 4096 / 44100) < 1e-6);
  assert.equal(sampleOffsets[0], dataStart);
  assert.equal(sampleOffsets[3], dataStart + 192);
});

test('walks moov-first (faststart) layout and chunk boundaries from stsc/stco', () => {
  const sizes = [210, 333, 87, 1024, 512];
  const { bytes, sampleOffsets, chunkOffsets } = buildM4a({ sizes, perChunk: 3, moovFirst: true });
  const demux = parseMp4Audio(bytes);
  assert.ok(demux);
  assert.deepEqual(Array.from(demux.sizes), sizes);
  assert.deepEqual(Array.from(demux.offsets), sampleOffsets);
  // 两个 chunk（3 + 2 条样本）：第二个 chunk 的起点由 stco 独立给出
  assert.equal(chunkOffsets.length, 2);
  assert.equal(demux.offsets[0], chunkOffsets[0]);
  assert.equal(demux.offsets[3], chunkOffsets[1]);
  assert.equal(demux.offsets[3], demux.offsets[2] + demux.sizes[2]);
});

test('maps samples across non-contiguous chunks (stco offsets, not running cursor)', () => {
  const sizes = [64, 64, 64, 64, 64];
  const probe = buildM4a({ sizes, perChunk: 3 });
  const secondChunkAt = probe.dataStart + 1000;          // 人为把 chunk2 挪远
  const { bytes, dataStart } = buildM4a({
    sizes, perChunk: 3, mdatPad: 1600, chunkOffsetOverride: [probe.dataStart, secondChunkAt]
  });
  const demux = parseMp4Audio(bytes);
  assert.ok(demux);
  assert.deepEqual(Array.from(demux.offsets), [
    dataStart, dataStart + 64, dataStart + 128,
    secondChunkAt, secondChunkAt + 64
  ]);
});

test('reads uniform stsz tables, co64 offsets and mdhd v1', () => {
  const { bytes, sampleOffsets } = buildM4a({
    sizes: new Array(6).fill(128), uniformSize: 128, perChunk: 4, chunkType: 'co64', mdhdVersion: 1
  });
  const demux = parseMp4Audio(bytes);
  assert.ok(demux);
  assert.deepEqual(Array.from(demux.sizes), new Array(6).fill(128));
  assert.deepEqual(Array.from(demux.offsets), sampleOffsets);
});

test('expands multi-run stts into drift-free per-sample durations', () => {
  // 游程 1：2 条 × 1024；游程 2：2 条 × 2048（timescale 44100）
  const { bytes } = buildM4a({ sizes: [64, 64, 64, 64], sttsRuns: [[2, 1024], [2, 2048]] });
  const demux = parseMp4Audio(bytes);
  assert.deepEqual(Array.from(demux.durationsUs), [23220, 23220, 46440, 46440]);
  const total = demux.durationsUs.reduce((sum, value) => sum + value, 0);
  assert.equal(total / 1e6, demux.durationSeconds);
  // 与「6144 采样 / 44100」的精确值只差累计舍入残差（无逐帧漂移）
  assert.ok(Math.abs(total - (6144 * 1e6 / 44100)) < 1);
});

test('explicit 24-bit sampling frequency in the ASC is honoured', () => {
  const { bytes } = buildM4a({ asc: ascFor({ rateIndex: 15, explicitRate: 44100 }) });
  assert.equal(parseMp4Audio(bytes).sampleRate, 44100);
});

test('sample index/time mapping follows stts prefix sums', () => {
  const { bytes } = buildM4a({ sizes: new Array(10).fill(64), sttsRuns: [[10, 1024]] });
  const demux = parseMp4Audio(bytes);
  assert.equal(mp4SampleIndexAt(demux, 0), 0);
  assert.equal(mp4SampleIndexAt(demux, 0.0001), 0);
  assert.equal(mp4SampleIndexAt(demux, 0.0232), 0);
  assert.equal(mp4SampleIndexAt(demux, 0.0233), 1);          // 跨过 23.22ms
  assert.equal(mp4SampleIndexAt(demux, 0.2), 8);             // 8×23.22 = 185.76ms < 200ms
  assert.equal(mp4SampleIndexAt(demux, 5), demux.count - 1); // 超出末尾钳到最后一帧
  assert.equal(mp4SampleTimeSeconds(demux, 0), 0);
  assert.ok(Math.abs(mp4SampleTimeSeconds(demux, 3) - 3 * 1024 / 44100) < 1e-6);
  assert.equal(mp4SampleTimeSeconds(demux, 999), mp4SampleTimeSeconds(demux, demux.count - 1));
});

// ===== 严格拒绝（结构意外一律 null）=====

const reject = (input, expectedReason) => {
  const result = parseMp4AudioDetailed(input);
  assert.equal(result.ok, false, JSON.stringify(result.value && result.value.count));
  if (expectedReason) assert.equal(result.reason, expectedReason, result.reason);
  assert.equal(parseMp4Audio(input), null);
};

test('rejects missing moov, non-audio tracks and truncated/oversized boxes', () => {
  reject(buildM4a({ trailingBytes: [1, 2, 3, 4] }).bytes, undefined);   // 尾部垃圾：顶层盒子铺不满
  // 20 字节的合法 ftyp（≥ 输入下限 16），但整个文件没有 moov
  reject(Uint8Array.from([0, 0, 0, 20, ...fourcc('ftyp'), ...fourcc('M4A '), ...u32(0), ...u32(0)]), 'missing-moov');
  reject(buildM4a({ handler: 'vide' }).bytes, 'no-audio-track');
  const whole = buildM4a().bytes;
  reject(whole.subarray(0, whole.byteLength - 6));                      // 截断
  reject(whole.subarray(0, 12), 'input-too-small');
  reject(null, 'input-too-small');
});

test('rejects bad sample-description shapes', () => {
  reject(buildM4a({ stsdFormat: 'alac' }).bytes, 'sample-entry-alac');
  reject(buildM4a({ stsdOverride: fullBox('stsd', [...u32(2), ...mp4aEntry(ascFor())]) }).bytes, 'stsd-entry-count-2');
  // stsd 里条目盒子越出 stsd 边界
  const badEntry = [...mp4aEntry(ascFor())];
  badEntry[0] = 0xFF;
  reject(buildM4a({ stsdOverride: fullBox('stsd', [...u32(1), ...badEntry]) }).bytes, 'stsd-entry-not-whole-box');
  // data_reference_index != 1
  const entry = mp4aEntry(ascFor());
  entry[8 + 6] = 0; entry[8 + 7] = 2;
  reject(buildM4a({ stsdOverride: fullBox('stsd', [...u32(1), ...entry]) }).bytes, 'data-reference-index-2');
});

test('extracts the ASC through esds and rejects descriptor surprises', () => {
  reject(buildM4a({ esdsOptions: { objectTypeIndication: 0x67 } }).bytes, 'object-type-103');
  reject(buildM4a({ esdsOptions: { streamType: 3 } }).bytes, 'stream-type-3');
  reject(buildM4a({ esdsOptions: { esFlags: 0x80 } }).bytes, 'es-descriptor-flags-unexpected');
  // SLConfigDescriptor 在 14496-1 里是可选的，缺它仍然合法 → 必须接受
  assert.ok(parseMp4Audio(buildM4a({ esdsOptions: { slConfig: false } }).bytes));
  // 缺少 0x05 DecoderSpecificInfo：手工拼一个只有 DecoderConfig 的 esds
  const noSpecific = fullBox('esds', descriptor(0x03, [
    ...u16(1), 0,
    ...descriptor(0x04, [0x40, (5 << 2) | 1, 0, 0, 0, ...u32(1), ...u32(1)])
  ]));
  reject(buildM4a({ stsdOverride: fullBox('stsd', [...u32(1), ...box('mp4a', [
    0, 0, 0, 0, 0, 0, ...u16(1), ...u16(2), ...u16(16), ...u16(0), ...u16(0), ...u32(44100 * 65536), ...noSpecific
  ])]) }).bytes, 'descriptor-missing');
});

test('rejects non-AAC-LC object types: HE-AAC SBR/PS and main profile', () => {
  reject(buildM4a({ asc: ascFor({ objectType: 5 }) }).bytes, 'audio-object-type-5');
  reject(buildM4a({ asc: ascFor({ objectType: 1 }) }).bytes, 'audio-object-type-1');
  reject(buildM4a({ asc: ascFor({ sbr: true }) }).bytes, 'he-aac');
  // 截断的 ASC（不足 2 字节）
  reject(buildM4a({ asc: [0x12] }).bytes, 'asc-too-short');
  // 未知采样率索引 13/14
  reject(buildM4a({ asc: ascBits([0, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1]) }).bytes, 'asc-sample-rate-unknown');
});

test('rejects inconsistent sample tables', () => {
  // stts 总样本数 != stsz 条数
  reject(buildM4a({ sizes: new Array(4).fill(64), sttsRuns: [[3, 1024]] }).bytes, 'stts-stsz-count-mismatch');
  // stts delta 为 0
  reject(buildM4a({ sttsRuns: [[4, 0]] }).bytes, 'bad-stts-entry');
  // stsz 某条样本长度为 0
  reject(buildM4a({ sizes: [64, 0, 64, 64] }).bytes, 'stsz-zero-sample-size');
  // stsz 表长度与声明条数不符（多 4 字节）
  reject(buildM4a({ stszOverride: fullBox('stsz', [...u32(0), ...u32(3), ...u32(64), ...u32(64), ...u32(64), ...u32(64)]) }).bytes, 'bad-stsz-length');
  // stsc 的样本描述索引 != 1（多重描述）
  reject(buildM4a({ stscRuns: [[1, 2, 2], [2, 2, 1]] }).bytes, 'sample-description-index-2');
  // stsc 游程首 chunk 号不是 1
  reject(buildM4a({ stscRuns: [[2, 4, 1]] }).bytes, 'bad-stsc-first-chunk');
  // stsc 覆盖的样本数少于 stsz 条数 → chunk 提前用尽
  reject(buildM4a({ sizes: new Array(6).fill(64), stscRuns: [[1, 2, 1], [2, 2, 1]] }).bytes, 'too-few-chunks-for-samples');
  // stsc 引用的 chunk 数与 stco 条数不符（stco 多出一条没人引用）。
  // 构造器按 stsc 游程推导 stco，所以必须显式给两个 chunk 偏移才能造出失配
  const stscProbe = buildM4a({ sizes: new Array(4).fill(64), stscRuns: [[1, 4, 1]] });
  reject(buildM4a({
    sizes: new Array(4).fill(64),
    stscRuns: [[1, 4, 1]],
    chunkOffsetOverride: [stscProbe.dataStart, stscProbe.dataStart + 128]
  }).bytes, 'stsc-chunk-count-mismatch');
  // stco 与 co64 同时存在
  reject(buildM4a({
    sizes: new Array(4).fill(64),
    stblExtra: fullBox('co64', [...u32(2), ...u64(100), ...u64(200)])
  }).bytes, 'both-stco-and-co64');
});

test('rejects sample byte ranges that fall outside the file', () => {
  const { dataStart } = buildM4a();
  // chunk 偏移指到 EOF 之外
  reject(buildM4a({ sizes: [64, 64, 64, 64], perChunk: 2, chunkOffsetOverride: [dataStart, dataStart + 100000] }).bytes,
    'sample-range-out-of-file');
  // chunk 偏移为 0（盒子头位置，不可当音频字节用）
  reject(buildM4a({ sizes: [64, 64, 64, 64], perChunk: 2, chunkOffsetOverride: [0, 200] }).bytes,
    'sample-range-out-of-file');
});

