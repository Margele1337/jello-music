/**
 * 前台窗口全屏探测（仅 Windows 生效，其它平台恒返回非全屏）。
 * 使用 koffi 调 user32/dwmapi，判定规则：前台窗口不是 Shell/Desktop、可见、
 * 且可见边界覆盖其所在显示器 → 视为全屏。
 */
const POLL_INTERVAL_MS = 500;

const listeners = new Set();
let pollTimer = null;
let lastState = { fullscreen: false, monitor: null };
let win32Api = null;
let win32Loading = null;
let win32Failed = false;

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
  // 注册即生效：下面的 func 签名按名字引用 'MONITORINFO' / 'DWMDWORD'，无需接住返回值
  koffi.struct('MONITORINFO', {
    cbSize: 'uint32',
    rcMonitor: RECT,
    rcWork: RECT,
    dwFlags: 'uint32'
  });
  koffi.struct('DWMDWORD', { value: 'uint32' });

  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  return {
    GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow(void)'),
    GetShellWindow: user32.func('void* __stdcall GetShellWindow(void)'),
    GetDesktopWindow: user32.func('void* __stdcall GetDesktopWindow(void)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void*)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(void*, _Out_ RECT*)'),
    MonitorFromWindow: user32.func('void* __stdcall MonitorFromWindow(void*, uint32)'),
    GetMonitorInfo: user32.func('bool __stdcall GetMonitorInfoW(void*, _Inout_ MONITORINFO*)'),
    GetWindowLongW: user32.func('long __stdcall GetWindowLongW(void*, int)'),
    DwmGetWindowAttributeRect: dwmapi.func('long __stdcall DwmGetWindowAttribute(void*, uint32, _Out_ RECT*, uint32)'),
    DwmGetWindowAttributeDword: dwmapi.func('long __stdcall DwmGetWindowAttribute(void*, uint32, _Out_ DWMDWORD*, uint32)')
  };
};

const WS_MAXIMIZE = 0x01000000;
const GWL_STYLE = -16;
const AUTOHIDE_TASKBAR_TOLERANCE = 4;

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

  const rect = {};
  if (!api.GetWindowRect(hwnd, rect)) {
    return { fullscreen: false, monitor: null };
  }

  try {
    const cloaked = { value: 0 };
    if (api.DwmGetWindowAttributeDword(hwnd, 14, cloaked, 4) === 0 && cloaked.value !== 0) {
      return { fullscreen: false, monitor: null };
    }
  } catch {
    // DWM 不可用：跳过 cloaked 检查
  }

  let bounds = rect;
  const visible = {};
  try {
    if (api.DwmGetWindowAttributeRect(hwnd, 9, visible, 16) === 0) {
      bounds = visible;
    }
  } catch {
    // DWM 不可用（如服务未起）：沿用外框判定
  }

  const monitor = api.MonitorFromWindow(hwnd, 2);
  const info = { cbSize: MONITORINFO_SIZE };
  if (!api.GetMonitorInfo(monitor, info)) {
    return { fullscreen: false, monitor: null };
  }

  const mx = info.rcMonitor.left;
  const my = info.rcMonitor.top;
  const mw = info.rcMonitor.right - info.rcMonitor.left;
  const mh = info.rcMonitor.bottom - info.rcMonitor.top;

  let isFullscreen = bounds.left <= mx + 2 && bounds.top <= my + 2
    && bounds.right >= mx + mw - 2 && bounds.bottom >= my + mh - 2;

  if (isFullscreen) {
    const work = info.rcWork;
    const taskbarHidden = Math.abs(work.left - mx) <= AUTOHIDE_TASKBAR_TOLERANCE
      && Math.abs(work.top - my) <= AUTOHIDE_TASKBAR_TOLERANCE
      && Math.abs(work.right - info.rcMonitor.right) <= AUTOHIDE_TASKBAR_TOLERANCE
      && Math.abs(work.bottom - info.rcMonitor.bottom) <= AUTOHIDE_TASKBAR_TOLERANCE;
    if (taskbarHidden) {
      try {
        const style = api.GetWindowLongW(hwnd, GWL_STYLE);
        if ((style & WS_MAXIMIZE) !== 0) isFullscreen = false;
      } catch {
        // 样式读取失败：保留几何判定
      }
    }
  }

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
    } catch {
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

export const ensureForegroundFullscreenWatcher = () => {
  watchForegroundFullscreen(() => {});
};

export const getForegroundFullscreenState = () => lastState;

export const stopForegroundFullscreenWatcher = () => {
  listeners.clear();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};
