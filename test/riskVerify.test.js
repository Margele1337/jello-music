import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VERIFY_ATTEMPTS,
  RiskVerifyError,
  buildTencentVerifyCode,
  extractRiskEventId,
  isLoginExpiredPayload,
  isReloginStatusPayload,
  isRiskPayload,
  isRiskSuppressed,
  isVerifySubmitSuccess,
  notifyRisk,
  parseVerifyInfo,
  processRiskPayload,
  resetRiskGuards,
  runManualVerify,
  suppressRisk,
  verifySubmitMessage
} from '../src/services/api/riskVerify.js';

const RISK_BODY = { error_code: 20028, error_msg: '需要验证', ssaCode: 'gz_tx_event_1' };
const OK_BODY = { status: 1, data: { url: ['https://example.com/a.mp3'] } };

beforeEach(() => resetRiskGuards());

test('extracts the risk eventid from sidecar body fields', () => {
  assert.equal(extractRiskEventId({ ssaCode: 'ev-1' }), 'ev-1');
  assert.equal(extractRiskEventId({ ssa_code: ' ev-2 ' }), 'ev-2');
  assert.equal(extractRiskEventId({ data: { ssaCode: 'ev-3' } }), 'ev-3');
  assert.equal(extractRiskEventId({ data: { eventid: 'ev-4' } }), 'ev-4');
  assert.equal(extractRiskEventId({ status: 1 }), '');
  assert.equal(extractRiskEventId(null), '');
});

test('detects 20028 across wrapper and passthrough field names', () => {
  assert.equal(isRiskPayload({ error_code: 20028 }), true);
  assert.equal(isRiskPayload({ errcode: 20028 }), true);
  assert.equal(isRiskPayload({ data: { error_code: 20028 } }), true);
  // status==0 且带验证事件也算风控
  assert.equal(isRiskPayload({ status: 0, data: { status: 0, ssaCode: 'ev' } }), true);
  assert.equal(isRiskPayload({ status: 0 }), false);
  assert.equal(isRiskPayload({ status: 1, ssaCode: 'ev' }), false);
  assert.equal(isRiskPayload(OK_BODY), false);
  assert.equal(isRiskPayload(null), false);
});

test('detects login expiry (20017) and song status==2 re-login', () => {
  assert.equal(isLoginExpiredPayload({ error_code: 20017 }), true);
  assert.equal(isLoginExpiredPayload({ data: { errcode: 20017 } }), true);
  assert.equal(isLoginExpiredPayload({ error_code: 20028 }), false);
  assert.equal(isReloginStatusPayload('/song/url', { status: 2 }), true);
  assert.equal(isReloginStatusPayload('/song/url', { status: '2' }), true);
  assert.equal(isReloginStatusPayload('/song/url', { status: 1 }), false);
  assert.equal(isReloginStatusPayload('/search', { status: 2 }), false);
  // 扫码登录轮询的 data.status==2（已扫码）不是登录失效
  assert.equal(isReloginStatusPayload('/login/qr/check', { status: 1, data: { status: 2 } }), false);
});

test('parses /get/verify/info into v_type dispatch info', () => {
  assert.deepEqual(
    parseVerifyInfo({ status: 1, data: { v_type: 32, mobile: '138****0000' } }),
    { ok: true, vType: 32, txAppId: '' }
  );
  assert.deepEqual(
    parseVerifyInfo({ status: 1, data: { v_type: 23, txappid: '2090934891' } }),
    { ok: true, vType: 23, txAppId: '2090934891' }
  );
  // 缺少 v_type 时按旧版默认滑块 23
  assert.deepEqual(parseVerifyInfo({ status: 1, data: {} }), { ok: true, vType: 23, txAppId: '' });
  const failed = parseVerifyInfo({ status: 0, msg: '事件不存在' });
  assert.equal(failed.ok, false);
  assert.equal(failed.message, '事件不存在');
});

test('normalizes /sidedt submit results', () => {
  assert.equal(isVerifySubmitSuccess({ status: 1 }), true);
  assert.equal(isVerifySubmitSuccess({ data: { status: 1 } }), true);
  assert.equal(isVerifySubmitSuccess({ status: 0, msg: '验证码错误' }), false);
  assert.equal(isVerifySubmitSuccess(null), false);
  assert.equal(verifySubmitMessage({ status: 0, msg: '验证码错误' }), '验证码错误');
  assert.equal(verifySubmitMessage({ status: 0 }, '验证失败'), '验证失败');
});

test('builds the KGCodeTX slider verifycode payload', () => {
  const code = buildTencentVerifyCode({ ticket: 'tk', randstr: 'rs', appId: '209' });
  assert.equal(code, 'KGCodeTX|{"ticket":"tk","randstr":"rs","txappid":"209"}');
});

