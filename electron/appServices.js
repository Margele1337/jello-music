import { app, ipcMain, BrowserWindow, screen, Tray, Menu, TouchBar, globalShortcut, dialog, shell, nativeImage } from 'electron';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import log from 'electron-log';
import Store from 'electron-store';
import treeKill from 'tree-kill';
import { fileURLToPath } from 'url';
import isDev from 'electron-is-dev';
import fs from 'fs';
import { Notification } from 'electron';
import { t } from './language/i18n.js';
import { bindExternalLinkHandler } from './services/externalLinkHandler.js';
import customTrayMenuService from './services/customTrayMenuService.js';
import { checkForUpdates } from './services/updater.js';
import { watchForegroundFullscreen, stopForegroundFullscreenWatcher } from './services/fullscreenWatcher.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const store = new Store();
const { TouchBarLabel, TouchBarButton, TouchBarGroup, TouchBarSpacer } = TouchBar;
let mainWindow = null;
let apiProcess = null;
let tray = null;
// TouchBar 的 IPC 监听器引用：重复创建 TouchBar 时先摘除旧的，避免重复注册
let touchBarPlayPauseHandler = null;
let touchBarLyricsHandler = null;

// 创建主窗口
export function createWindow() {
    const savedConfig = store.get('settings');
    const useNativeTitleBar = savedConfig?.nativeTitleBar === 'on' ? true : false;
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    const windowWidth = Math.min(1200, screenWidth * 0.8);
    const windowHeight = Math.min(938, screenHeight * 0.9);
    const lastWindowState = store.get('windowState') || {};

    let x = lastWindowState.x;
    let y = lastWindowState.y;
    let width = lastWindowState.width || windowWidth;
    let height = lastWindowState.height || windowHeight;

    width = Math.min(width, screenWidth);
    height = Math.min(height, screenHeight);

    // 多显示器：保存的位置可能落在副屏（负坐标或超出主屏宽度），用 getDisplayMatching
    // 找最近显示器并夹到其工作区内；只有完全没有保存过位置时才回退到主屏居中
    const hasSavedPosition = Number.isFinite(x) && Number.isFinite(y);
    if (!hasSavedPosition) {
        x = Math.floor((screenWidth - width) / 2);
        y = Math.floor((screenHeight - height) / 2);
    } else {
        const display = screen.getDisplayMatching({ x, y, width, height });
        const area = display.workArea;
        x = Math.min(Math.max(x, area.x), area.x + area.width - width);
        y = Math.min(Math.max(y, area.y), area.y + area.height - height);
    }

    mainWindow = new BrowserWindow({
        width: width,
        height: height,
        x: x,
        y: y,
        minWidth: 890,
        minHeight: 750,
        show: false,
        skipTaskbar: true,
        frame: useNativeTitleBar,
        titleBarStyle: useNativeTitleBar ? 'default' : 'hiddenInset',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            devTools: true,
            webSecurity: false, // 禁用 CORS、同源策略
            allowRunningInsecureContent: true, // 允许混合内容
            zoomFactor: 1.0,
            backgroundThrottling: false // 主窗口隐藏/失焦后频谱数据生产者 rAF 仍持续运行
        },
        icon: getIconPath('icon.ico')
    });
    bindExternalLinkHandler(mainWindow);

    if (store.get('maximize')) {
        mainWindow.maximize();
    }
    // 之前只有 get 没有 set：最大化状态从不落盘，退出后无法恢复
    mainWindow.on('maximize', () => store.set('maximize', true));
    mainWindow.on('unmaximize', () => store.set('maximize', false));

    if (isDev) {
        mainWindow.loadURL('http://localhost:8080');
        mainWindow.webContents.openDevTools();
    } else {
        if (savedConfig?.networkMode == 'devnet') { //开发网
            mainWindow.loadURL('http://localhost:8080');
        } else { //主网
            mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
        }
    }

    mainWindow.webContents.on('dom-ready', () => {
        console.log('DOM Ready');
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('Failed to load:', errorCode, errorDescription);
    });

    mainWindow.once('ready-to-show', () => {
        if (savedConfig?.startMinimized === 'on') {
            mainWindow.hide();
        }
    });

    mainWindow.webContents.on('did-finish-load', () => {
        console.log('Page Loaded Successfully');
        mainWindow.webContents.insertCSS('::-webkit-scrollbar { display: none; }');
    });

    mainWindow.on('close', (event) => {
        // 开发模式：关闭主窗口即退出应用（连带关闭频谱/歌词等子窗口，dev 脚本随之中止）
        if (process.env.NODE_ENV === 'development') {
            app.isQuitting = true;
            app.quit();
            return;
        }
        const savedConfig = store.get('settings');
        if (savedConfig?.minimizeToTray === 'off') {
            app.isQuitting = true;
            app.quit();
        }
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    if (process.platform === 'win32') {
        setThumbarButtons(mainWindow);
    }

    if (savedConfig?.desktopLyrics === 'on') {
        createLyricsWindow();
    }

    if (savedConfig?.desktopSpectrum === 'on') {
        createSpectrumWindow();
    }

    if (savedConfig?.desktopKeystrokes === 'on') {
        createKeystrokesWindow();
    }
    return mainWindow;
}

let lyricsWindow;

const persistLyricsWindowBounds = () => {
    if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
    const { x, y, width, height } = lyricsWindow.getBounds();
    store.set('lyricsWindowPosition', { x, y });
    store.set('lyricsWindowSize', { width, height });
};

let spectrumWindow;
let spectrumFullscreenState = { fullscreen: false, monitor: null };
let stopSpectrumFullscreenWatch = null;
let spectrumDisplayListenersBound = false;
let spectrumAnchorGuard = false;
let spectrumGeometryKey = '';
// 窗口当前尺寸所依据的 DIP 系数：分辨率/缩放变化时靠它把窗口同比换算过去
let spectrumDipScale = 0;
// 用户是否手动拖动过频谱窗口：手动位置优先，之后不再强制贴底（重新锁定时复位）
let spectrumUserMoved = false;

// 频谱几何基准：1080p 物理像素。sigmarebase 把条形像素高硬编码成「游戏窗口高/1080」，
// 只在 1080p 下正确；这里改为按当前显示器的物理高度等比缩放，1080p 仍是原值，
// 1440p/4K 则条宽、条高、默认窗口尺寸同步放大，观感与 1080p 一致。
const SPECTRUM_REFERENCE_HEIGHT = 1080;
const SPECTRUM_BASE_WINDOW_HEIGHT = 280;
const SPECTRUM_BASE_MIN_WIDTH = 300;
const SPECTRUM_BASE_MIN_HEIGHT = 60;
const SPECTRUM_MIN_SCALE = 0.5;
const SPECTRUM_MAX_SCALE = 4;

const clampSpectrumScale = (scale) =>
    Math.min(SPECTRUM_MAX_SCALE, Math.max(SPECTRUM_MIN_SCALE, scale));

// 相对 1080p 的物理像素缩放系数
const getSpectrumGeometryScale = (display) => {
    const pixelHeight = display?.size?.height || 0;
    if (!pixelHeight) return 1;
    return clampSpectrumScale(pixelHeight / SPECTRUM_REFERENCE_HEIGHT);
};

// 物理像素缩放 → DIP（窗口尺寸单位），保证 4K + 150% 缩放下默认窗口物理高度仍是 560px
const toDipScale = (display, pixelScale) => {
    const factor = display?.scaleFactor;
    return factor > 0 ? pixelScale / factor : pixelScale;
};

// 取窗口当前所在的显示器（窗口异常时退回主屏）
const getSpectrumDisplay = () => {
    try {
        return screen.getDisplayMatching(spectrumWindow.getBounds());
    } catch (error) {
        return screen.getPrimaryDisplay();
    }
};

// 显示器分辨率/缩放变化后，按 DIP 系数把窗口同比缩放。
// 渲染端条高按「物理像素 × 分辨率系数」绘制，窗口尺寸却走 DIP：只下发系数不缩放窗口，
// 换分辨率后条形会按新比例放大而窗口尺寸不变，结果就是大量条形顶到窗口上沿被截断。
const rescaleSpectrumWindow = (display, dipScale) => {
    if (!spectrumWindow || spectrumWindow.isDestroyed()) return;
    const lastDipScale = spectrumDipScale;
    spectrumDipScale = dipScale;
    if (!(lastDipScale > 0) || !Number.isFinite(lastDipScale)) return;
    const ratio = dipScale / lastDipScale;
    if (!(ratio > 0) || Math.abs(ratio - 1) < 0.005) return;

    const { x, y, width, height } = spectrumWindow.getBounds();
    const area = display.workArea;
    const nextWidth = Math.min(Math.round(width * ratio), area.width);
    const nextHeight = Math.min(Math.round(height * ratio), area.height);
    if (nextWidth === width && nextHeight === height) return;

    spectrumAnchorGuard = true;
    try {
        spectrumWindow.setBounds({ x, y, width: nextWidth, height: nextHeight });
    } finally {
        spectrumAnchorGuard = false;
    }
    // 尺寸跟着显示器变了，下次启动要以新系数为基准继续迁移
    store.set('spectrumGeometryDipScale', dipScale);
};

// 改分辨率、改缩放、跨屏拖动都走这里：窗口尺寸同步 + 下发渲染端系数
const applySpectrumGeometry = () => {
    if (!spectrumWindow || spectrumWindow.isDestroyed()) return;
    const display = getSpectrumDisplay();
    const scale = getSpectrumGeometryScale(display);
    rescaleSpectrumWindow(display, toDipScale(display, scale));
    const key = `${scale}|${display.size.width}x${display.size.height}`;
    if (key === spectrumGeometryKey) return;
    spectrumGeometryKey = key;
    spectrumWindow.webContents.send('spectrum-geometry', { scale });
};

const persistSpectrumWindowBounds = () => {
    if (!spectrumWindow || spectrumWindow.isDestroyed()) return;
    const { x, y, width, height } = spectrumWindow.getBounds();
    store.set('spectrumWindowPosition', { x, y });
    store.set('spectrumWindowSize', { width, height });
};

// 有应用全屏时贴屏幕物理底边，否则贴任务栏上沿
const getSpectrumAnchorBottom = () => {
    const bounds = spectrumWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    let anchorArea = display.workArea;

    if (spectrumFullscreenState.fullscreen && spectrumFullscreenState.monitor) {
        try {
            const origin = screen.screenToDipPoint({
                x: spectrumFullscreenState.monitor.x,
                y: spectrumFullscreenState.monitor.y
            });
            const sameDisplay = Math.abs(origin.x - display.bounds.x) <= 2
                && Math.abs(origin.y - display.bounds.y) <= 2;
            if (sameDisplay) anchorArea = display.bounds;
        } catch (error) {
            anchorArea = display.bounds;
        }
    }

    return anchorArea.y + anchorArea.height;
};

// 当前窗口位置是否正好是贴底锚定位置：用于区分「我们自己锚定」与「用户手动拖动」
const isSpectrumAtAnchor = () => {
    if (!spectrumWindow || spectrumWindow.isDestroyed()) return true;
    const bounds = spectrumWindow.getBounds();
    const anchorY = getSpectrumAnchorBottom() - bounds.height;
    return Math.abs(bounds.y - anchorY) <= 2;
};

const anchorSpectrumWindow = () => {
    if (spectrumAnchorGuard || !spectrumWindow || spectrumWindow.isDestroyed()) return;
    const bounds = spectrumWindow.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    if (spectrumUserMoved) {
        // 用户自定义过位置：只夹回工作区内，不再强制贴底（否则拖完的位置会被拉回去）
        const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width);
        const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height);
        if (x !== bounds.x || y !== bounds.y) {
            spectrumWindow.setBounds({ x, y, width: bounds.width, height: bounds.height });
        }
        return;
    }
    const y = getSpectrumAnchorBottom() - bounds.height;
    if (bounds.y === y) return;
    spectrumAnchorGuard = true;
    try {
        spectrumWindow.setBounds({ x: bounds.x, y, width: bounds.width, height: bounds.height });
    } finally {
        spectrumAnchorGuard = false;
    }
};

