import { net, protocol } from 'electron';
import {
  MEDIA_SCHEME,
  createHttpsUpgradeResolver,
  validateMediaTarget
} from '../../shared/mediaScheme.js';

// 必须在 app ready 之前调用（本模块被 main.js 顶层 import 时即执行）：
// standard/secure 让协议拥有正常 origin 语义；supportFetchAPI 让自解码链路
// 可以 fetch 它；stream 打开 Range/流式支持；corsEnabled + 响应里的 ACAO:*
// 保证 AudioWorklet 采集（CORS-clean media）与 fetch 均可用。
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
]);

// 只透传媒体播放需要的响应头；Content-* 由 fetch/Response 自行管理的不重复设
const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'];

const upgradeResolver = createHttpsUpgradeResolver({
  fetchImpl: (url, options) => net.fetch(url, options),
  log: (mode, host) => console.info(
    mode === 'upgrade'
      ? `[media-proxy] ${host}: HTTPS 可用，已升级`
      : `[media-proxy] ${host}: HTTPS 不可用，回退 HTTP（概念版 CDN 证书不匹配属预期）`
  )
});

const mediaResponse = async (request) => {
  if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
  const target = new URL(request.url).searchParams.get('u');
  if (!target) return new Response('missing media url', { status: 400 });

  let base;
  try {
    base = validateMediaTarget(target);
  } catch (error) {
    console.warn(`[media-proxy] 拒绝非白名单媒体请求: ${error.message}`);
    return new Response('forbidden', { status: 403 });
  }

  const upstreamUrl = await upgradeResolver.resolve(base);
  const headers = {};
  const range = request.headers.get('range');
  if (range) headers.Range = range;

  try {
    // 取消传播：元素中断（切歌/暂停/seek/关播放器）会 cancel 返回的 body 流，
    // cancel 必须传导为上游 fetch 的中止——否则每个被切掉的歌都留一条占着
    // per-host 连接的死流，快速切几首后新歌的缓冲被挤到饿死（「不播放」）
    const controller = new AbortController();
    const upstream = await net.fetch(upstreamUrl, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal
    });
    const responseHeaders = new Headers();
    for (const name of PASSTHROUGH_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    // AudioWorklet 采集与自解码 fetch 都要求 CORS-clean 资源
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Cache-Control', 'no-store');

    const body = new ReadableStream({
      async start(c) {
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              c.close();
              return;
            }
            c.enqueue(value);
          }
        } catch (error) {
          c.error(error);
        }
      },
      cancel() {
        controller.abort();
      }
    });
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    console.warn(`[media-proxy] 上游请求失败 ${upstreamUrl.host}: ${error?.message || error}`);
    return new Response('upstream error', { status: 502 });
  }
};

export const initMediaProxy = () => {
  protocol.handle(MEDIA_SCHEME, (request) => mediaResponse(request).catch((error) => {
    console.error('[media-proxy] handler 异常:', error?.message || error);
    return new Response('media proxy error', { status: 500 });
  }));
};

// 退出链清理：升级缓存随进程结束本就消失，这里保证显式可预期的状态归零
export const stopMediaProxy = () => {
  upgradeResolver.clearCache();
};
