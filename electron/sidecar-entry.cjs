'use strict';

// 侧车子进程入口。加载顺序：token 守卫 → 每日推荐分页注入（require 层内存
// 包装，不改子模块磁盘文件）→ Apache-2.0/MIT 上游 app.js。
// 两个路径由主进程通过环境变量传入，避免把 token 放进命令行参数。

const Module = require('node:module');
const path = require('node:path');

// ===== 每日推荐分页透传（纯逻辑，可在测试中直接 require 本文件复用） =====
//
// 上游 /everyday/recommend 模块（api/module/everyday_recommend.js）把请求体
// 钉死为 { platform }，丢弃渲染进程传入的 pagesize/page，导致普通账号每日
// 推荐永远只有一页 30 首。旧方案在 postinstall 用整文件覆盖改写子模块，
// 会让子模块工作树长期变脏（git submodule update 冲突/吞补丁）；这里改为
// require 层注入：钩住 Module._load，仅命中该模块时包一层——调用原模块，
// 但喂给它一个「把分页参数并入上游最终请求体」的 useAxios。
//
// 与整文件覆盖相比：
// - 子模块文件与 git 状态保持干净，npm install 不再写第三方源码；
// - 上游若改版（换 URL/加密方式），包装不覆盖任何上游字段，天然跟随；
// - 上游若自行转发分页参数，合并只在缺键时补，幂等；
// - 上游若换文件名导致钩子不命中，行为退回上游原样（每日推荐 30 首），
//   与未打补丁一致，绝不影响 sidecar 启动。
const PAGING_KEYS = ['pagesize', 'page'];

const pickPagingParams = (params) => {
  const picked = {};
  for (const key of PAGING_KEYS) {
    const value = params == null ? undefined : params[key];
    if (value === undefined || value === null || value === '') continue;
    const num = Number(value);
    picked[key] = Number.isFinite(num) ? num : value;
  }
  return Object.keys(picked).length ? picked : null;
};

const wrapEverydayRecommend = (original) => (params, useAxios) => {
  const extra = pickPagingParams(params);
  if (!extra) return original(params, useAxios);
  return original(params, (config) => {
    const merged = { ...(config?.params || {}) };
    for (const key of PAGING_KEYS) {
      if (merged[key] === undefined && extra[key] !== undefined) merged[key] = extra[key];
    }
    return useAxios({ ...config, params: merged });
  });
};

// 拦截 require：仅命中 <api 目录>/module/everyday_recommend.js 时返回包装版。
// Module._resolveFilename 是非公开 API，异常时按未命中处理（分页退回上游原样）。
const installEverydayPagingHook = (entryPath) => {
  const target = path.join(path.dirname(path.resolve(entryPath)), 'module', 'everyday_recommend.js');
  const originals = new WeakMap();
  const load = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    try {
      if (Module._resolveFilename(request, parent, isMain) === target) {
        const original = load.call(this, request, parent, isMain);
        let wrapped = originals.get(original);
        if (!wrapped) {
          wrapped = wrapEverydayRecommend(original);
          originals.set(original, wrapped);
        }
        return wrapped;
      }
    } catch {
      /* 解析失败按未命中处理 */
    }
    return load.call(this, request, parent, isMain);
  };
};

const startSidecarProcess = () => {
  if (process.env.JELLO_SIDECAR_GUARD) {
    require(process.env.JELLO_SIDECAR_GUARD);
  }

  if (!process.env.JELLO_SIDECAR_ENTRY) {
    throw new Error('JELLO_SIDECAR_ENTRY is not set');
  }

  installEverydayPagingHook(process.env.JELLO_SIDECAR_ENTRY);
  require(process.env.JELLO_SIDECAR_ENTRY);
};

// 测试通过 require 本文件拿到纯逻辑；作为主进程 spawn 的入口脚本时才启动侧车
module.exports = { PAGING_KEYS, installEverydayPagingHook, pickPagingParams, wrapEverydayRecommend };

if (require.main === module) startSidecarProcess();
