import test from 'node:test';
import assert from 'node:assert/strict';
import { mixFrameIntoWindow } from '../src/services/audio/mp3Frame.js';

const INT16_SCALE = 32768;
const FFT_SIZE = 2048;

// 模拟 f32-planar 语义的 copyTo：每个平面 frameSamples 个样本
const makeReadPlane = (planes, calls = []) => (planeIndex) => {
  calls.push(planeIndex);
  return Float32Array.from(planes[planeIndex]);
};

const runMix = ({ planes, frameSamples, channels }) => {
  const windowSamples = new Float32Array(FFT_SIZE);
  windowSamples.fill(9);   // 预填垃圾值，验证补零/覆盖
  const calls = [];
  const take = mixFrameIntoWindow({
    readPlane: makeReadPlane(planes, calls),
    frameSamples,
    channels,
    windowSamples,
    pairsNeeded: FFT_SIZE / 2,
    int16Scale: INT16_SCALE
  });
  return { take, windowSamples, calls };
};

test('stereo aac frames (1024/ch) fill the window exactly with L/R interleaved', () => {
  const plane0 = Array.from({ length: 1024 }, (_, i) => i / 1024);
  const plane1 = Array.from({ length: 1024 }, (_, i) => -(i + 1) / 1024);
  const { take, windowSamples, calls } = runMix({ planes: [plane0, plane1], frameSamples: 1024, channels: 2 });

  assert.equal(take, 1024);
  assert.deepEqual(calls, [0, 1]);
  assert.equal(windowSamples[0], 0);                       // L0
  assert.equal(windowSamples[1], Math.round(-1 / 1024 * INT16_SCALE)); // R0 = plane1[0]
  assert.equal(windowSamples[2], Math.round(1 / 1024 * INT16_SCALE));  // L1
  assert.equal(windowSamples[3], Math.round(-2 / 1024 * INT16_SCALE));
  assert.equal(windowSamples[2046], Math.round(clampMid(1023 / 1024) * INT16_SCALE));
  assert.ok(windowSamples.every((v) => v !== 9), 'no stale values left');
});

test('stereo mp3 frames (1152/ch) truncate to 1024 pairs', () => {
  const plane0 = Array.from({ length: 1152 }, (_, i) => (i >= 1024 ? 7 : 0.5)); // 截断段不应被读取
  const plane1 = Array.from({ length: 1152 }, (_, i) => (i >= 1024 ? 7 : -0.5));
  const { take, windowSamples } = runMix({ planes: [plane0, plane1], frameSamples: 1152, channels: 2 });

  assert.equal(take, 1024);
  assert.equal(windowSamples[0], Math.round(0.5 * INT16_SCALE));
  assert.equal(windowSamples[1], Math.round(-0.5 * INT16_SCALE));
  // 截断段（i>=1024 对）不进窗：窗内没有 7*32768
  assert.ok(windowSamples.every((v) => Math.abs(v) <= INT16_SCALE));
});

test('mono frames duplicate L into R and read only plane 0', () => {
  const plane0 = Array.from({ length: 1152 }, (_, i) => (i === 5 ? 0.25 : 0));
  const { take, windowSamples, calls } = runMix({ planes: [plane0], frameSamples: 1152, channels: 1 });

  assert.equal(take, 1024);
  assert.deepEqual(calls, [0]);
  assert.equal(windowSamples[10], Math.round(0.25 * INT16_SCALE));
  assert.equal(windowSamples[11], windowSamples[10]);
});

test('values outside [-1, 1] clamp before scaling', () => {
  const plane0 = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1.5 : i === 1 ? -2 : 0));
  const plane1 = Array.from({ length: 1024 }, () => 0);
  const { windowSamples } = runMix({ planes: [plane0, plane1], frameSamples: 1024, channels: 2 });

  assert.equal(windowSamples[0], INT16_SCALE);
  assert.equal(windowSamples[2], -INT16_SCALE);
});

