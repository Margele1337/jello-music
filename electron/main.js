import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSettings, getSettings, updateSettings } from './services/settingsStore.js';
import { registerIpc } from './ipc/index.js';
import { startSidecar, stopSidecar } from './services/sidecar.js';
import { initAuthSession, flushAuthSession } from './services/authSession.js';
import { hasTray, initTray, syncTray } from './tray.js';
import { destroyDesktopLyrics, getDesktopLyricsWindow, syncDesktopLyrics } from './windows/desktopLyrics.js';
import { destroySpectrumHud, getSpectrumWindow, syncSpectrumHud } from './windows/spectrumHud.js';
import { initUpdater, stopUpdater } from './services/updater.js';
import { initGlobalKeyListener, stopGlobalKeyListener } from './services/globalKeyService.js';
import { initGlobalShortcuts, stopGlobalShortcuts } from './services/globalShortcuts.js';
import {
  initDockController,
  isMainWindowDocked,
  raiseMainWindow,
  resetDockState,
  restoreMainWindow,
  stopDockAnimation,
  toggleMainWindowDock
} from './windows/sigmaDock.js';
import { setThumbarButtons } from './windows/thumbarButtons.js';
import { installSigmaSizeGuard } from './services/sigmaSizeGuard.js';

// Keep the clean-room app's settings/session isolated from the legacy GPL app.
app.setName('Jello Music Clean');
app.setPath('userData', path.join(app.getPath('appData'), 'jello-music-clean'));
app.setAppUserModelId('cn.jello.music');

// Chromium 的 Windows 网络变化探测在部分机器上会反复输出无害的
// WSALookupServiceBegin 10108 错误；只压掉 Chromium 错误级日志，
// 应用自身的 console/错误处理和侧车 stderr 不受影响。
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('log-level', '3');
}

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
  // 呼出即视为用户要面板在前：置顶 600ms（全屏前台时保持），再自动降回
  raiseMainWindow();
  if (isMainWindowDocked()) restoreMainWindow();
}

function handleRightShift() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || mainWindow.isMinimized()) {
    showMainWindow();
    return;
  }
  const wasDocked = isMainWindowDocked();
  toggleMainWindowDock();
  // 与旧版 toggleSigmaWindowFromHotkey 一致：滑出后置顶，否则按了像没反应
  if (wasDocked && !isMainWindowDocked()) raiseMainWindow();
}

function sendPlayerCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player:command', command);
  }
}

const toggleAuxSetting = (key, sync) => {
  const next = !getSettings()[key];
  updateSettings({ [key]: next });
  sync(next);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('settings:changed', getSettings());
  }
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    maxWidth: 800,
    maxHeight: 600,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    show: false,
    icon: path.join(__dirname, 'assets', 'app-icon.png'),
    backgroundColor: '#00000000',
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
  if (process.platform === 'win32') setThumbarButtons(mainWindow, false);

  // 尺寸守卫：跨缩放显示器拖动/系统缩放变化时 WM_DPICHANGED 可能改坏
  // 无边框透明窗口尺寸（Chromium issue 40813134），双层校验并自动修复
  const disposeSizeGuard = installSigmaSizeGuard(() => mainWindow, 800, 600);

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
    disposeSizeGuard();
    resetDockState();
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
  initDockController(() => mainWindow);
  registerIpc(() => [mainWindow, getDesktopLyricsWindow(), getSpectrumWindow()].filter(Boolean));
  initTray({
    showWindow: showMainWindow,
    quit: () => {
      isQuitting = true;
      app.quit();
    },
    playPause: () => sendPlayerCommand('toggle'),
    previous: () => sendPlayerCommand('previous'),
    next: () => sendPlayerCommand('next')
  });
  syncTray(getSettings().minimizeToTray);
  const platform = getSettings().dataSource === 'concept' ? 'lite' : 'official';
  startSidecar({ platform }).catch((error) => {
    console.error('[sidecar] 启动失败:', error.message);
  });
  createWindow();
  syncDesktopLyrics(getSettings().desktopLyrics);
  syncSpectrumHud(getSettings().spectrum);
  initGlobalKeyListener({ onRightShift: handleRightShift });
  initGlobalShortcuts({
    sendCommand: sendPlayerCommand,
    toggleDesktopLyrics: () => toggleAuxSetting('desktopLyrics', syncDesktopLyrics),
    toggleSpectrum: () => toggleAuxSetting('spectrum', syncSpectrumHud),
    toggleMainWindow: showMainWindow
  });

  app.on('activate', showMainWindow);
});

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownStarted) return;

  shutdownStarted = true;
  event.preventDefault();
  stopGlobalShortcuts();
  stopGlobalKeyListener();
  stopDockAnimation();
  stopUpdater();
  destroyDesktopLyrics();
  destroySpectrumHud();
  void stopSidecar();
  void Promise.race([
    flushAuthSession(),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  app.quit();
});
