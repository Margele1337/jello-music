// 通过 --require 在侧车入口前加载：给 Express 的 HTTP server 包一层 token 校验，
// 避免本机其它进程直接访问随机回环端口上的无鉴权 API。
const http = require('node:http');

const token = process.env.JELLO_SIDECAR_TOKEN;
// 守卫自带的两个控制路由（都先过 token 校验）：
//   health   —— 复用上轮遗留实例前的兼容性探针，无副作用（不打上游）
//   shutdown —— 让侧车自杀：复来的实例没有 child 句柄，按 PID 强杀可能命中
//               已被系统回收给别的进程的 PID，所以只让侧车自己退出
const HEALTH_PATH = '/__jello-health';
const SHUTDOWN_PATH = '/__jello-shutdown';

if (token) {
  const originalCreateServer = http.createServer;

  http.createServer = function guardedCreateServer(...args) {
    const listenerIndex = args.findIndex((arg) => typeof arg === 'function');
    if (listenerIndex < 0) return originalCreateServer.apply(this, args);

    const listener = args[listenerIndex];
    args[listenerIndex] = function guardedListener(req, res) {
      if (req.headers['x-jello-token'] !== token) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ status: 0, error: 'unauthorized' }));
        return;
      }
      if (req.url === HEALTH_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ status: 1, data: { healthy: true } }));
        return;
      }
      if (req.url === SHUTDOWN_PATH && req.method === 'POST') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ status: 1, data: { stopped: true } }));
        // 响应先落网，再退出：否则主进程拿到的是 ECONNRESET，无法区分「已停」和「没收到」
        setImmediate(() => process.exit(0));
        return;
      }
      return listener.call(this, req, res);
    };

    return originalCreateServer.apply(this, args);
  };
}

module.exports = { HEALTH_PATH, SHUTDOWN_PATH };
