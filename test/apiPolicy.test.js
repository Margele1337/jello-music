import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeApiRequest, sanitizeApiResponse } from '../shared/apiPolicy.js';

test('accepts allowlisted api requests', () => {
  assert.deepEqual(
    sanitizeApiRequest({ method: 'GET', path: '/login/qr/key' }),
    { method: 'GET', path: '/login/qr/key', params: {}, data: undefined }
  );
  assert.equal(
    sanitizeApiRequest({ method: 'post', path: '/user/playlist', data: { pagesize: 30 } }).method,
    'POST'
  );
  assert.equal(sanitizeApiRequest({ path: '/lyric' }).path, '/lyric');
  assert.equal(sanitizeApiRequest({ path: '/youth/day/vip' }).path, '/youth/day/vip');
});

test('does not match allowlisted prefixes by bare string prefix', () => {
  assert.throws(() => sanitizeApiRequest({ path: '/lyricfoo' }));
  assert.throws(() => sanitizeApiRequest({ path: '/searchx' }));
});

test('rejects absolute, traversal, and unknown paths', () => {
  assert.throws(() => sanitizeApiRequest({ path: 'https://evil.example/' }));
  assert.throws(() => sanitizeApiRequest({ path: '/login/../user/detail' }));
  assert.throws(() => sanitizeApiRequest({ path: '/admin/secret' }));
  assert.throws(() => sanitizeApiRequest({ method: 'DELETE', path: '/user/detail' }));
  assert.throws(() => sanitizeApiRequest(null));
});

test('removes auth fields from login and user responses', () => {
  const loginBody = {
    status: 1,
    data: { nickname: 'demo', token: 'secret', secu_params: 'secret2', userid: 1 }
  };
  assert.deepEqual(sanitizeApiResponse('/login/qr/check', loginBody), {
    status: 1,
    data: { nickname: 'demo', userid: 1 }
  });
  assert.deepEqual(sanitizeApiResponse('/user/detail', loginBody), {
    status: 1,
    data: { nickname: 'demo', userid: 1 }
  });
  assert.equal(sanitizeApiResponse('/playlist/track/all', loginBody), loginBody);
});

test('accepts risk-control verification endpoints only', () => {
  assert.deepEqual(
    sanitizeApiRequest({ path: '/get/verify/info', params: { eventid: 'gz_tx_event_x' } }),
    { method: 'GET', path: '/get/verify/info', params: { eventid: 'gz_tx_event_x' }, data: undefined }
  );
  assert.equal(sanitizeApiRequest({ path: '/sidedt' }).path, '/sidedt');
  // 只开放精确路径，前缀不放行其它 /get、/sidedt 变体
  assert.throws(() => sanitizeApiRequest({ path: '/get/other' }));
  assert.throws(() => sanitizeApiRequest({ path: '/sidedtx' }));
  assert.throws(() => sanitizeApiRequest({ path: '/verify/user/info' }));
});

test('passes verification responses through without stripping', () => {
  const verifyBody = { status: 1, data: { v_type: 23, txappid: '2090934891', token: 'keep-me' } };
  assert.equal(sanitizeApiResponse('/get/verify/info', verifyBody), verifyBody);
  const sidedtBody = { status: 1, data: { t: 'keep-me' } };
  assert.equal(sanitizeApiResponse('/sidedt', sidedtBody), sidedtBody);
});
