// 窗口尺寸守卫（窗口尺寸按设计恒为 800x600，min/max 已在窗口上锁死）。
//
// 背景：跨不同缩放比例（scaleFactor）的显示器拖动窗口、或在显示模式/系统缩放
// 变化的瞬间，Windows 的 WM_DPICHANGED 处理链（Chromium issue 40813134、
// electron#31999）可能把无边框透明窗口的尺寸改错。这里做触发无关的双层校验：
//   1) DIP 层：resize/move 事件后 getBounds != 目标尺寸 → 修回；
//   2) 物理层（仅 Windows，koffi 直调 user32）：GetWindowRect 实测物理尺寸应
//      等于 round(目标尺寸 × GetDpiForWindow/96)，偏差超容差 → 修回。
// 校验带 120ms 尾随防抖，避免和 Chromium 在 DPI 过渡期间打架。

const SIZE_TOLERANCE_PX = 2;
const CHECK_DEBOUNCE_MS = 120;
const WATCHDOG_INTERVAL_MS = 1000;

let win32Api = null;
let win32Loading = null;

const loadWin32Api = () => {
  if (win32Api || win32Loading) return win32Loading;
  win32Loading = import('koffi')
    .then((module) => {
      const koffi = module.default || module;
      // 结构体名不能与 fullscreenWatcher 注册的 'RECT' 重复（koffi 注册表进程级共享）
      const RECT = koffi.struct('SigmaGuardRect', {
        left: 'long', top: 'long', right: 'long', bottom: 'long'
      });
      const user32 = koffi.load('user32.dll');
      win32Api = {
        GetWindowRect: user32.func('bool __stdcall GetWindowRect(uintptr_t hwnd, _Out_ SigmaGuardRect*)'),
        GetDpiForWindow: user32.func('uint32 __stdcall GetDpiForWindow(uintptr_t hwnd)')
      };
      return win32Api;
    })
    .catch((error) => {
      console.error('[SigmaGuard] koffi 加载失败，物理层尺寸校验不可用:', error);
      return null;
    });
  return win32Loading;
};

export const installSigmaSizeGuard = (getWindow, expectedWidth, expectedHeight) => {
  const state = { debounceTimer: null, watchdog: null, repairing: false };

  const checkNow = (reason) => {
    const win = getWindow();
    if (!win || win.isDestroyed() || state.repairing) return;
    const bounds = win.getBounds();
    const dipBad = bounds.width !== expectedWidth || bounds.height !== expectedHeight;

    let physicalDetail = '';
    if (win32Api) {
      try {
        const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0);
        const dpi = win32Api.GetDpiForWindow(hwnd);
        if (dpi > 0) {
          const rect = {};
          if (win32Api.GetWindowRect(hwnd, rect)) {
            const scale = dpi / 96;
            const expectW = Math.round(expectedWidth * scale);
            const expectH = Math.round(expectedHeight * scale);
            const physW = rect.right - rect.left;
            const physH = rect.bottom - rect.top;
            if (Math.abs(physW - expectW) > SIZE_TOLERANCE_PX || Math.abs(physH - expectH) > SIZE_TOLERANCE_PX) {
              physicalDetail = ` physical=${physW}x${physH} expected=${expectW}x${expectH} dpi=${dpi}`;
            }
          }
        }
      } catch (error) {
        console.error('[SigmaGuard] 物理尺寸读取失败:', error);
      }
    }

    if (!dipBad && !physicalDetail) return;
    state.repairing = true;
    console.warn(`[SigmaGuard] 窗口尺寸漂移(${reason}) dip=${bounds.width}x${bounds.height}${physicalDetail} -> 重申 ${expectedWidth}x${expectedHeight}`);
    try {
      win.setBounds({ x: bounds.x, y: bounds.y, width: expectedWidth, height: expectedHeight });
    } finally {
      state.repairing = false;
    }
  };

  const scheduleCheck = (reason) => {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      checkNow(reason);
    }, CHECK_DEBOUNCE_MS);
  };

  const onResize = () => scheduleCheck('resize');
  const onMove = () => scheduleCheck('move');

  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.on('resize', onResize);
    win.on('move', onMove);
  }
  if (process.platform === 'win32') {
    loadWin32Api();
    state.watchdog = setInterval(() => checkNow('watchdog'), WATCHDOG_INTERVAL_MS);
  }

  return () => {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    if (state.watchdog) {
      clearInterval(state.watchdog);
      state.watchdog = null;
    }
    const target = getWindow();
    if (target && !target.isDestroyed()) {
      target.removeListener('resize', onResize);
      target.removeListener('move', onMove);
    }
  };
};
