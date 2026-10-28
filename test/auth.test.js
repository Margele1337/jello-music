import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import {
  authErrorMessage,
  isChineseMobile,
  isLoginSuccess
} from '../src/services/api/auth.js';
import { useAuthStore } from '../src/stores/auth.js';

test('validates Chinese mobile numbers', () => {
  assert.equal(isChineseMobile('13800138000'), true);
  assert.equal(isChineseMobile(' 13912345678 '), true);
  assert.equal(isChineseMobile('12800138000'), false);
  assert.equal(isChineseMobile('1380013800'), false);
  assert.equal(isChineseMobile(''), false);
});

test('detects login success only with status and data', () => {
  assert.equal(isLoginSuccess({ status: 1, data: { userid: 1 } }), true);
  assert.equal(isLoginSuccess({ status: 0, data: { userid: 1 } }), false);
  assert.equal(isLoginSuccess({ status: 1 }), false);
});

test('extracts the first friendly auth error', () => {
  assert.equal(authErrorMessage({ error: '验证码错误' }, '登录失败'), '验证码错误');
  assert.equal(authErrorMessage({ data: { msg: '账号异常' } }, '登录失败'), '账号异常');
  assert.equal(authErrorMessage({}, '登录失败'), '登录失败');
  assert.equal(authErrorMessage(null, '登录失败'), '登录失败');
});

test('auth store tracks login expiry for the SigmaView redirect', () => {
  setActivePinia(createPinia());
  const auth = useAuthStore();

  // 游客（未登录）命中 20017 不应触发跳登录页
  auth.markExpired();
  assert.equal(auth.expired, false);

  auth.setProfile({ userid: 1, nickname: 'demo' });
  assert.equal(auth.expired, false);

  auth.markExpired();
  assert.equal(auth.expired, true);

  // 重新登录后失效标记清除
  auth.setProfile({ userid: 2 });
  assert.equal(auth.expired, false);

  auth.markExpired();
  auth.clearExpired();
  assert.equal(auth.expired, false);
});
