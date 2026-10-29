import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog } from 'electron';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { SIDECAR_HEALTH_PATH, SIDECAR_SHUTDOWN_PATH } from '../../shared/ipc.js';
import { getSettings } from './settingsStore.js';
import { proxyUrlForSidecar } from './proxyService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const resolvePaths = () => {
  if (app.isPackaged) {
    return {
      apiDir: path.join(process.resourcesPath, 'api'),
      entry: path.join(process.resourcesPath, 'api', 'app.js'),
      wrapper: path.join(process.resourcesPath, 'sidecar-entry.cjs'),
      guard: path.join(process.resourcesPath, 'sidecar-guard.cjs')
    };
  }
  return {
    apiDir: path.join(__dirname, '..', '..', 'api'),
    entry: path.join(__dirname, '..', '..', 'api', 'app.js'),
    wrapper: path.join(__dirname, '..', 'sidecar-entry.cjs'),
    guard: path.join(__dirname, '..', 'sidecar-guard.cjs')
  };
};

const START_TIMEOUT_MS = 20000;
const SPAWN_RETRIES = 3;
// 崩溃弹窗的连续次数上限：sidecar 起不来时不能变成无限弹框的拒绝服务
const MAX_CRASH_PROMPTS = 3;

let child = null;
let baseUrl = '';
let starting = null;
let sidecarToken = '';
// 复用（adopt）来的实例没有 child 句柄：只能靠守卫的受 token 保护自杀路由让它退出
let adoptedPort = 0;
let currentPlatform = 'lite';
let intentionalStop = false;
let readyAnnounced = false;
let crashPromptOpen = false;
let crashPromptCount = 0;
let onStateChange = null;

const stateFilePath = () => path.join(app.getPath('userData'), 'sidecar-state.json');

const readPersistedState = () => {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFilePath(), 'utf-8'));
    const port = Math.round(Number(raw?.port));
    const token = String(raw?.token || '');
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || !/^[a-f0-9]{16,64}$/.test(token)) return null;
    return { port, token, platform: raw?.platform === 'official' ? 'official' : 'lite' };
  } catch {
    return null;
  }
};

const writePersistedState = (state) => {
  try {
    fs.writeFileSync(stateFilePath(), JSON.stringify(state), 'utf-8');
  } catch {
    /* 状态文件只是复用优化，写失败不影响本次运行 */
  }
};

const clearPersistedState = () => {
  try {
    fs.rmSync(stateFilePath(), { force: true });
  } catch {
    /* ignore */
  }
};

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const isPortOpen = (port, timeoutMs = 1200) => new Promise((resolve) => {
  const socket = net.connect({ host: '127.0.0.1', port });
  const finish = (result) => {
    socket.destroy();
    resolve(result);
  };
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
  socket.once('timeout', () => finish(false));
  socket.setTimeout(timeoutMs);
});

