import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getSettings, updateSettings } from '../services/settingsStore.js';
import { isTrustedSender } from '../security/trustedSender.js';
import { proxyApiRequest } from '../services/apiProxy.js';
import { clearAuthSession, getProfile } from '../services/authSession.js';

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
    const next = updateSettings(patch);
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
};
