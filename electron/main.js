import { app, BrowserWindow, dialog, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC, SETTINGS_ARG, findDeepLinkArg, hasSettingsArg, parseDeepLink, formatTrayTooltip } from '../shared/ipc.js';
import { initSettings, getSettings, updateSettings } from './services/settingsStore.js';
import { registerIpc } from './ipc/index.js';
import { startSidecar, stopSidecar, initSidecar } from './services/sidecar.js';
import { applyProxySettings } from './services/proxyService.js';
import { initLogSink, flushLogs, recordRendererMessage } from './services/logSink.js';
import { applyGpuAccelerationFlag } from './services/runtimeFlags.js';
import { initAuthSession, flushAuthSession } from './services/authSession.js';
import { getTrayInstance, hasTray, initTray, setTrayTooltip, syncTray } from './tray.js';
import customTrayMenu from './services/customTrayMenu.js';
import { destroyDesktopLyrics, getDesktopLyricsWindow, syncDesktopLyrics } from './windows/desktopLyrics.js';
import { destroySpectrumHud, getSpectrumWindow, syncSpectrumHud } from './windows/spectrumHud.js';
import { initUpdater, stopUpdater } from './services/updater.js';
import { initGlobalKeyListener, stopGlobalKeyListener } from './services/globalKeyService.js';
import { applyGlobalShortcuts, initGlobalShortcuts, stopGlobalShortcuts } from './services/globalShortcuts.js';
import {
  initDockController,
  isMainWindowDocked,
  raiseMainWindow,
  resetDockState,
  restoreMainWindow,
  stopDockAnimation,
  toggleMainWindowDock
} from './windows/sigmaDock.js';
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

// ===== ready 之前必须完成的设置 =====
// 日志器最先起：后面所有 console 才有落盘副本可导
initLogSink();
// GPU 开关必须在 app.ready 之前落定：disableHardwareAcceleration 与透明窗口的
// 软件合成开关只对「尚未建起的 GPU 进程」有效，ready 之后再调只是记个标志。
// 因此设置存储也要提前初始化（electron-store 只读 userData，不依赖 ready）。
initSettings();
applyGpuAccelerationFlag(getSettings().gpuAcceleration);

let mainWindow = null;
let isQuitting = false;
let shutdownStarted = false;

// ===== 启动意图：跳转列表 --settings 与 jello:// 深链 =====
// 渲染层挂载时通过 app:launch-intent 拉取一次；运行期到达的深链走 app:deep-link 推送
let pendingOpenSettings = false;
let pendingDeepLink = null;

const deliverDeepLink = () => {
  if (!pendingDeepLink || !mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) {
    // 页面加载期到达的深链：等就绪后再投（渲染层挂载时的拉取是另一路兜底）
    mainWindow.webContents.once('did-finish-load', () => setTimeout(deliverDeepLink, 150));
    return;
  }
  const params = pendingDeepLink;
  pendingDeepLink = null;
  mainWindow.webContents.send(IPC.APP_DEEP_LINK, params);
};

const handleProtocolUrl = (url) => {
  const params = parseDeepLink(url);
  if (!params) return;
  pendingDeepLink = params;
  deliverDeepLink();
};

const consumeLaunchIntent = () => {
  const intent = { openSettings: pendingOpenSettings, deepLink: pendingDeepLink };
  pendingOpenSettings = false;
  pendingDeepLink = null;
  return intent;
};

const openSettingsView = () => {
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(IPC.UI_NAVIGATE, { path: '/settings' });
  } else {
    // 窗口尚未就绪：记下意图，渲染层挂载后拉取
    pendingOpenSettings = true;
  }
};

// 二次启动的 argv 里可能带 --settings（跳转列表）或 jello:// URL（协议唤起）
const handleLaunchArgv = (argv) => {
  const windowReady = mainWindow && !mainWindow.isDestroyed();
  if (hasSettingsArg(argv)) {
    if (windowReady) openSettingsView();
    else pendingOpenSettings = true; // 首实例还在启动：记下意图，挂载后拉取
  } else if (windowReady) {
    showMainWindow();
  }
  const url = findDeepLinkArg(argv);
  if (url) handleProtocolUrl(url);
};

