import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';
import {
  getForegroundFullscreenState,
  stopForegroundFullscreenWatcher,
  watchForegroundFullscreen,
  ensureForegroundFullscreenWatcher
} from '../services/fullscreenWatcher.js';
import { getSettings } from '../services/settingsStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// 频谱几何基准：1080p 物理像素。1080p 仍是原版绝对像素值，1440p/4K 等比放大。
const REFERENCE_HEIGHT = 1080;
const BASE_WINDOW_HEIGHT = 280;
const BASE_MIN_WIDTH = 300;
const BASE_MIN_HEIGHT = 60;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

let hudWindow = null;
let lastData = null;
let lastSettings = null;
let spectrumDipScale = 0;
let spectrumUserMoved = false;
let spectrumGeometryKey = '';
let spectrumDisplayListenersBound = false;
let stopFullscreenWatch = null;
let boundsStore = null;
let displayListeners = [];

const getBoundsStore = () => {
  if (!boundsStore) boundsStore = new Store({ name: 'spectrum-window' });
  return boundsStore;
};

const clampScale = (value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

const getGeometryScale = (display) => {
  const factor = display.scaleFactor > 0 ? display.scaleFactor : 1;
  const pixelHeight = display.size.height * factor;
  if (!pixelHeight) return 1;
  return clampScale(pixelHeight / REFERENCE_HEIGHT);
};

const toDipScale = (display, pixelScale) => {
  const factor = display.scaleFactor > 0 ? display.scaleFactor : 1;
  return factor > 0 ? pixelScale / factor : pixelScale;
};

const getDisplay = () => {
  try {
    return screen.getDisplayMatching(hudWindow.getBounds());
  } catch {
    return screen.getPrimaryDisplay();
  }
};

const anchorSpectrumWindow = () => {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  const bounds = hudWindow.getBounds();
  const area = getDisplay().workArea;
  if (spectrumUserMoved) {
    const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width);
    const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height);
    if (x !== bounds.x || y !== bounds.y) {
      // setPosition 不带宽高：150% 缩放下 setBounds 的 DIP↔物理往返取整会让尺寸 ±1 漂移
      hudWindow.setPosition(Math.round(x), Math.round(y));
    }
    return;
  }
  const y = area.y + area.height - bounds.height;
  if (bounds.y === y) return;
  hudWindow.setPosition(bounds.x, Math.round(y));
};

const applySpectrumGeometry = () => {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  const display = getDisplay();
  const scale = getGeometryScale(display);
  const dipScale = toDipScale(display, scale);
  const key = `${scale}|${display.size.width}x${display.size.height}`;

  if (spectrumDipScale > 0) {
    const ratio = dipScale / spectrumDipScale;
    if (Number.isFinite(ratio) && Math.abs(ratio - 1) >= 0.005) {
      const bounds = hudWindow.getBounds();
      const nextWidth = Math.min(Math.round(bounds.width * ratio), display.workArea.width);
      const nextHeight = Math.min(Math.round(bounds.height * ratio), display.workArea.height);
      hudWindow.setBounds({ x: bounds.x, y: bounds.y, width: nextWidth, height: nextHeight });
    }
  }
  spectrumDipScale = dipScale;
  if (spectrumGeometryKey === key) return;
  spectrumGeometryKey = key;
  sendSpectrumSettings({ ...lastSettings, scale });
};

const isAllowedUrl = (url) => (
  devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://')
);

const geometry = () => {
  const display = screen.getPrimaryDisplay();
  const factor = display.scaleFactor > 0 ? display.scaleFactor : 1;
  const pixelScale = clampScale((display.size.height * factor) / REFERENCE_HEIGHT);
  const dipScale = pixelScale / factor;
  const height = Math.min(display.workArea.height, Math.round(BASE_WINDOW_HEIGHT * dipScale));
  return {
    width: display.workArea.width,
    height,
    x: display.workArea.x,
    y: display.workArea.y + display.workArea.height - height
  };
};

