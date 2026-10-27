import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { IPC } from '../../shared/ipc.js';

const INITIAL_STATE = {
  status: 'idle',
  version: '',
  percent: 0,
  error: ''
};

let state = { ...INITIAL_STATE };
let initialized = false;
let autoCheckTimer = null;

const broadcast = () => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.UPDATE_STATE, state);
  }
};

const setState = (patch) => {
  state = { ...state, ...patch };
  broadcast();
};

const errorText = (error) => String(error?.message || error || '更新失败').slice(0, 300);

export const initUpdater = () => {
  if (!app.isPackaged) {
    state = { ...INITIAL_STATE, status: 'dev' };
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: '' }));
  autoUpdater.on('update-available', (info) => {
    setState({ status: 'available', version: String(info?.version || ''), percent: 0, error: '' });
  });
  autoUpdater.on('update-not-available', (info) => {
    setState({ status: 'current', version: String(info?.version || app.getVersion()), error: '' });
  });
  autoUpdater.on('download-progress', (progress) => {
    const percent = Number(progress?.percent);
    setState({
      status: 'downloading',
      percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0,
      error: ''
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    setState({ status: 'downloaded', version: String(info?.version || ''), percent: 100, error: '' });
  });
  autoUpdater.on('error', (error) => {
    setState({ status: 'error', error: errorText(error) });
  });

  initialized = true;
  autoCheckTimer = setTimeout(() => {
    autoCheckTimer = null;
    void checkForUpdates();
  }, 15000);
};

export const getUpdateState = () => ({ ...state });

export const checkForUpdates = async () => {
  if (!app.isPackaged) {
    setState({ status: 'dev', error: '' });
    return getUpdateState();
  }
  if (!initialized) return getUpdateState();
  if (state.status === 'checking' || state.status === 'downloading') return getUpdateState();

  setState({ status: 'checking', version: '', percent: 0, error: '' });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setState({ status: 'error', error: errorText(error) });
  }
  return getUpdateState();
};

export const downloadUpdate = async () => {
  if (!app.isPackaged || !initialized) return getUpdateState();
  if (state.status !== 'available') return getUpdateState();

  setState({ status: 'downloading', percent: 0, error: '' });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    setState({ status: 'error', error: errorText(error) });
  }
  return getUpdateState();
};

export const installUpdate = () => {
  if (!app.isPackaged || !initialized) return;
  if (state.status !== 'downloaded') return;
  autoUpdater.quitAndInstall(false, true);
};

export const stopUpdater = () => {
  if (autoCheckTimer) clearTimeout(autoCheckTimer);
  autoCheckTimer = null;
};
