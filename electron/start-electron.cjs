// Wrapper: 在启动 Electron 前从 OS 环境中删除 ELECTRON_RUN_AS_NODE
// cross-env 只能设为空字符串，无法真正删除变量，导致 Electron C++ 层误判
// 另外负责在 dev 退出（Ctrl+C / 被杀）时结束 Electron 进程树，避免窗口和进程残留
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');

// 从 process.env 中删除该变量
delete process.env.ELECTRON_RUN_AS_NODE;

const electronPath = (() => {
    const distDir = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
    switch (process.platform) {
        case 'darwin':
            return path.join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
        case 'win32':
            return path.join(distDir, 'electron.exe');
        default:
            return path.join(distDir, 'electron');
    }
})();
const args = ['.'];

// dev 模式下 Vite 与 API 由 npm run dev 并行启动，Electron 若抢跑会：
//  - Vite 未就绪 → 窗口加载空白页
//  - API 未绑定 6521 → 主进程探测失败后自起隐藏侧车，与 run-p 的 api 实例
//    撞端口（后者 EADDRINUSE 退出，run-p --race 会把整套 dev 全部杀掉）
// 因此 dev 下 spawn Electron 前先等它们就绪；超时则放行并提示
// （单独跑 electron:serve 时没有并行的 vite/api，等待超时后照常启动）
const waitForHttpOk = (url, timeoutMs, label) => new Promise((resolve) => {
    const startedAt = Date.now();
    const tryOnce = () => {
        const req = http.get(url, (res) => {
            res.resume();
            resolve(true);
        });
        const retry = () => {
            req.removeAllListeners();
            req.destroy();
            if (Date.now() - startedAt >= timeoutMs) {
                console.log(`[dev] 等待 ${label} 就绪超时（${timeoutMs}ms），继续启动 Electron`);
                resolve(false);
                return;
            }
            setTimeout(tryOnce, 300);
        };
        req.on('error', retry);
        req.setTimeout(1500, retry);
    };
    tryOnce();
});

const spawnElectron = () => {
    const child = spawn(electronPath, args, {
        stdio: 'inherit',
        env: process.env, // 继承清理后的环境
        shell: false,
    });

    let childExited = false;

    const killChildTree = () => {
        if (childExited || !child.pid) return;
        childExited = true;
        try {
            if (process.platform === 'win32') {
                execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
            } else {
                child.kill('SIGTERM');
            }
        } catch (error) {
            /* 进程可能已退出，忽略 */
        }
    };

    // Ctrl+C / 被 npm-run-all 等杀死时，一并结束 Electron（含所有窗口）
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.on(signal, () => {
            killChildTree();
            process.exit(0);
        });
    }
    process.on('exit', killChildTree);

    child.on('exit', (code) => {
        childExited = true;
        process.exit(code || 0);
    });
};

if (process.env.NODE_ENV === 'development') {
    (async () => {
        // Vite 是 dev UI 的硬依赖，多等一会；API 等不到也没关系（主进程会自起隐藏侧车）
        await waitForHttpOk('http://127.0.0.1:8080', 45000, 'Vite (8080)');
        await waitForHttpOk('http://127.0.0.1:6521/register/dev', 8000, 'API (6521)');
        spawnElectron();
    })();
} else {
    spawnElectron();
}
