/**
 * 前台窗口全屏探测（仅 Windows 生效，其它平台恒返回非全屏）
 *
 * 旧实现：常驻 spawn 一个 powershell.exe 子进程，每 500ms 输出一行探测结果。
 * 问题：企业策略禁用/精简版系统无 PowerShell 时静默失效；任务管理器长期可见
 * 一个 powershell.exe；进程退出后 3s 重试会循环拉起。
 *
 * 现实现：项目已依赖 koffi（globalKeyService 在用），直接调 user32 API 自查，
 * 不再依赖任何外部进程。判定规则与旧脚本完全一致。
 */
const POLL_INTERVAL_MS = 500;

const listeners = new Set();
let pollTimer = null;
let lastState = { fullscreen: false, monitor: null };
let win32Api = null;      // koffi 绑定的 user32 函数集合
let win32Loading = null;  // 加载中的 Promise（防并发重复 import）
let win32Failed = false;

// MONITORINFO = cbSize(4) + rcMonitor(16) + rcWork(16) + dwFlags(4) = 40 字节
const MONITORINFO_SIZE = 40;

const notify = (state) => {
    lastState = state;
    for (const listener of listeners) {
        try {
            listener(state);
        } catch (error) {
            console.error('[FullscreenWatcher] listener error:', error);
        }
    }
};

const buildWin32Api = (koffi) => {
    const RECT = koffi.struct('RECT', {
        left: 'long', top: 'long', right: 'long', bottom: 'long'
    });
    const MONITORINFO = koffi.struct('MONITORINFO', {
        cbSize: 'uint32',
        rcMonitor: RECT,
        rcWork: RECT,
        dwFlags: 'uint32'
    });

    const user32 = koffi.load('user32.dll');
    return {
        RECT,
        MONITORINFO,
        GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow(void)'),
        GetShellWindow: user32.func('void* __stdcall GetShellWindow(void)'),
        GetDesktopWindow: user32.func('void* __stdcall GetDesktopWindow(void)'),
        IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void*)'),
        GetWindowRect: user32.func('bool __stdcall GetWindowRect(void*, _Out_ RECT*)'),
        MonitorFromWindow: user32.func('void* __stdcall MonitorFromWindow(void*, uint32)'),
        GetMonitorInfo: user32.func('bool __stdcall GetMonitorInfoW(void*, _Inout_ MONITORINFO*)')
    };
};

// 与旧 PowerShell 脚本完全相同的判定：前台窗口不是 Shell/Desktop、可见、
// 且矩形覆盖其所在显示器 → 视为全屏
const probeFullscreen = () => {
    const api = win32Api;
    if (!api) return lastState;

    const hwnd = api.GetForegroundWindow();
    if (hwnd === null
        || api.GetShellWindow() === hwnd
        || api.GetDesktopWindow() === hwnd
        || !api.IsWindowVisible(hwnd)) {
        return { fullscreen: false, monitor: null };
    }

    const rect = new api.RECT();
    if (!api.GetWindowRect(hwnd, rect)) {
        return { fullscreen: false, monitor: null };
    }

    const monitor = api.MonitorFromWindow(hwnd, 2); // MONITOR_DEFAULTTONEAREST
    const info = new api.MONITORINFO();
    info.cbSize = MONITORINFO_SIZE;
    if (!api.GetMonitorInfo(monitor, info)) {
        return { fullscreen: false, monitor: null };
    }

    const mx = info.rcMonitor.left;
    const my = info.rcMonitor.top;
    const mw = info.rcMonitor.right - info.rcMonitor.left;
    const mh = info.rcMonitor.bottom - info.rcMonitor.top;

    const isFullscreen = rect.left <= mx && rect.top <= my
        && rect.right >= mx + mw && rect.bottom >= my + mh;

    return isFullscreen
        ? { fullscreen: true, monitor: { x: mx, y: my, width: mw, height: mh } }
        : { fullscreen: false, monitor: null };
};

const ensureWin32Api = async () => {
    if (win32Api || win32Failed) return !!win32Api;
    if (!win32Loading) {
        win32Loading = import('koffi')
            .then((module) => {
                const koffi = module.default || module;
                win32Api = buildWin32Api(koffi);
            })
            .catch((error) => {
                console.error('[FullscreenWatcher] koffi 加载失败，全屏探测禁用:', error);
                win32Failed = true;
            });
    }
    await win32Loading;
    return !!win32Api;
};

const startPolling = () => {
    if (pollTimer || process.platform !== 'win32') return;

    // koffi 动态导入是异步的：等加载完成后再起轮询
    if (!win32Api) {
        ensureWin32Api().then((ok) => {
            if (ok && listeners.size > 0 && !pollTimer) startPolling();
        });
        return;
    }

    pollTimer = setInterval(() => {
        let next;
        try {
            next = probeFullscreen();
        } catch (error) {
            console.error('[FullscreenWatcher] 探测失败:', error);
            return;
        }
        const changed = next.fullscreen !== lastState.fullscreen
            || JSON.stringify(next.monitor) !== JSON.stringify(lastState.monitor);
        if (changed) notify(next);
    }, POLL_INTERVAL_MS);
};

export const watchForegroundFullscreen = (callback) => {
    listeners.add(callback);
    startPolling();
    callback(lastState);
    return () => listeners.delete(callback);
};

export const stopForegroundFullscreenWatcher = () => {
    listeners.clear();
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
};
