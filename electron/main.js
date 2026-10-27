import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSettings, getSettings } from './services/settingsStore.js';
import { registerIpc } from './ipc/index.js';
import { startSidecar, stopSidecar } from './services/sidecar.js';
import { initAuthSession, flushAuthSession } from './services/authSession.js';
import { hasTray, initTray, syncTray } from './tray.js';
import { destroyDesktopLyrics, getDesktopLyricsWindow, syncDesktopLyrics } from './windows/desktopLyrics.js';
import { initUpdater, stopUpdater } from './services/updater.js';

// Keep the clean-room app's settings/session isolated from the legacy GPL app.
app.setName('Jello Music Clean');
app.setPath('userData', path.join(app.getPath('appData'), 'jello-music-clean'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow = null;
let isQuitting = false;
let shutdownStarted = false;

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    useContentSize: true,
    show: false,
    backgroundColor: '#0e0c12',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
      // 主窗口隐藏到托盘后仍需按播放进度更新桌面歌词
      backgroundThrottling: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  mainWindow.on('close', (event) => {
    if (isQuitting || !getSettings().minimizeToTray || !hasTray()) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('minimize', (event) => {
    if (!getSettings().minimizeToTray || !hasTray()) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // 桌面歌词窗口是 closable:false 的辅助窗口，不能让它把应用留在后台
    if (!isQuitting) app.quit();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.whenReady().then(async () => {
  initSettings();
  await initAuthSession();
  initUpdater();
  registerIpc(() => [mainWindow, getDesktopLyricsWindow()].filter(Boolean));
  initTray({
    showWindow: showMainWindow,
    quit: () => {
      isQuitting = true;
      app.quit();
    }
  });
  syncTray(getSettings().minimizeToTray);
  const platform = getSettings().dataSource === 'concept' ? 'lite' : 'official';
  startSidecar({ platform }).catch((error) => {
    console.error('[sidecar] 启动失败:', error.message);
  });
  createWindow();
  syncDesktopLyrics(getSettings().desktopLyrics);

  app.on('activate', showMainWindow);
});

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownStarted) return;

  shutdownStarted = true;
  event.preventDefault();
  stopUpdater();
  destroyDesktopLyrics();
  void stopSidecar();
  void Promise.race([
    flushAuthSession(),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  app.quit();
});
