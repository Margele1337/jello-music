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
