// jello-media 协议冒烟：真实 Electron 运行时里验证白名单拦截与 HTTPS 升级。
// 用法：npx electron tools/smoke-media-proxy.mjs   （退出码 0 = 全部通过）
import { app, BrowserWindow } from 'electron';
import { initMediaProxy } from '../electron/services/mediaProxy.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

app.whenReady().then(async () => {
  initMediaProxy();
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html></html>');

  const run = async (target) => win.webContents.executeJavaScript(
    `fetch(${JSON.stringify(`jello-media://media/?u=${encodeURIComponent(target)}`)})`
      + '.then(r => r.text().then(t => ({ status: r.status, type: r.headers.get("content-type") })))'
      + '.catch(e => ({ error: String(e && e.message || e) }))',
    true
  );

  // 1) 白名单内 https：应 200 且透传 content-type（imge.kugou.com 是真实酷狗图片 CDN）
  const httpsResult = await run('https://imge.kugou.com/stdmusic/400/cover.jpg');
  check('https upstream', httpsResult.status === 200 && /image\//.test(httpsResult.type || ''),
    JSON.stringify(httpsResult));

  // 2) http 输入：主进程应探测升级到 https 后成功（日志可见 [media-proxy] 升级行）
  const httpResult = await run('http://imge.kugou.com/stdmusic/400/cover.jpg');
  check('http upgraded to https', httpResult.status === 200, JSON.stringify(httpResult));

  // 3) 白名单外主机：必须 403
  const evil = await run('https://example.com/cover.jpg');
  check('non-allowlisted host rejected', evil.status === 403, JSON.stringify(evil));

  // 4) file: 等非 http(s) 协议：必须 403
  const fileScheme = await run('file:///C:/Windows/win.ini');
  check('file: scheme rejected', fileScheme.status === 403, JSON.stringify(fileScheme));

  await win.destroy();
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `SMOKE FAILED (${failed})` : 'SMOKE OK');
  app.exit(failed ? 1 : 0);
}).catch((error) => {
  console.error('smoke bootstrap error:', error);
  app.exit(1);
});
