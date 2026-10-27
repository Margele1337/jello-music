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

export const claimDailyVip = async (date = new Date()) => {
  const day = formatVipDate(date);
  const claim = await apiRequest({
    method: 'POST',
    path: '/youth/day/vip',
    data: { receive_day: day }
  });
  if (!isOk(claim)) throw new Error(authErrorMessage(claim, '领取 VIP 失败'));

  let upgradeOk = false;
  let upgradeMessage = '';
  try {
    const upgrade = await apiRequest({ method: 'POST', path: '/youth/day/vip/upgrade' });
    upgradeOk = isOk(upgrade);
    if (!upgradeOk) upgradeMessage = authErrorMessage(upgrade, 'VIP 升级未完成');
  } catch (error) {
    upgradeMessage = error?.message || 'VIP 升级未完成';
  }

  return { day, upgradeOk, upgradeMessage };
};
