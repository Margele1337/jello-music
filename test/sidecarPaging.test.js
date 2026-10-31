import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
// 入口脚本只在 require.main === module 时启动侧车，测试 require 无副作用
const {
  PAGING_KEYS,
  installEverydayPagingHook,
  pickPagingParams,
  wrapEverydayRecommend
} = require('../electron/sidecar-entry.cjs');

const upstreamModule = (params, useAxios) => useAxios({
  url: '/everyday_song_recommend',
  encryptType: 'android',
  method: 'POST',
  params: { platform: params?.platform || 'ios' },
  cookie: params?.cookie || {},
  headers: { 'x-router': 'everydayrec.service.kugou.com' }
});

test('pickPagingParams extracts finite paging keys and drops empty ones', () => {
  assert.deepEqual(pickPagingParams({ pagesize: 60, page: 2 }), { pagesize: 60, page: 2 });
  assert.deepEqual(pickPagingParams({ pagesize: '60', page: '2' }), { pagesize: 60, page: 2 });
  assert.deepEqual(pickPagingParams({ pagesize: 'x', page: 3 }), { pagesize: 'x', page: 3 });
  assert.equal(pickPagingParams({ pagesize: '', page: null }), null);
  assert.equal(pickPagingParams({ platform: 'ios' }), null);
  assert.equal(pickPagingParams(undefined), null);
});

test('wrapEverydayRecommend merges paging into the upstream request body without touching other fields', () => {
  let captured = null;
  const wrapped = wrapEverydayRecommend(upstreamModule);
  wrapped({ platform: 'ios', pagesize: 60, page: 2 }, (config) => {
    captured = config;
    return config;
  });

  assert.equal(captured.url, '/everyday_song_recommend');
  assert.equal(captured.encryptType, 'android');
  assert.equal(captured.method, 'POST');
  assert.deepEqual(captured.params, { platform: 'ios', pagesize: 60, page: 2 });
  assert.deepEqual(captured.headers, { 'x-router': 'everydayrec.service.kugou.com' });
});

test('wrapEverydayRecommend is idempotent when upstream already forwards paging', () => {
  const upstreamForwards = (params, useAxios) => useAxios({
    params: { platform: 'ios', pagesize: params?.pagesize, page: params?.page }
  });
  let captured = null;
  wrapEverydayRecommend(upstreamForwards)({ pagesize: 30, page: 1 }, (config) => {
    captured = config;
    return config;
  });
  assert.deepEqual(captured.params, { platform: 'ios', pagesize: 30, page: 1 });
});

test('wrapEverydayRecommend passes through untouched when no paging params are sent', () => {
  const calls = [];
  const wrapped = wrapEverydayRecommend(upstreamModule);
  wrapped({ platform: 'ios' }, (config) => {
    calls.push(config);
    return config;
  });
  assert.deepEqual(calls[0].params, { platform: 'ios' });
  assert.deepEqual(PAGING_KEYS, ['pagesize', 'page']);
});

test('installEverydayPagingHook wraps only the target module at require time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jello-sidecar-paging-'));
  try {
    fs.mkdirSync(path.join(dir, 'module'));
    fs.writeFileSync(
      path.join(dir, 'module', 'everyday_recommend.js'),
      'module.exports = (params, useAxios) => useAxios({ params: { platform: params?.platform || \'ios\' } });'
    );
    fs.writeFileSync(
      path.join(dir, 'module', 'other_module.js'),
      'module.exports = (params, useAxios) => useAxios({ params: { kind: \'other\' } });'
    );

    const previousLoad = Module._load;
    installEverydayPagingHook(path.join(dir, 'app.js'));
    try {
      const target = require(path.join(dir, 'module', 'everyday_recommend.js'));
      const other = require(path.join(dir, 'module', 'other_module.js'));

      let captured = null;
      target({ pagesize: '60', page: '2' }, (config) => {
        captured = config;
        return config;
      });
      assert.deepEqual(captured.params, { platform: 'ios', pagesize: 60, page: 2 });

      let otherCaptured = null;
      other({}, (config) => {
        otherCaptured = config;
        return config;
      });
      assert.deepEqual(otherCaptured.params, { kind: 'other' });

      // 重复 require 拿到同一个包装实例（require 缓存 + WeakMap 稳定身份）
      assert.equal(require(path.join(dir, 'module', 'everyday_recommend.js')), target);
    } finally {
      Module._load = previousLoad;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
