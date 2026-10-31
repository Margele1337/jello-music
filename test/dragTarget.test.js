import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NUDGE_BACK_MS,
  NUDGE_OUT_MS,
  resolveDragTargetX,
  resolveNudgeFrame
} from '../shared/dragTarget.js';

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

// ===== 轻推手势帧 =====

const gesture = { fromX: 1000, fromY: 200, outX: 1140, outY: 200, desiredX: 1000, desiredY: 200 };

test('nudge out leg eases from the start position toward the excursion target', () => {
  const first = resolveNudgeFrame({ ...gesture, elapsedMs: 0 });
  assert.equal(first.x, 1000);
  assert.equal(first.y, 200);
  assert.equal(first.done, false);

  const mid = resolveNudgeFrame({ ...gesture, elapsedMs: NUDGE_OUT_MS / 2 });
  // easeOutCubic(0.5) = 0.875 → 已走出 87.5%，冲出去的前段快、收尾慢
  assert.ok(Math.abs(mid.x - (1000 + 140 * 0.875)) < 1e-9);
  assert.equal(mid.done, false);
});

test('nudge back leg eases toward the live desired position', () => {
  const atOutEnd = resolveNudgeFrame({ ...gesture, elapsedMs: NUDGE_OUT_MS });
  assert.equal(atOutEnd.x, 1140);   // t=0 → k=0，仍在出程端点
  const halfBack = resolveNudgeFrame({ ...gesture, elapsedMs: NUDGE_OUT_MS + NUDGE_BACK_MS / 2 });
  // easeInOutCubic(0.5) = 0.5 → 正好在出程端点与预期位的中点
  assert.equal(halfBack.x, 1070);
  assert.equal(halfBack.done, false);
});

test('nudge gesture lands exactly on the desired position when done', () => {
  const done = resolveNudgeFrame({ ...gesture, elapsedMs: NUDGE_OUT_MS + NUDGE_BACK_MS + 1 });
  assert.deepEqual({ x: done.x, y: done.y, done: true }, { x: 1000, y: 200, done: true });
});

test('moving desired during the back leg keeps the endpoint glued to it', () => {
  const frame = resolveNudgeFrame({ ...gesture, desiredX: 1100, elapsedMs: NUDGE_OUT_MS + NUDGE_BACK_MS });
  assert.equal(frame.x, 1100);
  assert.equal(frame.done, true);
});
