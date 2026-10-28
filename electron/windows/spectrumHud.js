import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

const REFERENCE_HEIGHT = 1080;
const BASE_HEIGHT = 280;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

let hudWindow = null;
let lastData = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const geometry = () => {
  const display = screen.getPrimaryDisplay();
  const factor = display.scaleFactor > 0 ? display.scaleFactor : 1;
  const pixelHeight = display.size.height * factor;
  const pixelScale = clamp(pixelHeight / REFERENCE_HEIGHT, MIN_SCALE, MAX_SCALE);
  const dipScale = pixelScale / factor;
  const height = Math.min(display.workArea.height, Math.round(BASE_HEIGHT * dipScale));
  return {
    width: display.workArea.width,
    height,
    x: display.workArea.x,
    y: display.workArea.y + display.workArea.height - height
  };
};

const isAllowedUrl = (url) => (
  devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://')
);

export const showSpectrumHud = () => {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.showInactive();
    return hudWindow;
  }

  hudWindow = new BrowserWindow({
    ...geometry(),
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
      preload: path.join(__dirname, '..', 'preloadSpectrum.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false
    }
  });

  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  hudWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  hudWindow.setIgnoreMouseEvents(true, { forward: true });

  hudWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  hudWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });

  hudWindow.webContents.on('did-finish-load', () => {
    if (lastData) hudWindow?.webContents.send('spectrum:data', lastData);
  });

  hudWindow.once('ready-to-show', () => hudWindow?.showInactive());
  hudWindow.on('closed', () => {
    hudWindow = null;
  });

  if (devServerUrl) {
    void hudWindow.loadURL(`${devServerUrl}#/spectrum`);
  } else {
    void hudWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'), {
      hash: '/spectrum'
    });
  }

  return hudWindow;
};

export const destroySpectrumHud = () => {
  if (hudWindow && !hudWindow.isDestroyed()) hudWindow.destroy();
  hudWindow = null;
  lastData = null;
};

export const syncSpectrumHud = (enabled) => {
  if (enabled) showSpectrumHud();
  else destroySpectrumHud();
};

export const getSpectrumWindow = () => hudWindow;

export const sendSpectrumData = (data) => {
  lastData = data;
  if (!hudWindow || hudWindow.isDestroyed()) return;
  if (hudWindow.webContents.isLoading()) return;
  hudWindow.webContents.send('spectrum:data', data);
};
