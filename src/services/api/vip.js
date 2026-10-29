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

// 服务端对重复领取的报错文案没有稳定错误码，只能按关键词识别
const ALREADY_CLAIMED_RE = /已领取|领取过|重复领取|已领过/;

export const claimDailyVip = async (date = new Date(), storage) => {
  const day = formatVipDate(date);
  const claim = await apiRequest({
    method: 'POST',
    path: '/youth/day/vip',
    data: { receive_day: day }
  });
  if (!isOk(claim)) {
    const message = authErrorMessage(claim, '领取 VIP 失败');
    // 服务端判定今天已领过：按状态处理并记住当天，而不是当作失败抛出
    if (ALREADY_CLAIMED_RE.test(message)) {
      writeClaimedDay(day, storage);
      return { day, alreadyClaimed: true, upgradeOk: false, upgradeMessage: '' };
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