// 重新锁定频谱：清除用户自定义位置，回到贴底锚定
export function resetSpectrumManualPosition() {
    spectrumUserMoved = false;
    if (store.get('spectrumUserMoved') === true) {
        store.set('spectrumUserMoved', false);
    }
    anchorSpectrumWindow();
    persistSpectrumWindowBounds();
}

const bindSpectrumDisplayListeners = () => {
    if (spectrumDisplayListenersBound) return;
    spectrumDisplayListenersBound = true;
    const reanchor = () => {
        anchorSpectrumWindow();
        applySpectrumGeometry();
    };
    screen.on('display-metrics-changed', reanchor);
    screen.on('display-added', reanchor);
    screen.on('display-removed', reanchor);
};

export function stopSpectrumFullscreenWatcher() {
    if (stopSpectrumFullscreenWatch) {
        stopSpectrumFullscreenWatch();
        stopSpectrumFullscreenWatch = null;
    }
    stopForegroundFullscreenWatcher();
}

// 频谱窗口渲染进程挂载后调用：补发当前显示器的分辨率系数（loadURL 前发的会被丢弃）
export function syncSpectrumGeometry() {
    spectrumGeometryKey = '';
    applySpectrumGeometry();
}

export function createLyricsWindow() {
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

    const windowWidth = Math.floor(screenWidth * 0.7);
    const windowHeight = 128;
    const legacyWindowHeight = 200;

    const savedLyricsPosition = store.get('lyricsWindowPosition') || {};
    const savedLyricsSize = store.get('lyricsWindowSize') || {
        width: windowWidth,
        height: windowHeight
    };

    let x = savedLyricsPosition.x;
    let y = savedLyricsPosition.y;
    let width = savedLyricsSize.width || windowWidth;
    let height = savedLyricsSize.height || windowHeight;
    if (height === legacyWindowHeight) height = windowHeight;

    // 限制窗口尺寸不超过屏幕
    width = Math.min(width, screenWidth);
    height = Math.min(height, screenHeight);

    // 检查位置是否有效：仅要求坐标存在（多屏下副屏坐标可能为负或超出主屏宽度，同样是合法的）
    const hasSavedPosition = Number.isFinite(x) && Number.isFinite(y);

    // 如果从未保存过位置，设置默认位置（主屏底部）
    if (!hasSavedPosition) {
        x = Math.floor((screenWidth - width) / 2);
        y = screenHeight - height;
    } else {
        // 已保存位置：夹取到最近显示器的工作区，防止显示器移除/缩放变化后窗口飞出屏幕
        const display = screen.getDisplayMatching({ x, y, width, height });
        const area = display.workArea;
        x = Math.min(Math.max(x, area.x), area.x + area.width - width);
        y = Math.min(Math.max(y, area.y), area.y + area.height - height);
    }

    lyricsWindow = new BrowserWindow({
        width: width,
        height: height,
        x: x,
        y: y,
        minWidth: 800,
        minHeight: windowHeight,
        maxWidth: screenWidth,
        maxHeight: screenHeight,
        alwaysOnTop: true,
        frame: false,
        transparent: true,
        resizable: true,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: false, // 禁用 CORS、同源策略
            allowRunningInsecureContent: true, // 允许混合内容
            backgroundThrottling: false,
            zoomFactor: 1.0
        }
    });

    lyricsWindow.on('resize', persistLyricsWindowBounds);
    lyricsWindow.on('move', persistLyricsWindowBounds);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.lyricsWindow = lyricsWindow;
    lyricsWindow.on('closed', () => {
        // 主窗口可能已销毁（退出流程中），判空避免 TypeError
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.lyricsWindow = null;
        }
    });

    if (isDev) {
        lyricsWindow.loadURL('http://localhost:8080/#/lyrics');
        lyricsWindow.webContents.openDevTools({ mode: 'detach' });
    } else {
        lyricsWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
            hash: 'lyrics'
        });
    }



    // 设置窗口置顶级别
    lyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    lyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // 允许窗口透明
    lyricsWindow.setBackgroundColor('#00000000');
}

