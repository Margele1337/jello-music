import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEDIA_SCHEME,
  buildMediaUrl,
  isMediaHostAllowed,
  validateMediaTarget,
  toHttpsUrl,
  createHttpsUpgradeResolver
} from '../shared/mediaScheme.js';

test('buildMediaUrl percent-encodes the upstream url under the scheme host', () => {
  const wrapped = buildMediaUrl('http://a.b.kugou.com/x?a=1&b=2');
  assert.ok(wrapped.startsWith(`${MEDIA_SCHEME}://media/?u=`));
  const decoded = decodeURIComponent(wrapped.split('?u=')[1]);
  assert.equal(decoded, 'http://a.b.kugou.com/x?a=1&b=2');
  assert.equal(buildMediaUrl(''), '');
  assert.equal(buildMediaUrl(undefined), undefined);
});

test('suffix match accepts real CDN hosts and the bare suffix', () => {
  assert.equal(isMediaHostAllowed('imge.kugou.com'), true);
  assert.equal(isMediaHostAllowed('loud.kgimg.com'), true);
  assert.equal(isMediaHostAllowed('a.b.kgimg.com'), true);
  assert.equal(isMediaHostAllowed('kugou.com'), true);
  // 端口剥离后仍按主机名判定
  assert.equal(isMediaHostAllowed('imge.kugou.com:8080'), true);
});

test('suffix match rejects string-endswith traps, IPs, ports and bare names', () => {
  assert.equal(isMediaHostAllowed('notkugou.com'), false);
  assert.equal(isMediaHostAllowed('kugou.com.evil.com'), false);
  assert.equal(isMediaHostAllowed('evil-kugou.com'), false);
  assert.equal(isMediaHostAllowed('example.com'), false);
  assert.equal(isMediaHostAllowed('127.0.0.1'), false);
  assert.equal(isMediaHostAllowed('localhost'), false);
  assert.equal(isMediaHostAllowed(''), false);
});

test('validateMediaTarget enforces protocol and host allowlist', () => {
  const ok = validateMediaTarget('http://fs.kugou.com/song.mp3');
  assert.equal(ok.host, 'fs.kugou.com');
  assert.throws(() => validateMediaTarget('file:///etc/passwd'), /unsupported media protocol/);
  assert.throws(() => validateMediaTarget('https://evil.com/song.mp3'), /not allowlisted/);
  assert.throws(() => validateMediaTarget('::::'), /invalid media url/);
});

test('toHttpsUrl keeps everything but the protocol', () => {
  const upgraded = toHttpsUrl(new URL('http://h.kugou.com:8080/a?b=1#f'));
  assert.equal(upgraded.protocol, 'https:');
  assert.equal(upgraded.host, 'h.kugou.com:8080');
  assert.equal(upgraded.pathname + upgraded.search + upgraded.hash, '/a?b=1#f');
});

const responder = (statusFor) => async (url, options = {}) => ({
  status: statusFor(String(url), options.method || 'HEAD'),
  arrayBuffer: async () => new ArrayBuffer(0)
});

test('https upgrade resolver upgrades on probe success and caches per host', async () => {
  const calls = [];
  const resolver = createHttpsUpgradeResolver({
    fetchImpl: async (url, options) => {
      calls.push(String(url));
      return responder(() => 200)(url, options);
    }
  });
  const first = await resolver.resolve(new URL('http://h1.kugou.com/a.mp3'));
  assert.equal(first.protocol, 'https:');
  await resolver.resolve(new URL('http://h1.kugou.com/b.mp3'));
  // 同 host 第二次不再探测
  assert.equal(calls.length, 1);
  // https 输入永远原样返回、不探测
  const direct = await resolver.resolve(new URL('https://h2.kugou.com/a.mp3'));
  assert.equal(direct.protocol, 'https:');
  assert.equal(calls.length, 1);
});

test('https upgrade resolver falls back to http on probe failure', async () => {
  const modes = [];
  const resolver = createHttpsUpgradeResolver({
    fetchImpl: async (url, options) => {
      modes.push(options.method);
      return responder(() => 403)(url, options);
    }
  });
  const kept = await resolver.resolve(new URL('http://blocked.kugou.com/a.mp3'));
  assert.equal(kept.protocol, 'http:');
  assert.equal(modes.length, 1, 'definitive status should not retry with GET');
});

test('https upgrade resolver retries with Range GET when HEAD is rejected 405', async () => {
  const methods = [];
  const resolver = createHttpsUpgradeResolver({
    fetchImpl: async (url, options) => {
      methods.push(options.method);
      return responder((_url, method) => (method === 'HEAD' ? 405 : 206))(url, options);
    }
  });
  const upgraded = await resolver.resolve(new URL('http://h3.kugou.com/a.mp3'));
  assert.equal(upgraded.protocol, 'https:');
  assert.deepEqual(methods, ['HEAD', 'GET']);
});

test('https upgrade resolver treats network errors as no-upgrade', async () => {
  const resolver = createHttpsUpgradeResolver({
    fetchImpl: async () => {
      throw new Error('certificate mismatch');
    }
  });
  const kept = await resolver.resolve(new URL('http://youth.kugou.com/a.mp3'));
  assert.equal(kept.protocol, 'http:');
});
