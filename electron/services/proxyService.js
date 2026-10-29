import { net, session } from 'electron/main';
import { normalizeProxyUrl } from '../../shared/settings.js';

// 独立探测会话：Electron 45 导出的 `session` 即 Session 类本体，new 出来的实例
// 没有 partition、不读写任何 storage，与 defaultSession 完全隔离——
// 「测试代理」绝不能把用户当前的代理状态改掉。
const SessionConstructor = session.Session ?? session;

const PROBE_TIMEOUT_MS = 10000;
const IP_ECHO_URL = 'https://api.ipify.org?format=json';

// 回环必须直连：sidecar RPC、dev server、以及 net:test-api-base 的本机探测
// 走代理会拿到 401/超时，看起来像「代理坏了」。
const BYPASS_RULES = '<-loopback>';

let probeSession = null;
let appliedRules = null;

const getProbeSession = () => {
  if (!probeSession) probeSession = new SessionConstructor();
  return probeSession;
};

const applyToDefaultSession = async (proxyUrl) => {
  // 关闭代理时回到 system 模式：这与「本功能从未存在过」的默认行为一致
  // （跟随系统代理设置），比强制 direct 更不容易让用户以为设置没生效。
  const rules = proxyUrl
    ? { proxyRules: proxyUrl, proxyBypassRules: BYPASS_RULES }
    : { mode: 'system' };
  await session.defaultSession.setProxy(rules);
  // 代理规则改完必须断开在途连接：否则已建立的 socket 会继续绕过新规则跑完，
  // 表现为「设置没生效」。
  try {
    await session.defaultSession.closeAllConnections();
  } catch {
    /* 老版本/无在途连接时忽略 */
  }
  appliedRules = proxyUrl;
};

/**
 * 把 settings.proxyEnabled/proxyUrl 应用到 Chromium 网络栈。
 * 之所以走 defaultSession.setProxy 而不是 --proxy-server 命令行：前者可在运行期
 * 生效（设置页改完立刻生效，不必重启），后者只在进程启动时定型。
 * 返回真正生效的代理地址（未启用/非法时为空串）。
 */
export const applyProxySettings = async (settings) => {
  const proxyUrl = settings?.proxyEnabled ? normalizeProxyUrl(settings.proxyUrl) : '';
  if (appliedRules === proxyUrl) return proxyUrl;
  try {
    await applyToDefaultSession(proxyUrl);
  } catch (error) {
    console.error('[proxy] 应用代理设置失败:', error?.message || error);
    return '';
  }
  return proxyUrl;
};

export const getActiveProxyUrl = () => appliedRules || '';

/**
 * sidecar（api/ 子模块）那一层的代理只认 http/https：
 * util/runtime.js 的 resolveProxy() 明确拒绝其他协议，socks 给它只会打警告并直连。
 * 所以 socks 代理时这里返回空串——不重启 sidecar，Chromium 层照样生效。
 */
export const proxyUrlForSidecar = (settings) => {
  const proxyUrl = settings?.proxyEnabled ? normalizeProxyUrl(settings.proxyUrl) : '';
  if (!proxyUrl) return '';
  return /^https?:\/\//i.test(proxyUrl) ? proxyUrl : '';
};

/**
 * 真正通过代理取一次公网 IP：独立 session + net.fetch。
 * 渲染进程的 fetch 不能设 agent，Proxy-Authorization 又是 forbidden header，
 * 在渲染层测等于走直连，会永远显示本机真实 IP（旧版踩过这个坑）。
 */
export const testProxy = async (proxyUrl) => {
  const rules = normalizeProxyUrl(proxyUrl);
  if (!rules) return { ok: false, error: '代理地址不合法：仅支持 http/https/socks4/socks5' };

  const probe = getProbeSession();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    await probe.setProxy({ proxyRules: rules, proxyBypassRules: BYPASS_RULES });
    const response = await net.fetch(IP_ECHO_URL, { session: probe, signal: controller.signal });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const payload = await response.json().catch(() => null);
    const ip = String(payload?.ip || payload?.origin || '').trim();
    if (!ip) return { ok: false, error: '代理未返回公网 IP' };
    return { ok: true, ip };
  } catch (error) {
    const message = error?.name === 'AbortError' ? '请求超时' : String(error?.message || error);
    return { ok: false, error: message.slice(0, 300) };
  } finally {
    clearTimeout(timer);
    // 会话留着复用，但代理规则擦成 direct：残留规则会让下一次测试看起来一直「通」
    try {
      await probe.setProxy({ mode: 'direct' });
    } catch {
      /* 清理失败不影响本次结果 */
    }
    try {
      await probe.closeAllConnections();
    } catch {
      /* ignore */
    }
  }
};