export function createSpectrumWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const savedConfig = store.get('settings') || {};
    const savedPosition = store.get('spectrumWindowPosition') || {};

    // 目标显示器按已保存的位置判断。多屏分辨率/缩放不一致时，用主屏系数建窗会与渲染端
    // （渲染端取窗口所在屏）打架，条形被放大或压扁，所以这里要和渲染端取同一块屏。
    const targetDisplay = (Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y))
        ? screen.getDisplayNearestPoint({ x: savedPosition.x, y: savedPosition.y })
        : primaryDisplay;
    const { width: screenWidth, height: screenHeight } = targetDisplay.workAreaSize;

    // 分辨率系数：物理像素相对 1080p；窗口尺寸走 DIP，所以要先除以系统缩放
    const pixelScale = getSpectrumGeometryScale(targetDisplay);
    const dipScale = toDipScale(targetDisplay, pixelScale);
    const defaultHeight = Math.round(SPECTRUM_BASE_WINDOW_HEIGHT * dipScale);
    const savedSizeRaw = store.get('spectrumWindowSize');
    const savedSize = savedSizeRaw || {
        width: screenWidth,
        height: defaultHeight
    };

    // 换过分辨率/缩放后按系数迁移已保存的尺寸，避免沿用旧尺寸导致条形被截断。
    // 用 DIP 系数（物理系数 ÷ 系统缩放）而不是物理系数：只改分辨率时两者等价，
    // 只改 Windows 缩放时才能保持窗口的物理高度不变。
    const storedDipScale = store.get('spectrumGeometryDipScale');
    let width = savedSize.width || screenWidth;
    let height = savedSize.height || defaultHeight;
    let scaleRatio = 1;
    if (Number.isFinite(storedDipScale) && storedDipScale > 0) {
        scaleRatio = dipScale / storedDipScale;
    } else if (savedSizeRaw && Math.abs(height - SPECTRUM_BASE_WINDOW_HEIGHT) <= 2) {
        // 老版本没记录系数：高度仍是写死的默认 280，说明是 1080p@100% 时代的整屏默认窗口。
        // 必须同时有历史尺寸才成立——全新安装时 defaultHeight 恰好也是 280，会被误当成遗留值放大一倍
        scaleRatio = dipScale;
    }
    if (scaleRatio !== 1) {
        width = Math.round(width * scaleRatio);
        height = Math.round(height * scaleRatio);
    }

    width = Math.min(width, screenWidth);
    height = Math.min(height, screenHeight);
    // 旧版本记的是物理系数，这里清掉，避免留下语义相近的脏键
    if (store.has('spectrumGeometryScale')) store.delete('spectrumGeometryScale');
    store.set('spectrumGeometryDipScale', dipScale);

    // 位置夹到目标显示器工作区内，越界就贴左下角
    const area = targetDisplay.workArea;
    let x = Math.min(Math.max(savedPosition.x ?? area.x, area.x), area.x + area.width - width);
    let y = Math.min(Math.max(savedPosition.y ?? (area.y + area.height - height), area.y), area.y + area.height - 1);

    spectrumWindow = new BrowserWindow({
        width: width,
        height: height,
        x: x,
        y: y,
        minWidth: Math.round(SPECTRUM_BASE_MIN_WIDTH * dipScale),
        minHeight: Math.round(SPECTRUM_BASE_MIN_HEIGHT * dipScale),
        maxWidth: screenWidth,
        maxHeight: screenHeight,
        alwaysOnTop: true,
        frame: false,
        transparent: true,
        resizable: true,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: false, // 禁用 CORS、同源策略
            allowRunningInsecureContent: true, // 允许混合内容
            backgroundThrottling: false,
            zoomFactor: 1.0
        }
    });

    // 建窗尺寸已经按目标显示器的 DIP 系数算好，先记下来，避免首次同步时再被缩放一次
    spectrumDipScale = dipScale;
    // 恢复上次用户手动拖动过的位置（未拖动过则维持贴底锚定）
    spectrumUserMoved = store.get('spectrumUserMoved') === true;

    spectrumWindow.on('resize', () => {
        anchorSpectrumWindow();
        persistSpectrumWindowBounds();
    });
    spectrumWindow.on('move', () => {
        persistSpectrumWindowBounds();
        // 区分「系统贴底锚定」与「用户手动拖动」：位置不是贴底目标 → 用户拖的，记住它
        if (!spectrumUserMoved && !isSpectrumAtAnchor()) {
            spectrumUserMoved = true;
            store.set('spectrumUserMoved', true);
        }
        applySpectrumGeometry();
    });
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.spectrumWindow = spectrumWindow;
    spectrumWindow.on('closed', () => {
        // 主窗口可能已销毁（退出流程中），判空避免 TypeError
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.spectrumWindow = null;
        }
        spectrumGeometryKey = '';
        spectrumDipScale = 0;
    });

    bindSpectrumDisplayListeners();
    if (!stopSpectrumFullscreenWatch) {
        stopSpectrumFullscreenWatch = watchForegroundFullscreen((state) => {
            spectrumFullscreenState = state;
            anchorSpectrumWindow();
        });
    }
    anchorSpectrumWindow();

    if (isDev) {
        spectrumWindow.loadURL('http://localhost:8080/#/spectrum-hud');
    } else {
        spectrumWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
            hash: 'spectrum-hud'
        });
    }

    spectrumWindow.setAlwaysOnTop(true, 'screen-saver');
    spectrumWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // 允许窗口透明
    spectrumWindow.setBackgroundColor('#00000000');
}

// KeyStrokes 覆盖层（1:1 复刻 sigmarebase KeyStrokes：左下角 x=10，窗口 160x252）
let keystrokesWindow = null;

export function createKeystrokesWindow() {
    if (keystrokesWindow && !keystrokesWindow.isDestroyed()) {
        keystrokesWindow.show();
        return keystrokesWindow;
    }

    const width = 170;
    const height = 260;

    // 复刻原版位置：左下角（贴工作区左边缘 x=10，下沿对齐工作区底部）
    const { workArea } = screen.getPrimaryDisplay();

    keystrokesWindow = new BrowserWindow({
        width,
        height,
        x: workArea.x + 10,
        y: workArea.y + workArea.height - height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        backgroundColor: '#00000000',
        title: 'KeyStrokes',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: false,
            allowRunningInsecureContent: true,
            backgroundThrottling: false,
            zoomFactor: 1.0
        }
    });

    // 鼠标穿透 + 置于所有窗口之上（HUD）
    keystrokesWindow.setIgnoreMouseEvents(true, { forward: true });
    keystrokesWindow.setAlwaysOnTop(true, 'screen-saver');
    keystrokesWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    keystrokesWindow.setBackgroundColor('#00000000');

    keystrokesWindow.once('ready-to-show', () => {
        if (keystrokesWindow && !keystrokesWindow.isDestroyed()) keystrokesWindow.show();
    });

    keystrokesWindow.on('closed', () => {
        keystrokesWindow = null;
    });

    if (isDev) {
        keystrokesWindow.loadURL('http://localhost:8080/#/keystrokes');
    } else {
        keystrokesWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
            hash: 'keystrokes'
        });
    }

    return keystrokesWindow;
}

export function closeKeystrokesWindow() {
    if (keystrokesWindow && !keystrokesWindow.isDestroyed()) {
        keystrokesWindow.close();
    }
    keystrokesWindow = null;
}

export function getKeystrokesWindow() {
    return keystrokesWindow;
}

// Sigma UI 独立透明窗口（固定 800x600，背景可透到应用后面）
let sigmaWindow = null;
let sigmaWindowLoaded = false;
let sigmaDocked = false;
let sigmaAnimating = false;

// 注意：这里刻意没有「越界余量」常量。原版 AnimatedIconPanel 的夹取是精确的
// xA + widthA <= parentWidth，普通拖拽永远无法让右缘越过屏幕右缘，因此
// MusicPlayer.draw 的半透明判据（getXA() + getWidthA() > parent.getWidthA()）
// 在普通拖拽中永不成立 —— 半透明只来自橡皮筋越界与已吸附态。
// 早先为「让拖拽也能半透明」加了 12px 余量，那是偏离原版的自创行为。

const SIGMA_DOCK_VISIBLE = 40;   // 贴右边缘收起后保留可见的宽度（原版 var8 = parentWidth - 40）
const SIGMA_RESTORE_MARGIN = 20; // 滑出后距右边缘的间距（原版 var11 = parentWidth - 20 - width）

// 拖拽中的「右缘是否越过屏幕右缘」信号（连续，1:1 对齐原版
// MusicPlayer.draw 的 getXA() + getWidthA() > parent.getWidthA()）。
// 与 sigmaDocked 分开：后者是离散吸附态，前者只描述几何位置。
let sigmaOverhanging = false;
const setSigmaOverhanging = (overhanging) => {
    if (sigmaOverhanging === overhanging) return;
    sigmaOverhanging = overhanging;
    if (sigmaWindow && !sigmaWindow.isDestroyed()) {
        sigmaWindow.webContents.send('sigma-overhang-changed', overhanging);
    }
};

const setSigmaDocked = (docked) => {
    if (sigmaDocked === docked) return;
    sigmaDocked = docked;
    if (sigmaWindow && !sigmaWindow.isDestroyed()) {
        sigmaWindow.webContents.send('sigma-dock-changed', docked);
    }
};

