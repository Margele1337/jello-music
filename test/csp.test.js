import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MEDIA_CDN_SUFFIXES,
  isHostInSuffixList,
  buildCsp,
  auditCspTarget
} from '../shared/csp.js';

const connectSrcOf = (policy) => {
  const part = policy.split(';').find((directive) => directive.trim().startsWith('connect-src'));
  return part ? part.trim().replace(/^connect-src\s*/, '') : '';
};

test('buildCsp keeps document directives stable and media-src broad for now', () => {
  const policy = buildCsp({ dev: false });
  assert.match(policy, /^default-src 'self';/);
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /style-src 'self' 'unsafe-inline'/);
  assert.match(policy, /img-src 'self' data: https:/);
  assert.match(policy, /media-src 'self' https: http: blob:/);
});

test('prod connect-src uses the suffix allowlist instead of a wide https:', () => {
  const connect = connectSrcOf(buildCsp({ dev: false }));
  // 宽放行 token 是独立的 "https:"（后面直接跟分隔符），带路径的 https://* 不能误伤
  assert.doesNotMatch(connect, /(^|\s)https?:(\s|$)/);
  for (const suffix of MEDIA_CDN_SUFFIXES) {
    assert.ok(connect.includes(`https://*.${suffix}`), `missing https://*.${suffix}`);
    assert.ok(connect.includes(`https://${suffix}`), `missing https://${suffix}`);
    assert.ok(connect.includes(`http://*.${suffix}`), `missing http://*.${suffix}`);
  }
});

test('dev-only Vite HMR origins never ship in the built policy', () => {
  const prod = buildCsp({ dev: false });
  assert.ok(!prod.includes('5173'), 'prod policy must not mention the dev server port');
  const dev = buildCsp({ dev: true });
  assert.match(dev, /ws:\/\/127\.0\.0\.1:5173/);
  assert.match(dev, /http:\/\/127\.0\.0\.1:5173/);
});

test('suffix match accepts real CDN hosts and the bare suffix', () => {
  assert.equal(isHostInSuffixList('imge.kugou.com'), true);
  assert.equal(isHostInSuffixList('loud.kgimg.com'), true);
  assert.equal(isHostInSuffixList('a.b.kgimg.com'), true);
  assert.equal(isHostInSuffixList('kugou.com'), true);
});

test('suffix match rejects string-endswith traps, IPs, ports and bare names', () => {
  assert.equal(isHostInSuffixList('notkugou.com'), false);
  assert.equal(isHostInSuffixList('kugou.com.evil.com'), false);
  assert.equal(isHostInSuffixList('evil-kugou.com'), false);
  assert.equal(isHostInSuffixList('example.com'), false);
  assert.equal(isHostInSuffixList('127.0.0.1'), false);
  assert.equal(isHostInSuffixList('localhost'), false);
  assert.equal(isHostInSuffixList(''), false);
  // 端口剥离后仍按主机名判定
  assert.equal(isHostInSuffixList('imge.kugou.com:8080'), true);
});

test('auditCspTarget flags only unlisted hosts and reports the host name', () => {
  const warnings = [];
  const logger = { warn: (message) => warnings.push(message) };
  assert.equal(auditCspTarget('https://imge.kugou.com/a.jpg', '媒体播放', logger), false);
  assert.equal(warnings.length, 0);
  assert.equal(auditCspTarget('https://cdn.example.org/song.flac', '自解码 fetch', logger), true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[csp-audit\]/);
  assert.match(warnings[0], /cdn\.example\.org/);
  // 非法 URL 静默跳过，不产生噪音
  assert.equal(auditCspTarget('not a url', '媒体播放', logger), false);
  assert.equal(warnings.length, 1);
});
