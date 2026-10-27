// 侧车子进程入口：先加载 token 守卫，再加载 Apache-2.0/MIT 上游的 app.js。
// 两个路径由主进程通过环境变量传入，避免把 token 放进命令行参数。
if (process.env.JELLO_SIDECAR_GUARD) {
  require(process.env.JELLO_SIDECAR_GUARD);
}

if (!process.env.JELLO_SIDECAR_ENTRY) {
  throw new Error('JELLO_SIDECAR_ENTRY is not set');
}

require(process.env.JELLO_SIDECAR_ENTRY);