test('suppression window blocks re-prompting after a failed verify', () => {
  const now = 1_000_000;
  assert.equal(isRiskSuppressed(now), false);
  suppressRisk(now);
  assert.equal(isRiskSuppressed(now + 1000), true);
  assert.equal(isRiskSuppressed(now + 31_000), false);
});

test('risk notices respect the cooldown', () => {
  const now = 1_000_000;
  assert.equal(notifyRisk('提示一', now), true);
  assert.equal(notifyRisk('提示二', now + 1000), false);
  assert.equal(notifyRisk('提示三', now + 6000), true);
});

test('processRiskPayload passes normal payloads through untouched', async () => {
  let prompted = 0;
  const out = await processRiskPayload(OK_BODY, { path: '/song/url' }, 0, {
    send: () => { throw new Error('should not replay'); },
    prompt: () => { prompted += 1; return Promise.resolve({ verified: true }); }
  });
  assert.equal(out, OK_BODY);
  assert.equal(prompted, 0);
});

test('processRiskPayload verifies then replays the original request', async () => {
  const request = { method: 'GET', path: '/song/url', params: { hash: 'H' } };
  const seen = [];
  const out = await processRiskPayload(RISK_BODY, request, 0, {
    send: (req) => { seen.push(req); return Promise.resolve(OK_BODY); },
    prompt: (eventId) => {
      assert.equal(eventId, 'gz_tx_event_1');
      return Promise.resolve({ verified: true });
    }
  });
  assert.equal(out, OK_BODY);
  assert.deepEqual(seen, [request]);
});

test('processRiskPayload allows multiple verify rounds but caps retries', async () => {
  let prompted = 0;
  let sent = 0;
  const error = await processRiskPayload(RISK_BODY, { path: '/song/url' }, 0, {
    send: () => { sent += 1; return Promise.resolve(RISK_BODY); },
    prompt: () => { prompted += 1; return Promise.resolve({ verified: true }); }
  }).then(() => null, (err) => err);

  assert.ok(error instanceof RiskVerifyError);
  assert.equal(error.code, 'exhausted');
  assert.equal(prompted, MAX_VERIFY_ATTEMPTS);
  assert.equal(sent, MAX_VERIFY_ATTEMPTS);
  // 用尽后进入抑制期，后续请求直接透传不再弹窗
  assert.equal(isRiskSuppressed(), true);
});

test('processRiskPayload suppresses and throws a distinguishable error on cancel', async () => {
  let prompted = 0;
  const deps = {
    send: () => Promise.resolve(OK_BODY),
    prompt: () => { prompted += 1; return Promise.resolve({ verified: false, reason: 'cancelled' }); }
  };
  const error = await processRiskPayload(RISK_BODY, { path: '/song/url' }, 0, deps)
    .then(() => null, (err) => err);
  assert.ok(error instanceof RiskVerifyError);
  assert.equal(error.code, 'cancelled');

  // 抑制期内再命中风控：透传 payload，不再弹窗
  const out = await processRiskPayload(RISK_BODY, { path: '/song/url' }, 0, deps);
  assert.equal(out, RISK_BODY);
  assert.equal(prompted, 1);
});

test('processRiskPayload passes through when no eventid is present', async () => {
  let prompted = 0;
  const out = await processRiskPayload({ error_code: 20028 }, { path: '/song/url' }, 0, {
    send: () => Promise.resolve(OK_BODY),
    prompt: () => { prompted += 1; return Promise.resolve({ verified: true }); }
  });
  assert.deepEqual(out, { error_code: 20028 });
  assert.equal(prompted, 0);
});

test('manual verify reports not-needed when the probe is clean', async () => {
  const result = await runManualVerify({
    send: () => Promise.resolve(OK_BODY),
    prompt: () => Promise.resolve({ verified: true })
  });
  assert.deepEqual(result, { needed: false, verified: false });
});

test('manual verify runs the prompt and re-checks the probe', async () => {
  const responses = [RISK_BODY, OK_BODY];
  const result = await runManualVerify({
    send: () => Promise.resolve(responses.shift()),
    prompt: (eventId) => Promise.resolve({ verified: eventId === 'gz_tx_event_1' })
  });
  assert.deepEqual(result, { needed: true, verified: true, stillBlocked: false });
});

test('manual verify surfaces cancel and missing-eventid reasons', async () => {
  const cancelled = await runManualVerify({
    send: () => Promise.resolve(RISK_BODY),
    prompt: () => Promise.resolve({ verified: false, reason: 'cancelled' })
  });
  assert.deepEqual(cancelled, { needed: true, verified: false, reason: 'cancelled' });

  resetRiskGuards();
  const noEvent = await runManualVerify({
    send: () => Promise.resolve({ error_code: 20028 }),
    prompt: () => Promise.resolve({ verified: true })
  });
  assert.deepEqual(noEvent, { needed: true, verified: false, reason: 'no-eventid' });
});
