const cookies = new Map();
let authHeader = '';

const parseSetCookie = (line) => {
  const pair = String(line).split(';', 1)[0];
  const index = pair.indexOf('=');
  if (index < 1) return null;
  return [pair.slice(0, index).trim(), pair.slice(index + 1).trim()];
};

export const storeSetCookies = (setCookies = []) => {
  for (const line of setCookies) {
    const pair = parseSetCookie(line);
    if (pair) cookies.set(pair[0], pair[1]);
  }
};

export const getCookieHeader = () => [...cookies.entries()]
  .map(([key, value]) => `${key}=${value}`)
  .join('; ');

export const getAuthHeader = () => authHeader;

export const storeLoginData = (data = {}) => {
  const token = data.token || data.t;
  const userid = data.userid;
  if (!token || !userid) return;
  const parts = [`token=${token}`, `userid=${userid}`];
  if (data.t1) parts.push(`t1=${data.t1}`);
  if (data.vip_type) parts.push(`vip_type=${data.vip_type}`);
  authHeader = parts.join(';');
};

export const clearAuthSession = () => {
  cookies.clear();
  authHeader = '';
};
