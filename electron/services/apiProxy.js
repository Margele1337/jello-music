import { net } from 'electron';
import { sanitizeApiRequest, sanitizeApiResponse } from '../../shared/apiPolicy.js';
import { resolveApiBaseUrl, sidecarTokenFor } from './apiEndpoint.js';
import {
  getAuthHeader,
  getCookieHeader,
  storeLoginData,
  storeSetCookies
} from './authSession.js';

let deviceReadyBaseUrl = '';
let deviceReadyPromise = null;

export const resetDeviceRegistration = () => {
  deviceReadyBaseUrl = '';
};

const ensureDeviceCookie = async (baseUrl) => {
  if (deviceReadyBaseUrl === baseUrl) return;
  if (deviceReadyPromise) return deviceReadyPromise;

  deviceReadyPromise = (async () => {
    try {
      const headers = {};
      // 只对内置 sidecar 附带本机启动密钥；自定义 RPC 地址必须拿不到它
      const token = sidecarTokenFor(baseUrl);
      if (token) headers['x-jello-token'] = token;
      const response = await net.fetch(new URL('/register/dev', baseUrl), {
        method: 'POST',
        headers
      });
      const setCookies = response.headers.getSetCookie?.() || [];
      if (setCookies.length) storeSetCookies(setCookies);
      await response.arrayBuffer();
      deviceReadyBaseUrl = baseUrl;
    } catch (error) {
      console.error('[api] device registration failed:', error.message);
    }
  })().finally(() => {
    deviceReadyPromise = null;
  });

  return deviceReadyPromise;
};

export const proxyApiRequest = async (input) => {
  const request = sanitizeApiRequest(input);
  const baseUrl = await resolveApiBaseUrl();
  if (!baseUrl) throw new Error('API sidecar is not ready');

  await ensureDeviceCookie(baseUrl);

  const url = new URL(request.path, baseUrl);
  for (const [key, value] of Object.entries(request.params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  const headers = {};
  // 同上：per-launch 密钥只在打内置 sidecar 时携带，不随自定义 RPC 地址外发
  const sidecarToken = sidecarTokenFor(baseUrl);
  if (sidecarToken) headers['x-jello-token'] = sidecarToken;
  const cookieHeader = getCookieHeader();
  if (cookieHeader) headers.Cookie = cookieHeader;
  const authHeader = getAuthHeader();
  if (authHeader) headers.Authorization = authHeader;

  let body;
  if (request.method === 'POST') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(request.data || {});
  }

  // net.fetch 走 Chromium 网络栈，才会吃到 session.setProxy 的代理设置
  const response = await net.fetch(url, { method: request.method, headers, body });
  const setCookies = response.headers.getSetCookie?.() || [];
  if (setCookies.length) storeSetCookies(setCookies);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`sidecar returned non-JSON response (${response.status})`);
  }

  // 精确 /login 是账号密码登录（POST /login），/login/ 前缀覆盖二维码与手机号登录；
  // 只匹配前缀会让密码登录拿到响应却不落会话
  if ((request.path === '/login' || request.path.startsWith('/login/')) && payload?.data) {
    storeLoginData(payload.data);
  }

  return sanitizeApiResponse(request.path, payload);
};
