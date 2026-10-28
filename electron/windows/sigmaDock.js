import { screen } from 'electron';
import { getForegroundFullscreenState } from '../services/fullscreenWatcher.js';
import { IPC } from '../../shared/ipc.js';

// 右侧收起/呼出：1:1 移植旧版 sigmaWindow.js 的行为。
const DOCK_VISIBLE = 40;   // 收起后保留可见宽度（原版 var8 = parentWidth - 40）
const RESTORE_MARGIN = 20; // 滑出后距右缘间距（原版 var11 = parentWidth - 20 - width）

// 窗口尺寸按设计恒定：动画/吸附一律用常量而不是 getBounds 实测值，
// 跨缩放显示器拖动时 WM_DPICHANGED 可能瞬时改坏尺寸，回写会把漂移固化
const WINDOW_WIDTH = 800;
const WINDOW_HEIGHT = 600;

// 缓动动画（复刻原版 updatePanelDimensions：var7 = dt / 18.1ms，每帧 x 0.25 × var7、y 0.2 × var7）
// 首选渲染进程 rAF 驱动（与显示器垂直同步）；窗口离屏导致 rAF 降频/停发时，
// 主进程 150ms 收不到帧就接管，用同一套公式从最后一帧坐标继续推进
const ANIM_GAME_FRAME_MS = 18.10361;
const ANIM_TICK_MS = 4;
const ANIM_MAX_DT = 40;
const ANIM_RENDERER_TIMEOUT = 150;
const ANIM_STUCK_MS = 3000;

const TOGGLE_THROTTLE_MS = 120;

let getWindow = () => null;
let docked = false;
let animating = false;
let animationTimer = null;
let animationWatchdog = null;
let animationStartedAt = 0;
let animationMode = null; // 'renderer' | 'main'
let lastFrameAt = 0;
let lastX = 0;
let lastY = 0;
let targetX = 0;
let targetY = 0;
let lastToggleAt = 0;
let raiseTimer = null;

export const initDockController = (getter) => {
  getWindow = getter;
};

export const isMainWindowDocked = () => docked;

const emitDockState = (value) => {
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send(IPC.WINDOW_DOCK_CHANGED, value);
};

const cancelAnimation = () => {
  if (animationTimer) {
    clearTimeout(animationTimer);
    animationTimer = null;
  }
  if (animationWatchdog) {
    clearInterval(animationWatchdog);
    animationWatchdog = null;
  }
  animationMode = null;
  animating = false;
};

export const stopDockAnimation = () => cancelAnimation();

export const resetDockState = () => {
  cancelAnimation();
  docked = false;
  if (raiseTimer) {
    clearTimeout(raiseTimer);
    raiseTimer = null;
  }
};

const animationBlocked = () => {
  if (!animating) return false;
  if (Date.now() - animationStartedAt > ANIM_STUCK_MS) {
    cancelAnimation();
    return false;
  }
  return true;
};

const setBoundsAt = (win, x, y) => {
  // 旧版这里重申固定 800x600 防 WM_DPICHANGED 漂移；新版窗口带系统边框
  // （content 800x600），重申常量会把窗口压小，改为重申实测尺寸。
  const bounds = win.getBounds();
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: bounds.width, height: bounds.height });
};

// 主进程接管推进（渲染进程 rAF 不可用时兜底，公式与渲染层完全一致）
const runMainAnimation = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) {
    cancelAnimation();
    return;
  }
  animationMode = 'main';
  win.webContents.send(IPC.WINDOW_ANIMATE_STOP);

  let currentX = lastX;
  let currentY = lastY;
  let lastTime = Date.now();

  const step = () => {
    animationTimer = null;
    const current = getWindow();
    if (!current || current.isDestroyed()) {
      cancelAnimation();
      return;
    }

    const now = Date.now();
    const dt = Math.min(ANIM_MAX_DT, Math.max(1, now - lastTime));
    lastTime = now;
    const frameFactor = dt / ANIM_GAME_FRAME_MS;

    currentX = targetX > currentX
      ? Math.min(currentX + (targetX - currentX) * 0.25 * frameFactor, targetX)
      : Math.max(currentX + (targetX - currentX) * 0.25 * frameFactor, targetX);
    currentY = targetY > currentY
      ? Math.min(currentY + (targetY - currentY) * 0.2 * frameFactor, targetY)
      : Math.max(currentY + (targetY - currentY) * 0.2 * frameFactor, targetY);

    lastX = currentX;
    lastY = currentY;

    if (Math.abs(targetX - currentX) < 0.5 && Math.abs(targetY - currentY) < 0.5) {
      setBoundsAt(current, targetX, targetY);
      cancelAnimation();
      return;
    }

    setBoundsAt(current, currentX, currentY);
    animationTimer = setTimeout(step, ANIM_TICK_MS);
  };
  step();
};