function clampMid(value) {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

// ===== 预设 1（original）· 全格式统一的打包语义 =====
const { mixFrameIntoWindowPacked } = await import('../src/services/audio/mp3Frame.js');

test('original packs frames as L*2 + R/32768 with no Int16 clamp', () => {
  const plane0 = Float32Array.from([1, -1, 0.5, 0]);      // L（s16 量级 ±32767 缩放前）
  const plane1 = Float32Array.from([0.25, -0.25, 3, -3]); // R
  const windowSamples = new Float32Array(1024);
  windowSamples.fill(9);

  const take = mixFrameIntoWindowPacked({
    readPlane: (planeIndex) => (planeIndex === 0 ? plane0 : plane1),
    frameSamples: 4,
    channels: 2,
    windowSamples,
    pairsNeeded: 512
  });

  assert.equal(take, 4);
  assert.equal(windowSamples[0], 1 * 65536 + 0.25);
  assert.equal(windowSamples[1], -1 * 65536 + -0.25);
  // 不做 [-1,1] 削波：s16 量纲下打包值域 ±65536，R 以 1 的幅度并入
  assert.equal(windowSamples[2], 0.5 * 65536 + 3);
  assert.equal(windowSamples[3], 0 * 65536 + -3);
  // 尾部补零到窗长
  assert.equal(windowSamples[4], 0);
  assert.equal(windowSamples[1023], 0);
});

test('original packed truncates to pairsNeeded and reads only plane 0 for mono', () => {
  const plane0 = Float32Array.from({ length: 1152 }, (_, i) => (i < 512 ? 1 : 7));
  const plane1 = Float32Array.from({ length: 1152 }, () => 0.5);
  const windowSamples = new Float32Array(1024);
  const calls = [];

  const take = mixFrameIntoWindowPacked({
    readPlane: (planeIndex) => {
      calls.push(planeIndex);
      return planeIndex === 0 ? plane0 : plane1;
    },
    frameSamples: 1152,
    channels: 2,
    windowSamples,
    pairsNeeded: 512
  });

  assert.equal(take, 512);
  assert.deepEqual(calls, [0, 1]);
  assert.equal(windowSamples[511], 1 * 65536 + 0.5);
  assert.equal(windowSamples[512], 0);   // 截断段不进窗

  const monoWindow = new Float32Array(1024);
  mixFrameIntoWindowPacked({
    readPlane: () => plane0,
    frameSamples: 1152,
    channels: 1,
    windowSamples: monoWindow,
    pairsNeeded: 512
  });
  assert.equal(monoWindow[0], 65536);     // mono 按 s16L*2 量纲，无 R 混入
});

test('original mp3 window covers 1024 sample times instead of only 512 stereo pairs', () => {
  const plane0 = Float32Array.from({ length: 1152 }, (_, i) => i / 1152);
  const plane1 = Float32Array.from({ length: 1152 }, () => 0.25);
  const windowSamples = new Float32Array(1024);
  windowSamples.fill(9);

  const take = mixFrameIntoWindowPacked({
    readPlane: (planeIndex) => (planeIndex === 0 ? plane0 : plane1),
    frameSamples: 1152,
    channels: 2,
    windowSamples,
    pairsNeeded: 1024
  });

  assert.equal(take, 1024);
  // Float32 在 ~6e4 量级的分辨率约 0.004，容差需覆盖一次舍入
  assert.ok(Math.abs(windowSamples[512] - ((512 / 1152) * 65536 + 0.25)) < 0.01);
  assert.ok(Math.abs(windowSamples[1023] - ((1023 / 1152) * 65536 + 0.25)) < 0.01);
  assert.ok(windowSamples.every((value) => value !== 9), '整个 1024 点窗都被当前帧覆盖');
});

test('original packed preserves L when readPlane reuses one scratch buffer', () => {
  const planes = [
    Float32Array.from([0.5, -0.25, 0.125, 1]),
    Float32Array.from([0.25, 0.75, -0.5, -1])
  ];
  const scratch = new Float32Array(4);
  const windowSamples = new Float32Array(4);

  mixFrameIntoWindowPacked({
    readPlane: (planeIndex) => {
      scratch.set(planes[planeIndex]);
      return scratch;
    },
    frameSamples: 4,
    channels: 2,
    windowSamples,
    pairsNeeded: 4
  });

  for (let i = 0; i < 4; i += 1) {
    assert.equal(windowSamples[i], planes[0][i] * 65536 + planes[1][i]);
  }
});
