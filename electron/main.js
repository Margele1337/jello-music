import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSettings, getSettings } from './services/settingsStore.js';
import { registerIpc } from './ipc/index.js';
import { startSidecar, stopSidecar } from './services/sidecar.js';
import { initAuthSession, flushAuthSession } from './services/authSession.js';

// Keep the clean-room app's settings/session isolated from the legacy GPL app.
app.setName('Jello Music Clean');
app.setPath('userData', path.join(app.getPath('appData'), 'jello-music-clean'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let mainWindow = null;

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
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

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

app.whenReady().then(() => {
  initSettings();
  initAuthSession();
  registerIpc(() => mainWindow);
  const platform = getSettings().dataSource === 'concept' ? 'lite' : 'official';
  startSidecar({ platform }).catch((error) => {
    console.error('[sidecar] 启动失败:', error.message);
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  flushAuthSession();
  stopSidecar();
});

app.on('window-all-closed', () => {
  app.quit();
});
