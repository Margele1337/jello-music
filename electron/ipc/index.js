import { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, shell } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getSettings, updateSettings } from '../services/settingsStore.js';
import { getPlaybackState, savePlaybackState } from '../services/playbackStateStore.js';
import { isTrustedSender } from '../security/trustedSender.js';
import { proxyApiRequest, resetDeviceRegistration } from '../services/apiProxy.js';
import { clearAuthSession, getProfile, resetDeviceCookies } from '../services/authSession.js';
import { restartSidecar } from '../services/sidecar.js';
import { syncTray } from '../tray.js';
import {
  getDesktopLyricsWindow,
  resendDesktopLyricsState,
  sendDesktopLyricsLyrics,
  sendDesktopLyricsProgress,
  setDesktopLyricsFont,
  syncDesktopLyrics
} from '../windows/desktopLyrics.js';
import { sanitizeDesktopLyricLyrics, sanitizeDesktopLyricProgress } from '../../shared/desktopLyrics.js';
import { sanitizeSpectrumPayload } from '../../shared/spectrum.js';
import { getSpectrumWindow, sendSpectrumData, syncSpectrumHud, sendSpectrumSettings, syncSpectrumHudSettings } from '../windows/spectrumHud.js';
import {
  isMainWindowDocked,
  moveMainWindow,
  finishMainWindowDrag,
  getMainWindowBounds,
  restoreMainWindow,
  toggleMainWindowDock,
  applyAnimatePosition,
  finishAnimate
} from '../windows/sigmaDock.js';
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate
} from '../services/updater.js';

const assertTrusted = (event, getWindow) => {
  if (!isTrustedSender(event, getWindow())) {
    throw new Error('unauthorized ipc sender');
  }
};

let sleepBlockerId = null;

const applySystemSettings = (previous, next) => {
  if (next.autoStart !== previous.autoStart) {
    app.setLoginItemSettings({ openAtLogin: next.autoStart });
  }
  if (next.preventAppSuspension !== previous.preventAppSuspension) {
    if (next.preventAppSuspension && sleepBlockerId === null) {
      sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!next.preventAppSuspension && sleepBlockerId !== null) {
      powerSaveBlocker.stop(sleepBlockerId);
      sleepBlockerId = null;
    }
  }
};

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
};

