import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeApiBaseUrl, normalizeProxyUrl, sanitizeSettings } from '../shared/settings.js';
import {
  apiBaseRejectedMessage,
  checkApiBaseInput,
  checkProxyInput,
  inputRejectedBySanitizer,
  proxyRejectedMessage
} from '../src/components/settings/addressChecks.js';

test('normalized-but-valid input is never reported as rejected', () => {
  // 省略协议、补尾斜杠这类「善意归一化」不能被当成保存失败
  assert.equal(inputRejectedBySanitizer('127.0.0.1:7890', 'http://127.0.0.1:7890', normalizeProxyUrl), false);
  assert.equal(inputRejectedBySanitizer('http://127.0.0.1:7890/admin', 'http://127.0.0.1:7890', normalizeProxyUrl), false);
  assert.equal(inputRejectedBySanitizer('https://rpc.example.com/', 'https://rpc.example.com', normalizeApiBaseUrl), false);
  assert.equal(inputRejectedBySanitizer('SOCKS5://10.0.0.1:1080', 'socks5://10.0.0.1:1080', normalizeProxyUrl), false);
});

test('silently dropped input is detected', () => {
  assert.equal(inputRejectedBySanitizer('ftp://127.0.0.1:21', '', normalizeProxyUrl), true);
  assert.equal(inputRejectedBySanitizer('ftp://127.0.0.1:21', 'http://old:8080', normalizeProxyUrl), true);
  assert.equal(inputRejectedBySanitizer('socks5://127.0.0.1', '', normalizeProxyUrl), true);
  assert.equal(inputRejectedBySanitizer('http://192.168.1.20:6521', '', normalizeApiBaseUrl), true);
  assert.equal(inputRejectedBySanitizer('http://rpc.example.com', 'https://good.example', normalizeApiBaseUrl), true);
});

test('clearing the address field is a legal operation', () => {
  assert.equal(inputRejectedBySanitizer('', 'http://127.0.0.1:7890', normalizeProxyUrl), false);
  assert.equal(inputRejectedBySanitizer('   ', '', normalizeApiBaseUrl), false);
  assert.equal(inputRejectedBySanitizer(null, '', normalizeProxyUrl), false);
});

test('the rejection verdict matches what sanitizeSettings actually stores', () => {
  const cases = [
    ['127.0.0.1:7890', normalizeProxyUrl],
    ['ftp://127.0.0.1:21', normalizeProxyUrl],
    ['not a url at all', normalizeProxyUrl],
    ['socks5://127.0.0.1', normalizeProxyUrl],
    ['https://rpc.example.com', normalizeApiBaseUrl],
    ['http://10.0.0.9:6521', normalizeApiBaseUrl],
    ['http://user:pass@127.0.0.1:80', normalizeApiBaseUrl]
  ];
  for (const [typed, normalize] of cases) {
    const effective = sanitizeSettings(
      normalize === normalizeProxyUrl ? { proxyUrl: typed } : { apiBaseUrl: typed }
    );
    const stored = normalize === normalizeProxyUrl ? effective.proxyUrl : effective.apiBaseUrl;
    assert.equal(
      inputRejectedBySanitizer(typed, stored, normalize),
      normalize(typed) === '' || normalize(typed) !== stored,
      `${typed} 的判定应与主进程一致`
    );
  }
});

test('proxy rejection messages name the actual mistake', () => {
  assert.match(proxyRejectedMessage('ftp://127.0.0.1:21'), /ftp/);
  assert.match(proxyRejectedMessage('ftp://127.0.0.1:21'), /socks5/);
  assert.match(proxyRejectedMessage('socks5://127.0.0.1'), /端口/);
  assert.match(proxyRejectedMessage('socks5://'), /端口/);
  assert.match(proxyRejectedMessage('not a url at all'), /无法解析/);
  assert.match(proxyRejectedMessage('http://'), /无法解析/);
  // 省略协议 + 省略端口对 http 代理是合法的，不能误报
  assert.equal(inputRejectedBySanitizer('127.0.0.1', 'http://127.0.0.1', normalizeProxyUrl), false);
});

test('api base rejection messages explain the loopback-only rule', () => {
  assert.match(apiBaseRejectedMessage('http://rpc.example.com'), /127\.0\.0\.1/);
  assert.match(apiBaseRejectedMessage('http://rpc.example.com'), /凭据/);
  // 省略协议时 shared 会按 http 解析：远端主机被拒的原因要说清是缺前缀
  assert.match(apiBaseRejectedMessage('rpc.example.com'), /协议前缀/);
  assert.match(apiBaseRejectedMessage('javascript:alert(1)'), /https/);
  assert.match(apiBaseRejectedMessage('http://user:pass@127.0.0.1:80'), /账号密码/);
  assert.notEqual(apiBaseRejectedMessage(''), '');
});

test('every input the sanitizer drops gets a non-empty chinese reason', () => {
  const junk = [
    'ftp://127.0.0.1:21', 'socks5://127.0.0.1', 'not a url at all', 'http://', 'x'.repeat(600)
  ];
  for (const typed of junk) {
    assert.equal(checkProxyInput(typed, ''), proxyRejectedMessage(typed));
    assert.match(checkProxyInput(typed, ''), /[\u4e00-\u9fa5]/);
  }
  for (const typed of ['http://10.0.0.9:6521', 'ftp://127.0.0.1:21', 'garbage url!!']) {
    assert.equal(checkApiBaseInput(typed, ''), apiBaseRejectedMessage(typed));
    assert.match(checkApiBaseInput(typed, ''), /[\u4e00-\u9fa5]/);
  }
});

test('the wrappers stay silent when the address actually saved', () => {
  assert.equal(checkProxyInput('127.0.0.1:7890', 'http://127.0.0.1:7890'), null);
  assert.equal(checkApiBaseInput('http://localhost:6521', 'http://localhost:6521'), null);
  assert.equal(checkProxyInput('', 'http://127.0.0.1:7890'), null);
});