export const showSpectrumHud = () => {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.showInactive();
    return hudWindow;
  }

  const store = getBoundsStore();
  const display = screen.getPrimaryDisplay();
  const pixelScale = clampScale((display.size.height * display.scaleFactor) / REFERENCE_HEIGHT);
  const dipScale = pixelScale / (display.scaleFactor || 1);
  const savedSize = store.get('spectrumWindowSize');
  const savedPosition = store.get('spectrumWindowPosition');

  let width = savedSize?.width || display.workArea.width;
  let height = savedSize?.height || Math.round(BASE_WINDOW_HEIGHT * dipScale);
  const storedDipScale = store.get('spectrumGeometryDipScale');
  if (Number.isFinite(storedDipScale) && storedDipScale > 0) {
    const ratio = dipScale / storedDipScale;
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  width = Math.min(width, display.workArea.width);
  height = Math.min(height, display.workArea.height);

  const x = Math.min(
    Math.max(savedPosition?.x ?? display.workArea.x, display.workArea.x),
    display.workArea.x + display.workArea.width - width
  );
  const y = Math.min(
    Math.max(savedPosition?.y ?? display.workArea.y + display.workArea.height - height, display.workArea.y),
    display.workArea.y + display.workArea.height - 1
  );

  hudWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: Math.round(BASE_MIN_WIDTH * dipScale),
    minHeight: Math.round(BASE_MIN_HEIGHT * dipScale),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preloadSpectrum.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      zoomFactor: 1.0
    }
  });

  spectrumDipScale = dipScale;
  spectrumUserMoved = store.get('spectrumUserMoved') === true;

  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  hudWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  applySpectrumHudMouseEvents(getSettings().spectrumLocked === true);

  const persistBounds = () => {
    if (!hudWindow || hudWindow.isDestroyed()) return;
    const bounds = hudWindow.getBounds();
    store.set('spectrumWindowPosition', { x: bounds.x, y: bounds.y });
    store.set('spectrumWindowSize', { width: bounds.width, height: bounds.height });
  };

  // 原生拖动/缩放期间 move 事件每秒几十次，同步落盘会卡住拖动循环；防抖到停手后再写
  let boundsFlushTimer = null;
  const flushBoundsSoon = () => {
    if (boundsFlushTimer) clearTimeout(boundsFlushTimer);
    boundsFlushTimer = setTimeout(() => {
      boundsFlushTimer = null;
      persistBounds();
    }, 200);
  };

  const isAtAnchor = () => {
    if (!hudWindow || hudWindow.isDestroyed()) return true;
    const bounds = hudWindow.getBounds();
    const area = getDisplay().workArea;
    return Math.abs(bounds.y - (area.y + area.height - bounds.height)) <= 2;
  };

  const anchor = () => {
    if (!hudWindow || hudWindow.isDestroyed()) return;
    const bounds = hudWindow.getBounds();
    const area = getDisplay().workArea;
    if (spectrumUserMoved) {
      const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width);
      const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height);
      if (x !== bounds.x || y !== bounds.y) {
        // setPosition 不带宽高：150% 缩放下 setBounds 的 DIP↔物理往返取整会让尺寸 ±1 漂移
        hudWindow.setPosition(Math.round(x), Math.round(y));
      }
      return;
    }
    const targetY = area.y + area.height - bounds.height;
    if (bounds.y === targetY) return;
    hudWindow.setPosition(bounds.x, Math.round(targetY));
  };

  const reanchorAndSync = () => {
    anchor();
    applySpectrumGeometry();
  };

  hudWindow.on('resize', () => {
    anchor();
    flushBoundsSoon();
  });
  hudWindow.on('move', () => {
    flushBoundsSoon();
    // 区分「系统贴底锚定」与「用户手动拖动」：位置不是贴底目标 → 用户拖的，记住它
    if (!spectrumUserMoved && !isAtAnchor()) {
      spectrumUserMoved = true;
      store.set('spectrumUserMoved', true);
    }
  });

  hudWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  hudWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });

  hudWindow.webContents.on('did-finish-load', () => {
    const settings = getSettings();
    const scale = getGeometryScale(getDisplay());
    const spectrumSettings = {
      spectrumScale: settings.spectrumScale,
      spectrumSigmaSmoothing: settings.spectrumSigmaSmoothing,
      spectrumInfoScale: settings.spectrumInfoScale,
      spectrumInfoVisible: settings.spectrumInfoVisible,
      spectrumLocked: settings.spectrumLocked,
      scale
    };
    hudWindow?.webContents.send('spectrum:settings', spectrumSettings);
    lastSettings = spectrumSettings;
    if (lastData) hudWindow?.webContents.send('spectrum:data', lastData);
  });

  hudWindow.once('ready-to-show', () => hudWindow?.showInactive());
  hudWindow.on('closed', () => {
    hudWindow = null;
    spectrumGeometryKey = '';
    spectrumDipScale = 0;
    if (boundsFlushTimer) {
      clearTimeout(boundsFlushTimer);
      boundsFlushTimer = null;
    }
  });

  const bindDisplayListeners = () => {
    if (spectrumDisplayListenersBound) return;
    spectrumDisplayListenersBound = true;
    const events = ['display-metrics-changed', 'display-added', 'display-removed'];
    for (const event of events) {
      const handler = () => reanchorAndSync();
      screen.on(event, handler);
      displayListeners.push({ event, handler });
    }
  };
  bindDisplayListeners();

  if (!stopFullscreenWatch) {
    stopFullscreenWatch = watchForegroundFullscreen(() => anchor());
  }

  anchor();

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
  lastSettings = null;
  spectrumGeometryKey = '';
  spectrumDipScale = 0;
  if (stopFullscreenWatch) {
    stopFullscreenWatch();
    stopFullscreenWatch = null;
  }
  for (const { event, handler } of displayListeners) {
    screen.removeListener(event, handler);
  }
  displayListeners = [];
  spectrumDisplayListenersBound = false;
};