// 端口通 + token 能过守卫 + 返回约定的 JSON 结构，三者同时满足才认定为「兼容实例」。
// 探针走守卫自带的 health 路由：/register/dev 会真打上游酷狗接口，
// 只为判断「能不能复用」而烧一次设备注册不值得；只探端口又会把别的本机 HTTP
// 服务误判成 sidecar，导致所有音乐请求静默失败。
const probeCompatible = async (port, token) => {
  if (!(await isPortOpen(port))) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}${SIDECAR_HEALTH_PATH}`, {
      headers: { 'x-jello-token': token },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null);
    return response.status === 200 && payload?.data?.healthy === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

// 有界就绪轮询：TCP 建连只说明端口在听，进程可能还在 require 上游模块；
// 用固定间隔轮询端口并把总时长卡在 timeoutMs 内，超时明确失败而不是无限等
const waitForPort = (port, timeoutMs = START_TIMEOUT_MS) => new Promise((resolve, reject) => {
  const deadline = Date.now() + timeoutMs;
  const tick = async () => {
    if (child === null && intentionalStop) {
      reject(new Error('sidecar stopped before ready'));
      return;
    }
    if (await isPortOpen(port, 1000)) {
      resolve();
      return;
    }
    if (Date.now() >= deadline) {
      reject(new Error(`sidecar start timed out after ${Math.round(timeoutMs / 1000)}s`));
      return;
    }
    setTimeout(tick, 250);
  };
  void tick();
});

const announce = (patch) => {
  onStateChange?.({ baseUrl, ...patch });
};

/**
 * 运行期崩溃的可恢复提示：本地化文案、给「重试 / 继续使用」两个出口，
 * 并限制连续弹窗次数（反复起不来就只记日志，不再骚扰用户）。
 */
const promptSidecarCrash = async (detail) => {
  if (crashPromptOpen || crashPromptCount >= MAX_CRASH_PROMPTS) return;
  crashPromptOpen = true;
  crashPromptCount += 1;
  try {
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: '音乐接口已停止响应',
      message: '本地音乐接口进程意外退出，歌曲解析与登录请求会暂时失败。',
      detail: `${detail}\n\n「重新启动接口」会立即拉起本地接口进程；「稍后处理」保持当前界面，接口会在下次请求前自动重试。`,
      buttons: ['重新启动接口', '稍后处理'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (result.response === 0) {
      readyAnnounced = false;
      await startSidecar({ platform: currentPlatform }).catch((error) => {
        console.error('[sidecar] 手动重启失败:', error.message);
      });
    }
  } catch (error) {
    console.error('[sidecar] 崩溃提示失败:', error?.message || error);
  } finally {
    crashPromptOpen = false;
  }
};

const spawnSidecar = async (port, platform) => {
  const { apiDir, entry, wrapper, guard } = resolvePaths();
  const token = randomBytes(24).toString('hex');
  // 侧车出站走 api/util/runtime.js 的 resolveProxy()，只认 KUGOU_API_PROXY 环境变量
  // （http/https 代理）；socks 系它不支持，那部分只有 Chromium 网络栈能吃到。
  const sidecarProxy = proxyUrlForSidecar(getSettings());

  child = spawn(process.execPath, [wrapper, `--port=${port}`, `--platform=${platform}`], {
    cwd: apiDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: '127.0.0.1',
      KUGOU_API_PROXY: sidecarProxy,
      JELLO_SIDECAR_TOKEN: token,
      JELLO_SIDECAR_GUARD: guard,
      JELLO_SIDECAR_ENTRY: entry
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  sidecarToken = token;
  if (sidecarProxy) console.log('[sidecar] 出站代理已启用（仅 http/https 生效）');

  child.stdout.on('data', () => {});
  child.stderr.on('data', (data) => {
    const text = String(data).trim();
    if (text) console.error('[sidecar]', text.slice(0, 500));
  });
  child.once('error', (error) => {
    console.error('[sidecar] 进程错误:', error.message);
  });
  child.once('exit', (code, signal) => {
    child = null;
    baseUrl = '';
    sidecarToken = '';
    adoptedPort = 0;
    clearPersistedState();
    if (intentionalStop) return;
    const detail = `code=${code}${signal ? ` signal=${signal}` : ''}`;
    console.error(`[sidecar] 意外退出 ${detail}`);
    announce({ crashed: true, detail });
    if (readyAnnounced) void promptSidecarCrash(detail);
  });

  await waitForPort(port);
  baseUrl = `http://127.0.0.1:${port}`;
  readyAnnounced = true;
  crashPromptCount = 0;
  writePersistedState({ port, token, platform });
  return baseUrl;
};

