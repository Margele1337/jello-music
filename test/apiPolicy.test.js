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
});

test('rejects absolute, traversal, and unknown paths', () => {
  assert.throws(() => sanitizeApiRequest({ path: 'https://evil.example/' }));
  assert.throws(() => sanitizeApiRequest({ path: '/login/../user/detail' }));
  assert.throws(() => sanitizeApiRequest({ path: '/admin/secret' }));
  assert.throws(() => sanitizeApiRequest({ method: 'DELETE', path: '/user/detail' }));
  assert.throws(() => sanitizeApiRequest(null));
});

test('removes auth fields from login and user responses', () => {
  const loginBody = { status: 1, data: { nickname: 'demo', token: 'secret', userid: 1 } };
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
