// Wrapper: 在启动 Electron 前从 OS 环境中删除 ELECTRON_RUN_AS_NODE
// cross-env 只能设为空字符串，无法真正删除变量，导致 Electron C++ 层误判
// 另外负责在 dev 退出（Ctrl+C / 被杀）时结束 Electron 进程树，避免窗口和进程残留
const { spawn, execSync } = require('child_process');
const path = require('path');

// 从 process.env 中删除该变量
delete process.env.ELECTRON_RUN_AS_NODE;

const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const args = ['.'];

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
