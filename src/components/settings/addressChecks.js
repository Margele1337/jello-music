// 网络地址输入的纯逻辑：判断「用户输入有没有被主进程 sanitize 静默拒绝」，
// 并把 shared 的归一化结果翻译成中文原因。
// shared/settings.js 的 normalize* 只会回空串，设置页若不做这层判定就会把
// 「没存进去」显示成「已保存」，用户直到请求失败才发现地址是空的。
import { normalizeApiBaseUrl, normalizeProxyUrl } from '../../../shared/settings.js';

const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const PROXY_SCHEMES = Object.freeze(['http', 'https', 'socks4', 'socks4a', 'socks5']);

// 与 shared/settings.js 的 isLoopbackHost 同语义（那份未导出，UI 侧只能自带一份，
// 仅用于生成解释文案；真正的放行判定始终以主进程 sanitize 结果为准）
const isLoopbackHost = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  return /^127(\.\d{1,3}){3}$/.test(host);
};

const parseLoose = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    // 与 normalizeProxyUrl 一致：省略协议时按 http 解析（代理允许，RPC 不允许）
    return new URL(PROTOCOL_RE.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
};

const schemeOf = (value) => {
  const matched = String(value ?? '').trim().match(PROTOCOL_RE);
  return matched ? matched[0].slice(0, -3).toLowerCase() : '';
};

/**
 * 输入是否被 sanitize 拒绝：
 * 合法输入的归一化结果必然等于主进程回写的生效值；不等（或归一化成空串）
 * 说明主进程悄悄回落了旧值/空值，必须提示用户而不是假装成功。
 * 清空地址（输入框留空）是合法操作，返回 false。
 */
export const inputRejectedBySanitizer = (typed, effective, normalize) => {
  const raw = String(typed ?? '').trim();
  if (!raw) return false;
  const normalized = normalize(raw);
  if (!normalized) return true;
  return normalized !== String(effective ?? '');
};

export const proxyRejectedMessage = (typed) => {
  const raw = String(typed ?? '').trim();
  const parsed = parseLoose(raw);
  if (!parsed) return '代理地址无法解析，例如 http://127.0.0.1:7890';
  const scheme = schemeOf(raw);
  if (scheme && scheme !== 'socks' && !PROXY_SCHEMES.includes(scheme)) {
    return `不支持的代理协议 ${scheme}，仅支持 http / https / socks4 / socks4a / socks5`;
  }
  const effectiveScheme = scheme || 'http';
  if (effectiveScheme.startsWith('socks') && !parsed.port) {
    return 'socks 代理必须写明端口，例如 socks5://127.0.0.1:7890';
  }
  return '代理地址无效，例如 http://127.0.0.1:7890 或 socks5://user:pass@127.0.0.1:7890';
};

export const apiBaseRejectedMessage = (typed) => {
  const raw = String(typed ?? '').trim();
  const parsed = parseLoose(raw);
  if (!parsed) return '无法解析该地址，例如 https://rpc.example.com';
  const withScheme = PROTOCOL_RE.test(raw);
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    return withScheme
      ? '明文 http 仅允许 127.0.0.1 / localhost：登录凭据会随请求头一起外发，请改用 https'
      : '缺少协议前缀：缺省按 http 处理会被拒绝，请写成 https://… 或 http://127.0.0.1:端口';
  }
  if (parsed.username || parsed.password) return '地址中不能包含账号密码';
  if (parsed.protocol !== 'https:') return '仅支持 https 地址，或指向本机的 http 地址';
  return 'RPC 地址无效，例如 https://rpc.example.com';
};

// 视图侧统一入口：把两个 normalize 与两段文案绑好，避免模板里传来传去
export const checkProxyInput = (typed, effective) => {
  if (!inputRejectedBySanitizer(typed, effective, normalizeProxyUrl)) return null;
  return proxyRejectedMessage(typed);
};

export const checkApiBaseInput = (typed, effective) => {
  if (!inputRejectedBySanitizer(typed, effective, normalizeApiBaseUrl)) return null;
  return apiBaseRejectedMessage(typed);
};