// 缓动动画（复刻原版 updatePanelDimensions：var7 = dt / 18.1ms，每帧 0.25 × var7）
// 首选渲染进程 rAF 驱动（与显示器垂直同步，最顺）；窗口离屏导致 rAF 降频/停发时，
// 主进程 150ms 收不到帧就接管，用同一套公式继续推进（从最后一帧坐标接着走）
const SIGMA_ANIM_GAME_FRAME_MS = 18.10361;
const SIGMA_ANIM_TICK_MS = 4;             // 主进程接管时的步进间隔
const SIGMA_ANIM_MAX_DT = 40;             // dt 上限，避免偶发迟到造成大跳
const SIGMA_ANIM_RENDERER_TIMEOUT = 150;  // 渲染进程超过该时间没回帧 → 主进程接管

// 触发节流：连续按键时丢弃过密的请求。
// 参照 sigmarebase 的 TabGUI.animationCooldown(80 ticks) 与
// ModuleCardButton.CLICK_THROTTLE_MS(30ms) 两个先例，取两者之间的量级。
const SIGMA_TOGGLE_THROTTLE_MS = 120;

let sigmaAnimationTimer = null;
let sigmaAnimationWatchdog = null;
let sigmaAnimationStartedAt = 0;
let sigmaAnimationMode = null;  // 'renderer' | 'main'
let sigmaLastFrameAt = 0;
let sigmaLastX = 0;
let sigmaLastY = 0;
let sigmaTargetX = 0;
let sigmaTargetY = 0;

let sigmaLastTargetX = 0;
let sigmaLastTargetY = 0;
let sigmaToggleAcceptedAt = 0;

const cancelSigmaAnimation = () => {
    if (sigmaAnimationTimer) {
        clearTimeout(sigmaAnimationTimer);
        sigmaAnimationTimer = null;
    }
    if (sigmaAnimationWatchdog) {
        clearInterval(sigmaAnimationWatchdog);
        sigmaAnimationWatchdog = null;
    }
    sigmaAnimationMode = null;
    sigmaAnimating = false;
};

// 触发节流：距上次接受的切换不足 SIGMA_TOGGLE_THROTTLE_MS 则丢弃本次请求。
// 动画本身仍会跑完，只是连按不再反复反转。
const sigmaToggleThrottled = () => {
    const now = Date.now();
    if (now - sigmaToggleAcceptedAt < SIGMA_TOGGLE_THROTTLE_MS) return true;
    sigmaToggleAcceptedAt = now;
    return false;
};

// 动画卡死保护：超过 3 秒仍未结束则强制取消
const sigmaAnimationBlocked = () => {
    if (!sigmaAnimating) return false;
    if (Date.now() - sigmaAnimationStartedAt > 3000) {
        cancelSigmaAnimation();
        return false;
    }
    return true;
};

// 主进程接管推进
const runMainSigmaAnimation = () => {
    if (!sigmaWindow || sigmaWindow.isDestroyed()) {
        cancelSigmaAnimation();
        return;
    }
    sigmaAnimationMode = 'main';
    sigmaWindow.webContents.send('sigma-animate-stop');

    let currentX = sigmaLastX;
    let currentY = sigmaLastY;
    let lastTime = Date.now();

    const step = () => {
        sigmaAnimationTimer = null;
        if (!sigmaWindow || sigmaWindow.isDestroyed()) {
            cancelSigmaAnimation();
            return;
        }

        const now = Date.now();
        const dt = Math.min(SIGMA_ANIM_MAX_DT, Math.max(1, now - lastTime));
        lastTime = now;
        const frameFactor = dt / SIGMA_ANIM_GAME_FRAME_MS;

        currentX = sigmaTargetX > currentX
            ? Math.min(currentX + (sigmaTargetX - currentX) * 0.25 * frameFactor, sigmaTargetX)
            : Math.max(currentX + (sigmaTargetX - currentX) * 0.25 * frameFactor, sigmaTargetX);
        currentY = sigmaTargetY > currentY
            ? Math.min(currentY + (sigmaTargetY - currentY) * 0.2 * frameFactor, sigmaTargetY)
            : Math.max(currentY + (sigmaTargetY - currentY) * 0.2 * frameFactor, sigmaTargetY);

        sigmaLastX = currentX;
        sigmaLastY = currentY;

        if (Math.abs(sigmaTargetX - currentX) < 0.5 && Math.abs(sigmaTargetY - currentY) < 0.5) {
            sigmaWindow.setPosition(Math.round(sigmaTargetX), Math.round(sigmaTargetY));
            cancelSigmaAnimation();
            return;
        }

        sigmaWindow.setPosition(Math.round(currentX), Math.round(currentY));
        sigmaAnimationTimer = setTimeout(step, SIGMA_ANIM_TICK_MS);
    };
    step();
};

const animateSigmaWindow = (targetX, targetY) => {
    if (!sigmaWindow || sigmaWindow.isDestroyed()) return;
    const start = sigmaWindow.getBounds();
    if (Math.abs(start.x - targetX) < 1 && Math.abs(start.y - targetY) < 1) {
        // 必须先停掉在跑的动画：否则旧动画会继续往它自己的目标推进，
        // 面板就与目标位各走各的（连按时表现为"分散开"）。
        cancelSigmaAnimation();
        sigmaLastTargetX = targetX;
        sigmaLastTargetY = targetY;
        return;
    }

    cancelSigmaAnimation();
    sigmaAnimating = true;
    sigmaAnimationStartedAt = Date.now();
    sigmaAnimationMode = 'renderer';
    sigmaTargetX = targetX;
    sigmaTargetY = targetY;
    sigmaLastX = start.x;
    sigmaLastY = start.y;
    sigmaLastFrameAt = Date.now();
    // 记录上一个目标，供下一帧判断是否发生反向（进度保持用）
    sigmaLastTargetX = targetX;
    sigmaLastTargetY = targetY;

    sigmaWindow.webContents.send('sigma-animate-to', {
        x: Math.round(targetX),
        y: Math.round(targetY),
        fromX: start.x,
        fromY: start.y
    });

    sigmaAnimationWatchdog = setInterval(() => {
        if (!sigmaAnimating || sigmaAnimationMode !== 'renderer') return;
        if (Date.now() - sigmaLastFrameAt > SIGMA_ANIM_RENDERER_TIMEOUT) {
            runMainSigmaAnimation();
        }
    }, 50);
};

// 渲染进程每帧回传的动画位置（仅渲染进程驱动阶段生效）
export function applySigmaAnimatePosition(x, y) {
    if (!sigmaWindow || sigmaWindow.isDestroyed() || !sigmaAnimating || sigmaAnimationMode !== 'renderer') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    sigmaLastFrameAt = Date.now();
    sigmaLastX = x;
    sigmaLastY = y;
    sigmaWindow.setPosition(Math.round(x), Math.round(y));
}

// 渲染进程动画结束（主进程接管后忽略，避免误取消）
export function finishSigmaAnimate() {
    if (!sigmaAnimating || sigmaAnimationMode !== 'renderer') return;
    cancelSigmaAnimation();
}

// 拖动过程中，1:1 对齐原版 AnimatedIconPanel.handleMovementAndCheckBoundaries
// 与 MusicPlayer.updatePanelDimensions 的 else（拖拽中）分支。原版每 tick 顺序：
//   1) AnimatedIconPanel 先 setXA(desired)，再把 xA 精确夹在 [0, parentW - width]
//   2) MusicPlayer 再判 var12(=desired) + width > parentW + 200 && movedX > 70
//      成立则 var15 = desired - xA - 200，xA = (int)(xA + var15 * 0.5)
//
// 关键：第 2 步的基准 xA 是「本 tick 刚从 desired 夹出来的值」，不是上一次留下的
// 窗口位置。基准取错会让橡皮筋不动点从「纯光标函数」退化成「完整超出量」：
//   原版不动点 = clamp + 0.5*(desired - clamp - 200)，desired=1900 时停在 x=1410
//   误用 bounds.x 时每帧在已推出的位置上再推一半，收敛到 x=1700（右缘 2500，
//   越界 580px，原版仅 290px）—— 面板一路爬出屏幕且越来越难抓回来。
export function moveSigmaWindow(x, y, movedX = 0) {
    if (!sigmaWindow || sigmaWindow.isDestroyed() || sigmaAnimationBlocked()) return;

    const bounds = sigmaWindow.getBounds();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const display = screen.getDisplayMatching({ x: Math.round(x), y: Math.round(y), width: bounds.width, height: bounds.height });
    const area = display.workArea;
    const right = area.x + area.width;
    const bottom = area.y + area.height;
    const nextY = Math.min(Math.max(Math.round(y), area.y), bottom - bounds.height);

    // 原版第 1 步：精确夹取，无越界余量（见 SIGMA_DOCK_VISIBLE 上方说明）
    const clampedX = Math.min(Math.max(Math.round(x), area.x), right - bounds.width);

    // 原版第 2 步：var14 = 200, newHeight - mouseX > 70
    if (x + bounds.width > right + 200 && movedX > 70) {
        // var15 = desired - xA_clamped - var14；Math.trunc 对应 Java 的 (int) 向零取整
        const pushedX = clampedX + Math.trunc((x - clampedX - 200) * 0.5);
        setSigmaOverhanging(pushedX + bounds.width > right);
        if (pushedX !== bounds.x || nextY !== bounds.y) {
            sigmaWindow.setBounds({ x: pushedX, y: nextY, width: bounds.width, height: bounds.height });
        }
        return;
    }

    setSigmaOverhanging(clampedX + bounds.width > right);
    if (clampedX !== bounds.x || nextY !== bounds.y) {
        sigmaWindow.setBounds({ x: clampedX, y: nextY, width: bounds.width, height: bounds.height });
    }
}

