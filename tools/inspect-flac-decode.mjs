// FLAC description A/B 解码实验：真实字节 + 端口自己的帧解析器，
// A = 'fLaC'+全部元数据（当前实现），B = 'fLaC'+仅 STREAMINFO 块，
// C = 仅 STREAMINFO 34 字节数据。看哪种 description 能让 Chromium 解码出帧。
// 用法：npx electron tools/inspect-flac-decode.mjs
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import {
  findFirstFlacFrame,
  findNextFlacFrameOffset,
  parseFlacStream
} from '../src/services/audio/mp3Frame.js';

const here = path.dirname(fileURLToPath(import.meta.url));
app.setPath('userData', path.join(app.getPath('appData'), 'jello-music-clean'));

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
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
    if (Date.now() >= deadline) { reject(new Error('sidecar timeout')); return; }
    setTimeout(tick, 250);
  };
  void tick();
});

app.whenReady().then(async () => {
  const { initAuthSession, getCookieHeader, getAuthHeader } = await import('../electron/services/authSession.js');
  await initAuthSession();
  const cookie = getCookieHeader();
  const auth = getAuthHeader();
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
  child.stderr.on('data', () => {});

  try {
    await waitForPort(port);
    const base = `http://127.0.0.1:${port}`;
    const call = async (p, method = 'GET', body) => {
      const r = await fetch(`${base}${p}`, {
        method,
        headers: { 'x-jello-token': token, Cookie: cookie, ...(auth ? { Authorization: auth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      return r.json();
    };
    await call('/register/dev', 'POST');
    const daily = await call('/everyday/recommend', 'POST', { pagesize: 30, page: 1 });
    let url = null;
    for (const song of (daily?.data?.song_list || [])) {
      const u = await call(`/song/url?hash=${song.hash}&quality=flac`);
      const c = Array.isArray(u?.url) ? u.url[0] : u?.url;
      if (c && u?.extName === 'flac') { url = c; break; }
    }
    if (!url) { console.log('NO FLAC SAMPLE'); app.exit(2); return; }

    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    const stream = parseFlacStream(buf);
    const first = findFirstFlacFrame(buf);
    console.log(`bytes=${buf.length} descStart=${stream.descriptionStart} descEnd=${stream.descriptionEnd} firstFrame=${first.offset} blocksize=${first.header.blocksize} rate=${first.header.sampleRate}`);

    // 真实帧边界（端口解析器）
    const frames = [];
    let off = first.offset;
    let prev = first.offset;
    for (let i = 0; i < 60; i += 1) {
      const next = findNextFlacFrameOffset(buf, off + 1, stream.streaminfo);
      if (next < 0) break;
      frames.push(buf.slice(off, next));
      prev = next;
      off = next;
    }
    console.log(`frames extracted: ${frames.length}, avg ${Math.round((prev - first.offset) / Math.max(1, frames.length))}B`);

    // STREAMINFO 块边界（'fLaC' 后第一个块）
    let p = stream.descriptionStart + 4;
    const siLen = (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
    const siBlockEnd = p + 4 + siLen;               // 含块头
    const siDataStart = p + 4;                      // 34 字节数据起点

    const framesB64 = Array.from(frames, (f) => Buffer.from(f).toString('base64'));
    const descA = Buffer.from(buf.slice(stream.descriptionStart, stream.descriptionEnd)).toString('base64');
    const descB = Buffer.from(buf.slice(stream.descriptionStart, siBlockEnd)).toString('base64');
    const descC = Buffer.from(buf.slice(siDataStart, siBlockEnd)).toString('base64');

    const tmp = path.join(os.tmpdir(), 'jello-flac-ab.html');
    fs.writeFileSync(tmp, '<html><body>ab</body></html>');
    const win = new BrowserWindow({ show: false });
    await win.loadFile(tmp);
    const result = await win.webContents.executeJavaScript(`(async () => {
      const frames = ${JSON.stringify(framesB64)};
      const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const decode = async (descriptionB64) => {
        const description = bytes(descriptionB64);
        let outputs = 0; let error = null;
        const decoder = new AudioDecoder({
          output: () => { outputs += 1; },
          error: (e) => { error = e?.message || String(e); }
        });
        decoder.configure({ codec: 'fLaC', sampleRate: 44100, numberOfChannels: 2, description });
        try {
          for (let i = 0; i < frames.length; i += 1) {
            if (error) break;
            decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: i * 100, data: bytes(frames[i]) }));
          }
          await decoder.flush();
        } catch (e) { error = 'throw:' + (e?.message || e); }
        try { decoder.close(); } catch {}
        return { outputs, error };
      };
      return {
        A_fullMetadata: await decode(${JSON.stringify(descA)}),
        B_flacPlusStreaminfo: await decode(${JSON.stringify(descB)}),
        C_streaminfoDataOnly: await decode(${JSON.stringify(descC)})
      };
    })()`, true);
    console.log(JSON.stringify(result, null, 1));
    fs.rmSync(tmp, { force: true });
  } finally {
    child.kill();
  }
  app.exit(0);
}).catch((e) => { console.error('inspect error:', e); app.exit(1); });
