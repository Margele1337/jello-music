import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDragTargetX } from '../shared/dragTarget.js';

// 1920 宽单显示器、面板 800：屏幕内最大 X = 1120，橡皮筋触发线 = desired > 2120
const base = { areaLeft: 0, areaRight: 1920, windowWidth: 800 };

test('on-screen desired positions clamp exactly, no overhang', () => {
  assert.deepEqual(resolveDragTargetX({ ...base, desiredX: 500, movedX: 0 }), { x: 500, overhanging: false });
  assert.deepEqual(resolveDragTargetX({ ...base, desiredX: 1120, movedX: 0 }), { x: 1120, overhanging: false });
  // 右缘相切（x + 800 = 1920）不算悬出（原版严格 >）
  assert.deepEqual(resolveDragTargetX({ ...base, desiredX: 1200, movedX: 100 }), { x: 1120, overhanging: false });
});

test('beyond threshold with movedX > 70 enters the half-speed rubber band', () => {
  const result = resolveDragTargetX({ ...base, desiredX: 2500, movedX: 300 });
  // pushedX = 1120 + trunc((2500 - 1120 - 200) / 2) = 1710，面板悬出 590
  assert.equal(result.x, 1710);
  assert.equal(result.overhanging, true);
});

test('beyond threshold without movedX > 70 stays hard-clamped', () => {
  assert.deepEqual(resolveDragTargetX({ ...base, desiredX: 2500, movedX: 50 }), { x: 1120, overhanging: false });
  assert.deepEqual(resolveDragTargetX({ ...base, desiredX: 2500, movedX: 70 }), { x: 1120, overhanging: false });
});

test('within threshold never rubber-bands even with a big movedX', () => {
  assert.deepEqual(resolveDragTargetX({ ...base, desiredX: 1200, movedX: 500 }), { x: 1120, overhanging: false });
});

test('rubber band starting just past the threshold begins at the clamp point', () => {
  const result = resolveDragTargetX({ ...base, desiredX: 1321, movedX: 100 });
  assert.equal(result.x, 1120);
  assert.equal(result.overhanging, false);
});

test('float desired rounds into the clamp like the original inline math', () => {
  assert.deepEqual(resolveDragTargetX({ ...base, desiredX: 499.6, movedX: 0 }), { x: 500, overhanging: false });
});

test('left edge clamps symmetrically', () => {
  assert.deepEqual(resolveDragTargetX({ ...base, desiredX: -50, movedX: 0 }), { x: 0, overhanging: false });
});
