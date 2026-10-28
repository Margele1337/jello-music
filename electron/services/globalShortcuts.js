import { globalShortcut } from 'electron';
import { IPC } from '../../shared/ipc.js';

// 媒体快捷键 + 全局组合键（默认键位与旧版一致）
// 媒体键：MediaPlayPause / MediaNextTrack / MediaPreviousTrack / MediaStop
// 组合键：Alt+Ctrl+Space 播放暂停、Alt+Ctrl+←/→ 切歌、Alt+Ctrl+↑/↓ 音量、
//         Alt+Ctrl+M 静音、Alt+Ctrl+D 桌面歌词、Alt+Ctrl+S 频谱、Ctrl+Shift+S 主窗口
export const initGlobalShortcuts = ({
  sendCommand,
  toggleDesktopLyrics,
  toggleSpectrum,
  toggleMainWindow
}) => {
  const register = (accelerator, handler) => {
    try {
      globalShortcut.register(accelerator, handler);
    } catch {
      /* 快捷键被其他程序占用时跳过 */
    }
  };

  register('MediaPlayPause', () => sendCommand('toggle'));
  register('MediaNextTrack', () => sendCommand('next'));
  register('MediaPreviousTrack', () => sendCommand('previous'));
  register('MediaStop', () => sendCommand('pause'));

  register('Alt+CommandOrControl+Space', () => sendCommand('toggle'));
  register('Alt+CommandOrControl+Left', () => sendCommand('previous'));
  register('Alt+CommandOrControl+Right', () => sendCommand('next'));
  register('Alt+CommandOrControl+Up', () => sendCommand('volume-up'));
  register('Alt+CommandOrControl+Down', () => sendCommand('volume-down'));
  register('Alt+CommandOrControl+M', () => sendCommand('toggle-mute'));
  register('Alt+CommandOrControl+L', () => sendCommand('like'));
  register('Alt+CommandOrControl+D', toggleDesktopLyrics);
  register('Alt+CommandOrControl+S', toggleSpectrum);
  register('CmdOrCtrl+Shift+S', toggleMainWindow);
};

export const stopGlobalShortcuts = () => {
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
};