export const syncSpectrumHud = (enabled) => {
  if (enabled) showSpectrumHud();
  else destroySpectrumHud();
};

// 锁定 = 鼠标完全穿透（forward 让 mousemove 仍转发，方便渲染层感知）；解锁 = 可拖动/缩放。
// 解除穿透时不能带 forward 选项：Windows 上 (false, {forward:true}) 解除不干净，窗口仍然穿透
export const applySpectrumHudMouseEvents = (locked) => {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  if (locked === true) {
    hudWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    hudWindow.setIgnoreMouseEvents(false);
  }
};

export const syncSpectrumHudSettings = (settings) => {
  const payload = {
    spectrumScale: settings.spectrumScale,
    spectrumSigmaSmoothing: settings.spectrumSigmaSmoothing,
    spectrumInfoScale: settings.spectrumInfoScale,
    spectrumInfoVisible: settings.spectrumInfoVisible,
    spectrumLocked: settings.spectrumLocked,
    scale: hudWindow && !hudWindow.isDestroyed() ? getGeometryScale(getDisplay()) : 1
  };
  lastSettings = payload;
  if (!hudWindow || hudWindow.isDestroyed()) return;
  applySpectrumHudMouseEvents(settings.spectrumLocked);
  if (hudWindow.webContents.isLoading()) return;
  hudWindow.webContents.send('spectrum:settings', payload);
};

export const getSpectrumWindow = () => hudWindow;

export const sendSpectrumData = (data) => {
  lastData = data;
  if (!hudWindow || hudWindow.isDestroyed()) return;
  if (hudWindow.webContents.isLoading()) return;
  hudWindow.webContents.send('spectrum:data', data);
};

export const sendSpectrumSettings = (settings) => {
  lastSettings = settings;
  if (!hudWindow || hudWindow.isDestroyed()) return;
  if (hudWindow.webContents.isLoading()) return;
  hudWindow.webContents.send('spectrum:settings', settings);
};
