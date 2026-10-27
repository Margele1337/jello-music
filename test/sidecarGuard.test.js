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
