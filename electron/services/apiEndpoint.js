import { net } from 'electron';
import { normalizeApiBaseUrl } from '../../shared/settings.js';
import { getSettings } from './settingsStore.js';
import { getSidecarBaseUrl, getSidecarToken, waitForSidecar } from './sidecar.js';

const joinUrl = (baseUrl, path) => {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const rel = String(path || '').replace(/^\/+/, '');
  return `${base}/${rel}`;
};

// 自定义 RPC 地址只在 mode==='custom' 且通过白名单校验后生效；
// 校验不过就静默回落内置 sidecar——否则一个手滑的地址会把全部请求打到黑洞。
export const resolveCustomApiBaseUrl = (settings = getSettings()) => {
  if (settings?.apiBaseUrlMode !== 'custom') return '';
  return normalizeApiBaseUrl(settings.apiBaseUrl);
};

export const resolveApiBaseUrl = async () => {
  const custom = resolveCustomApiBaseUrl();
  if (custom) return custom;
  return getSidecarBaseUrl() || await waitForSidecar();
};

// 打到内置 sidecar 时必须带 per-launch token，否则 token 守卫会回 401 误判「地址不通」。
// 反过来：切到自定义 RPC 地址时绝不能把这枚本机密钥发出去。
export const sidecarTokenFor = (baseUrl) => {
  const sidecar = getSidecarBaseUrl();
  if (!sidecar || normalizeApiBaseUrl(baseUrl) !== normalizeApiBaseUrl(sidecar)) return '';
  return getSidecarToken();
};

const tokenForUrl = sidecarTokenFor;

export const fetchJsonFromApiBase = async (baseUrl, path, options = {}) => {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  const token = tokenForUrl(baseUrl);
  if (token) headers['x-jello-token'] = token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
  try {
    // net.fetch 才会走 Chromium 网络栈，代理设置对探测同样生效
    const response = await net.fetch(joinUrl(baseUrl, path), {
      method: options.method || 'GET',
      headers,
      body: options.body,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    return { response, payload };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 「测试」自定义 RPC 地址：打 /register/dev 拿设备标识，能拿到 JSON 结构才算连通。
 * 只回 ok/error，不把响应体透给渲染层（里面含 dfid/ip 等设备指纹）。
 */
export const testApiBaseUrl = async (rawUrl) => {
  const baseUrl = normalizeApiBaseUrl(rawUrl);
  if (!baseUrl) return { ok: false, error: '地址不合法：仅允许 https 或本机 http 回环' };

  try {
    const { response, payload } = await fetchJsonFromApiBase(baseUrl, '/register/dev', { timeoutMs: 8000 });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    if (!payload || typeof payload !== 'object' || !('status' in payload)) {
      return { ok: false, error: '返回内容不是酷狗 RPC 的 JSON 结构' };
    }
    return { ok: true };
  } catch (error) {
    const message = error?.name === 'AbortError' ? '请求超时' : String(error?.message || error);
    return { ok: false, error: message.slice(0, 300) };
  }
};
