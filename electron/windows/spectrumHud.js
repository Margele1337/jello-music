import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

let hudWindow = null;
let lastBands = null;

const position = () => {
  const display = screen.getPrimaryDisplay();
  const width = Math.min(900, Math.max(600, Math.round(display.workArea.width * 0.62)));
  const height = 150;
  return {
    width,
    height,
    x: display.workArea.x + Math.round((display.workArea.width - width) / 2),
    y: display.workArea.y + 40
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
      preload: path.join(__dirname, '..', 'preloadSpectrum.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  hudWindow.setAlwaysOnTop(true, 'floating');
  hudWindow.setIgnoreMouseEvents(true, { forward: true });

  hudWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  hudWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });

  hudWindow.webContents.on('did-finish-load', () => {
    if (lastBands) hudWindow?.webContents.send('spectrum:data', lastBands);
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
  lastBands = null;
};

export const syncSpectrumHud = (enabled) => {
  if (enabled) showSpectrumHud();
  else destroySpectrumHud();
};

export const getSpectrumWindow = () => hudWindow;

export const sendSpectrumBands = (bands) => {
  lastBands = bands;
  if (!hudWindow || hudWindow.isDestroyed()) return;
  if (hudWindow.webContents.isLoading()) return;
  hudWindow.webContents.send('spectrum:data', bands);
};
