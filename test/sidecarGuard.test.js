import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

process.env.JELLO_SIDECAR_TOKEN = 'test-secret';
const require = createRequire(import.meta.url);
require('../electron/sidecar-guard.cjs');

test('sidecar guard rejects requests without the launch token', async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const denied = await fetch(`http://127.0.0.1:${port}/search?keywords=x`);
    assert.equal(denied.status, 401);

    const allowed = await fetch(`http://127.0.0.1:${port}/search?keywords=x`, {
      headers: { 'x-jello-token': 'test-secret' }
    });
    assert.equal(allowed.status, 200);
    assert.equal(await allowed.text(), 'ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// 自杀路由本身不能测「成功分支」：它会 process.exit 掉测试进程。
// 这里只验证它同样受 token 保护（无 token 必须 401 且服务还活着）。
test('sidecar shutdown route is token-guarded too', async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const denied = await fetch(`http://127.0.0.1:${port}/__jello-shutdown`, { method: 'POST' });
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { status: 0, error: 'unauthorized' });

    const wrongToken = await fetch(`http://127.0.0.1:${port}/__jello-shutdown`, {
      method: 'POST',
      headers: { 'x-jello-token': 'nope' }
    });
    assert.equal(wrongToken.status, 401);

    // 未被授权的请求绝不能把宿主进程带走
    const stillAlive = await fetch(`http://127.0.0.1:${port}/search?keywords=x`, {
      headers: { 'x-jello-token': 'test-secret' }
    });
    assert.equal(stillAlive.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
