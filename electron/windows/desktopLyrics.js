import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let lyricsWindow = null;
let lastState = null;

const position = () => {
  const display = screen.getPrimaryDisplay();
  const width = Math.min(1000, Math.max(600, Math.round(display.workArea.width * 0.72)));
  const height = 150;
  return {
    width,
    height,
    x: display.workArea.x + Math.round((display.workArea.width - width) / 2),
    y: display.workArea.y + display.workArea.height - height - 56
  };
};

const isAllowedUrl = (url) => (
  devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://')
);

export const showDesktopLyrics = () => {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.showInactive();
    return lyricsWindow;
  }

  lyricsWindow = new BrowserWindow({
    ...position(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preloadLyrics.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  lyricsWindow.setAlwaysOnTop(true, 'floating');
  lyricsWindow.setIgnoreMouseEvents(true, { forward: true });

  lyricsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  lyricsWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });

  lyricsWindow.webContents.on('did-finish-load', () => {
    if (lastState) lyricsWindow?.webContents.send('desktop-lyrics:state', lastState);
  });

  lyricsWindow.once('ready-to-show', () => lyricsWindow?.showInactive());
  lyricsWindow.on('closed', () => {
    lyricsWindow = null;
  });

  if (devServerUrl) {
    void lyricsWindow.loadURL(`${devServerUrl}#/desktop-lyrics`);
  } else {
    void lyricsWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'), {
      hash: '/desktop-lyrics'
    });
  }

  return lyricsWindow;
};

export const destroyDesktopLyrics = () => {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.destroy();
  lyricsWindow = null;
  lastState = null;
};

export const syncDesktopLyrics = (enabled) => {
  if (enabled) showDesktopLyrics();
  else destroyDesktopLyrics();
};

export const getDesktopLyricsWindow = () => lyricsWindow;

export const sendDesktopLyricsState = (state) => {
  lastState = state;
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  if (lyricsWindow.webContents.isLoading()) return;
  lyricsWindow.webContents.send('desktop-lyrics:state', state);
};