export const registerIpc = (getWindow, intents = {}) => {
  ipcMain.handle(IPC.APP_VERSION, (event) => {
    assertTrusted(event, getWindow);
    return app.getVersion();
  });

  // 渲染层挂载后拉取一次启动意图（--settings / jello:// 深链），返回即清空。
  // 仅主窗口可消费：HUD 窗口（桌面歌词/频谱）跑同一个 App.vue，不拦会被抢走
  ipcMain.handle(IPC.APP_LAUNCH_INTENT, (event) => {
    assertTrusted(event, getWindow);
    const empty = { openSettings: false, deepLink: null };
    const main = getWindow()?.[0];
    if (!main || main.isDestroyed() || event.sender !== main.webContents) return empty;
    return intents.consumeLaunchIntent?.() ?? empty;
  });

  ipcMain.handle(IPC.APP_OPEN_LOGS, (event) => {
    assertTrusted(event, getWindow);
    return shell.openPath(app.getPath('userData'));
  });

  ipcMain.handle(IPC.SETTINGS_GET, (event) => {
    assertTrusted(event, getWindow);
    return getSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SET, (event, patch) => {
    assertTrusted(event, getWindow);
    const previous = getSettings();
    const next = updateSettings(patch);

    if (next.dataSource !== previous.dataSource) {
      resetDeviceRegistration();
      resetDeviceCookies();
      const platform = next.dataSource === 'concept' ? 'lite' : 'official';
      void restartSidecar({ platform }).catch((error) => {
        console.error('[sidecar] 数据源切换重启失败:', error.message);
      });
    }

    if (next.minimizeToTray !== previous.minimizeToTray) {
      syncTray(next.minimizeToTray);
    }

    if (next.desktopLyrics !== previous.desktopLyrics) {
      syncDesktopLyrics(next.desktopLyrics);
    }

    if (next.desktopLyricsFont !== previous.desktopLyricsFont) {
      setDesktopLyricsFont(next.desktopLyricsFont);
    }

    applySystemSettings(previous, next);

    if (next.spectrum !== previous.spectrum) {
      syncSpectrumHud(next.spectrum);
    }

    syncSpectrumHudSettings(next);

    broadcast(IPC.SETTINGS_CHANGED, next);
    return next;
  });

  ipcMain.handle(IPC.AUTH_GET, (event) => {
    assertTrusted(event, getWindow);
    return getProfile();
  });

  // 播放状态持久化：仅主窗口可读写（HUD 窗口跑同一个 App.vue，不拦会被抢走/误写）
  ipcMain.handle(IPC.PLAYBACK_STATE_GET, (event) => {
    assertTrusted(event, getWindow);
    const main = getWindow()?.[0];
    if (!main || main.isDestroyed() || event.sender !== main.webContents) return null;
    return getPlaybackState();
  });

  ipcMain.on(IPC.PLAYBACK_STATE_SET, (event, state) => {
    if (!isTrustedSender(event, getWindow())) return;
    const main = getWindow()?.[0];
    if (!main || main.isDestroyed() || event.sender !== main.webContents) return;
    savePlaybackState(state);
  });

  ipcMain.handle(IPC.AUTH_CLEAR, (event) => {
    assertTrusted(event, getWindow);
    clearAuthSession();
    broadcast(IPC.AUTH_CHANGED, null);
    return null;
  });

  ipcMain.handle(IPC.API_REQUEST, async (event, request) => {
    assertTrusted(event, getWindow);
    const response = await proxyApiRequest(request);
    if (String(request?.path || '').startsWith('/login/')) {
      const profile = getProfile();
      if (profile) broadcast(IPC.AUTH_CHANGED, profile);
    }
    return response;
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_UPDATE, (event, state) => {
    if (!isTrustedSender(event, getWindow())) return;
    sendDesktopLyricsLyrics(sanitizeDesktopLyricLyrics(state));
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_PROGRESS, (event, payload) => {
    if (!isTrustedSender(event, getWindow())) return;
    sendDesktopLyricsProgress(sanitizeDesktopLyricProgress(payload));
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_READY, (event) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    resendDesktopLyricsState();
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_ACTION, (event, action) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const commandMap = {
      'toggle-play': 'toggle',
      'previous-song': 'previous',
      'next-song': 'next'
    };
    if (action === 'close-lyrics') {
      updateSettings({ desktopLyrics: false });
      syncDesktopLyrics(false);
      broadcast(IPC.SETTINGS_CHANGED, getSettings());
      return;
    }
    const command = commandMap[action];
    if (!command) return;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window !== getDesktopLyricsWindow()) {
        window.webContents.send(IPC.PLAYER_COMMAND, command);
      }
    }
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_IGNORE_MOUSE, (event, ignore) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const window = getDesktopLyricsWindow();
    if (window && !window.isDestroyed()) {
      window.setIgnoreMouseEvents(ignore === true, { forward: true });
    }
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_BOUNDS, (event, bounds) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const window = getDesktopLyricsWindow();
    if (!window || window.isDestroyed() || !bounds || typeof bounds !== 'object') return;
    const clamp = (value, fallback) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };
    const current = window.getBounds();
    window.setBounds({
      x: clamp(bounds.x, current.x),
      y: clamp(bounds.y, current.y),
      width: clamp(bounds.width, current.width),
      height: clamp(bounds.height, current.height)
    });
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_FIXED_SIZE, (event, payload) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const window = getDesktopLyricsWindow();
    if (!window || window.isDestroyed()) return;
    const area = screen.getPrimaryDisplay().workArea;
    if (payload?.fixed) {
      const width = Math.max(800, Math.round(Number(payload.width) || area.width));
      const height = Math.max(160, Math.round(Number(payload.height) || 160));
      window.setMaximumSize(Math.min(width, area.width), Math.min(height, area.height));
    } else {
      window.setMaximumSize(area.width, area.height);
    }
  });

  ipcMain.handle(IPC.DESKTOP_LYRICS_POINTER_STATE, (event) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return null;
    const window = getDesktopLyricsWindow();
    if (!window || window.isDestroyed()) return null;
    return {
      cursor: screen.getCursorScreenPoint(),
      bounds: window.getBounds()
    };
  });

  ipcMain.on(IPC.SPECTRUM_UPDATE, (event, payload) => {
    if (!isTrustedSender(event, getWindow())) return;
    sendSpectrumData(sanitizeSpectrumPayload(payload));
  });

  ipcMain.on(IPC.SPECTRUM_HUD_READY, (event) => {
    if (!isTrustedSender(event, getWindow())) return;
    const settings = getSettings();
    sendSpectrumSettings({ ...settings, scale: 1 });
    const main = getWindow()?.filter?.(Boolean)?.[0];
    if (main && !main.isDestroyed()) {
      main.webContents.send('spectrum:request-current');
    }
  });

  ipcMain.on(IPC.SPECTRUM_LOCK_TOGGLE, (event, value) => {
    if (!isTrustedSender(event, getWindow())) return;
    updateSettings({ spectrumLocked: value === true });
    syncSpectrumHudSettings(getSettings());
  });

  // 解锁态的拖动：渲染层算好新 bounds，主进程 setBounds（CSS drag region 在
  // 高 DPI 缩放屏上 hit-test 不可靠，桌面歌词窗口同款方案）。
  // 只写提供的字段：宽高跟着写回会在 150% 缩放的 DIP↔物理往返中 ±1 漂移
  ipcMain.on(IPC.SPECTRUM_BOUNDS, (event, bounds) => {
    if (!isTrustedSender(event, getSpectrumWindow())) return;
    const window = getSpectrumWindow();
    if (!window || window.isDestroyed() || !bounds || typeof bounds !== 'object') return;
    const next = {};
    for (const key of ['x', 'y', 'width', 'height']) {
      const num = Number(bounds[key]);
      if (Number.isFinite(num)) next[key] = Math.round(num);
    }
    if (Object.keys(next).length) window.setBounds(next);
  });

  ipcMain.on(IPC.WINDOW_DOCK_TOGGLE, (event) => {
    if (!isTrustedSender(event, getWindow())) return;
    toggleMainWindowDock();
  });

  ipcMain.handle(IPC.WINDOW_DOCK_GET, (event) => {
    assertTrusted(event, getWindow);
    return isMainWindowDocked();
  });

  ipcMain.on(IPC.WINDOW_RESTORE, (event) => {
    if (!isTrustedSender(event, getWindow())) return;
    restoreMainWindow();
  });

  ipcMain.on(IPC.WINDOW_ANIMATE_POSITION, (event, pos) => {
    if (!isTrustedSender(event, getWindow())) return;
    applyAnimatePosition(Number(pos?.x), Number(pos?.y));
  });

  ipcMain.on(IPC.WINDOW_ANIMATE_DONE, (event) => {
    if (!isTrustedSender(event, getWindow())) return;
    finishAnimate();
  });

  ipcMain.on(IPC.WINDOW_MOVE, (event, position) => {
    if (!isTrustedSender(event, getWindow())) return;
    moveMainWindow(Number(position?.x), Number(position?.y), Number(position?.movedX) || 0);
  });

  ipcMain.on(IPC.WINDOW_DRAG_END, (event) => {
    if (!isTrustedSender(event, getWindow())) return;
    finishMainWindowDrag();
  });

  ipcMain.handle(IPC.WINDOW_GET_BOUNDS, (event) => {
    assertTrusted(event, getWindow);
    return getMainWindowBounds();
  });

  ipcMain.handle(IPC.UPDATE_GET, (event) => {
    assertTrusted(event, getWindow);
    return getUpdateState();
  });

  ipcMain.handle(IPC.UPDATE_CHECK, async (event) => {
    assertTrusted(event, getWindow);
    return checkForUpdates();
  });

  ipcMain.handle(IPC.UPDATE_DOWNLOAD, async (event) => {
    assertTrusted(event, getWindow);
    return downloadUpdate();
  });

  ipcMain.handle(IPC.UPDATE_INSTALL, (event) => {
    assertTrusted(event, getWindow);
    installUpdate();
    return true;
  });
};
