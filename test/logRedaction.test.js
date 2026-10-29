import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReleaseNotes, redactLogText } from '../shared/ipc.js';

test('log redaction masks credentials and device identifiers', () => {
  const input = [
    'GET /module/login/captcha_send?mobile=13800001111&code=1234',
    'request token=abcdef0123456789abcdef0123456789 userid=987654321',
    'cookie: dfid=AbcD1234ef&mid=Zm9vYmFy&guid=1234567890abcdef',
    'key=SIGNKEY123 appkey=deadbeef'
  ].join('\n');
  const output = redactLogText(input);

  for (const secret of ['13800001111', 'abcdef0123456789', '987654321', 'AbcD1234ef', 'Zm9vYmFy', '1234567890abcdef', 'SIGNKEY123', '1234']) {
    assert.equal(output.includes(secret), false, `未脱敏：${secret}`);
  }
  // 键名保留，排查时才知道是哪一类字段被打了码
  for (const name of ['mobile', 'token', 'userid', 'dfid', 'mid', 'guid', 'key']) {
    assert.match(output, new RegExp(`${name}=`));
  }
});

test('log redaction leaves non-secret text untouched', () => {
  const input = '[sidecar] listening on 127.0.0.1:6521 platform=lite\n[api] song=晴天 artist=周杰伦';
  assert.equal(redactLogText(input), input);
});

test('log redaction masks proxy credentials in urls', () => {
  const output = redactLogText('using proxy http://jello:sup3rs3cret@10.0.0.1:7890 for request');
  assert.equal(output.includes('sup3rs3cret'), false);
  assert.equal(output.includes('jello:'), false);
});

test('log redaction tolerates empty and non-string input', () => {
  assert.equal(redactLogText(''), '');
  assert.equal(redactLogText(null), '');
  assert.equal(redactLogText(undefined), '');
  assert.equal(redactLogText(42), '42');
});

test('release notes flatten markdown, arrays and objects into plain text', () => {
  assert.equal(formatReleaseNotes('## 1.2.0\n- 修复 **崩溃** 问题'), '1.2.0\n- 修复 崩溃 问题');
  assert.equal(formatReleaseNotes([{ note: '新增代理设置' }, { note: '修复频谱卡顿' }]), '新增代理设置\n\n修复频谱卡顿');
  assert.equal(formatReleaseNotes('See [changelog](https://github.com/x/y)'), 'See changelog');
  assert.equal(formatReleaseNotes({ note: '对象形状' }), '对象形状');
});

test('release notes stay a string and never leak raw structures', () => {
  for (const value of [null, undefined, '', 0, false, [], {}]) {
    assert.equal(typeof formatReleaseNotes(value), 'string');
  }
  assert.equal(formatReleaseNotes(null), '');
  assert.equal(formatReleaseNotes([]), '');
});

test('release notes are length-capped for ipc', () => {
  const long = 'x'.repeat(20000);
  const output = formatReleaseNotes(long);
  assert.equal(output.length <= 4000, true);
  assert.equal(output.endsWith('...'), true);
});
