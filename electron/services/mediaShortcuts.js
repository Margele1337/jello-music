import { globalShortcut } from 'electron';

// 媒体键（播放/暂停、上一首、下一首、停止）由系统保留语义，固定注册、不参与自定义：
// 它们没有「组合键」形状，让用户录制容易录出一堆无法注册的假键位。
const FIXED_MEDIA_KEYS = Object.freeze([
  ['MediaPlayPause', 'toggle'],
  ['MediaNextTrack', 'next'],
  ['MediaPreviousTrack', 'previous'],
  ['MediaStop', 'pause']
]);

let handlers = null;
const ownedAccelerators = new Set();

export const registerMediaKeys = (injectedHandlers) => {
  handlers = injectedHandlers;
  for (const [accelerator, command] of FIXED_MEDIA_KEYS) {
    if (ownedAccelerators.has(accelerator)) continue;
    try {
      if (globalShortcut.register(accelerator, () => handlers?.sendCommand(command))) {
        ownedAccelerators.add(accelerator);
      }
    } catch {
      /* 媒体键被别的程序占住：静默跳过 */
    }
  }
};

export const stopMediaKeys = () => {
  for (const accelerator of [...ownedAccelerators]) {
    try {
      globalShortcut.unregister(accelerator);
    } catch {
      /* ignore */
    }
    ownedAccelerators.delete(accelerator);
  }
};
