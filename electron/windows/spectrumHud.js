import { BrowserWindow, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';
import {
  getForegroundFullscreenState,
  stopForegroundFullscreenWatcher,
  watchForegroundFullscreen
} from '../services/fullscreenWatcher.js';
import {
  clampHudPosition,
  hudAnchorPosition,
  hudOffsetFromAnchor,
  hudPositionFromOffset,
  hudSurfaceSize,
  resolveHudArea,
  scaleHudOffset
} from '../../shared/spectrumHud.js';
import { getSettings } from '../services/settingsStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// 频谱几何基准：1080p 物理像素。1080p 仍是原版绝对像素值，1440p/4K 等比放大。
const REFERENCE_HEIGHT = 1080;
const BASE_MIN_WIDTH = 300;
const BASE_MIN_HEIGHT = 60;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

let hudWindow = null;
let lastData = null;
let lastSettings = null;
let spectrumDipScale = 0;
let spectrumUserMoved = false;
// 用户拖出来的偏移（相对左下锚点，DIP）：整屏表面靠它保留「条基线被抬高」的语义
let spectrumUserOffset = { x: 0, y: 0 };
let spectrumGeometryKey = '';
let spectrumDisplayListenersBound = false;
let stopFullscreenWatch = null;
let boundsStore = null;
let displayListeners = [];
let surfaceApplying = false;

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

// HUD 目标区域：前台全屏 → 整块显示器；否则 → 工作区（不压住任务栏）。
// 原版画在整个游戏窗口上，条可以顶到屏幕最上沿，这里必须给满整个区域。
const getHudArea = () => {
  const fallback = (() => {
    try {
      const display = hudWindow && !hudWindow.isDestroyed()
        ? screen.getDisplayMatching(hudWindow.getBounds())
        : screen.getPrimaryDisplay();
      return display.workArea;
    } catch {
      return null;
    }
  })();
  const area = resolveHudArea(screen.getAllDisplays(), getForegroundFullscreenState(), fallback);
  return area || fallback;
};

// 解锁态只用于拖动定位：窗口收回底部条高，否则整块工作区的非穿透窗口
// 会吃掉全屏点击（托盘菜单、Sigma 面板都点不动）
const UNLOCKED_STRIP_DIP = 280;
let hudLocked = true;

const unlockedStripHeight = (area) => {
  const display = getDisplay();
  const dipScale = toDipScale(display, getGeometryScale(display));
  return Math.max(120, Math.min(area.height, Math.round(UNLOCKED_STRIP_DIP * (dipScale || 1))));
};

// 目标几何：尺寸恒等于区域，位置按「是否被用户拖过」决定
const getHudTarget = (area = getHudArea()) => {
  if (!area) return null;
  const size = hudSurfaceSize(area);
  if (!hudLocked) size.height = unlockedStripHeight(area);
  const position = spectrumUserMoved
    ? clampHudPosition(area, size, hudPositionFromOffset(area, size, spectrumUserOffset))
    : hudAnchorPosition(area, size);
  return { ...size, ...position };
};

const isHudAtTarget = (target) => {
  if (!target || !hudWindow || hudWindow.isDestroyed()) return true;
  const bounds = hudWindow.getBounds();
  const tolerance = 2;
  return Math.abs(bounds.x - target.x) <= tolerance
    && Math.abs(bounds.y - target.y) <= tolerance
    && Math.abs(bounds.width - target.width) <= tolerance
    && Math.abs(bounds.height - target.height) <= tolerance;
};

const applyHudTarget = (target = getHudTarget()) => {
  if (!target || !hudWindow || hudWindow.isDestroyed()) return;
  if (isHudAtTarget(target)) return;
  const bounds = hudWindow.getBounds();
  surfaceApplying = true;
  try {
    if (Math.abs(bounds.width - target.width) > 2 || Math.abs(bounds.height - target.height) > 2) {
      hudWindow.setBounds(target);
    } else {
      // setPosition 不带宽高：150% 缩放下 setBounds 的 DIP↔物理往返取整会让尺寸 ±1 漂移
      hudWindow.setPosition(target.x, target.y);
    }
  } finally {
    surfaceApplying = false;
  }
};

// DPI / 分辨率变化：表面尺寸由区域直接给出，需要等比换算的只有「用户拖出来的偏移」
const applySpectrumGeometry = () => {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  const display = getDisplay();
  const scale = getGeometryScale(display);
  const dipScale = toDipScale(display, scale);
  const key = `${scale}|${display.size.width}x${display.size.height}`;

  if (spectrumDipScale > 0 && spectrumUserMoved) {
    const ratio = dipScale / spectrumDipScale;
    if (Number.isFinite(ratio) && Math.abs(ratio - 1) >= 0.005) {
      spectrumUserOffset = scaleHudOffset(spectrumUserOffset, ratio);
    }
  }
  spectrumDipScale = dipScale;
  applyHudTarget();
  if (spectrumGeometryKey === key) return;
  spectrumGeometryKey = key;
  sendSpectrumSettings({ ...lastSettings, scale });
};

const isAllowedUrl = (url) => (
  devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://')
);

// 创建时的初始几何：整块工作区（前台全屏时由 watcher 再切到显示器区域）
const geometry = () => screen.getPrimaryDisplay().workArea;

const initialHudBounds = (store, area, dipScale) => {
  // 与 getHudTarget 同几何：锁定态整块区域，解锁态贴底矮条。窗口必须
  // 「出生即最终形态」——否则创建（整屏）与首次 applyHudTarget 之间的
  // setBounds 会成为一次可见的缩放/位移跳变（观感即「从空中放大到下方」）
  const size = hudSurfaceSize(area);
  if (!hudLocked) size.height = unlockedStripHeight(area);
  const savedSize = store.get('spectrumWindowSize');
  const savedPosition = store.get('spectrumWindowPosition');
  const storedDipScale = store.get('spectrumGeometryDipScale');
  const moved = store.get('spectrumUserMoved') === true;

  let offset = { x: 0, y: 0 };
  if (moved && savedPosition && Number.isFinite(savedPosition.x)) {
    // 旧版本存的是贴底 ~280px 条：把保存的左下角位置换算成相对锚点的偏移，
    // 再按 DPI 变化等比换算（storedDipScale 缺失时按当前 DPI 处理）
    const savedHeight = Number.isFinite(savedSize?.height) ? savedSize.height : size.height;
    const savedY = Number.isFinite(savedPosition.y)
      ? savedPosition.y
      : area.y + area.height - savedHeight;
    const previous = hudOffsetFromAnchor(area, { width: size.width, height: savedHeight }, {
      x: savedPosition.x,
      y: savedY
    });
    const ratio = Number.isFinite(storedDipScale) && storedDipScale > 0
      ? dipScale / storedDipScale
      : 1;
    offset = scaleHudOffset(previous, ratio);
  }

  const position = clampHudPosition(area, size, hudPositionFromOffset(area, size, offset));
  return { ...size, ...position, offset };
};

// Windows 默认给顶层窗口的显示/隐藏加 ~200ms 淡入淡出（DWM 过渡）。频谱 HUD
// 全透明、内容为空时看不出它；但解锁态的编辑边框、以及首显瞬间尚未清零的
// 内容都会被这层淡入罩住。DWMWA_TRANSITIONS_FORCEDISABLED(3)=1 只关过渡动画，
// 不动阴影/穿透/置顶；Electron 未暴露此属性，经 koffi 调 dwmapi（与
// fullscreenWatcher 同一桥）。窗口创建后异步落定，生命周期内只需一次；
// 失败只是退回系统默认过渡，不值得打扰用户
let dwmDisableStarted = false;

const disableDwmTransitions = (win) => {
  if (process.platform !== 'win32' || dwmDisableStarted) return;
  dwmDisableStarted = true;
  // 句柄同步取：异步间隙窗口理论上可能已被销毁
  const handle = win.getNativeWindowHandle();
  import('koffi')
    .then((module) => {
      const koffi = module.default || module;
      // 结构体名不能与 fullscreenWatcher 的 DWMDWORD 重名：koffi 全局注册
      const dword = koffi.struct('SpectrumDwmDword', { value: 'uint32' });
      const dwmapi = koffi.load('dwmapi.dll');
      const setAttribute = dwmapi.func('long __stdcall DwmSetWindowAttribute(void*, uint32, _In_ SpectrumDwmDword*, uint32)');
      setAttribute(handle, 3, { value: 1 }, 4);
    })
    .catch(() => {});
};

export const showSpectrumHud = () => {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.showInactive();
    return hudWindow;
  }

  // 创建窗口前先落定锁定状态：initialHudBounds / 首次 applyHudTarget 都依赖它，
  // 顺序错了窗口会以错误几何显示、再跳到目标位置
  hudLocked = getSettings().spectrumLocked === true;
  hudClosed = false;

  const store = getBoundsStore();
  const display = screen.getPrimaryDisplay();
  const factor = display.scaleFactor > 0 ? display.scaleFactor : 1;
  const pixelScale = clampScale((display.size.height * factor) / REFERENCE_HEIGHT);
  const dipScale = pixelScale / factor;
  const area = geometry();
  const initial = initialHudBounds(store, area, dipScale);
  const { width, height, x, y, offset } = initial;

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
  spectrumUserOffset = offset;

  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  disableDwmTransitions(hudWindow);
  hudWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  applySpectrumHudMouseEvents(getSettings().spectrumLocked === true);

  const persistBounds = () => {
    if (!hudWindow || hudWindow.isDestroyed()) return;
    const bounds = hudWindow.getBounds();
    store.set('spectrumWindowPosition', { x: bounds.x, y: bounds.y });
    store.set('spectrumWindowSize', { width: bounds.width, height: bounds.height });
    if (Number.isFinite(spectrumDipScale) && spectrumDipScale > 0) {
      store.set('spectrumGeometryDipScale', spectrumDipScale);
    }
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

  // 「贴底锚定」只看左下角（尺寸由区域决定，可能还没来得及同步）
  const isAtAnchor = () => {
    if (!hudWindow || hudWindow.isDestroyed()) return true;
    const bounds = hudWindow.getBounds();
    const area = getHudArea();
    if (!area) return true;
    return Math.abs(bounds.x - area.x) <= 2
      && Math.abs((bounds.y + bounds.height) - (area.y + area.height)) <= 2;
  };

  const anchor = () => applyHudTarget();

  const reanchorAndSync = () => {
    anchor();
    applySpectrumGeometry();
  };

  hudWindow.on('resize', () => {
    anchor();
    flushBoundsSoon();
  });
  hudWindow.on('move', () => {
    if (surfaceApplying) {
      flushBoundsSoon();
      return;
    }
    const bounds = hudWindow.getBounds();
    const area = getHudArea();
    // 区分「系统贴底锚定」与「用户手动拖动」：左下角不在贴底目标 → 用户拖的，记住它
    if (!spectrumUserMoved && !isAtAnchor()) {
      spectrumUserMoved = true;
      store.set('spectrumUserMoved', true);
    }
    if (spectrumUserMoved && area) {
      spectrumUserOffset = hudOffsetFromAnchor(area, hudSurfaceSize(area), bounds);
    }
    // 整屏表面允许向上/向右溢出（拖动要能改变条基线），但左下角锚点必须留在屏内
    anchor();
    flushBoundsSoon();
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
      spectrumBarOpacity: settings.spectrumBarOpacity,
      spectrumInfoOpacity: settings.spectrumInfoOpacity,
      spectrumMouseFade: settings.spectrumMouseFade,
      spectrumMouseFadeRadius: settings.spectrumMouseFadeRadius,
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
    spectrumUserOffset = { x: 0, y: 0 };
    surfaceApplying = false;
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
  hudClosed = false;
  lastData = null;
  lastSettings = null;
  spectrumGeometryKey = '';
  spectrumDipScale = 0;
  spectrumUserOffset = { x: 0, y: 0 };
  surfaceApplying = false;
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

// 关闭不再隐藏窗口。隐藏→显示会触发 Windows 的窗口级出现动画（DWM 过渡、
// 分层表面重新挂载），即使设了 DWMWA_TRANSITIONS_FORCEDISABLED 也压不干净；
// 而恢复播放不走 show、永远没有这层——这是「开关频谱」与「恢复播放」观感
// 无法对齐的根源。窗口保持存活+可见但内容清空（全透明不可见），重开零窗口
// 事件，入场只剩渲染层的升起动画；销毁只发生在应用退出。
// 解锁态原本靠隐藏避免吃点击，关闭态改由 hudClosed 强制穿透替代。
let hudClosed = false;

export const syncSpectrumHud = (enabled) => {
  if (enabled) {
    hudClosed = false;
    if (hudWindow && !hudWindow.isDestroyed()) {
      applySpectrumHudMouseEvents(getSettings().spectrumLocked === true);
      try {
        hudWindow.webContents.send('spectrum:reopen');
      } catch {
        /* ignore */
      }
      return;
    }
    showSpectrumHud();
    return;
  }
  if (!hudWindow || hudWindow.isDestroyed()) return;
  hudClosed = true;
  try {
    hudWindow.webContents.send('spectrum:close');
  } catch {
    /* ignore */
  }
  applySpectrumHudMouseEvents(getSettings().spectrumLocked === true);
};

// 设置页「重置频谱位置」：清掉拖动记录与全部位置存档，回到左下贴底锚点。
// 关闭态窗口也照常生效（applyHudTarget 只依赖几何，不依赖可见性）
export const resetSpectrumHudPosition = () => {
  spectrumUserMoved = false;
  spectrumUserOffset = { x: 0, y: 0 };
  const store = getBoundsStore();
  store.delete('spectrumUserMoved');
  store.delete('spectrumWindowPosition');
  store.delete('spectrumWindowSize');
  store.delete('spectrumGeometryDipScale');
  applyHudTarget();
};

// 锁定 = 鼠标完全穿透（forward 让 mousemove 仍转发，方便渲染层感知）；解锁 = 可拖动/缩放。
// 解除穿透时不能带 forward 选项：Windows 上 (false, {forward:true}) 解除不干净，窗口仍然穿透
// HUD 表面现在是整块工作区：解锁态整屏都会吃鼠标，渲染层为此提供「锁定」按钮 + 双击任意处复位，
// 且解锁态指示框/徽标全程 pointer-events:none（只有按钮可点），不挡穿透路径。
export const applySpectrumHudMouseEvents = (locked) => {
  hudLocked = locked === true;
  if (!hudWindow || hudWindow.isDestroyed()) return;
  // 关闭态强制穿透：窗口不再隐藏（见 syncSpectrumHud），解锁态的空窗口
  // 若仍接鼠标会吃掉整片区域的点击
  if (hudLocked || hudClosed) {
    hudWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    hudWindow.setIgnoreMouseEvents(false);
  }
  // 锁定/解锁切换即改变目标尺寸：解锁收回底部条，锁定铺回整个区域
  applyHudTarget();
};

export const syncSpectrumHudSettings = (settings) => {
  const payload = {
    spectrumScale: settings.spectrumScale,
    spectrumSigmaSmoothing: settings.spectrumSigmaSmoothing,
    // 两级透明度都由渲染层合成：条形 canvas globalAlpha + 信息卡 CSS opacity
    spectrumBarOpacity: settings.spectrumBarOpacity,
    spectrumInfoOpacity: settings.spectrumInfoOpacity,
    // 鼠标靠近透明（渲染层按光标位置做圆形渐隐）+ 渐隐圈半径
    spectrumMouseFade: settings.spectrumMouseFade,
    spectrumMouseFadeRadius: settings.spectrumMouseFadeRadius,
    spectrumPreset: settings.spectrumPreset,
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
