import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authErrorMessage,
  isChineseMobile,
  isLoginSuccess
} from '../src/services/api/auth.js';

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
