// FLAC 自解码失败解剖：用真实会话取一首 flac 歌的字节，离线跑解析器，
// 报告首帧、帧扫描覆盖率、以及第一个解析断点附近的十六进制。
// 用法：npx electron tools/inspect-flac.mjs
import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { randomBytes } from 'node:crypto';

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
    const songs = daily?.data?.song_list || [];
    // 逐个试 flac 档
    let picked = null;
    let bytes = null;
    for (const song of songs) {
      const u = await call(`/song/url?hash=${song.hash}&quality=flac`);
      const url = Array.isArray(u?.url) ? u.url[0] : u?.url;
      if (!url || u?.extName !== 'flac') continue;
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length < 10000) continue;
      picked = { song, url, size: buf.length };
      bytes = buf;
      break;
    }
    if (!bytes) { console.log('NO FLAC SAMPLE in daily recommendations (需要 VIP flac 档)'); app.exit(2); return; }
    console.log(`sample: ${picked.song.songname} ${picked.size} bytes, ext=flac`);

    const { findFirstFlacFrame, findNextFlacFrameOffset, parseFlacFrameHeader }
      = await import('../src/services/audio/mp3Frame.js');
    const first = findFirstFlacFrame(bytes);
    if (!first) { console.log('FAIL: findFirstFlacFrame=null'); }
    else {
      console.log(`first frame @ ${first.offset}, blocksize=${first.header.blocksize} rate=${first.header.sampleRate} ch=${first.header.channels} bps=${first.header.bitsPerSample} descEnd=${first.stream.descriptionEnd}`);
      // 全文件扫帧，看哪里断
      let off = first.offset;
      let count = 0;
      while (true) {
        const next = findNextFlacFrameOffset(bytes, off + 1, first.stream.streaminfo, off);
        if (next < 0) { console.log(`scan ended after ${count} frames at offset ${off} (remaining ${bytes.length - off}B — 末帧或断点)`); break; }
        const h = parseFlacFrameHeader(bytes, next, first.stream.streaminfo);
        if (!h) { console.log(`frame ${count + 1} @ ${next} header null`); break; }
        if (h.blocksize !== first.header.blocksize || h.sampleRate !== first.header.sampleRate) {
          console.log(`frame ${count + 1} @ ${next}: blocksize=${h.blocksize} rate=${h.sampleRate} (drift!)`);
        }
        off = next;
        count += 1;
      }
      console.log(`scanned ${count} frames OK, avg frame bytes ≈ ${count > 0 ? Math.round((off - first.offset) / count) : 0}`);
    }
  } finally {
    child.kill();
  }
  app.exit(0);
}).catch((e) => { console.error('inspect error:', e); app.exit(1); });
