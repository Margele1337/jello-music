import { spawn } from 'node:child_process';
import { app } from 'electron';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const resolveApiDir = () => (
  app.isPackaged
    ? path.join(process.resourcesPath, 'api')
    : path.join(__dirname, '..', '..', 'api')
);

let child = null;
let baseUrl = '';
let starting = null;

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const waitForPort = (port, timeoutMs = 20000) => new Promise((resolve, reject) => {
  const deadline = Date.now() + timeoutMs;
  const tryConnect = () => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve();
    });
    socket.once('error', () => {
      socket.destroy();
      if (Date.now() > deadline) {
        reject(new Error('sidecar start timed out'));
      } else {
        setTimeout(tryConnect, 250);
      }
    });
  };
  tryConnect();
});

export const startSidecar = async ({ platform = 'lite' } = {}) => {
  if (baseUrl) return baseUrl;
  if (starting) return starting;

  starting = (async () => {
    const port = await getFreePort();
    const apiDir = resolveApiDir();
    const entry = path.join(apiDir, 'app.js');
    const args = [entry, `--port=${port}`, `--platform=${platform}`];

    child = spawn(process.execPath, args, {
      cwd: apiDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        HOST: '127.0.0.1'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', () => {});
    child.stderr.on('data', (data) => {
      const text = String(data).trim();
      if (text) console.error('[sidecar]', text.slice(0, 500));
    });
    child.once('exit', () => {
      child = null;
      baseUrl = '';
    });

    await waitForPort(port);
    baseUrl = `http://127.0.0.1:${port}`;
    return baseUrl;
  })().finally(() => {
    starting = null;
  });

  return starting;
};

export const getSidecarBaseUrl = () => baseUrl;

export const waitForSidecar = async (timeoutMs = 10000) => {
  if (baseUrl) return baseUrl;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (baseUrl) return baseUrl;
    if (starting) {
      try {
        return await starting;
      } catch {
        return '';
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return baseUrl;
};

export const stopSidecar = async () => {
  if (starting) {
    try {
      await starting;
    } catch {
      /* starting already failed */
    }
  }

  const current = child;
  child = null;
  baseUrl = '';
  if (!current || current.killed) return;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    current.once('exit', finish);
    current.kill();
    setTimeout(finish, 3000);
  });
};

export const restartSidecar = async (options) => {
  await stopSidecar();
  return startSidecar(options);
};
