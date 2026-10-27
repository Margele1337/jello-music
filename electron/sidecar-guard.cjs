// 通过 --require 在侧车入口前加载：给 Express 的 HTTP server 包一层 token 校验，
// 避免本机其它进程直接访问随机回环端口上的无鉴权 API。
const http = require('node:http');

const token = process.env.JELLO_SIDECAR_TOKEN;

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
      return listener.call(this, req, res);
    };

    return originalCreateServer.apply(this, args);
  };
}