// 松手：若窗口已在屏幕外 → 吸附收起
export function finishSigmaDrag() {
    if (!sigmaWindow || sigmaWindow.isDestroyed() || sigmaAnimationBlocked()) return;
    const bounds = sigmaWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const right = area.x + area.width;
    const bottom = area.y + area.height;
    const centerY = Math.round(area.y + (area.height - bounds.height) / 2);

    // 松手：若窗口已在屏幕外（几何越界）→ 吸附收起。
    // 判据是严格 > right，1:1 对齐原版 MusicPlayer.java:309
    // （getXA() + getWidthA() > parent.getWidthA()）。
    // 夹取已无余量，普通拖拽不可能触发这条分支，只有橡皮筋越界才会。
    if (bounds.x + bounds.width > right) {
        setSigmaDocked(true);
        animateSigmaWindow(right - SIGMA_DOCK_VISIBLE, centerY);
        return;
    }

    setSigmaDocked(false);
    const nextX = Math.min(Math.max(bounds.x, area.x), right - bounds.width);
    const nextY = Math.min(Math.max(bounds.y, area.y), bottom - bounds.height);
    // 未收起：清掉拖拽期的越界信号，之后透明度只跟 sigma-dock-changed 走
    setSigmaOverhanging(false);
    if (nextX !== bounds.x || nextY !== bounds.y) {
        sigmaWindow.setBounds({ x: nextX, y: nextY, width: bounds.width, height: bounds.height });
    }
}

// 从收起状态滑出（原版 var11 = parentWidth - 20 - width）
export function restoreSigmaWindow() {
    // 同 dockSigmaWindow：连按时要能打断反向，不能被动画卡死保护拦下
    if (!sigmaWindow || sigmaWindow.isDestroyed()) return;
    const bounds = sigmaWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const right = area.x + area.width;
    // 不要用"是否越过右边缘"来判断是否需要滑出：收起动画进行中面板可能还在
    // 屏幕中间（如 x=1100），按几何位置判定会误判成"无需滑出"而直接返回，
    // 面板就卡在中间不动。sigmaDocked 才是权威标志。
    if (!sigmaDocked && bounds.x + bounds.width <= right) return; // 未在屏幕外，无需滑出
    const centerY = Math.round(area.y + (area.height - bounds.height) / 2);
    setSigmaDocked(false);
    animateSigmaWindow(right - bounds.width - SIGMA_RESTORE_MARGIN, centerY);
}

export function createSigmaWindow() {
    if (sigmaWindow && !sigmaWindow.isDestroyed()) {
        sigmaWindow.show();
        sigmaWindow.focus();
        return sigmaWindow;
    }

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const width = 800;
    const height = 600;

    sigmaWindow = new BrowserWindow({
        width,
        height,
        x: Math.max(0, Math.round((screenWidth - width) / 2)),
        y: Math.max(0, Math.round((screenHeight - height) / 2)),
        minWidth: width,
        minHeight: height,
        maxWidth: width,
        maxHeight: height,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        frame: false,
        transparent: true,
        hasShadow: false,
        skipTaskbar: true,
        alwaysOnTop: false,
        show: false,
        backgroundColor: '#00000000',
        title: 'Sigma Music',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: false,
            allowRunningInsecureContent: true,
            backgroundThrottling: false,
            zoomFactor: 1.0
        }
    });

    sigmaWindow.once('ready-to-show', () => {
        if (sigmaWindow && !sigmaWindow.isDestroyed()) {
            sigmaWindow.show();
        }
    });

    sigmaWindow.on('closed', () => {
        sigmaWindow = null;
        sigmaWindowLoaded = false;
        sigmaDocked = false;
        cancelSigmaAnimation();
        // 关闭 Sigma 窗口不再回退主界面（主窗口是隐藏播放宿主）；左键托盘可随时重新打开
    });

    if (isDev) {
        sigmaWindow.loadURL('http://localhost:8080/#/sigma');
    } else {
        sigmaWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
            hash: 'sigma'
        });
    }

    sigmaWindow.setBackgroundColor('#00000000');

    sigmaWindow.webContents.on('did-finish-load', () => {
        sigmaWindowLoaded = true;
    });

    return sigmaWindow;
}

export function closeSigmaWindow() {
    if (sigmaWindow && !sigmaWindow.isDestroyed()) {
        sigmaWindow.destroy();
    }
    sigmaWindow = null;
    sigmaWindowLoaded = false;
    sigmaDocked = false;
}

export function getSigmaWindow() {
    return sigmaWindow;
}

// 把 Sigma 窗口临时提到最前（呼出瞬间置顶，不常驻）。
// 用普通置顶层级即可，随后 600ms 降回，避免长期压住其它应用。
export const raiseSigmaWindow = (win) => {
    if (!win || win.isDestroyed()) return;
    win.setAlwaysOnTop(true);
    win.show();
    win.moveTop();
    win.focus();
    // 置顶只是「叫到前面」，一段时间后降回普通层级，避免长期压住其它应用
    setTimeout(() => {
        if (sigmaWindow && !sigmaWindow.isDestroyed()) {
            sigmaWindow.setAlwaysOnTop(false);
        }
    }, 600);
};

// 吸附到右侧收起位（共用逻辑：快捷键与托盘切换收起）
const dockSigmaWindow = () => {
    // 不用 sigmaAnimationBlocked() 拦截：连按时第二次调用必须能打断并反向，
    // 被拦下会造成「意图已置位（玻璃点亮）但动画没启动」，正是分离的成因。
    if (!sigmaWindow || sigmaWindow.isDestroyed()) return;
    const bounds = sigmaWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const right = area.x + area.width;
    const centerY = Math.round(area.y + (area.height - bounds.height) / 2);
    setSigmaDocked(true);
    // 已在收起位则不必再动画，但要确保旧动画已停
    if (Math.abs(bounds.x - (right - SIGMA_DOCK_VISIBLE)) < 1 && Math.abs(bounds.y - centerY) < 1) {
        cancelSigmaAnimation();
        return;
    }
    animateSigmaWindow(right - SIGMA_DOCK_VISIBLE, centerY);
};

// 显示 ↔ 收起 互切（面板只有这两种状态，没有"完全隐藏"）
// 已收起 → 滑出；已展开 → 吸附到右侧收起位
// 外层叠 120ms 触发节流（参照 sigmarebase 的 TabGUI 冷却 80 ticks 与
// ModuleCardButton 的 30ms 点击防抖）：动画仍会跑完，但连按不再反复反转。
const toggleSigmaDocked = (force = false) => {
    if (!sigmaWindow || sigmaWindow.isDestroyed()) return;
    if (!force && sigmaToggleThrottled()) return;
    if (sigmaDocked) {
        // 与点右侧 41px 触发条（sigma-window-restore）完全同一条路径
        restoreSigmaWindow();
        return;
    }
    dockSigmaWindow();
};

// RSHIFT 全局热键：与托盘菜单同一套逻辑，共用 toggleSigmaDocked
export function toggleSigmaWindowFromHotkey() {
    if (!sigmaWindow || sigmaWindow.isDestroyed()) {
        const win = createSigmaWindow();
        if (win && !win.isDestroyed()) {
            raiseSigmaWindow(win);
        }
        return;
    }
    toggleSigmaDocked();
}

const getIconPath = (iconName, subPath = '') => path.join(
    isDev ? __dirname + '/../build/icons' : process.resourcesPath + '/icons',
    subPath,
    iconName
);

export function getTray() {
    return tray;
}