const startAnimation = (win, toX, toY) => {
  const start = win.getBounds();
  if (Math.abs(start.x - toX) < 1 && Math.abs(start.y - toY) < 1) {
    // 必须先停掉在跑的动画：否则旧动画会继续往它自己的目标推进，
    // 面板就与目标位各走各的（连按时表现为"分散开"）
    cancelAnimation();
    return;
  }

  cancelAnimation();
  animating = true;
  animationStartedAt = Date.now();
  animationMode = 'renderer';
  targetX = toX;
  targetY = toY;
  lastX = start.x;
  lastY = start.y;
  lastFrameAt = Date.now();

  win.webContents.send(IPC.WINDOW_ANIMATE_TO, {
    x: Math.round(toX),
    y: Math.round(toY),
    fromX: start.x,
    fromY: start.y
  });

  animationWatchdog = setInterval(() => {
    if (!animating || animationMode !== 'renderer') return;
    if (Date.now() - lastFrameAt > ANIM_RENDERER_TIMEOUT) runMainAnimation();
  }, 50);
};

// 渲染进程每帧回传的动画位置（仅渲染进程驱动阶段生效）
export const applyAnimatePosition = (x, y) => {
  const win = getWindow();
  if (!win || win.isDestroyed() || !animating || animationMode !== 'renderer') return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  lastFrameAt = Date.now();
  lastX = x;
  lastY = y;
  setBoundsAt(win, x, y);
};

// 渲染进程动画结束（主进程接管后忽略，避免误取消）
export const finishAnimate = () => {
  if (!animating || animationMode !== 'renderer') return;
  cancelAnimation();
};

const areaFor = (win) => screen.getDisplayMatching(win.getBounds()).workArea;

const centerYFor = (area, height = WINDOW_HEIGHT) => (
  Math.round(area.y + (area.height - height) / 2)
);

// 呼出瞬间置顶 600ms（不常驻）；前台是全屏应用时保持置顶直到全屏退出，
// 否则降回会让面板立刻沉到全屏窗口后面，看起来像「呼出没反应」
export const raiseMainWindow = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true);
  win.show();
  win.moveTop();
  win.focus();
  if (raiseTimer) clearTimeout(raiseTimer);
  const dropWhenSafe = () => {
    raiseTimer = null;
    const current = getWindow();
    if (!current || current.isDestroyed()) return;
    if (getForegroundFullscreenState().fullscreen) {
      raiseTimer = setTimeout(dropWhenSafe, 500);
      return;
    }
    current.setAlwaysOnTop(false);
  };
  raiseTimer = setTimeout(dropWhenSafe, 600);
};

export const dropMainWindowRaise = () => {
  if (raiseTimer) {
    clearTimeout(raiseTimer);
    raiseTimer = null;
  }
  const win = getWindow();
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(false);
};

export const dockMainWindow = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) return false;

  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  if (win.isMaximized()) win.unmaximize();

  const area = areaFor(win);
  const bounds = win.getBounds();
  const right = area.x + area.width;
  const centerY = centerYFor(area, bounds.height);

  // 收起 = 用户明确不再需要面板在前：立即撤掉呼出时的置顶
  if (raiseTimer) {
    clearTimeout(raiseTimer);
    raiseTimer = null;
  }
  win.setAlwaysOnTop(false);

  docked = true;
  emitDockState(true);

  if (Math.abs(bounds.x - (right - DOCK_VISIBLE)) < 1 && Math.abs(bounds.y - centerY) < 1) {
    cancelAnimation();
    return true;
  }
  startAnimation(win, right - DOCK_VISIBLE, centerY);
  return true;
};

export const restoreMainWindow = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) return false;

  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();

  const area = areaFor(win);
  const bounds = win.getBounds();
  const right = area.x + area.width;

  // 不要用「是否越过右边缘」判断是否需要滑出：收起动画进行中面板可能还在屏幕
  // 中间，按几何位置判定会误判成「无需滑出」而卡在中间。docked 才是权威标志。
  if (!docked && bounds.x + bounds.width <= right) return false;

  docked = false;
  emitDockState(false);
  // 旧版用常量 800（无边框窗口 bounds=content）；新版窗口带边框，用实测尺寸
  startAnimation(win, right - bounds.width - RESTORE_MARGIN, centerYFor(area, bounds.height));
  return true;
};

export const toggleMainWindowDock = () => {
  const now = Date.now();
  if (now - lastToggleAt < TOGGLE_THROTTLE_MS) return false;
  lastToggleAt = now;
  return docked ? restoreMainWindow() : dockMainWindow();
};
