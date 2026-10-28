import { BrowserWindow, screen, shell } from 'electron';
import Store from 'electron-store';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from '../../shared/ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let lyricsWindow = null;
let lastLyrics = { hash: '', title: '', artist: '', lines: [] };
let lastProgress = { time: 0, playing: false };
let lyricsFont = '';
let boundsStore = null;

const getBoundsStore = () => {
  if (!boundsStore) boundsStore = new Store({ name: 'desktop-lyrics-window' });
  return boundsStore;
};

const defaultBounds = () => {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(1000, Math.max(600, Math.round(area.width * 0.7)));
  const height = 160;
  return {
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + area.height - height - 56
  };
};

const restoreBounds = () => {
  const fallback = defaultBounds();
  const saved = getBoundsStore().get('bounds') || {};
  let { x, y, width, height } = saved;
  if (!Number.isFinite(width) || width < 800) ({ width } = fallback);
  if (!Number.isFinite(height) || height < 160) ({ height } = fallback);
  const area = screen.getPrimaryDisplay().workArea;
  width = Math.min(width, area.width);
  height = Math.min(height, area.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { width, height, x: fallback.x, y: fallback.y };
  }
  const display = screen.getDisplayMatching({ x, y, width, height });
  const area2 = display.workArea;
  return {
    width,
    height,
    x: Math.min(Math.max(x, area2.x), area2.x + area2.width - width),
    y: Math.min(Math.max(y, area2.y), area2.y + area2.height - height)
  };
};

const persistBounds = () => {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  try {
    getBoundsStore().set('bounds', lyricsWindow.getBounds());
  } catch {
    /* ignore */
  }
};

const isAllowedUrl = (url) => (
  devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://')
);

export const showDesktopLyrics = () => {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.showInactive();
    return lyricsWindow;
  }

  const bounds = restoreBounds();
  const area = screen.getPrimaryDisplay().workArea;

  lyricsWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 160,
    maxWidth: area.width,
    maxHeight: area.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
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
      webSecurity: true,
      backgroundThrottling: false
    }
  });

  lyricsWindow.setAlwaysOnTop(true, 'screen-saver');
  lyricsWindow.setIgnoreMouseEvents(true, { forward: true });
  lyricsWindow.on('move', persistBounds);
  lyricsWindow.on('resize', persistBounds);

  lyricsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  lyricsWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });

  lyricsWindow.webContents.on('did-finish-load', () => {
    if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
    lyricsWindow.webContents.send(IPC.DESKTOP_LYRICS_STATE, lastLyrics);
    lyricsWindow.webContents.send(IPC.DESKTOP_LYRICS_PROGRESS, lastProgress);
    lyricsWindow.webContents.send(IPC.DESKTOP_LYRICS_FONT, lyricsFont);
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
  lastLyrics = { hash: '', title: '', artist: '', lines: [] };
  lastProgress = { time: 0, playing: false };
};

export const syncDesktopLyrics = (enabled) => {
  if (enabled) showDesktopLyrics();
  else destroyDesktopLyrics();
};

export const getDesktopLyricsWindow = () => lyricsWindow;

export const sendDesktopLyricsLyrics = (payload) => {
  lastLyrics = payload;
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  if (lyricsWindow.webContents.isLoading()) return;
  lyricsWindow.webContents.send(IPC.DESKTOP_LYRICS_STATE, payload);
};

export const sendDesktopLyricsProgress = (payload) => {
  lastProgress = payload;
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  if (lyricsWindow.webContents.isLoading()) return;
  lyricsWindow.webContents.send(IPC.DESKTOP_LYRICS_PROGRESS, payload);
};

export const resendDesktopLyricsState = () => {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  if (lyricsWindow.webContents.isLoading()) return;
  lyricsWindow.webContents.send(IPC.DESKTOP_LYRICS_STATE, lastLyrics);
  lyricsWindow.webContents.send(IPC.DESKTOP_LYRICS_PROGRESS, lastProgress);
  lyricsWindow.webContents.send(IPC.DESKTOP_LYRICS_FONT, lyricsFont);
};

export const setDesktopLyricsFont = (font) => {
  lyricsFont = typeof font === 'string' ? font.slice(0, 100) : '';
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  if (lyricsWindow.webContents.isLoading()) return;
  lyricsWindow.webContents.send(IPC.DESKTOP_LYRICS_FONT, lyricsFont);
};
