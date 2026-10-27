import test from 'node:test';
import assert from 'node:assert/strict';

let handler = async () => ({});
globalThis.window = {
  jello: {
    api: {
      request: (request) => handler(request)
    }
  }
};

const { claimDailyVip, formatVipDate } = await import('../src/services/api/vip.js');

test('formats the VIP date in Asia/Shanghai', () => {
  assert.equal(formatVipDate(new Date('2026-10-27T15:59:00Z')), '2026-10-27');
  assert.equal(formatVipDate(new Date('2026-10-27T16:00:00Z')), '2026-10-28');
});

test('claims daily VIP and reports upgrade status', async () => {
  const calls = [];
  handler = async (request) => {
    calls.push(request.path);
    return { status: 1 };
  };

  const result = await claimDailyVip(new Date('2026-10-27T16:30:00Z'));
  assert.equal(result.day, '2026-10-28');
  assert.equal(result.upgradeOk, true);
  assert.deepEqual(calls, ['/youth/day/vip', '/youth/day/vip/upgrade']);
});

test('throws the API error when the claim fails', async () => {
  handler = async () => ({ status: 0, error: '今日已领取' });
  await assert.rejects(() => claimDailyVip(), /今日已领取/);
});
