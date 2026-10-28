import { screen } from 'electron';

const DOCK_VISIBLE = 40;
const RESTORE_MARGIN = 20;
const ANIMATION_MS = 260;
const TOGGLE_THROTTLE_MS = 120;

let getWindow = () => null;
let docked = false;
let animationTimer = null;
let lastToggleAt = 0;

export const initDockController = (getter) => {
  getWindow = getter;
};

export const isMainWindowDocked = () => docked;

const cancelAnimation = () => {
  if (animationTimer) clearInterval(animationTimer);
  animationTimer = null;
  // 动画被打断时恢复窗口可拖动/可调整大小
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.setMovable(true);
    win.setResizable(true);
  }
};

const emitDockState = (value) => {
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('window:dock-changed', value);
};

const animateTo = (win, targetX, targetY, onDone) => {
  cancelAnimation();
  const start = win.getBounds();
  const startedAt = Date.now();
  const fromX = start.x;
  const fromY = start.y;
  const width = start.width;
  const height = start.height;

  animationTimer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      cancelAnimation();
      return;
    }
    const progress = Math.min(1, (Date.now() - startedAt) / ANIMATION_MS);
    const eased = 1 - Math.pow(1 - progress, 3);
    win.setBounds({
      x: Math.round(fromX + (targetX - fromX) * eased),
      y: Math.round(fromY + (targetY - fromY) * eased),
      width,
      height
    });
    if (progress >= 1) {
      cancelAnimation();
      onDone?.();
    }
  }, 16);
};

const areaFor = (win) => screen.getDisplayMatching(win.getBounds()).workArea;

export const dockMainWindow = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) return false;

  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  if (win.isMaximized()) win.unmaximize();
  cancelAnimation();

  const area = areaFor(win);
  const bounds = win.getBounds();
  const targetX = area.x + area.width - DOCK_VISIBLE;
  const targetY = Math.max(area.y, area.y + Math.round((area.height - bounds.height) / 2));

  docked = true;
  emitDockState(true);
  win.setMovable(false);
  win.setResizable(false);
  animateTo(win, targetX, targetY);
  return true;
};

export const restoreMainWindow = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) return false;

  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  cancelAnimation();

  const area = areaFor(win);
  const bounds = win.getBounds();
  const targetX = Math.max(area.x, area.x + area.width - bounds.width - RESTORE_MARGIN);
  const targetY = Math.max(area.y, area.y + Math.round((area.height - bounds.height) / 2));

  docked = false;
  emitDockState(false);
  win.setMovable(false);
  win.setResizable(false);
  animateTo(win, targetX, targetY, () => {
    const current = getWindow();
    if (!current || current.isDestroyed()) return;
    current.setMovable(true);
    current.setResizable(true);
  });
  return true;
};

export const toggleMainWindowDock = () => {
  const now = Date.now();
  if (now - lastToggleAt < TOGGLE_THROTTLE_MS) return false;
  lastToggleAt = now;
  return docked ? restoreMainWindow() : dockMainWindow();
};

export const stopDockAnimation = () => {
  cancelAnimation();
};

export const resetDockState = () => {
  cancelAnimation();
  docked = false;
};
