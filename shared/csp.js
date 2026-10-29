// CSP 策略与主机白名单的唯一来源：vite.config.js 在 dev/build 两个阶段把
// buildCsp 的结果写进 index.html 的 meta 标签（dev 需要 Vite HMR 的 5173，
// build 产物不带）。主进程与渲染器共用这份白名单做 [csp-audit] 收集。

// 酷狗系 CDN 后缀。发现清单外主机时不要静默扩：先看 main.log 里的
// [csp-audit] 记录确认真实主机名，确认属于酷狗系再加进来。
export const MEDIA_CDN_SUFFIXES = Object.freeze(['kugou.com', 'kgimg.com']);

// 端口/末尾点号容忍 + 整段标签比较：'notkugou.com'、'kugou.com.evil.com'
// 这类字符串endsWith陷阱必须挡住，裸 IP 与内网主机名一律不匹配。
export const isHostInSuffixList = (host, list = MEDIA_CDN_SUFFIXES) => {
  const value = String(host || '').trim().toLowerCase().replace(/\.+$/, '').replace(/:\d+$/, '');
  if (!value || !value.includes('.')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  if (value.includes(':')) return false;
  const labels = value.split('.');
  return list.some((suffix) => {
    const suffixLabels = String(suffix).toLowerCase().split('.');
    if (suffixLabels.length > labels.length) return false;
    return suffixLabels.every((label, index) => labels[labels.length - suffixLabels.length + index] === label);
  });
};

const hostSources = (scheme) => MEDIA_CDN_SUFFIXES
  .flatMap((suffix) => [`${scheme}*.${suffix}`, `${scheme}${suffix}`])
  .join(' ');

// media-src 维持宽放行（https:/http:）：音频 URL 的真实主机名仍在收集
// （library.js 的 [csp-audit]），收齐后才具备收紧条件。
export const buildCsp = ({ dev = false } = {}) => {
  const connectSrc = ["'self'", hostSources('https://'), hostSources('http://')];
  if (dev) connectSrc.push('ws://127.0.0.1:5173', 'http://127.0.0.1:5173');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "media-src 'self' https: http: blob:",
    `connect-src ${connectSrc.join(' ')}`
  ].join('; ');
};

// 渲染器在发起跨源 fetch / 把 URL 交给 <audio> 前调用。白名单外主机打一条
// [csp-audit]：connect-src 已按白名单收紧，缺失主机的症状是频谱自解码静默
// 降级为远程 URL 播放（播放本身不受影响）+ 这条日志。
export const auditCspTarget = (url, kind, logger = console) => {
  let host;
  try {
    host = new URL(String(url)).host;
  } catch {
    return false;
  }
  if (isHostInSuffixList(host)) return false;
  logger.warn(`[csp-audit] ${kind} 目标主机不在白名单: ${host}`);
  return true;
};
