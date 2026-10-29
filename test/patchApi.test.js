import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  MARKER,
  isPatched,
  patchEverydayRecommend
} = require('../tools/patch-api.cjs');

const SCRIPT = fileURLToPath(new URL('../tools/patch-api.cjs', import.meta.url));

// 上游原版模块的独立夹具（内容与 api/module/everyday_recommend.js 一致）
const UPSTREAM_SOURCE = `module.exports = (params, useAxios) => {
  return useAxios({
    url: '/everyday_song_recommend',
    encryptType: 'android',
    method: 'POST',
    params: { platform: params.platform || 'ios' },
    cookie: params?.cookie || {},
    headers: { 'x-router': 'everydayrec.service.kugou.com' },
  });
};`;

const makeApiDir = (source = UPSTREAM_SOURCE) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jello-patch-api-'));
  fs.mkdirSync(path.join(dir, 'module'), { recursive: true });
  if (source !== null) {
    fs.writeFileSync(path.join(dir, 'module', 'everyday_recommend.js'), source, 'utf8');
  }
  return dir;
};

const targetOf = (dir) => path.join(dir, 'module', 'everyday_recommend.js');
const readTarget = (dir) => fs.readFileSync(targetOf(dir), 'utf8');

test('patch rewrites the module to forward pagesize/page', () => {
  const dir = makeApiDir();
  const result = patchEverydayRecommend(dir);
  assert.equal(result.status, 'patched');
  assert.ok(isPatched(readTarget(dir)));

  // 打补丁后的模块应把 pagesize/page 透传给 useAxios，并保留 platform/cookie 语义
  const patchedModule = require(targetOf(dir));
  const calls = [];
  const useAxios = (config) => { calls.push(config); return 'ok'; };
  patchedModule({ pagesize: '60', page: 2, cookie: { k: 'v' } }, useAxios);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/everyday_song_recommend');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].params, { platform: 'ios', pagesize: 60, page: 2 });
  assert.deepEqual(calls[0].cookie, { k: 'v' });

  // 无分页参数时与上游行为一致（只有 platform）
  patchedModule({ platform: 'android' }, useAxios);
  assert.deepEqual(calls[1].params, { platform: 'android' });

  fs.rmSync(dir, { recursive: true, force: true });
});

test('patch is idempotent and never touches an already-patched file', () => {
  const dir = makeApiDir();
  assert.equal(patchEverydayRecommend(dir).status, 'patched');
  const first = readTarget(dir);

  const second = patchEverydayRecommend(dir);
  assert.equal(second.status, 'already');
  assert.equal(readTarget(dir), first);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('patch no-ops on missing submodule and unrecognized upstream file', () => {
  const missingDir = path.join(os.tmpdir(), `jello-patch-missing-${Date.now()}`);
  assert.equal(patchEverydayRecommend(missingDir).status, 'missing');

  const dir = makeApiDir('module.exports = () => { /* upstream refactor */ };');
  assert.equal(patchEverydayRecommend(dir).status, 'unrecognized');
  assert.equal(readTarget(dir), 'module.exports = () => { /* upstream refactor */ };');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('dry-run reports without writing', () => {
  const dir = makeApiDir();
  const result = patchEverydayRecommend(dir, { dryRun: true });
  assert.equal(result.status, 'dry-run');
  assert.equal(readTarget(dir), UPSTREAM_SOURCE);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI exits 0 for patched, repeated and absent targets (CI-safe)', () => {
  const dir = makeApiDir();
  const run = spawnSync(process.execPath, [SCRIPT, '--api-dir', dir], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.ok(readTarget(dir).includes(MARKER));

  const rerun = spawnSync(process.execPath, [SCRIPT, '--api-dir', dir], { encoding: 'utf8' });
  assert.equal(rerun.status, 0);
  assert.match(rerun.stdout, /跳过/);

  const absent = spawnSync(process.execPath, [SCRIPT, '--api-dir', path.join(dir, 'nope')], { encoding: 'utf8' });
  assert.equal(absent.status, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});
