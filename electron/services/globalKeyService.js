// Windows 右 Shift 全局监听：Electron globalShortcut 无法区分左右 Shift。
// 使用 GetAsyncKeyState 轮询（koffi），不安装低级键盘钩子，避免游戏使用
// Raw Input 时收不到按键。
const POLL_INTERVAL_MS = 30;
const RSHIFT_VK = 0xa1;

let started = false;
let suspended = false;
let onRightShift = null;
let timer = null;
let pressed = false;

const trigger = () => {
  try {
    onRightShift?.();
  } catch (error) {
    console.error('[globalKey] 右 Shift 处理失败:', error);
  }
};

export const setGlobalKeySuspended = (value) => {
  suspended = !!value;
};

export const initGlobalKeyListener = ({ onRightShift: handler } = {}) => {
  if (started) return;
  started = true;
  onRightShift = handler;

  if (process.platform !== 'win32') {
    console.warn('[globalKey] 右 Shift 全局监听当前仅支持 Windows');
    return;
  }

  import('koffi')
    .then((module) => {
      const koffi = module.default || module;
      const user32 = koffi.load('user32.dll');
      const getAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
      const isDown = () => (getAsyncKeyState(RSHIFT_VK) & 0x8000) !== 0;

      pressed = isDown();
      timer = setInterval(() => {
        const down = isDown();
        if (down === pressed) return;
        pressed = down;
        if (down && !suspended) trigger();
      }, POLL_INTERVAL_MS);
      console.log('[globalKey] 右 Shift 全局监听已启用');
    })
    .catch((error) => {
      console.error('[globalKey] 右 Shift 监听启动失败:', error.message);
    });
};

export const stopGlobalKeyListener = () => {
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
  pressed = false;
};
