import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLoudnessData,
  setLoudnessEnabled
} from '../src/services/audio/spectrum.js';

test('loudness gain is 1 when disabled or data missing', () => {
  setLoudnessEnabled(false);
  assert.equal(applyLoudnessData({ volume: -11.4, volumeGain: 0, volumePeak: 0.5 }), 1);
  setLoudnessEnabled(true);
  assert.equal(applyLoudnessData(null), 1);
  assert.equal(applyLoudnessData(undefined), 1);
});

test('loudness gain follows -14 LUFS target', () => {
  setLoudnessEnabled(true);
  // -14 LUFS 歌曲无需调整
  assert.ok(Math.abs(applyLoudnessData({ volume: -14, volumeGain: 0, volumePeak: 0.5 }) - 1) < 1e-9);
  // -11.4 LUFS 偏响，需要衰减 10^(-2.6/20)
  const quieter = applyLoudnessData({ volume: -11.4, volumeGain: 0, volumePeak: 0.5 });
  assert.ok(Math.abs(quieter - Math.pow(10, -2.6 / 20)) < 1e-9);
  // API 建议增益叠加
  const boosted = applyLoudnessData({ volume: -16, volumeGain: 3, volumePeak: 0.5 });
  assert.ok(Math.abs(boosted - Math.pow(10, 2 / 20) * Math.pow(10, 3 / 20)) < 1e-9);
});

test('loudness gain clamps for clipping and range', () => {
  setLoudnessEnabled(true);
  // 峰值防削波：0.95 / peak
  const clipped = applyLoudnessData({ volume: -20, volumeGain: 0, volumePeak: 1.0 });
  assert.ok(Math.abs(clipped - 0.95) < 1e-9);
  // 增益范围 [0.1, 3]
  const maxed = applyLoudnessData({ volume: -60, volumeGain: 0, volumePeak: 0.1 });
  assert.equal(maxed, 3);
});
