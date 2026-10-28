import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 纯函数藏在 SFC 里（约束：只能新增本测试文件），从源码提取后验证与
// sigmarebase MusicManager.renderSpectrum :206-212 的公式逐位一致：
// bass = max(0, sqrt(a[0..2]) - 1000); scale = 1 + round(bass/(4750-1000)*0.14*75)/75
const vuePath = fileURLToPath(new URL('../src/views/SpectrumHudView.vue', import.meta.url));
const source = readFileSync(vuePath, 'utf8');
const match = source.match(/const computePulseScale = \(smoothedLevels\) => \{[\s\S]*?\n\};/);
assert.ok(match, 'SpectrumHudView.vue 应定义 computePulseScale');
const computePulseScale = new Function(`${match[0]}\nreturn computePulseScale;`)();

const withBins = (values) => {
  const levels = new Float32Array(114);
  values.forEach((value, index) => { levels[index] = value; });
  return levels;
};

test('静音时 scale 恒为 1', () => {
  assert.equal(computePulseScale(withBins([])), 1);
});

test('sqrt(a) 低于 1000 时 bass 下限为 0', () => {
  assert.equal(computePulseScale(withBins([999 * 999, 500000, 1])), 1);
});

test('只看 bin0..2 且取最大值', () => {
  // bin3 再大也不参与
  assert.equal(computePulseScale(withBins([0, 0, 0, 2.256e7])), 1);
  // bass = 2875 - 1000 = 1875 -> (1875/3750)*0.14*75 = 5.25 -> round 5
  const scale = computePulseScale(withBins([1000 * 1000, 2875 * 2875, 0]));
  assert.ok(Math.abs(scale - (1 + 5 / 75)) < 1e-12);
});

test('量化到 1/75 步长', () => {
  const scale = computePulseScale(withBins([2000 * 2000, 0, 0]));
  // bass = 1000 -> 1000/3750*10.5 = 2.8 -> round 3
  assert.ok(Math.abs((scale - 1) * 75 - 3) < 1e-9);
  assert.ok(Number.isInteger(Math.round((scale - 1) * 75)));
});

test('幅度封顶 2.256e7 时不超过原版的 1/75 量化上限', () => {
  // sqrt(2.256e7) ≈ 4749.74 -> bass ≈ 3749.74 -> 10.4993 -> round 10
  const scale = computePulseScale(withBins([2.256e7, 0, 0]));
  assert.ok(Math.abs(scale - (1 + 10 / 75)) < 1e-12);
  assert.ok(scale <= 1.14);
});
