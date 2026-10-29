export const isChineseMobile = (value) => /^1[3-9]\d{9}$/.test(String(value ?? '').trim());

export const isLoginSuccess = (payload) => payload?.status === 1 && !!payload?.data;

export const authErrorMessage = (payload, fallback = '操作失败') => {
  if (!payload || typeof payload !== 'object') return fallback;
  const candidates = [
    payload.error,
    payload.error_msg,
    payload.msg,
    payload.message,
    payload.data?.error,
    payload.data?.msg
  ];
  const message = candidates.find((value) => typeof value === 'string' && value.trim());
  return message ? message.trim().slice(0, 200) : fallback;
};

// 账号密码登录：POST body（username 可为邮箱或 userid），密码绝不进 URL/query。
// 返回给渲染层的 token 由主进程代理剥离，这里只负责组装请求参数。
export const buildPasswordLoginData = (username, password) => ({
  username: String(username ?? '').trim(),
  password: String(password ?? '')
});

// 手机号登录 body：仅在用户已从多账号列表中选定账号时带 userid（对齐旧版重提交）
export const buildPhoneLoginData = ({ mobile, code, userid }) => {
  const data = { mobile: String(mobile ?? '').trim(), code: String(code ?? '').trim() };
  if (userid !== undefined && userid !== null && userid !== '') data.userid = userid;
  return data;
};

// 一个手机号可能绑定多个酷狗账号：登录接口把候选放在 info_list。
// 代理对业务错误不抛异常而是透传 body，因此 info_list 可能出现在多种容器里，
// 甚至被包在 axios 风格错误的 response.data 下，这里都做兼容提取（纯函数，可测）。
export const extractAccountInfoList = (payload) => {
  if (!payload) return [];
  const container = payload.response?.data ?? payload;
  const candidates = [
    container.info_list,
    container.data?.info_list,
    container.data?.data?.info_list
  ];
  const list = candidates.find((item) => Array.isArray(item) && item.length);
  if (!list) return [];
  return list.filter((account) => account && (account.userid !== undefined && account.userid !== null));
};

export const isAccountSelectionPayload = (payload) => extractAccountInfoList(payload).length > 1;

// ===== 游客模式：记住「跳过登录」的选择（localStorage 单标记，非设置项） =====
export const GUEST_MODE_KEY = 'jello-guest-mode';

const guestStorage = (storage) => {
  if (storage) return storage;
  // Node 22 会暴露一个没有 Storage 方法的 globalThis.localStorage，必须校验方法存在再用
  const candidate = typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
  if (candidate && typeof candidate.getItem === 'function'
    && typeof candidate.setItem === 'function'
    && typeof candidate.removeItem === 'function') {
    return candidate;
  }
  return null;
};

export const readGuestChoice = (storage) => guestStorage(storage)?.getItem(GUEST_MODE_KEY) === '1';

export const writeGuestChoice = (storage) => guestStorage(storage)?.setItem(GUEST_MODE_KEY, '1');

export const clearGuestChoice = (storage) => guestStorage(storage)?.removeItem(GUEST_MODE_KEY);

// 启动时是否需要把用户引导到登录页（游客已记住则不再打扰）
export const shouldPromptLoginOnLaunch = ({ authenticated, guestRemembered }) => (
  !authenticated && !guestRemembered
);

// 试听标识：仅当实际解析到试听片段时显示；未登录时点亮为可点击的「去登录」提示，
// 已登录只作纯信息展示。字段供 SigmaMusicPlayer 直接驱动 SigmaText（图集绘制，无 DOM 文本）。
export const TRIAL_BADGE_LABEL = '试听片段';
export const computeTrialBadge = ({ trial, authenticated }) => {
  const visible = !!trial;
  const nudgesLogin = visible && !authenticated;
  return {
    visible,
    label: TRIAL_BADGE_LABEL,
    nudgesLogin,
    color: nudgesLogin ? '#ff69b4' : '#b9b1c6'
  };
};