// 显示并提到最前；若处于贴边收起/屏幕外，先播放滑出动画
export const revealSigmaWindow = (win = sigmaWindow) => {
    if (!win || win.isDestroyed()) return false;
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const right = area.x + area.width;
    // 判据与 SIGMA_DOCK_VISIBLE 上方一致：夹取无余量，只有橡皮筋越界/吸附态才越界
    if (sigmaDocked || bounds.x + bounds.width > right) {
        if (!sigmaDocked) {
            const centerY = Math.round(area.y + (area.height - bounds.height) / 2);
            win.setPosition(right - SIGMA_DOCK_VISIBLE, centerY);
            setSigmaDocked(true);
        }
        restoreSigmaWindow();
    }
    raiseSigmaWindow(win);
    return true;
};

// 打开设置：Sigma 窗口已加载就始终用它（隐藏/贴边收起都会自动呼出），否则回退主窗口转发
// 返回是否由 Sigma 窗口接收（未就绪时由调用方决定是否记为 pending）
export function openSettingsWindow(mainWindow) {
    const sigmaExists = sigmaWindowLoaded && sigmaWindow && !sigmaWindow.isDestroyed();
    if (sigmaExists) {
        revealSigmaWindow(sigmaWindow);
        sigmaWindow.webContents.send('open-settings');
        return true;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        // 主窗口不显示，仅转发设置请求（主窗口会转交给 Sigma 窗口）
        mainWindow.webContents.send('open-settings');
    }
    return false;
}

// 创建托盘图标及菜单
export function createTray(mainWindow, title = '') {
    // 只要托盘已存在就复用：旧判据是 `tray && title`，title 为空串（无标题音源 /
    // i18n 缺失）时会再 new 一个 Tray，旧的不 destroy → 托盘堆图标 + 监听器泄漏
    if (tray && !tray.isDestroyed()) {
        if (title) tray.setToolTip(title);
        return tray;
    }

    let trayIconName
    if (process.platform === 'linux') {
        trayIconName = 'linux-icon.png'
    } else if (process.platform === 'darwin') {
        trayIconName = 'tray-icon.png'
    } else {
        trayIconName = 'tray-icon.ico'
    }

    tray = new Tray(getIconPath(trayIconName));
    tray.setToolTip('Jello Music');

    const contextMenu = Menu.buildFromTemplate([
        {
label: t('show-dock'),
            icon: getIconPath('show.png', 'menu'),
            click: () => {
                // 主窗口是隐藏播放宿主：显示/收起切换作用于 Sigma 窗口
                // force：菜单点击是显式操作，不受连按节流限制
                const win = getSigmaWindow();
                if (!win || win.isDestroyed()) {
                    // 窗口还没创建：创建即显示
                    createSigmaWindow();
                    return;
                }
                toggleSigmaDocked(true);
            }
        },
        { type: 'separator' },
        {
            label: t('prev-track'),
            icon: getIconPath('prev.png', 'menu'),
                        click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('play-previous-track');
                }
            }
        },
        {
            label: t('pause'),
            icon: getIconPath('play.png', 'menu'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('toggle-play-pause');
                }
            }
        },
        {
            label: t('next-track'),
            icon: getIconPath('next.png', 'menu'),
            click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('play-next-track');
                }
            }
        },
        { type: 'separator' },
        {
            label: t('settings'),
            click: () => {
                openSettingsWindow(mainWindow);
            }
        },
        {
            label: t('check-updates'),
            icon: getIconPath('update.png', 'menu'),
            click: () => {
                checkForUpdates(false);
            }
        },
        {
            label: t('project-home'),
            icon: getIconPath('home.png', 'menu'),
            click: () => {
                shell.openExternal('https://github.com/Margele1337/jello-music');
            }
        },
        {
            label: t('restart-app'),
            icon: getIconPath('restart.png', 'menu'),
            click: () => {
                app.relaunch();
                app.isQuitting = true;
                app.quit();
            }
        },
        { type: 'separator' },
        {
            label: t('quit'),
            icon: getIconPath('quit.png', 'menu'),
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    const useCustomTrayMenu = !!mainWindow && store.get('settings')?.customTrayMenu === 'custom';
    const useLinuxCustomTrayMenu = process.platform === 'linux' && useCustomTrayMenu;
    switch (process.platform) {
        case 'linux':
            if (useLinuxCustomTrayMenu) {
                tray.on('click', () => {
                    void customTrayMenuService.toggle();
                });
                break;
            }
            customTrayMenuService.hide();
            tray.setContextMenu(contextMenu);
            break;
        default:
            tray.on('right-click', () => {
                if (useCustomTrayMenu) {
                    void customTrayMenuService.toggle();
                    return;
                }
                customTrayMenuService.hide();
                tray.popUpContextMenu(contextMenu);
            });
    }
    if (!useLinuxCustomTrayMenu) {
        // 左键单击托盘：显示 Sigma 窗口（主窗口只作为隐藏播放宿主，不再显示）
        tray.on('click', () => {
            customTrayMenuService.hide();
            revealSigmaWindow(createSigmaWindow());
        });
        tray.on('double-click', () => {
            customTrayMenuService.hide();
            revealSigmaWindow(createSigmaWindow());
        });
    }
    return tray;
}

// TouchBar 的 IPC 监听器引用见文件顶部（touchBarPlayPauseHandler / touchBarLyricsHandler）：
// createTouchBar 可能被多次调用（重建 TouchBar / 切换账号），
// 匿名 handler 无法摘除 → 监听器会无限累积。这里保留引用，重建前先摘掉旧的。

// 创建 TouchBar
export function createTouchBar(mainWindow) {
    const ICON_SIZE = 16;
    let isPlaying = false;

    const iconPath = (iconName) => {
        const originalIcon = nativeImage.createFromPath(
            getIconPath(`${iconName}.png`)
        );

        // 调整图标大小
        return originalIcon.resize({
            width: ICON_SIZE,
            height: ICON_SIZE,
        });
    };

    const prevButton = new TouchBarButton({
        icon: iconPath("prev"),
        iconPosition: "center",
        click: () => {
            mainWindow.webContents.send("play-previous-track");
        },
    });

    const playPauseButton = new TouchBarButton({
        icon: iconPath(isPlaying ? "pause" : "play"),
        iconPosition: "center",
        click: () => {
            isPlaying = !isPlaying;
            playPauseButton.icon = iconPath(isPlaying ? "pause" : "play");
            mainWindow.webContents.send("toggle-play-pause");
        },
    });

    const nextButton = new TouchBarButton({
        icon: iconPath("next"),
        iconPosition: "center",
        click: () => {
            mainWindow.webContents.send("play-next-track");
        },
    });

    // 歌词
    const lyricsLabel = new TouchBarLabel({
        label: t('no-lyrics'),
        textColor: "#FFFFFF",
    });

    const touchBar = new TouchBar({
        items: [
            prevButton,
            new TouchBarSpacer({ size: "small" }),
            playPauseButton,
            new TouchBarSpacer({ size: "small" }),
            nextButton,
            new TouchBarSpacer({ size: "flexible" }),
            lyricsLabel,
            new TouchBarSpacer({ size: "flexible" }),
        ],
    });

    mainWindow.setTouchBar(touchBar);

    // 重建前先摘掉上一轮的监听器，避免多次创建 TouchBar 时无限累积
    if (touchBarPlayPauseHandler) {
        ipcMain.removeListener('play-pause-action', touchBarPlayPauseHandler);
    }
    if (touchBarLyricsHandler) {
        ipcMain.removeListener('update-current-lyrics', touchBarLyricsHandler);
    }

    // 监听播放状态变化
    touchBarPlayPauseHandler = (event, playing) => {
        isPlaying = playing;
        playPauseButton.icon = iconPath(isPlaying ? "pause" : "play");
    };
    ipcMain.on('play-pause-action', touchBarPlayPauseHandler);

    // 监听歌词更新
    touchBarLyricsHandler = (event, currentLyric) => {
        if (currentLyric) {
            lyricsLabel.label = currentLyric;
        }
    };
    ipcMain.on('update-current-lyrics', touchBarLyricsHandler);

    return touchBar;
}

