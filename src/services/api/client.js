// 所有 KuGouMusicApi 调用的统一漏斗：签名保持 apiRequest(request) → payload 不变。
// 在这里集中做两件对调用方透明的事：
//   1. 风控 20028 → 弹验证、重放原请求、返回正常 payload（失败/取消才抛 RiskVerifyError）
//   2. 登录失效（error_code 20017 / 歌曲接口 status==2）→ 标记 auth store 并提示重新登录

import {
  isLoginExpiredPayload,
  isReloginStatusPayload,
  processRiskPayload,
  sendApiRequest
} from './riskVerify.js';

// auth store 依赖 Pinia 实例，延迟到运行时再取，避免模块加载顺序问题
const markLoginExpired = async (message) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('jello:toast', { detail: message }));
  try {
    const { useAuthStore } = await import('../../stores/auth.js');
    useAuthStore().markExpired();
  } catch (error) {
    console.error('[api] 标记登录失效失败:', error?.message || error);
  }
};

const checkLoginExpiry = (request, payload) => {
  if (!payload || typeof payload !== 'object') return;
  if (isLoginExpiredPayload(payload)) {
    void markLoginExpired('登录已失效，请重新登录');
    return;
  }
  if (isReloginStatusPayload(request?.path, payload)) {
    void markLoginExpired('登录失效，请重新登录后再播放');
  }
};

export const apiRequest = async (request) => {
  const payload = await sendApiRequest(request);
  checkLoginExpiry(request, payload);
  return processRiskPayload(payload, request, 0);
};

export { RiskVerifyError } from './riskVerify.js';
