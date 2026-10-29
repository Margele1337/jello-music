// CSP 策略的唯一来源：vite.config.js 在 dev/build 两个阶段把 buildCsp 的结果
// 写进 index.html 的 meta 标签（dev 需要 Vite HMR 的 5173，build 产物不带）。
//
// 媒体与跨源请求全部经 jello-media 自定义协议（shared/mediaScheme.js）由主进程
// 代理：渲染器不再直接访问酷狗 CDN，因此 connect-src 不含任何 CDN 主机，
// media-src 只放行协议本身与自解码管线必需的 blob:。

import { MEDIA_SCHEME } from './mediaScheme.js';

export const buildCsp = ({ dev = false } = {}) => {
  const connectSrc = ["'self'", `${MEDIA_SCHEME}:`];
  if (dev) connectSrc.push('ws://127.0.0.1:5173', 'http://127.0.0.1:5173');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    `media-src blob: ${MEDIA_SCHEME}:`,
    `connect-src ${connectSrc.join(' ')}`
  ].join('; ');
};
