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

const { claimDailyVip, formatVipDate, readClaimedDay, writeClaimedDay, getClaimedDays, getVipClaimStatus } = await import('../src/services/api/vip.js');

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

test('getClaimedDays parses the month record and keeps real receipts only', async () => {
  handler = async () => ({
    status: 1,
    data: {
      list: [
        { day: '2026-10-28', receive_vip: 1, vip_type: 'svip' },
        { day: '2026-10-29', receive_vip: 0, vip_type: 'svip' }, // 未发放，不算
        { day: '', receive_vip: 1 },                             // 无日期，丢弃
        { vip_type: 'svip', receive_vip: 1 },                    // 无日期，丢弃
        null
      ]
    }
  });
  assert.deepEqual(await getClaimedDays(), ['2026-10-28']);
});

test('getVipClaimStatus trusts the server record and syncs the local marker', async () => {
  const storage = makeStorage();
  handler = async (request) => {
    if (request.path === '/youth/month/vip/record') {
      return { status: 1, data: { list: [{ day: '2026-10-29', receive_vip: 1 }] } };
    }
    throw new Error('unexpected path');
  };

  const claimed = await getVipClaimStatus(new Date('2026-10-29T10:00:00+08:00'), storage);
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.source, 'server');
  assert.equal(readClaimedDay(storage), '2026-10-29');

  handler = async () => ({ status: 1, data: { list: [] } });
  const fresh = await getVipClaimStatus(new Date('2026-10-29T10:00:00+08:00'), storage);
  assert.equal(fresh.claimed, false);
  assert.equal(fresh.source, 'server');
});

test('getVipClaimStatus falls back to the local marker when the record query fails', async () => {
  const storage = makeStorage();
  writeClaimedDay('2026-10-29', storage);
  handler = async () => { throw new Error('network down'); };

  const status = await getVipClaimStatus(new Date('2026-10-29T10:00:00+08:00'), storage);
  assert.equal(status.claimed, true);
  assert.equal(status.source, 'local');
});

test('silent duplicate-claim failure is re-checked against the month record', async () => {
  const calls = [];
  handler = async (request) => {
    calls.push(request.path);
    if (request.path === '/youth/day/vip') return { status: 0, error_msg: '', error_code: 0 };
    // 重复领取是静默失败：无 error_msg，靠记录复核
    return { status: 1, data: { list: [{ day: '2026-10-29', receive_vip: 1 }] } };
  };
  const storage = makeStorage();

  const result = await claimDailyVip(new Date('2026-10-29T10:00:00+08:00'), storage);
  assert.equal(result.alreadyClaimed, true);
  assert.equal(readClaimedDay(storage), '2026-10-29');
  assert.deepEqual(calls, ['/youth/day/vip', '/youth/month/vip/record']);
});
