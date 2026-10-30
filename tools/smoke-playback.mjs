// 播放链路端到端冒烟：真实会话 + sidecar → /song/url → jello-media → <audio> 播放。
// 不弹 UI：headless BrowserWindow 里跑，验证「能出声数据流」。
// 用法：npx electron tools/smoke-playback.mjs
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
// 协议特权注册必须发生在 app ready 之前（与 main.js 的顶层 import 同时机）
import { initMediaProxy } from '../electron/services/mediaProxy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setPath('userData', path.join(app.getPath('appData'), 'jello-music-clean'));

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
  initMediaProxy();

  const cookie = getCookieHeader();
  const auth = getAuthHeader();
  console.log(`session: cookie ${cookie.length}B, auth ${auth ? 'yes' : 'no'}`);

  const port = await getFreePort();
  const token = randomBytes(24).toString('hex');
  const child = spawn(process.execPath, [
    path.join(here, '..', 'electron', 'sidecar-entry.cjs'), `--port=${port}`, '--platform=lite'
  ], {
    cwd: path.join(here, '..', 'api'),
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1',
      JELLO_SIDECAR_TOKEN: token,
      JELLO_SIDECAR_GUARD: path.join(here, '..', 'electron', 'sidecar-guard.cjs'),
      JELLO_SIDECAR_ENTRY: path.join(here, '..', 'api', 'app.js')
    },
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', (d) => console.error('[sidecar]', String(d).trim().slice(0, 200)));
  await waitForPort(port);

  const base = `http://127.0.0.1:${port}`;
  const call = async (p, method = 'GET', body) => {
    const response = await fetch(`${base}${p}`, {
      method,
      headers: {
        'x-jello-token': token, Cookie: cookie,
        ...(auth ? { Authorization: auth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return response.json();
  };

  await call('/register/dev', 'POST');
  // 拿一首真实歌曲（每日推荐第一首）
  const daily = await call('/everyday/recommend', 'POST', { pagesize: 1, page: 1 });
  const song = daily?.data?.song_list?.[0];
  if (!song?.hash) { console.log('FAIL: 拿不到测试歌曲'); app.exit(1); return; }
  console.log(`song: ${song.songname || song.filename} (${song.hash.slice(0, 8)}…)`);

  const urlPayload = await call(`/song/url?hash=${song.hash}&quality=128`);
  const upstream = Array.isArray(urlPayload?.url) ? urlPayload.url[0] : urlPayload?.url;
  if (!upstream) {
    console.log(`FAIL: /song/url 无可用地址 status=${urlPayload?.status} err=${urlPayload?.error_msg || urlPayload?.error || ''}`);
    app.exit(1); return;
  }
  console.log(`upstream: ${upstream.slice(0, 80)}…`);

  // headless 窗口里播放 jello-media 包装地址
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html></html>');
  const mediaUrl = `jello-media://media/?u=${encodeURIComponent(upstream)}`;
  const result = await win.webContents.executeJavaScript(`(() => {
    const a = new Audio(${JSON.stringify(mediaUrl)});
    a.volume = 1;
    return new Promise((resolve) => {
      const done = (outcome) => resolve(outcome);
      a.addEventListener('error', () => done({ error: a.error ? a.error.code + ':' + (a.error.message || '') : 'unknown' }), { once: true });
      a.addEventListener('canplay', () => {
        a.play().then(async () => {
          await new Promise((r) => setTimeout(r, 2500));
          done({ ok: true, duration: a.duration, advanced: a.currentTime > 1, time: a.currentTime });
        }).catch((e) => done({ playReject: String(e && e.message || e) }));
      }, { once: true });
      a.addEventListener('stalled', () => done({ stalled: true, networkState: a.networkState }), { once: true });
      setTimeout(() => done({ timeout: true, readyState: a.readyState, networkState: a.networkState }), 15000);
      a.load();
    });
  })()`, true);

  console.log('playback result:', JSON.stringify(result, null, 1));
  const ok = result && result.ok && result.advanced;
  console.log(ok ? 'SMOKE OK（音频数据流正常推进）' : 'SMOKE FAILED');
  child.kill();
  await win.destroy();
  app.exit(ok ? 0 : 1);
}).catch((error) => {
  console.error('bootstrap error:', error);
  app.exit(1);
});
