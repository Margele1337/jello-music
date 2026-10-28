// 酷狗风控（error_code 20028）二次安全验证 + 登录失效检测。
//
// 侧车在风控响应体里附带 ssaCode（api/util/request.js 会把 ssa-code 响应头写回 body），
// 渲染进程只拿得到 body，因此 eventid 从 body 字段提取。
// 验证流程：/get/verify/info?eventid=… 拿到 v_type（23=腾讯滑块 / 32=短信验证码），
// 结果以 verifycode 提交到 /sidedt（侧车内部补 sid/edt 后转发 verifyservice）。
//
// 本模块被 node:test 直接导入：所有纯函数不得触碰 window，运行时函数需自行兜底。

export const RISK_ERROR_CODE = 20028;
export const LOGIN_EXPIRED_CODE = 20017;
export const MAX_VERIFY_ATTEMPTS = 3;
export const SUPPRESS_AFTER_FAILURE_MS = 30 * 1000;
export const NOTICE_COOLDOWN_MS = 5 * 1000;
export const VERIFY_PROMPT_TIMEOUT_MS = 5 * 60 * 1000;

// 手动验证的探针请求：免费歌曲片段接口，风控生效时必然命中 20028
export const MANUAL_VERIFY_PROBE = Object.freeze({
  method: 'GET',
  path: '/song/url',
  params: { hash: 'D167AA4D4E53B9BB162DBAA2C0AE7F7B', free_part: 1 }
});

export class RiskVerifyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RiskVerifyError';
    // cancelled / timeout / failed / exhausted，调用方可据此区分处理
    this.code = code;
  }
}

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

const firstString = (candidates) => String(candidates.find((item) => item) || '').trim();

// ── 风控识别（纯函数） ──

export const extractRiskEventId = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  return firstString([
    payload.ssaCode,
    payload.ssa_code,
    payload.eventid,
    data.ssaCode,
    data.ssa_code,
    data.eventid
  ]);
};

const readErrorCode = (payload) => {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  return toNumber(payload?.error_code ?? payload?.errcode ?? data?.error_code ?? data?.errcode ?? 0);
};

// 侧车包装的失败响应用 error_code，上游直透的用 errcode，两种都要认
export const isRiskPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return false;
  if (readErrorCode(payload) === RISK_ERROR_CODE) return true;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const failed = toNumber(payload.status ?? data.status ?? -1) === 0;
  return failed && Boolean(extractRiskEventId(payload));
};

// ── 登录失效检测（纯函数） ──

export const isLoginExpiredPayload = (payload) => readErrorCode(payload) === LOGIN_EXPIRED_CODE;

// 歌曲地址等接口登录失效时返回 status==2（区别于成功 status==1）
export const isReloginStatusPayload = (path, payload) => (
  String(path || '').startsWith('/song') && toNumber(payload?.status) === 2
);

// ── 验证信息解析（纯函数） ──

// /get/verify/info 正常返回 {status:1, data:{v_type, txappid, …}}
export const parseVerifyInfo = (response) => {
  if (toNumber(response?.status) !== 1) {
    return { ok: false, message: String(response?.msg || response?.data || '未能获取验证信息') };
  }
  const info = response.data && typeof response.data === 'object' ? response.data : response;
  return {
    ok: true,
    vType: toNumber(info.v_type) || 23,
    txAppId: String(info.txappid || '').trim()
  };
};

// /sidedt 的成功判定：status==1 可能在顶层也可能在 data 里
export const isVerifySubmitSuccess = (response) => {
  if (!response || typeof response !== 'object') return false;
  if (toNumber(response.status) === 1) return true;
  return toNumber(response.data?.status) === 1;
};

export const verifySubmitMessage = (response, fallback = '验证失败') => {
  const message = response?.msg || response?.data?.msg || response?.error_msg || response?.data;
  return typeof message === 'string' && message.trim() ? message.trim() : fallback;
};

// 腾讯滑块结果的 verifycode 格式：KGCodeTX|{ticket,randstr,txappid 的 JSON}
export const buildTencentVerifyCode = ({ ticket, randstr, appId }) => (
  `KGCodeTX|${JSON.stringify({ ticket, randstr, txappid: appId })}`
);

// ── 抑制 / 冷却（模块级状态，测试可重置） ──

let riskSuppressedUntil = 0;
let lastRiskNoticeAt = 0;
let verifyQueue = Promise.resolve();

export const isRiskSuppressed = (now = Date.now()) => now < riskSuppressedUntil;

export const suppressRisk = (now = Date.now()) => {
  riskSuppressedUntil = now + SUPPRESS_AFTER_FAILURE_MS;
};

export const resetRiskGuards = () => {
  riskSuppressedUntil = 0;
  lastRiskNoticeAt = 0;
  verifyQueue = Promise.resolve();
};

// 风控提示走 SigmaView 已有的 jello:toast 事件，5s 冷却防止多档音质连环轰炸
export const notifyRisk = (message, now = Date.now()) => {
  if (now - lastRiskNoticeAt < NOTICE_COOLDOWN_MS) return false;
  lastRiskNoticeAt = now;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('jello:toast', { detail: message }));
  }
  return true;
};