// 启动 API 服务器
// 探测本机 6521 端口是否已经有兼容的 API 在运行（例如 dev 环境或上一个实例）
// 校验响应内容（/register/dev 返回的 JSON 结构），避免把占用端口的其它 HTTP
// 程序误判为本项目 API —— 否则复用错误的"服务"会导致所有音乐请求静默失败。
const API_PROBE_URL = 'http://127.0.0.1:6521/register/dev';
const probeApiServer = (timeoutMs = 1500) => new Promise((resolve) => {
    const request = http.get(API_PROBE_URL, { timeout: timeoutMs }, (response) => {
        let body = '';
        response.on('data', (chunk) => {
            body += chunk;
            if (body.length > 64 * 1024) response.destroy(); // 防御：异常大响应直接判定不匹配
        });
        response.on('end', () => {
            try {
                const json = JSON.parse(body);
                resolve(typeof json === 'object' && json !== null && 'status' in json && 'data' in json);
            } catch (_) {
                resolve(false);
            }
        });
        response.on('error', () => resolve(false));
    });
    request.on('timeout', () => {
        request.destroy();
        resolve(false);
    });
    request.on('error', () => resolve(false));
});

// 轮询等待侧车就绪：以「端口探测成功」为准，不再依赖 stdout 的关键字。
// stdout 分包时 'running' 可能被拆到两个 chunk 之间而永远匹配不上，
// 单靠它会让 Promise 永不 resolve（应用无窗口、无报错地卡死）。
const waitForApiReady = (timeoutMs = 15000, intervalMs = 300) => new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
        probeApiServer(800).then((ready) => {
            if (ready) {
                resolve(true);
                return;
            }
            if (Date.now() >= deadline) {
                resolve(false);
                return;
            }
            setTimeout(tick, intervalMs);
        });
    };
    tick();
});

export function startApiServer() {
    return new Promise((resolve, reject) => {
        let apiPath = '';
        if (isDev) {
            return resolve();
            // apiPath = path.join(__dirname, '../api/app_api');
        } else {
            switch (process.platform) {
                case 'win32':
                    apiPath = path.join(process.resourcesPath, '../api', 'app_win.exe');
                    break;
                case 'darwin':
                    // Apple Silicon 的包名是 app_macos_arm64（见子模块 pkgmacos-arm64 脚本）
                    apiPath = path.join(process.resourcesPath, '../api', process.arch === 'arm64' ? 'app_macos_arm64' : 'app_macos');
                    break;
                case 'linux':
                    apiPath = path.join(process.resourcesPath, '../api', 'app_linux');
                    break;
                default:
                    reject(new Error(`Unsupported platform: ${process.platform}`));
                    return;
            }
        }

        log.info(`API路径: ${apiPath}`);

        if (!fs.existsSync(apiPath)) {
            const error = new Error(`API可执行文件未找到：${apiPath}`);
            log.error(error.message);
            reject(error);
            return;
        }

        // 启动 API 服务器进程
        const savedConfig = store.get('settings') || {};
        const proxy = savedConfig?.proxy;
        const proxyUrl = savedConfig?.proxyUrl;
        const dataSource = savedConfig?.dataSource || 'concept';

        probeApiServer().then(async (alreadyRunning) => {
            if (alreadyRunning) {
                log.info('API 端口 6521 已有服务在运行，复用现有实例（不再启动第二个）');
                console.log('API 已在运行，复用现有实例');
                resolve();
                return;
            }

            // 多次 resolve/reject 只会生效一次：stdout 关键字、端口探测、进程退出三者竞争
            let settled = false;
            const settle = (fn, value) => {
                if (settled) return;
                settled = true;
                fn(value);
            };

            const Args = [];
            if (dataSource === 'concept') {
                Args.push('--platform=lite');
                log.info('API data source: concept (lite mode)');
            }
            if (proxy === 'on' && proxyUrl) {
                const proxyAddress = String(proxyUrl).trim();
                if (proxyAddress) {
                    Args.push(`--proxy=${proxyAddress}`);
                    log.info(`API proxy enabled: ${proxyAddress}`);
                }
            }
            Args.push('--port=6521');
            let apiProcessSpawned = null;
            try {
                apiProcessSpawned = spawn(apiPath, Args, { windowsHide: true });
                apiProcess = apiProcessSpawned;
            } catch (error) {
                log.error('启动 API 失败:', error);
                settle(reject, error);
                return;
            }

            // 侧车在「就绪之后」崩溃：此时启动流程早已 resolve，settle(reject) 变成空操作，
            // 用户侧表现为「所有请求失败但毫无提示」。这里补一个本地化错误框，
            // 让用户知道是 API 侧车挂了，而不是应用本身坏了。
            let apiReady = false;
            const notifyApiCrashed = (code, signal) => {
                if (!apiReady) return; // 启动阶段的失败由 main.js 的 api-error 弹窗负责
                if (app.isQuitting) return; // 正常退出时侧车是被我们主动杀掉的，不是崩溃
                apiReady = false;
                const detail = `code=${code}${signal ? ` signal=${signal}` : ''}`;
                log.error(`API 运行期崩溃: ${detail}`);
                Promise.resolve(dialog.showMessageBox({
                    type: 'error',
                    title: t('error'),
                    message: `${t('api-crashed')}\n${detail}`,
                    buttons: [t('ok')]
                })).catch(() => { /* 弹窗失败不影响主流程 */ });
            };

            // 累积 stdout：关键字可能被分包拆开，单 chunk 匹配会漏判
            let stdoutBuffer = '';
            apiProcessSpawned.stdout.on('data', (data) => {
                const text = data.toString();
                log.info(`API输出: ${text}`);
                stdoutBuffer += text;
                if (stdoutBuffer.length > 64 * 1024) stdoutBuffer = stdoutBuffer.slice(-4096);
                if (stdoutBuffer.includes('running')) {
                    console.log('API服务器已启动');
                    apiReady = true;
                    settle(resolve);
                }
            });

            // stderr 只记日志，不作为失败判据：
            // 很多运行时把普通日志/告警写 stderr（Node 的 warning、Go/Python 的日志），
            // 一旦无条件 reject，侧车打个告警就会导致应用完全无法启动。
            apiProcessSpawned.stderr.on('data', (data) => {
                const text = String(data);
                log.error(`API stderr: ${text}`);
                if (text.includes('EADDRINUSE')) {
                    log.error('端口 6521 被其它程序占用：请关闭占用该端口的程序（或重复运行的实例）后重试');
                }
            });

            apiProcessSpawned.on('error', (error) => {
                log.error('启动 API 失败:', error);
                settle(reject, error);
            });

            apiProcessSpawned.on('exit', (code, signal) => {
                log.info(`API 退出，code=${code} signal=${signal ?? ''}`);
                if (apiProcess === apiProcessSpawned) apiProcess = null;
                // 就绪后崩溃 → 弹本地化错误框（notifyApiCrashed 内含 isQuitting 守卫）；
                // 就绪前退出 = 真正的启动失败，由 settle(reject) 交给 main.js 弹 api-error
                notifyApiCrashed(code, signal);
                settle(reject, new Error(`API 进程提前退出（code=${code}，signal=${signal ?? 'none'}）`));
            });

            // 兜底判据：轮询 6521 直到可达，超时才算失败
            const ready = await waitForApiReady();
            if (ready) {
                apiReady = true;
                settle(resolve);
                return;
            }
            settle(reject, new Error('API 服务启动超时：15 秒内 6521 端口未就绪'));
        });
    });
}

// 停止 API 服务器
// onDone 用于让调用方等进程树真正被杀掉后再退出：
// 否则主进程会先 app.exit(0)，侧车的子进程变孤儿继续占住 6521，
// 下次启动就会被端口探测误判为「已有服务」而复用旧版本侧车。
export function stopApiServer(onDone) {
    const done = typeof onDone === 'function' ? onDone : () => {};
    if (!apiProcess) {
        done();
        return;
    }
    // 杀整个进程树（避免子进程残留），并在进程已退出时静默降级
    const { pid } = apiProcess;
    apiProcess = null;
    let called = false;
    const finish = () => {
        if (called) return;
        called = true;
        done();
    };
    treeKill(pid, 'SIGKILL', finish);
    // 兜底：进程已消失时 tree-kill 可能不回调
    setTimeout(finish, 1000);
}

