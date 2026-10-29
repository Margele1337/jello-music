// 登录会话持久化冒烟：模拟「写入 → 重启 → 恢复」链路。
// 用独立临时 userData，绝不触碰真实 session vault。
// 用法：npx electron tools/smoke-session.mjs   （退出码 0 = 通过）
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// 必须 before-ready：让 sessionVault / electron-store 全部落到临时目录
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'jello-session-smoke-')));

const fail = (message) => {
  console.error(`FAIL ${message}`);
  app.exit(1);
};

app.whenReady().then(async () => {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    fail('本机 safeStorage 异步加密不可用（真实环境同样会丢登录态，属平台问题而非代码问题）');
    return;
  }

  const { initAuthSession, storeLoginData, storeSetCookies, flushAuthSession, getProfile, getCookieHeader }
    = await import('../electron/services/authSession.js');
  const { loadSession } = await import('../electron/services/sessionVault.js');

  // 进程 A：初始化（空）→ 写入登录数据 + cookie → 落盘
  await initAuthSession();
  storeLoginData({ token: 'tok123', userid: 'u1', nickname: '冒烟用户', vip_type: 1 });
  storeSetCookies(['dfid=DEVDFID; Path=/', 'KUGOU_API_PLATFORM=lite; Path=/']);
  await flushAuthSession();

  const raw = await loadSession();
  if (!raw?.authHeader) {
    fail('落盘的 session 缺少 authHeader');
    return;
  }

  // 进程 B（同一运行时里模拟重启）：用带查询串的全新模块实例得到干净的
  // 内存状态，从磁盘重新 init 并校验恢复结果
  const authSessionB = await import(`../electron/services/authSession.js?reinit=${Date.now()}`);
  await authSessionB.initAuthSession();

  const profile = authSessionB.getProfile();
  const cookie = authSessionB.getCookieHeader();
  const okProfile = profile?.userid === 'u1';
  const okCookie = cookie.includes('dfid=DEVDFID') && cookie.includes('KUGOU_API_PLATFORM=lite');

  console.log(`${okProfile ? 'PASS' : 'FAIL'} profile 恢复 — ${JSON.stringify(profile)}`);
  console.log(`${okCookie ? 'PASS' : 'FAIL'} cookie 恢复 — ${cookie}`);

  authSessionB.clearAuthSession();
  const wiped = (await loadSession()) === null;
  console.log(`${wiped ? 'PASS' : 'FAIL'} clearAuthSession 清除落盘`);

  const allOk = okProfile && okCookie && wiped;
  console.log(allOk ? 'SMOKE OK' : 'SMOKE FAILED');
  app.exit(allOk ? 0 : 1);
}).catch((error) => {
  console.error('smoke bootstrap error:', error);
  app.exit(1);
});
