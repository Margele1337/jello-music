// VIP 领取接口诊断：用真实本地会话（只读）复现一次领取调用，
// 打印服务端对「今日已领取」场景的原始响应结构（token 类字段脱敏）。
// 不会写入/覆盖 session vault，不会启动应用窗口。
// 用法：npx electron tools/inspect-vip-claim.mjs
import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { randomBytes } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
// 与 electron/main.js 相同的 userData，才能读到真实加密会话
app.setPath('userData', path.join(app.getPath('appData'), 'jello-music-clean'));

const REDACT = /"(token|t1|t|cookie|secu_params|vip_token|access_token|refresh_token)":"[^"]*"/gi;
const print = (label, payload) => {
  console.log(`=== ${label} ===`);
  console.log(JSON.stringify(payload, (key, value) => value).replace(REDACT, '"$1":"<redacted>"').slice(0, 2000));
};

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const waitForPort = (port, timeoutMs = 20000) => new Promise((resolve, reject) => {
  const deadline = Date.now() + timeoutMs;
  const tick = async () => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const ok = await new Promise((done) => {
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(1000, () => { socket.destroy(); done(false); });
    });
    socket.destroy();
    if (ok) { resolve(); return; }
    if (Date.now() >= deadline) { reject(new Error('sidecar start timeout')); return; }
    setTimeout(tick, 250);
  };
  void tick();
});

app.whenReady().then(async () => {
  const { initAuthSession, getCookieHeader, getAuthHeader } = await import('../electron/services/authSession.js');
  await initAuthSession();
  const cookie = getCookieHeader();
  const auth = getAuthHeader();
  if (!cookie && !auth) {
    console.log('NO_SESSION: 本地没有已登录会话，无法诊断');
    app.exit(2);
    return;
  }
  console.log(`session loaded: cookie 长度 ${cookie.length}, authHeader ${auth ? '有' : '无'}`);

  // 独立 sidecar（概念版 lite），与主进程同款包装器 + token 守卫
  const port = await getFreePort();
  const token = randomBytes(24).toString('hex');
  const apiDir = path.join(here, '..', 'api');
  const child = spawn(process.execPath, [
    path.join(here, '..', 'electron', 'sidecar-entry.cjs'),
    `--port=${port}`,
    '--platform=lite'
  ], {
    cwd: apiDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: '127.0.0.1',
      JELLO_SIDECAR_TOKEN: token,
      JELLO_SIDECAR_GUARD: path.join(here, '..', 'electron', 'sidecar-guard.cjs'),
      JELLO_SIDECAR_ENTRY: path.join(here, '..', 'api', 'app.js')
    },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', (d) => console.error('[sidecar]', String(d).trim().slice(0, 300)));

  try {
    await waitForPort(port);
    const base = `http://127.0.0.1:${port}`;
    const call = async (p, method = 'GET', body) => {
      const response = await fetch(`${base}${p}`, {
        method,
        headers: { 'x-jello-token': token, Cookie: cookie, ...(auth ? { Authorization: auth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      return response.json();
    };

    await call('/register/dev', 'POST');
    const day = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date()).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    const receiveDay = `${day.year}-${day.month}-${day.day}`;

    print('今日领取响应（预期：已领取）', await call('/youth/day/vip', 'POST', { receive_day: receiveDay }));
    print('upgrade 响应', await call('/youth/day/vip/upgrade', 'POST', {}));
    print('当月领取记录', await call('/youth/month/vip/record?latest_limit=100'));
  } finally {
    child.kill();
  }
  app.exit(0);
}).catch((error) => {
  console.error('inspect error:', error);
  app.exit(1);
});