// 注册快捷键
// macOS 走 before-quit 标记退出状态，这里保存引用以便重新注册时摘掉旧监听器
let macBeforeQuitHandler = null;
export function registerShortcut() {
    try {
        const settings = store.get('settings');
        globalShortcut.unregisterAll();
        // 快捷键触发时主窗口可能已销毁（未判空会抛 TypeError 且被 uncaughtException 吞掉，
        // 表现为快捷键静默失效），统一走带判空的转发
        const sendToMainWindow = (channel) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(channel);
            }
        };
        let clickFunc = () => { app.isQuitting = true; };
        if (process.platform === 'darwin') {
            // macOS 没有全局快捷键退出，改为在 before-quit 时标记退出状态。
            // registerShortcut 可能被多次调用（切换快捷键等），每次都 app.on 会让监听器
            // 无限累积，这里先摘掉上一轮的再挂新的。
            if (macBeforeQuitHandler) {
                app.removeListener('before-quit', macBeforeQuitHandler);
            }
            macBeforeQuitHandler = clickFunc;
            app.on('before-quit', macBeforeQuitHandler);
        } else {
            clickFunc = () => {
                app.isQuitting = true;
                app.quit();
            };
            if (settings?.shortcuts?.quitApp) {
                globalShortcut.register(settings?.shortcuts?.quitApp, clickFunc);
            } else if (!settings?.shortcuts) {
                globalShortcut.register('CmdOrCtrl+Q', clickFunc);
            }
        }

        clickFunc = () => {
            // 主窗口是隐藏播放宿主：快捷键切换 Sigma 窗口 显示 ↔ 收起
            // 走节流：全局快捷键可被按住连发（按住 Shift 本身就会重复触发）
            const win = sigmaWindow && !sigmaWindow.isDestroyed() ? sigmaWindow : createSigmaWindow();
            if (!win || win.isDestroyed()) return;
            toggleSigmaDocked();
        }
        if (settings?.shortcuts?.mainWindow) {
            globalShortcut.register(settings?.shortcuts?.mainWindow, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('CmdOrCtrl+Shift+S', clickFunc);
        }

        clickFunc = () => sendToMainWindow('play-previous-track');
        if (settings?.shortcuts?.prevTrack) {
            globalShortcut.register(settings?.shortcuts?.prevTrack, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Left', clickFunc);
        }

        clickFunc = () => sendToMainWindow('play-next-track');
        if (settings?.shortcuts?.nextTrack) {
            globalShortcut.register(settings?.shortcuts?.nextTrack, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Right', clickFunc);
        }

        clickFunc = () => sendToMainWindow('volume-up');
        if (settings?.shortcuts?.volumeUp) {
            globalShortcut.register(settings?.shortcuts?.volumeUp, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Up', clickFunc);
        }

        clickFunc = () => sendToMainWindow('volume-down');
        if (settings?.shortcuts?.volumeDown) {
            globalShortcut.register(settings?.shortcuts?.volumeDown, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Down', clickFunc);
        }

        clickFunc = () => sendToMainWindow('toggle-play-pause');
        if (settings?.shortcuts?.playPause) {
            globalShortcut.register(settings?.shortcuts?.playPause, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Space', clickFunc);
        }

        clickFunc = () => sendToMainWindow('toggle-mute');
        if (settings?.shortcuts?.mute) {
            globalShortcut.register(settings?.shortcuts?.mute, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+M', clickFunc);
        }

        clickFunc = () => sendToMainWindow('toggle-like');
        if (settings?.shortcuts?.like) {
            globalShortcut.register(settings?.shortcuts?.like, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+L', clickFunc);
        }

        clickFunc = () => sendToMainWindow('toggle-mode');
        if (settings?.shortcuts?.mode) {
            globalShortcut.register(settings?.shortcuts?.mode, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+P', clickFunc);
        }

        clickFunc = () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            if (mainWindow.lyricsWindow) {
                mainWindow.lyricsWindow.close();
                mainWindow.lyricsWindow = null;
                new Notification({
                    title: t('desktop-lyrics-closed'),
                    icon: getIconPath('logo.png')
                }).show();
                syncDesktopLyricsSetting('off');
            } else {
                createLyricsWindow();
                syncDesktopLyricsSetting('on');
            }
        }
        if (settings?.shortcuts?.toggleDesktopLyrics) {
            globalShortcut.register(settings.shortcuts.toggleDesktopLyrics, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+Ctrl+D', clickFunc);
        }

        clickFunc = () => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            if (mainWindow.spectrumWindow) {
                mainWindow.spectrumWindow.close();
                mainWindow.spectrumWindow = null;
                syncDesktopSpectrumSetting('off');
            } else {
                createSpectrumWindow();
                syncDesktopSpectrumSetting('on');
            }
        }
        if (settings?.shortcuts?.toggleDesktopSpectrum) {
            globalShortcut.register(settings.shortcuts.toggleDesktopSpectrum, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+Ctrl+S', clickFunc);
        }
    } catch {
        dialog.showMessageBox({
            type: 'error',
            title: t('hint'),
            message: t('shortcut-failed'),
            buttons: [t('ok')]
        });
    }
}

const syncDesktopLyricsSetting = (value) => {
    const settings = store.get('settings') || {};
    store.set('settings', {
        ...settings,
        desktopLyrics: value
    });
};

const syncDesktopSpectrumSetting = (value) => {
    const settings = store.get('settings') || {};
    store.set('settings', {
        ...settings,
        desktopSpectrum: value
    });
};

// 设置任务栏缩略图工具栏
export function setThumbarButtons(mainWindow, isPlaying = false) {
    const buttons = [
        {
            tooltip: t('prev-track'),
            icon: getIconPath('prev.png'),
            click: () => {
                mainWindow.webContents.send('play-previous-track');
                setThumbarButtons(mainWindow, true);
            }
        },
        {
            tooltip: t('pause'),
            icon: getIconPath('pause.png'),
            click: () => {
                mainWindow.webContents.send('toggle-play-pause');
                setThumbarButtons(mainWindow, false);
            }
        },
        {
            tooltip: t('next-track'),
            icon: getIconPath('next.png'),
            click: () => {
                mainWindow.webContents.send('play-next-track');
                setThumbarButtons(mainWindow, true);
            }
        }
    ];

    if (!isPlaying) {
        buttons[1] = {
            tooltip: t('play'),
            icon: getIconPath('play.png'),
            click: () => {
                mainWindow.webContents.send('toggle-play-pause');
                setThumbarButtons(mainWindow, true);
            }
        };
    }

    mainWindow.setThumbarButtons(buttons);
}

// 处理自定义协议相关
let hash = "";
let listid = "";
let protocolMainWindow = null;

// 注册自定义协议
export function registerProtocolHandler(mainWindow) {
    const PROTOCOL = "jello";

    // 保存mainWindow引用
    if (mainWindow) {
        protocolMainWindow = mainWindow;
    }

    // 注册协议：开发模式要带应用根目录参数，否则点 jello:// 链接会启动裸 electron（空白窗口）
    const devArgs = isDev ? [path.resolve(__dirname, '..')] : [];
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, devArgs);

    // 处理启动参数
    handleArgv(process.argv);

    // second-instance 统一由 main.js 的顶层 handler 处理（含 --settings 与 revealSigmaWindow），
    // 这里不再重复注册，避免每次唤起执行两遍

    // 在macOS平台特别处理open-url事件
    if (process.platform === 'darwin') {
        app.on('open-url', (event, urlStr) => {
            event.preventDefault();
            handleUrl(urlStr);
        });
    }

    return {
        getHash: () => hash,
        handleProtocolArgv: handleArgv
    };
}

// 处理命令行参数
function handleArgv(argv) {
    const PROTOCOL = "jello";
    const prefix = `${PROTOCOL}:`;
    const url = argv.find(arg => arg.startsWith(prefix));
    if (url) handleUrl(url);
}

// 处理URL
function handleUrl(url) {
    // 深链来自外部（浏览器/其它应用的 jello:// 链接），内容不可控：
    // 畸形 URL 会让 new URL 抛异常，而本函数在 second-instance 同步链路里被调用，
    // 异常一路冒到 uncaughtException 后，唤起/协议处理的其余逻辑全部丢失。
    let urlObj;
    try {
        urlObj = new URL(url);
    } catch (error) {
        console.warn('[protocol] 忽略无法解析的深链:', url, error?.message);
        return;
    }

    // 提取所有参数并更新全局变量
    hash = urlObj.searchParams.get("hash") || "";
    listid = urlObj.searchParams.get("listid") || "";

    // 根据路径和参数决定发送什么数据到渲染进程
    if (protocolMainWindow && protocolMainWindow.webContents) {
        // 将所有参数打包发送
        protocolMainWindow.webContents.send('url-params', {
            hash,
            listid,
            urlPath: urlObj.pathname.substring(1) // 去掉前导斜杠
        });
    }
}

// 如果有从URL启动的hash参数，在页面加载完成后发送
export function sendHashAfterLoad(mainWindow) {
    if (mainWindow) {
        protocolMainWindow = mainWindow;
    }

    if ((hash || listid) && protocolMainWindow) {
        protocolMainWindow.webContents.on('did-finish-load', () => {
            setTimeout(() => {
                protocolMainWindow.webContents.send('url-params', {
                    hash,
                    listid,
                    urlPath: 'share'
                });
            }, 1000);
        });
    }
}
