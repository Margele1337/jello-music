import { clearStoredSession, loadSession, saveSession } from './sessionVault.js';

const cookies = new Map();
const PROFILE_FIELDS = ['userid', 'nickname', 'pic', 'vip_type', 'user_type'];

let authHeader = '';
let profile = null;
let initialized = false;
let persistTimer = null;
let warnedNoEncryption = false;

const pickProfile = (data) => {
  const next = {};
  for (const key of PROFILE_FIELDS) {
    const value = data?.[key];
    if (value !== undefined && value !== null && value !== '') next[key] = value;
  }
  return Object.keys(next).length ? next : null;
};

const persistNow = () => {
  persistTimer = null;
  if (!initialized) return;
  const saved = saveSession({
    cookies: [...cookies.entries()],
    authHeader,
    profile
  });
  if (!saved && !warnedNoEncryption) {
    warnedNoEncryption = true;
    console.warn('[session] 系统加密不可用，登录态不会写入磁盘');
  }
};

const schedulePersist = () => {
  if (!initialized) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, 400);
};

const parseSetCookie = (line) => {
  const pair = String(line).split(';', 1)[0];
  const index = pair.indexOf('=');
  if (index < 1) return null;
  return [pair.slice(0, index).trim(), pair.slice(index + 1).trim()];
};

export const initAuthSession = () => {
  const session = loadSession();
  if (session) {
    for (const entry of Array.isArray(session.cookies) ? session.cookies : []) {
      if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string') {
        cookies.set(entry[0], String(entry[1]));
      }
    }
    if (typeof session.authHeader === 'string') authHeader = session.authHeader;
    profile = pickProfile(session.profile);
  }

  if (!profile) {
    const userid = cookies.get('userid') || /(?:^|;)\s*userid=([^;]+)/.exec(authHeader)?.[1];
    if (userid && (cookies.get('token') || authHeader)) profile = { userid };
  }

  initialized = true;
};

export const flushAuthSession = () => {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistNow();
  }
};

export const storeSetCookies = (setCookies = []) => {
  let changed = false;
  for (const line of setCookies) {
    const pair = parseSetCookie(line);
    if (!pair) continue;
    if (cookies.get(pair[0]) !== pair[1]) {
      cookies.set(pair[0], pair[1]);
      changed = true;
    }
  }
  if (changed) schedulePersist();
};

export const getCookieHeader = () => [...cookies.entries()]
  .map(([key, value]) => `${key}=${value}`)
  .join('; ');

export const getAuthHeader = () => authHeader;

export const getProfile = () => (profile ? { ...profile } : null);

export const storeLoginData = (data = {}) => {
  const token = data.token || data.t || cookies.get('token');
  const userid = data.userid || cookies.get('userid');
  if (!token || !userid) return;

  const parts = [`token=${token}`, `userid=${userid}`];
  if (data.t1) parts.push(`t1=${data.t1}`);
  if (data.vip_type) parts.push(`vip_type=${data.vip_type}`);
  authHeader = parts.join(';');
  profile = pickProfile(data) || { userid: String(userid) };
  schedulePersist();
};

export const resetDeviceCookies = () => {
  let changed = false;
  for (const key of [...cookies.keys()]) {
    if (key.startsWith('KUGOU_API_') || key === 'dfid') {
      cookies.delete(key);
      changed = true;
    }
  }
  if (changed) schedulePersist();
};

export const clearAuthSession = () => {
  for (const key of ['token', 'userid', 't1', 'vip_type']) cookies.delete(key);
  authHeader = '';
  profile = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  clearStoredSession();
};