// ── 运行时请求（不经风控拦截，避免 /sidedt 自身 20028 造成递归） ──

export const sendApiRequest = async (request) => {
  if (typeof window === 'undefined' || !window.jello?.api?.request) {
    throw new Error('API bridge is unavailable');
  }
  return window.jello.api.request(request);
};

export const fetchVerifyInfo = (eventId) => sendApiRequest({
  method: 'GET',
  path: '/get/verify/info',
  params: { eventid: eventId }
});

export const submitVerifyCode = ({ eventId, vType, code }) => sendApiRequest({
  method: 'GET',
  path: '/sidedt',
  params: {
    eventid: eventId,
    v_type: vType,
    // 侧车 verify_user_info 会对 verifycode 做一次 decodeURIComponent，
    // 与代理的 searchParams 编码合计两次，这里必须先手动编码一次
    verifycode: encodeURIComponent(String(code || '').trim())
  }
});

// ── 验证弹窗调度（经 Pinia risk store，弹窗挂在 SigmaView 上） ──

const getRiskStore = async () => {
  const { useRiskStore } = await import('../../stores/risk.js');
  return useRiskStore();
};

const promptOnce = async (eventId) => {
  let store;
  try {
    store = await getRiskStore();
  } catch {
    return { verified: false, reason: 'failed' };
  }
  return store.openVerify(eventId);
};

// 同一时间只弹一个验证框：并发的 20028 排队，避免弹窗互相覆盖
const promptRiskVerification = (eventId, timeoutMs = VERIFY_PROMPT_TIMEOUT_MS) => {
  const current = verifyQueue.then(() => new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(async () => {
      finish({ verified: false, reason: 'timeout' });
      try {
        (await getRiskStore()).abortVerify?.();
      } catch { /* 弹窗已关闭则忽略 */ }
    }, timeoutMs);
    promptOnce(eventId).then(
      (verified) => finish({ verified: !!verified, reason: verified ? 'verified' : 'cancelled' }),
      () => finish({ verified: false, reason: 'failed' })
    );
  }));
  verifyQueue = current.then(() => undefined, () => undefined);
  return current;
};

// ── apiRequest 漏斗里的风控处理（对调用方透明：成功时返回重放后的正常 payload） ──

export const processRiskPayload = async (payload, request, attempt = 0, deps = {}) => {
  const send = deps.send || sendApiRequest;
  const prompt = deps.prompt || promptRiskVerification;

  if (!isRiskPayload(payload)) return payload;

  // 连续多轮「滑块 → 重试」仍未解除：明确报错并进入抑制期，不再连环弹窗
  if (attempt >= MAX_VERIFY_ATTEMPTS) {
    suppressRisk();
    throw new RiskVerifyError('exhausted', '安全验证未通过，请稍后重试或更换网络环境');
  }

  // 刚取消/失败过：按普通失败透传，避免下一档音质候选又弹一次
  if (isRiskSuppressed()) return payload;

  const eventId = extractRiskEventId(payload);
  if (!eventId) {
    notifyRisk('酷狗要求安全验证，但未返回验证事件，请稍后重试');
    return payload;
  }

  const result = await prompt(eventId);
  if (!result?.verified) {
    suppressRisk();
    if (result?.reason === 'cancelled') {
      throw new RiskVerifyError('cancelled', '已取消安全验证');
    }
    notifyRisk('安全验证未完成，播放暂时受限，请稍后重试');
    throw new RiskVerifyError(result?.reason === 'timeout' ? 'timeout' : 'failed', '安全验证未完成');
  }

  riskSuppressedUntil = 0;
  const retryPayload = await send(request);
  return processRiskPayload(retryPayload, request, attempt + 1, deps);
};

// ── 手动安全验证（设置页入口） ──

// 主动发一次必然暴露风控的探针请求：未触发风控返回 needed=false；
// 触发则弹验证，通过后复查探针确认风控是否解除
export const runManualVerify = async (deps = {}) => {
  const send = deps.send || sendApiRequest;
  const prompt = deps.prompt || promptRiskVerification;
  const probeRequest = deps.probe || MANUAL_VERIFY_PROBE;

  let payload;
  try {
    payload = await send(probeRequest);
  } catch (error) {
    return { needed: false, verified: false, reason: 'probe-error', message: error?.message || '探测请求失败' };
  }

  if (!isRiskPayload(payload)) return { needed: false, verified: false };

  const eventId = extractRiskEventId(payload);
  if (!eventId) return { needed: true, verified: false, reason: 'no-eventid' };

  const result = await prompt(eventId);
  if (!result?.verified) return { needed: true, verified: false, reason: result?.reason || 'cancelled' };

  try {
    const again = await send(probeRequest);
    return { needed: true, verified: true, stillBlocked: isRiskPayload(again) };
  } catch {
    return { needed: true, verified: true, stillBlocked: true };
  }
};
