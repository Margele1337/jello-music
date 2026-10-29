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
