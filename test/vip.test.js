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

const { claimDailyVip, formatVipDate, readClaimedDay, writeClaimedDay } = await import('../src/services/api/vip.js');

const makeStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
};

test('formats the VIP date in Asia/Shanghai', () => {
  assert.equal(formatVipDate(new Date('2026-10-27T15:59:00Z')), '2026-10-27');
  assert.equal(formatVipDate(new Date('2026-10-27T16:00:00Z')), '2026-10-28');
});

test('claims daily VIP, records the day and reports upgrade status', async () => {
  const calls = [];
  handler = async (request) => {
    calls.push(request.path);
    return { status: 1 };
  };
  const storage = makeStorage();

  const result = await claimDailyVip(new Date('2026-10-27T16:30:00Z'), storage);
  assert.equal(result.day, '2026-10-28');
  assert.equal(result.alreadyClaimed, false);
  assert.equal(result.upgradeOk, true);
  assert.deepEqual(calls, ['/youth/day/vip', '/youth/day/vip/upgrade']);
  assert.equal(readClaimedDay(storage), '2026-10-28');
});

test('treats an already-claimed response as status, not failure', async () => {
  const calls = [];
  handler = async (request) => {
    calls.push(request.path);
    return { status: 0, error: '今日已领取过' };
  };
  const storage = makeStorage();

  const result = await claimDailyVip(new Date('2026-10-28T02:00:00Z'), storage);
  assert.equal(result.alreadyClaimed, true);
  assert.equal(result.day, '2026-10-28');
  // 重复领取不再走升级步骤：没有新权益可升
  assert.deepEqual(calls, ['/youth/day/vip']);
  assert.equal(readClaimedDay(storage), '2026-10-28');
});

test('unrelated claim errors still throw and record nothing', async () => {
  handler = async () => ({ status: 0, error: '系统繁忙，请稍后重试' });
  const storage = makeStorage();

  await assert.rejects(() => claimDailyVip(), /系统繁忙/);
  assert.equal(readClaimedDay(storage), '');
});

test('claim day marker round-trips and tolerates missing storage', () => {
  const storage = makeStorage();
  writeClaimedDay('2026-10-29', storage);
  assert.equal(readClaimedDay(storage), '2026-10-29');
  writeClaimedDay('2026-10-30', null);
  assert.equal(readClaimedDay(makeStorage()), '');
  // Node 22 的 globalThis.localStorage 没有 Storage 方法，缺方法时必须静默跳过
  assert.equal(readClaimedDay({}), '');
});
