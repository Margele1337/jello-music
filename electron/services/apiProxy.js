import { sanitizeApiRequest, sanitizeApiResponse } from '../../shared/apiPolicy.js';
import { getSidecarBaseUrl, getSidecarToken, waitForSidecar } from './sidecar.js';
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
      const token = getSidecarToken();
      if (token) headers['x-jello-token'] = token;
      const response = await fetch(new URL('/register/dev', baseUrl), {
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
  const baseUrl = getSidecarBaseUrl() || await waitForSidecar();
  if (!baseUrl) throw new Error('API sidecar is not ready');

  await ensureDeviceCookie(baseUrl);

  const url = new URL(request.path, baseUrl);
  for (const [key, value] of Object.entries(request.params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  const headers = {};
  const sidecarToken = getSidecarToken();
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

  const response = await fetch(url, { method: request.method, headers, body });
  const setCookies = response.headers.getSetCookie?.() || [];
  if (setCookies.length) storeSetCookies(setCookies);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`sidecar returned non-JSON response (${response.status})`);
  }

  if (request.path.startsWith('/login/') && payload?.data) {
    storeLoginData(payload.data);
  }

  return sanitizeApiResponse(request.path, payload);
};