// 单实例锁：第二个实例把 argv 转交首个实例后退出，避免重复托盘/侧车抢端口
if (!app.requestSingleInstanceLock()) {
  app.quit();
  // 此刻尚未初始化任何服务，直接退出，跳过 before-quit 清理链
  process.exit(0);
}
app.on('second-instance', (_event, argv) => handleLaunchArgv(argv));
// macOS：协议唤起走 open-url 事件而不是 argv
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});
// 冷启动 argv：--settings（跳转列表）与 Windows 协议唤起（jello://… 直接进 argv）
if (hasSettingsArg(process.argv)) pendingOpenSettings = true;
const startupLink = findDeepLinkArg(process.argv);
if (startupLink) {
  const params = parseDeepLink(startupLink);
  if (params) pendingDeepLink = params;
}

// 注册 jello:// 协议。dev 模式必须带应用根目录参数，否则系统会用裸 electron
// 打开链接（空白窗口）；打包后无额外参数
const registerDeepLinkProtocol = () => {
  try {
    const devArgs = app.isPackaged ? [] : [path.resolve(__dirname, '..')];
    app.setAsDefaultProtocolClient('jello', process.execPath, devArgs);
  } catch (error) {
    console.warn('[protocol] jello:// 注册失败:', error?.message || error);
  }
};

// Windows 跳转列表：任务栏图标右键 → 任务 → 设置。
// 外壳装饰类接口失败绝不能中断启动流程，否则后面的 createWindow 不会执行
const setupJumpList = () => {
  if (process.platform !== 'win32') return;
  try {
    const status = app.setJumpList([
      {
        type: 'tasks',
        items: [
          {
            type: 'task',
            program: process.execPath,
            args: SETTINGS_ARG,
            title: '设置',
            description: '打开 Jello Music 设置',
            iconPath: process.execPath,
            iconIndex: 0
          }
        ]
      }
    ]);
    if (status !== 'ok') console.warn('[jumplist] 设置未生效:', status);
  } catch (error) {
    console.warn('[jumplist] 设置异常:', error?.message || error);
  }
};

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

const quitApplication = () => {
  isQuitting = true;
  app.quit();
};

// GPU 开关之类的设置在 UI 上提示「需重启」，用户点「立即重启」时走这里。
// 仍走正常退出链（不 app.exit）：sidecar 与 session 落盘都要在退出前完成，
// 否则重启后拿到的是一个孤儿接口进程。
const restartApp = () => {
  app.relaunch();
  flushLogs();
  quitApplication();
};

const toggleAuxSetting = (key, sync) => {
  const next = !getSettings()[key];
  updateSettings({ [key]: next });
  sync(next);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('settings:changed', getSettings());
  }
};

// 多屏时在光标所在显示器打开：用户通常在当前工作的屏幕上唤起面板，
// 固定主屏会让副屏用户每次都要手动拖过去。返回工作区内居中的坐标。
const initialWindowPosition = () => {
  const WINDOW_WIDTH = 800;
  const WINDOW_HEIGHT = 600;
  let display;
  try {
    display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch {
    display = null;
  }
  const area = (display || screen.getPrimaryDisplay()).workArea;
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  return {
    x: clamp(Math.round(area.x + (area.width - WINDOW_WIDTH) / 2), area.x, area.x + Math.max(0, area.width - WINDOW_WIDTH)),
    y: clamp(Math.round(area.y + (area.height - WINDOW_HEIGHT) / 2), area.y, area.y + Math.max(0, area.height - WINDOW_HEIGHT))
  };
};

function createWindow() {
  const position = initialWindowPosition();
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    x: position.x,
    y: position.y,
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
    skipTaskbar: true,
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

  // 窗口（重）建后补投未消费的深链；加载期到达的由 deliverDeepLink 内部等待
  deliverDeepLink();
}

// ===== 托盘悬停提示（正在播放）=====
// 复用自绘托盘菜单的 store 抓取机制（executeJavaScript），不为提示新增 IPC 通道。
// 2s 轮询即节流；setTrayTooltip 内部对相同文案去重，避免无谓的原生调用。
let trayTooltipTimer = null;
let trayTooltipScraping = false;

const startTrayTooltipSync = () => {
  if (trayTooltipTimer) return;
  trayTooltipTimer = setInterval(() => {
    if (trayTooltipScraping || !hasTray()) return;
    const win = mainWindow;
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
    trayTooltipScraping = true;
    customTrayMenu.getMenuState(win)
      .then((state) => {
        setTrayTooltip(formatTrayTooltip({
          playing: state?.isPlaying,
          title: state?.song?.title,
          artist: state?.song?.artist
        }));
      })
      .catch(() => {})
      .finally(() => {
        trayTooltipScraping = false;
      });
  }, 2000);
};

const stopTrayTooltipSync = () => {
  if (trayTooltipTimer) {
    clearInterval(trayTooltipTimer);
    trayTooltipTimer = null;
  }
};

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  // Electron 45 起事件对象带 level/message/location，旧签名是位置参数：两种都收
  contents.on('console-message', (event, legacyLevel, legacyMessage, legacyLine, legacySource) => {
    const level = event?.level ?? legacyLevel;
    const message = event?.message ?? legacyMessage;
    if (message == null) return;
    const source = event?.location?.url || legacySource || '';
    const line = event?.location?.lineNumber ?? legacyLine;
    recordRendererMessage(level, message, line ? `${source}:${line}` : source);
  });
});

