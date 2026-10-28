import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getSettings, updateSettings } from '../services/settingsStore.js';
import { isTrustedSender } from '../security/trustedSender.js';
import { proxyApiRequest, resetDeviceRegistration } from '../services/apiProxy.js';
import { clearAuthSession, getProfile, resetDeviceCookies } from '../services/authSession.js';
import { restartSidecar } from '../services/sidecar.js';
import { syncTray } from '../tray.js';
import { syncDesktopLyrics, sendDesktopLyricsState } from '../windows/desktopLyrics.js';
import { sanitizeDesktopLyricState } from '../../shared/desktopLyrics.js';
import { sanitizeSpectrumPayload } from '../../shared/spectrum.js';
import { sendSpectrumData, syncSpectrumHud, sendSpectrumSettings, syncSpectrumHudSettings } from '../windows/spectrumHud.js';
import { isMainWindowDocked, restoreMainWindow, toggleMainWindowDock } from '../windows/sigmaDock.js';
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

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
};

export const registerIpc = (getWindow) => {
  ipcMain.handle(IPC.APP_VERSION, (event) => {
    assertTrusted(event, getWindow);
    return app.getVersion();
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
    sendDesktopLyricsState(sanitizeDesktopLyricState(state));
  });

  ipcMain.on(IPC.SPECTRUM_UPDATE, (event, payload) => {
    if (!isTrustedSender(event, getWindow())) return;
    sendSpectrumData(sanitizeSpectrumPayload(payload));
  });

  ipcMain.on(IPC.SPECTRUM_HUD_READY, (event) => {
    if (!isTrustedSender(event, getWindow())) return;
    sendSpectrumSettings({ ...getSettings(), scale: 1 });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('spectrum:request-current');
    }
  });

  ipcMain.on(IPC.SPECTRUM_LOCK_TOGGLE, (event, value) => {
    if (!isTrustedSender(event, getWindow())) return;
    updateSettings({ spectrumLocked: value === true });
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
