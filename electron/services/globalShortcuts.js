import { globalShortcut } from 'electron';
import { SHORTCUT_ACTIONS, normalizeAccelerator } from '../../shared/settings.js';

// 媒体键（播放/暂停、上一首、下一首、停止）由系统保留语义，不参与自定义：
// 它们没有「组合键」形状，让用户录制容易录出一堆无法注册的假键位。
const FIXED_MEDIA_KEYS = Object.freeze([
  ['MediaPlayPause', 'toggle'],
  ['MediaNextTrack', 'next'],
  ['MediaPreviousTrack', 'previous'],
  ['MediaStop', 'pause']
]);

// action -> 发给渲染层的 player:command（沿用旧版命令名）
const ACTION_COMMANDS = Object.freeze({
  previous: 'previous',
  next: 'next',
  playPause: 'toggle',
  volumeUp: 'volume-up',
  volumeDown: 'volume-down',
  mute: 'toggle-mute',
  like: 'like',
  // 渲染层的播放模式循环命令（顺序列表循环/单曲循环/随机）
  mode: 'toggle-mode'
});

let handlers = null;
// 我们注册成功的热键集合：换键时只摘「这次不再需要」的，绝不 unregisterAll，
// 否则会把固定媒体键与别的模块（koffi 底层钩子）之外的系统状态一起搅乱
let ownedAccelerators = new Set();
let lastStatus = { ok: true, failed: [] };
// 设置页录键时临时挂起：旧键不挂起会抢走用户正在按的组合键并误触发动作
let lastShortcuts = null;
let suspended = false;

const runAction = (action) => {
  if (!handlers) return;
  const command = ACTION_COMMANDS[action];
  if (command) {
    handlers.sendCommand(command);
    return;
  }
  if (action === 'showHide') handlers.toggleMainWindow?.();
  else if (action === 'quitApp') handlers.quitApp?.();
  else if (action === 'desktopLyrics') handlers.toggleDesktopLyrics?.();
  else if (action === 'desktopSpectrum') handlers.toggleSpectrum?.();
};

const tryRegister = (accelerator, action) => {
  // Electron 对畸形 accelerator 是 throw，对「已被别的程序/应用占用」是返回 false，
  // 两种失败都要单独记账：一个键被占不能让剩下 11 个键全部失效
  try {
    if (!globalShortcut.register(accelerator, () => runAction(action))) {
      return { ok: false, reason: 'occupied' };
    }
    ownedAccelerators.add(accelerator);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error).slice(0, 120) };
  }
};

const unregister = (accelerator) => {
  try {
    globalShortcut.unregister(accelerator);
  } catch {
    /* 系统层失败不影响后续注册 */
  }
  ownedAccelerators.delete(accelerator);
};

const registerFixedMediaKeys = () => {
  for (const [accelerator, command] of FIXED_MEDIA_KEYS) {
    if (ownedAccelerators.has(accelerator)) continue;
    try {
      if (globalShortcut.register(accelerator, () => handlers?.sendCommand(command))) {
        ownedAccelerators.add(accelerator);
      }
    } catch {
      /* 媒体键被别的程序占住：静默跳过，自定义键不受影响 */
    }
  }
};

/**
 * 按 settings.shortcuts 全量重挂热键（设置变更时实时生效，不需要重启）。
 * 返回 { ok, failed: [{ action, accelerator, reason }] }，由 IPC 广播给设置页提示用户。
 */
export const applyGlobalShortcuts = (shortcuts) => {
  lastShortcuts = shortcuts && typeof shortcuts === 'object' ? { ...shortcuts } : {};
  // 录键期间挂起：只记账校验结果，不动系统注册，等恢复时统一重挂
  if (suspended) {
    const pendingFailed = [];
    for (const action of SHORTCUT_ACTIONS) {
      const accelerator = normalizeAccelerator(lastShortcuts[action]);
      if (!accelerator) pendingFailed.push({ action, accelerator: String(lastShortcuts[action] ?? ''), reason: 'invalid' });
    }
    lastStatus = { ok: pendingFailed.length === 0, failed: pendingFailed };
    return lastStatus;
  }

  const failed = [];
  const wanted = new Map();

  for (const action of SHORTCUT_ACTIONS) {
    const raw = shortcuts?.[action];
    const accelerator = normalizeAccelerator(raw);
    if (!accelerator) {
      failed.push({ action, accelerator: String(raw ?? ''), reason: 'invalid' });
      continue;
    }
    const owner = wanted.get(accelerator);
    if (owner) {
      failed.push({ action, accelerator, reason: `duplicate:${owner}` });
      continue;
    }
    wanted.set(accelerator, action);
  }

  for (const accelerator of [...ownedAccelerators]) {
    if (!wanted.has(accelerator)) unregister(accelerator);
  }

  for (const [accelerator, action] of wanted) {
    // 同名键先摘后挂： Electron 对「自己已注册的同名键」返回 true 并覆盖回调，
    // 但显式 unregister 能让「换键失败后旧键仍然有效」这条路径更可预期
    unregister(accelerator);
    const result = tryRegister(accelerator, action);
    if (!result.ok) failed.push({ action, accelerator, reason: result.reason });
  }

  registerFixedMediaKeys();

  lastStatus = { ok: failed.length === 0, failed };
  return lastStatus;
};

export const getGlobalShortcutStatus = () => lastStatus;

/**
 * 录键期间挂起/恢复全局热键。挂起时摘掉我们注册的全部键（含固定媒体键），
 * 恢复时按最后一次 settings.shortcuts 重挂并返回最新注册结果。
 */
export const setGlobalShortcutsSuspended = (value) => {
  const next = value === true;
  if (next === suspended) return lastStatus;
  suspended = next;
  if (suspended) {
    for (const accelerator of [...ownedAccelerators]) unregister(accelerator);
    return lastStatus;
  }
  return applyGlobalShortcuts(lastShortcuts || {});
};

export const initGlobalShortcuts = (injectedHandlers) => {
  handlers = injectedHandlers;
};

export const stopGlobalShortcuts = () => {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  ownedAccelerators.clear();
};
