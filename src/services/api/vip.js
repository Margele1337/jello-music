import { authErrorMessage } from './auth.js';
import { apiRequest } from './client.js';

const isOk = (payload) => payload?.status === 1;

export const formatVipDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

// ===== 领取记录：localStorage 单标记（与游客选择同模式，非设置项） =====
// 只记录本应用的领取；别处（手机端）领过时靠领取接口的报错文案兜底识别
const VIP_CLAIM_DAY_KEY = 'jello.vip.claimDay';

const claimStorage = (storage) => {
  // Node 22 会暴露一个没有 Storage 方法的 globalThis.localStorage，必须校验方法存在再用
  const candidate = storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  return candidate && typeof candidate.getItem === 'function' ? candidate : null;
};

export const readClaimedDay = (storage) => claimStorage(storage)?.getItem(VIP_CLAIM_DAY_KEY) || '';

export const writeClaimedDay = (day, storage) => {
  claimStorage(storage)?.setItem(VIP_CLAIM_DAY_KEY, day);
};

// 服务端对重复领取的报错文案没有稳定错误码；实测重复领取是静默失败
// （status:0、error_msg 空），文案识别只是兜底
const ALREADY_CLAIMED_RE = /已领取|领取过|重复领取|已领过/;

// 当月领取记录：data.list[] 每项 { day: 'YYYY-MM-DD', receive_vip, vip_type }。
// 这是「今天领过没有」的可靠判定来源（覆盖手机端等其他渠道的领取）。
export const getClaimedDays = async () => {
  const payload = await apiRequest({
    method: 'GET',
    path: '/youth/month/vip/record',
    params: { latest_limit: 100 }
  });
  if (!isOk(payload)) throw new Error(authErrorMessage(payload, '获取领取记录失败'));
  const list = Array.isArray(payload?.data?.list) ? payload.data.list : [];
  return list
    .filter((item) => Number(item?.receive_vip) > 0 && typeof item?.day === 'string' && item.day)
    .map((item) => item.day);
};

// 当前领取状态：优先服务端记录，查询失败回落本地标记
export const getVipClaimStatus = async (date = new Date(), storage) => {
  const day = formatVipDate(date);
  try {
    const days = await getClaimedDays();
    if (days.includes(day)) {
      writeClaimedDay(day, storage);
      return { day, claimed: true, source: 'server' };
    }
    return { day, claimed: false, source: 'server' };
  } catch {
    return { day, claimed: readClaimedDay(storage) === day, source: 'local' };
  }
};

export const claimDailyVip = async (date = new Date(), storage) => {
  const day = formatVipDate(date);
  const claim = await apiRequest({
    method: 'POST',
    path: '/youth/day/vip',
    data: { receive_day: day }
  });
  if (!isOk(claim)) {
    // 服务端失败响应没有稳定的错误字段：把（已脱敏的）完整载荷打进日志便于对码，
    // UI 消息在无文案时至少带上 error_code
    try {
      console.warn('[vip] 领取响应:', JSON.stringify(claim).slice(0, 800));
    } catch { /* ignore */ }
    const detail = authErrorMessage(claim, '');
    const code = claim?.error_code ?? claim?.data?.error_code;
    const message = detail
      || (code !== undefined ? `领取 VIP 失败（error_code ${code}）` : '领取 VIP 失败');
    // 服务端判定今天已领过：按状态处理并记住当天，而不是当作失败抛出
    if (ALREADY_CLAIMED_RE.test(message)) {
      writeClaimedDay(day, storage);
      return { day, alreadyClaimed: true, upgradeOk: false, upgradeMessage: '' };
    }
    if (!detail) {
      // 静默失败（status:0、无 error_msg）是重复领取的实测表现：
      // 用当月领取记录复核，命中即按「已领取」处理
      try {
        const days = await getClaimedDays();
        if (days.includes(day)) {
          writeClaimedDay(day, storage);
          return { day, alreadyClaimed: true, upgradeOk: false, upgradeMessage: '' };
        }
      } catch { /* 记录查询失败则维持原报错 */ }
    }
    throw new Error(message);
  }
  writeClaimedDay(day, storage);

  let upgradeOk = false;
  let upgradeMessage = '';
  try {
    const upgrade = await apiRequest({ method: 'POST', path: '/youth/day/vip/upgrade' });
    upgradeOk = isOk(upgrade);
    if (!upgradeOk) upgradeMessage = authErrorMessage(upgrade, 'VIP 升级未完成');
  } catch (error) {
    upgradeMessage = error?.message || 'VIP 升级未完成';
  }

  return { day, alreadyClaimed: false, upgradeOk, upgradeMessage };
};
