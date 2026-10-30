// 预设 2（legacy）攒批显示队列的纯状态机测试（spectrum.js tap 链路按帧驱动它）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIGMA_LEGACY_BATCH_SECONDS,
  SIGMA_LEGACY_BATCH_MAX,
  SIGMA_LEGACY_FRAME_SECONDS,
  SIGMA_LEGACY_QUEUE_MAX,
  createSigmaBurst
} from '../src/services/audio/mp3Frame.js';

const batchFrames = Math.ceil((SIGMA_LEGACY_BATCH_SECONDS - SIGMA_LEGACY_FRAME_SECONDS)
  / SIGMA_LEGACY_FRAME_SECONDS) + 1; // 首帧到达即爆发，之后约每 9 帧一批

test('burst model flushes the first frame immediately (startup pre-armed burst)', () => {
  const burst = createSigmaBurst();
  const first = new Float32Array([1]);
  assert.equal(burst.push(first), first, '首帧到达即入队并返回队首');
  assert.equal(burst.size, 1);
});

test('burst model advances the queue head in ~0.25s steps', () => {
  const burst = createSigmaBurst();
  burst.push(new Float32Array([1]));
  // 下一批要攒满 batchSeconds：中间帧不推进队首
  for (let i = 2; i < batchFrames; i += 1) {
    const head = burst.push(new Float32Array([i]));
    assert.equal(head[0], 1, `第 ${i} 帧不应让队首前移`);
  }
  // 攒满一批：队首一次前移多帧（台阶式）
  const head = burst.push(new Float32Array([batchFrames]));
  assert.ok(head[0] > 1, '攒批完成时队首应整体前移');
});

test('burst model caps the display queue at 4 frames', () => {
  const burst = createSigmaBurst();
  for (let round = 0; round < 6; round += 1) {
    for (let i = 0; i < batchFrames + 1; i += 1) burst.push(new Float32Array([round * 100 + i]));
  }
  assert.ok(burst.size <= SIGMA_LEGACY_QUEUE_MAX, `队列深度 ${burst.size} 应 ≤ ${SIGMA_LEGACY_QUEUE_MAX}`);
});

test('burst model force-flushes at batch max even before 0.25s', () => {
  const burst = createSigmaBurst({ batchSeconds: 10, batchMax: SIGMA_LEGACY_BATCH_MAX });
  burst.push(new Float32Array([1])); // 预热的爆发只含 1 帧
  let flushedEarly = false;
  for (let i = 2; i <= SIGMA_LEGACY_BATCH_MAX + 1; i += 1) {
    const head = burst.push(new Float32Array([i]));
    if (head[0] !== 1) { flushedEarly = true; break; }
  }
  assert.equal(flushedEarly, true, '攒到 batchMax 应提前冲刷');
});

test('reset re-arms the burst and empties the queue', () => {
  const burst = createSigmaBurst();
  for (let i = 0; i < batchFrames * 2; i += 1) burst.push(new Float32Array([i]));
  burst.reset();
  assert.equal(burst.peek(), null);
  const first = new Float32Array([42]);
  assert.equal(burst.push(first), first, 'reset 后首帧立即形成第一批（开局预热）');
});
