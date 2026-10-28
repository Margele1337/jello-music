import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { useRiskStore } from '../src/stores/risk.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('openVerify shows the modal and resolves false on cancel', async () => {
  setActivePinia(createPinia());
  const risk = useRiskStore();

  const pending = risk.openVerify('ev-1');
  await tick();
  assert.equal(risk.visible, true);
  assert.equal(risk.eventId, 'ev-1');
  // node 环境没有 API bridge：获取验证信息失败应落到 error 相位而不是崩溃
  assert.equal(risk.phase, 'error');
  assert.ok(risk.errorText);

  risk.cancel();
  assert.equal(await pending, false);
  assert.equal(risk.visible, false);
});

test('abortVerify closes a pending prompt from the timeout path', async () => {
  setActivePinia(createPinia());
  const risk = useRiskStore();

  const pending = risk.openVerify('ev-2');
  await tick();
  risk.abortVerify();
  assert.equal(await pending, false);
  assert.equal(risk.visible, false);

  // 未打开时调用不抛错
  risk.abortVerify();
});

test('openManualVerify tolerates a missing API bridge', async () => {
  setActivePinia(createPinia());
  const risk = useRiskStore();

  const result = await risk.openManualVerify();
  assert.equal(result.needed, false);
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'probe-error');
  assert.equal(risk.manualBusy, false);
});
