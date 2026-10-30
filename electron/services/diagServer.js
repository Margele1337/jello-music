// 频谱相位实机测量诊断服务（仅开发/标定用途，JELLO_DIAG=1 时启动）：
// - 记录渲染进程发来的 spectrum:update 频谱帧（主进程收到时刻的 Date.now()）
// - 每 50ms 采样主窗口 audio.currentTime 与 AudioContext 输出延迟
// - 127.0.0.1:8791 控制端口：POST /start?url=<播放地址> 驱动主播放器播放任意 URL；
//   POST /stop 暂停；GET /state 返回最近采样
// 全部追加写入 userData/spectrum-diag.jsonl（每行 {kind, t, ...}）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow, app, ipcMain } from 'electron';
import { buildMediaUrl } from '../../shared/mediaScheme.js';

const CONTROL_PORT = 8791;
const POS_SAMPLE_MS = 50;

let logStream = null;
const log = (kind, obj = {}) => {
  if (!logStream) return;
  logStream.write(`${JSON.stringify({ kind, t: Date.now(), ...obj })}\n`);
};

// 频谱 HUD 是独立窗口（URL 带 /spectrum），主窗口取第一个不匹配的
const mainWindow = () => {
  const wins = BrowserWindow.getAllWindows();
  return wins.find((w) => {
    try {
      return !w.webContents.getURL().includes('spectrum');
    } catch {
      return false;
    }
  });
};

const startPlayback = async (url) => {
  const win = mainWindow();
  if (!win || !url) return 'ERR: no window or url';
  const script = `(() => {
    try {
      const appEl = document.getElementById('app');
      const pinia = appEl && appEl.__vue_app__ && appEl.__vue_app__.config.globalProperties.$pinia;
      let store = null;
      if (pinia && pinia._s) {
        for (const s of pinia._s.values()) { if (Array.isArray(s.queue)) { store = s; break; } }
      }
      if (!store) return 'ERR: no player store';
      const audio = store.audio || document.querySelector('audio');
      if (!audio) return 'ERR: no audio element';
      // 不动 queue/currentSong：避免触发 store 的加载/错误重试流把 src 改写。
      // HUD 只依赖 isPlaying()（= store.playing）与频谱帧，currentSong 为空仅影响封面/歌名。
      audio.crossOrigin = 'anonymous';
      audio.src = ${JSON.stringify(url)};
      audio.loop = true;
      audio.volume = Math.max(0.1, (Number(store.volume) || 50) / 100);
      store.playing = true;
      if (window.__diagCtx && window.__diagCtx.state === 'suspended') void window.__diagCtx.resume();
      return audio.play().then(() => 'OK').catch((e) => 'PLAY_ERR: ' + String(e && e.message || e));
    } catch (e) {
      return 'ERR: ' + String(e && e.message || e);
    }
  })()`;
  return win.webContents.executeJavaScript(script, true);
};

const stopPlayback = async () => {
  const win = mainWindow();
  if (!win) return 'ERR: no window';
  const script = `(() => {
    try {
      const appEl = document.getElementById('app');
      const pinia = appEl && appEl.__vue_app__ && appEl.__vue_app__.config.globalProperties.$pinia;
      let store = null;
      if (pinia && pinia._s) {
        for (const s of pinia._s.values()) { if (Array.isArray(s.queue)) { store = s; break; } }
      }
      const audio = (store && store.audio) || document.querySelector('audio');
      if (audio) audio.pause();
      if (store) store.playing = false;
      return 'OK';
    } catch (e) {
      return 'ERR: ' + String(e && e.message || e);
    }
  })()`;
  return win.webContents.executeJavaScript(script, true);
};

export const initDiagServer = () => {
  const logPath = path.join(app.getPath('userData'), 'spectrum-diag.jsonl');
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
  log('event', { msg: 'diag server start', logPath });

  ipcMain.on('spectrum:update', (_event, payload) => {
    if (!payload || !Array.isArray(payload.levels)) return;
    log('levels', {
      playing: payload.playing === true,
      reset: payload.reset === true,
      levels: payload.levels.slice(0, 8).map((v) => Math.round(Number(v) || 0))
    });
  });

  setInterval(() => {
    const win = mainWindow();
    if (!win || win.isDestroyed()) return;
    const script = `(() => {
      const appEl = document.getElementById('app');
      const pinia = appEl && appEl.__vue_app__ && appEl.__vue_app__.config.globalProperties.$pinia;
      let store = null;
      if (pinia && pinia._s) {
        for (const s of pinia._s.values()) { if (Array.isArray(s.queue)) { store = s; break; } }
      }
      const a = (store && store.audio) || document.querySelector('audio');
      if (!window.__diagCtx) {
        try { window.__diagCtx = new AudioContext(); } catch (e) { window.__diagCtx = null; }
      }
      const c = window.__diagCtx;
      return JSON.stringify({
        ct: a ? a.currentTime : null,
        paused: a ? a.paused : null,
        pr: a ? a.playbackRate : null,
        ns: a ? a.networkState : null,
        rs: a ? a.readyState : null,
        buf: a && a.buffered && a.buffered.length ? a.buffered.end(a.buffered.length - 1) : null,
        sr: c ? c.sampleRate : null,
        out: c && c.outputLatency != null ? c.outputLatency : null,
        base: c && c.baseLatency != null ? c.baseLatency : null,
        state: c ? c.state : null
      });
    })()`;
    win.webContents.executeJavaScript(script, true)
      .then((json) => {
        try {
          const sample = JSON.parse(json);
          log('pos', sample);
        } catch {
          /* 页面未就绪时忽略 */
        }
      })
      .catch(() => {});
  }, POS_SAMPLE_MS);

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://127.0.0.1:${CONTROL_PORT}`);
    const reply = (body) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(body));
    };
    if (u.pathname === '/start' && req.method === 'POST') {
      const url = u.searchParams.get('url') || '';
      // viaMedia=1：把目标 URL 包装成 jello-media:// 走主进程媒体代理（与生产路径一致）
      const target = u.searchParams.get('viaMedia') === '1' ? buildMediaUrl(url) : url;
      log('event', { msg: 'control start', url: target });
      startPlayback(target).then(reply).catch((e) => reply(`ERR: ${e}`));
    } else if (u.pathname === '/stop' && req.method === 'POST') {
      log('event', { msg: 'control stop' });
      stopPlayback().then(reply).catch((e) => reply(`ERR: ${e}`));
    } else if (u.pathname === '/state' && req.method === 'GET') {
      reply(JSON.stringify({ ok: true, windows: BrowserWindow.getAllWindows().length }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(CONTROL_PORT, '127.0.0.1', () => {
    console.log(`[diag] spectrum diag server on 127.0.0.1:${CONTROL_PORT}, log: ${logPath}`);
  });
};