export const startSidecar = async ({ platform } = {}) => {
  if (baseUrl) return baseUrl;
  if (starting) return starting;
  // 平台只在显式传入时定格；restartSidecar 已在 stop 之前钉住目标平台，
  // 这里若无条件赋值，会把并发调用方（waitForSidecar 自动拉起）刚钉好的
  // 新平台又改回旧值
  if (platform) currentPlatform = platform === 'official' ? 'official' : 'lite';

  starting = (async () => {
    // 复用上一轮遗留的兼容实例（dev 热重启 / 崩溃后未回收的子进程仍在监听随机端口）
    const persisted = readPersistedState();
    if (persisted && persisted.platform === currentPlatform && await probeCompatible(persisted.port, persisted.token)) {
      sidecarToken = persisted.token;
      baseUrl = `http://127.0.0.1:${persisted.port}`;
      adoptedPort = persisted.port;
      readyAnnounced = true;
      console.log(`[sidecar] 复用已运行的实例 :${persisted.port}`);
      announce({ reused: true });
      return baseUrl;
    }
    clearPersistedState();

    let lastError = null;
    // 随机端口在 getFreePort 与 sidecar 真正 bind 之间可能被别的进程抢走
    // （Windows 上 ephemeral 端口段撞车很常见），失败就换端口重来
    for (let attempt = 0; attempt < SPAWN_RETRIES; attempt += 1) {
      try {
        const port = await getFreePort();
        return await spawnSidecar(port, currentPlatform);
      } catch (error) {
        lastError = error;
        console.warn(`[sidecar] 第 ${attempt + 1} 次启动失败:`, error.message);
        if (child) {
          const dying = child;
          child = null;
          try {
            dying.kill();
          } catch {
            /* ignore */
          }
        }
        baseUrl = '';
        sidecarToken = '';
      }
    }
    throw lastError || new Error('sidecar failed to start');
  })().finally(() => {
    starting = null;
  });

  return starting;
};

export const getSidecarBaseUrl = () => baseUrl;

export const getSidecarToken = () => sidecarToken;

export const waitForSidecar = async (timeoutMs = 10000) => {
  if (baseUrl) return baseUrl;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (baseUrl) return baseUrl;
    if (starting) {
      try {
        return await starting;
      } catch {
        return '';
      }
    }
    // 崩溃/未启动：主动拉一次，让「稍后处理」的用户在下次请求时无感恢复
    void startSidecar({ platform: currentPlatform }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return baseUrl;
};

const stopAdoptedInstance = async () => {
  if (!adoptedPort) return true;
  const port = adoptedPort;
  adoptedPort = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    // 守卫里的 /__jello-shutdown 只认本次 launch 的 token，别的本机进程调不动
    const response = await fetch(`http://127.0.0.1:${port}${SIDECAR_SHUTDOWN_PATH}`, {
      method: 'POST',
      headers: { 'x-jello-token': sidecarToken },
      signal: controller.signal
    });
    return !!response?.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export const stopSidecar = async () => {
  intentionalStop = true;
  if (starting) {
    try {
      await starting;
    } catch {
      /* starting already failed */
    }
  }

  const current = child;
  child = null;
  baseUrl = '';
  readyAnnounced = false;
  // 顺序要紧：/__jello-shutdown 要校验本次 launch 的 token，先清空 sidecarToken
  // 就再也调不动被复用的实例；状态文件也只在它确实退出后才删，
  // 否则下次启动既找不到它、又杀不掉它，本机就会留下永久孤儿进程
  const adoptedStopped = await stopAdoptedInstance();
  sidecarToken = '';
  if (adoptedStopped) clearPersistedState();
  if (!current || current.killed) return;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    current.once('exit', finish);
    current.kill();
    setTimeout(finish, 3000);
  });
};

export const restartSidecar = async (options = {}) => {
  // 目标平台必须先于 stop 定格：stop→start 之间（秒级）进来的请求会经
  // waitForSidecar 自动拉起实例，拿到的必须是新平台，否则数据源切换会被
  // 旧平台实例「抢跑」，表现成切了没生效
  if (options.platform) currentPlatform = options.platform === 'official' ? 'official' : 'lite';
  await stopSidecar();
  intentionalStop = false;
  return startSidecar();
};

// 主进程用来接 sidecar 状态变化（崩溃/复用），避免 service 反向依赖窗口层
export const initSidecar = (listener) => {
  onStateChange = typeof listener === 'function' ? listener : null;
};
