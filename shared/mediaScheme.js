// jello-media 自定义协议：渲染器不再直接持有酷狗 CDN URL，媒体元素与自解码
// fetch 都走这个主进程协议。main 进程在 handler 里做上游主机白名单校验与
// 逐主机 HTTPS 升级（HTTP 仅作为概念版 CDN 证书不匹配时的兜底）。
// 协议名与 CDN 后缀白名单同时被 CSP 生成、渲染器 URL 构造和主进程代理使用，
// 因此统一放在本模块，避免两份主机匹配实现失同步。

export const MEDIA_SCHEME = 'jello-media';

// 酷狗系 CDN 后缀：既是主进程代理的上游白名单，也是清理日志时的判定依据。
export const MEDIA_CDN_SUFFIXES = Object.freeze(['kugou.com', 'kgimg.com']);

export const buildMediaUrl = (url) => (url
  ? `${MEDIA_SCHEME}://media/?u=${encodeURIComponent(String(url))}`
  : url);

// 「. 分隔的整段标签」比较：notkugou.com / kugou.com.evil.com / 裸 IP /
// 带端口主机名都必须正确处理；空主机名与内网裸名一律拒绝。
export const isMediaHostAllowed = (host, suffixes = MEDIA_CDN_SUFFIXES) => {
  const value = String(host || '').trim().toLowerCase().replace(/\.+$/, '').replace(/:\d+$/, '');
  if (!value || !value.includes('.') || value.includes(':')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  const labels = value.split('.');
  return suffixes.some((suffix) => {
    const suffixLabels = String(suffix).toLowerCase().split('.');
    if (suffixLabels.length > labels.length) return false;
    return suffixLabels.every((label, index) => labels[labels.length - suffixLabels.length + index] === label);
  });
};

// 主进程代理的入口校验：协议与主机白名单双重限制，防止 jello-media 被当成
// 任意 URL 代理使用。通过原样返回 URL，调用方再做 HTTPS 升级。
export const validateMediaTarget = (raw) => {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error('invalid media url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('unsupported media protocol');
  }
  if (!isMediaHostAllowed(url.host)) throw new Error('media host is not allowlisted');
  return url;
};

// ===== 逐主机 HTTPS 升级决策（纯逻辑，fetch 注入以便测试） =====
// KuGou 概念版 CDN 的 http 音源先探测 https：证书有效即升级（本次启动内按
// host 缓存，正负结果都缓存），失败回退 http。探测顺序 HEAD → Range GET 单
// 字节（部分 CDN 拒绝 HEAD 返回 405）；网络层异常（证书不匹配/DNS/超时）直接
// 判负——每首歌都白等超时是不可接受的。
export const toHttpsUrl = (url) => {
  const next = new URL(url.toString());
  next.protocol = 'https:';
  return next;
};

export const createHttpsUpgradeResolver = ({
  fetchImpl,
  probeTimeoutMs = 5000,
  log = () => {}
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');
  const cache = new Map();

  const probeOnce = async (httpsUrl, method) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), probeTimeoutMs);
    try {
      const response = await fetchImpl(httpsUrl, {
        method,
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : {},
        redirect: 'follow',
        signal: controller.signal
      });
      await response.arrayBuffer?.().catch?.(() => {});
      return response.status;
    } finally {
      clearTimeout(timer);
    }
  };

  const probeHttps = async (httpsUrl) => {
    for (const method of ['HEAD', 'GET']) {
      try {
        const status = await probeOnce(httpsUrl, method);
        if (status < 400) return true;
        if (status !== 405) return false;
      } catch {
        return false;
      }
    }
    return false;
  };

  return {
    // https 原样返回；http 按探测结果决定升级或回退
    resolve: async (url) => {
      if (url.protocol === 'https:') return url;
      const cached = cache.get(url.host);
      if (cached !== undefined) return cached ? toHttpsUrl(url) : url;
      const ok = await probeHttps(toHttpsUrl(url));
      cache.set(url.host, ok);
      log(ok ? 'upgrade' : 'fallback', url.host);
      return ok ? toHttpsUrl(url) : url;
    },
    clearCache: () => cache.clear()
  };
};