app.whenReady().then(async () => {
  await initAuthSession();
  initUpdater();
  // 代理在 sidecar 启动与首个窗口创建之前应用：Chromium 网络栈与 sidecar
  // 的出站请求从第一个包起就走同一条代理链路
  await applyProxySettings(getSettings());
  initSidecar(({ crashed, detail }) => {
    if (!crashed) return;
    console.error(`[sidecar] 运行期退出 ${detail}`);
  });
  registerDeepLinkProtocol();
  setupJumpList();
  initDockController(() => mainWindow);
  registerIpc(
    () => [mainWindow, getDesktopLyricsWindow(), getSpectrumWindow()].filter(Boolean),
    { consumeLaunchIntent, restartApp }
  );
  initTray({
    showWindow: showMainWindow,
    quit: quitApplication,
    playPause: () => sendPlayerCommand('toggle'),
    previous: () => sendPlayerCommand('previous'),
    next: () => sendPlayerCommand('next'),
    showHide: () => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.hide();
        return;
      }
      showMainWindow();
    },
    openSettings: openSettingsView
  });
  customTrayMenu.init(
    () => mainWindow,
    () => getTrayInstance(),
    {
      showHide: () => {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
          mainWindow.hide();
          return;
        }
        showMainWindow();
      },
      openSettings: openSettingsView,
      playPause: () => sendPlayerCommand('toggle'),
      previous: () => sendPlayerCommand('previous'),
      next: () => sendPlayerCommand('next'),
      quit: quitApplication
    }
  );
  syncTray(getSettings().minimizeToTray);
  startTrayTooltipSync();
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
    toggleMainWindow: handleRightShift,
    quitApp: quitApplication
  });
  const shortcutStatus = applyGlobalShortcuts(getSettings().shortcuts);
  if (!shortcutStatus.ok) {
    console.warn('[shortcuts] 部分热键注册失败:', JSON.stringify(shortcutStatus.failed));
  }

  app.on('activate', showMainWindow);
}).catch((error) => {
  // 启动链中任一步抛错都会跳过 createWindow，留下无窗口、无托盘却仍占着
  // 单实例锁的僵尸进程（之后再启动会静默退出）。显式报错并用 app.exit 跳过
  // before-quit 清理链（此时部分服务尚未初始化）
  console.error('[startup] 初始化失败:', error?.stack || error);
  try {
    dialog.showErrorBox('Jello Music 启动失败', String(error?.stack || error));
  } catch {
    /* 对话框不可用时至少留下控制台记录 */
  }
  app.exit(1);
});

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownStarted) return;

  shutdownStarted = true;
  event.preventDefault();
  flushLogs();
  stopTrayTooltipSync();
  stopGlobalShortcuts();
  stopGlobalKeyListener();
  stopDockAnimation();
  stopUpdater();
  customTrayMenu.cleanup();
  destroyDesktopLyrics();
  destroySpectrumHud();
  // stopSidecar 最坏路径约 5s（shutdown POST 2s + 子进程退出 3s），
  // 不能只 fire-and-forget：否则被复用的实例会在退出闸门之后仍活着
  const cleanup = Promise.allSettled([
    stopSidecar(),
    flushAuthSession()
  ]);
  void Promise.race([
    cleanup,
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  app.quit();
});
