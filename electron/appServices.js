import { app, ipcMain, BrowserWindow, screen, Tray, Menu, TouchBar, globalShortcut, dialog, shell, nativeImage } from 'electron';
import path from 'path';
import { spawn } from 'child_process';
import log from 'electron-log';
import Store from 'electron-store';
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
let neteaseApiProcess = null;
let tray = null;

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

    const isValidPosition = x !== undefined && y !== undefined &&
        x >= 0 && x <= screenWidth &&
        y >= 0 && y <= screenHeight;

    if (!isValidPosition) {
        x = Math.floor((screenWidth - width) / 2);
        y = Math.floor((screenHeight - height) / 2);
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

const anchorSpectrumWindow = () => {
    if (spectrumAnchorGuard || !spectrumWindow || spectrumWindow.isDestroyed()) return;
    const bounds = spectrumWindow.getBounds();
    const y = getSpectrumAnchorBottom() - bounds.height;
    if (bounds.y === y) return;
    spectrumAnchorGuard = true;
    try {
        spectrumWindow.setBounds({ x: bounds.x, y, width: bounds.width, height: bounds.height });
    } finally {
        spectrumAnchorGuard = false;
    }
};

const bindSpectrumDisplayListeners = () => {
    if (spectrumDisplayListenersBound) return;
    spectrumDisplayListenersBound = true;
    const reanchor = () => anchorSpectrumWindow();
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

    // 检查位置是否有效
    const isValidPosition = x !== undefined && y !== undefined &&
        x >= 0 && x <= screenWidth &&
        y >= 0 && y <= screenHeight;

    // 如果位置无效，设置默认位置
    if (!isValidPosition) {
        x = Math.floor((screenWidth - width) / 2);
        y = screenHeight - height;
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
    mainWindow.lyricsWindow = lyricsWindow;
    lyricsWindow.on('closed', () => {
        mainWindow.lyricsWindow = null;
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
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const savedConfig = store.get('settings') || {};

    const defaultHeight = 150;
    const savedPosition = store.get('spectrumWindowPosition') || {};
    const savedSize = store.get('spectrumWindowSize') || {
        width: screenWidth,
        height: defaultHeight
    };

    let x = savedPosition.x ?? 0;
    let y = savedPosition.y ?? (screenHeight - defaultHeight);
    let width = Math.min(savedSize.width || screenWidth, screenWidth);
    let height = Math.min(savedSize.height || defaultHeight, screenHeight);

    // 位置无效时锚定屏幕底部
    const isValidPosition = x !== undefined && y !== undefined &&
        x >= 0 && x <= screenWidth &&
        y >= 0 && y <= screenHeight;
    if (!isValidPosition) {
        x = 0;
        y = screenHeight - height;
    }

    spectrumWindow = new BrowserWindow({
        width: width,
        height: height,
        x: x,
        y: y,
        minWidth: 300,
        minHeight: 60,
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

    spectrumWindow.on('resize', () => {
        anchorSpectrumWindow();
        persistSpectrumWindowBounds();
    });
    spectrumWindow.on('move', persistSpectrumWindowBounds);
    mainWindow.spectrumWindow = spectrumWindow;
    spectrumWindow.on('closed', () => {
        mainWindow.spectrumWindow = null;
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

// Sigma UI 独立透明窗口（固定 800x600，背景可透到应用后面）
let sigmaWindow = null;
let sigmaWindowLoaded = false;
let sigmaDocked = false;
let sigmaAnimating = false;

const SIGMA_DOCK_VISIBLE = 40;   // 贴右边缘收起后保留可见的宽度（原版 var8 = parentWidth - 40）
const SIGMA_RESTORE_MARGIN = 20; // 滑出后距右边缘的间距（原版 var11 = parentWidth - 20 - width）

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

let sigmaAnimationTimer = null;
let sigmaAnimationWatchdog = null;
let sigmaAnimationStartedAt = 0;
let sigmaAnimationMode = null;  // 'renderer' | 'main'
let sigmaLastFrameAt = 0;
let sigmaLastX = 0;
let sigmaLastY = 0;
let sigmaTargetX = 0;
let sigmaTargetY = 0;

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

// 拖动过程中（复刻原版 handleMovementAndCheckBoundaries + MusicPlayer.updatePanelDimensions）：
// 1) 平时四边硬夹在显示器内（碰到右边缘不会收起）
// 2) 鼠标相对起手点向右超过 70px 且目标超出屏幕右边 200px 以上时，向屏幕外推（每次推进超出量的一半）
// 3) 松手时若已在屏幕外，才吸附收起到 40px
export function moveSigmaWindow(x, y, movedX = 0) {
    if (!sigmaWindow || sigmaWindow.isDestroyed() || sigmaAnimationBlocked()) return;

    const bounds = sigmaWindow.getBounds();
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const display = screen.getDisplayMatching({ x: Math.round(x), y: Math.round(y), width: bounds.width, height: bounds.height });
    const area = display.workArea;
    const right = area.x + area.width;
    const bottom = area.y + area.height;
    const nextY = Math.min(Math.max(Math.round(y), area.y), bottom - bounds.height);

    // 原版：var14 = 200, newHeight - mouseX > 70
    if (x + bounds.width > right + 200 && movedX > 70) {
        const excess = x - bounds.x - 200;
        const pushedX = Math.round(bounds.x + excess * 0.5);
        if (pushedX !== bounds.x || nextY !== bounds.y) {
            sigmaWindow.setBounds({ x: pushedX, y: nextY, width: bounds.width, height: bounds.height });
        }
        return;
    }

    const nextX = Math.min(Math.max(Math.round(x), area.x), right - bounds.width);
    if (nextX !== bounds.x || nextY !== bounds.y) {
        sigmaWindow.setBounds({ x: nextX, y: nextY, width: bounds.width, height: bounds.height });
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

    if (bounds.x + bounds.width > right) {
        setSigmaDocked(true);
        animateSigmaWindow(right - SIGMA_DOCK_VISIBLE, centerY);
        return;
    }

    setSigmaDocked(false);
    const nextX = Math.min(Math.max(bounds.x, area.x), right - bounds.width);
    const nextY = Math.min(Math.max(bounds.y, area.y), bottom - bounds.height);
    if (nextX !== bounds.x || nextY !== bounds.y) {
        sigmaWindow.setBounds({ x: nextX, y: nextY, width: bounds.width, height: bounds.height });
    }
}

// 从收起状态滑出（原版 var11 = parentWidth - 20 - width）
export function restoreSigmaWindow() {
    if (!sigmaWindow || sigmaWindow.isDestroyed() || sigmaAnimationBlocked()) return;
    const bounds = sigmaWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const right = area.x + area.width;
    if (bounds.x + bounds.width <= right) return; // 未在屏幕外，无需滑出
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
        if (sigmaWindow && !sigmaWindow.isDestroyed()) sigmaWindow.show();
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

const getIconPath = (iconName, subPath = '') => path.join(
    isDev ? __dirname + '/../build/icons' : process.resourcesPath + '/icons',
    subPath,
    iconName
);

export function getTray() {
    return tray;
}

// 打开设置：Sigma 窗口开着就在 Sigma 窗口内显示设置页，否则用主窗口
// 返回是否由 Sigma 窗口接收（未就绪时由调用方决定是否记为 pending）
export function openSettingsWindow(mainWindow) {
    const sigmaReady = sigmaWindowLoaded && sigmaWindow && !sigmaWindow.isDestroyed() && sigmaWindow.isVisible();
    if (sigmaReady) {
        sigmaWindow.show();
        sigmaWindow.focus();
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
    if (tray && title) {
        tray.setToolTip(title);
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
            label: t('show-hide'),
                        icon: getIconPath('show.png', 'menu'),
            click: () => {
                // 主窗口是隐藏播放宿主：显示/隐藏作用于 Sigma 窗口
                const win = getSigmaWindow();
                if (!win || win.isDestroyed()) {
                    // 窗口还没创建：创建即显示
                    createSigmaWindow();
                    return;
                }
                if (win.isVisible()) {
                    win.hide();
                } else {
                    win.show();
                    win.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: t('prev-track'),
            icon: getIconPath('prev.png', 'menu'),
                        click: () => {
                mainWindow.webContents.send('play-previous-track');
            }
        },
        {
            label: t('pause'),
            icon: getIconPath('play.png', 'menu'),
            click: () => {
                mainWindow.webContents.send('toggle-play-pause');
            }
        },
        {
            label: t('next-track'),
            icon: getIconPath('next.png', 'menu'),
            click: () => {
                mainWindow.webContents.send('play-next-track');
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
            const win = createSigmaWindow();
            if (win && !win.isDestroyed()) {
                win.show();
                win.focus();
            }
        });
        tray.on('double-click', () => {
            customTrayMenuService.hide();
            const win = createSigmaWindow();
            if (win && !win.isDestroyed()) {
                win.show();
                win.focus();
            }
        });
    }
    return tray;
}

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

    // 监听播放状态变化
    ipcMain.on("play-pause-action", (event, playing) => {
        isPlaying = playing;
        playPauseButton.icon = iconPath(isPlaying ? "pause" : "play");
    });

    // 监听歌词更新
    ipcMain.on("update-current-lyrics", (event, currentLyric) => {
        if (currentLyric) {
            lyricsLabel.label = currentLyric;
        }
    });

    return touchBar;
}

// 启动 API 服务器
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
                    apiPath = path.join(process.resourcesPath, '../api', 'app_macos');
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
        apiProcess = spawn(apiPath, Args, { windowsHide: true });

        apiProcess.stdout.on('data', (data) => {
            log.info(`API输出: ${data}`);
            if (data.toString().includes('running')) {
                console.log('API服务器已启动');
                resolve();
            }
        });

        apiProcess.stderr.on('data', (data) => {
            log.error(`API 错误: ${data}`);
            reject(data);
        });

        apiProcess.on('close', (code) => {
            log.info(`API 关闭，退出码: ${code}`);
        });

        apiProcess.on('error', (error) => {
            log.error('启动 API 失败:', error);
            reject(error);
        });
    });
}

// 停止 API 服务器
export function stopApiServer() {
    if (apiProcess) {
        process.kill(apiProcess.pid, 'SIGKILL');
        apiProcess = null;
    }
}

// 启动网易云 API 服务器
export function startNeteaseApiServer() {
    return new Promise((resolve, reject) => {
        if (isDev) {
            // 开发模式下由 npm run api-netease 处理
            return resolve();
        }

        const apiPath = path.join(process.resourcesPath, '../api-netease', 'start.js');

        if (!fs.existsSync(apiPath)) {
            log.error(`网易云 API 入口文件未找到：${apiPath}`);
            // 非致命错误，网易云 API 不可用不影响酷狗 API
            resolve();
            return;
        }

        log.info(`网易云 API 路径: ${apiPath}`);

        const savedConfig = store.get('settings') || {};
        const proxy = savedConfig?.proxy;
        const proxyUrl = savedConfig?.proxyUrl;

        const env = { ...process.env };
        if (proxy === 'on' && proxyUrl) {
            env.PROXY_URL = String(proxyUrl).trim();
            env.ENABLE_PROXY = 'true';
        }

        neteaseApiProcess = spawn('node', [apiPath, '--port=6522'], {
            windowsHide: true,
            env,
        });

        neteaseApiProcess.stdout.on('data', (data) => {
            log.info(`网易云 API 输出: ${data}`);
            if (data.toString().includes('running')) {
                console.log('网易云 API 服务器已启动');
                resolve();
            }
        });

        neteaseApiProcess.stderr.on('data', (data) => {
            log.error(`网易云 API 错误: ${data}`);
        });

        neteaseApiProcess.on('close', (code) => {
            log.info(`网易云 API 关闭，退出码: ${code}`);
        });

        neteaseApiProcess.on('error', (error) => {
            log.error('启动网易云 API 失败:', error);
            // 非致命错误
            resolve();
        });

        // 超时保护
        setTimeout(() => resolve(), 5000);
    });
}

// 停止网易云 API 服务器
export function stopNeteaseApiServer() {
    if (neteaseApiProcess) {
        process.kill(neteaseApiProcess.pid, 'SIGKILL');
        neteaseApiProcess = null;
    }
}

// 注册快捷键
export function registerShortcut() {
    try {
        const settings = store.get('settings');
        globalShortcut.unregisterAll();
        let clickFunc = () => { app.isQuitting = true; };
        if (process.platform === 'darwin') {
            app.on('before-quit', clickFunc);
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
            // 主窗口是隐藏播放宿主：快捷键切换 Sigma 窗口显示
            const win = sigmaWindow && !sigmaWindow.isDestroyed() ? sigmaWindow : createSigmaWindow();
            if (!win || win.isDestroyed()) return;
            if (win.isVisible()) {
                win.hide();
            } else {
                win.show();
                win.focus();
            }
        }
        if (settings?.shortcuts?.mainWindow) {
            globalShortcut.register(settings?.shortcuts?.mainWindow, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('CmdOrCtrl+Shift+S', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('play-previous-track');
        if (settings?.shortcuts?.prevTrack) {
            globalShortcut.register(settings?.shortcuts?.prevTrack, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Left', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('play-next-track');
        if (settings?.shortcuts?.nextTrack) {
            globalShortcut.register(settings?.shortcuts?.nextTrack, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Right', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('volume-up');
        if (settings?.shortcuts?.volumeUp) {
            globalShortcut.register(settings?.shortcuts?.volumeUp, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Up', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('volume-down');
        if (settings?.shortcuts?.volumeDown) {
            globalShortcut.register(settings?.shortcuts?.volumeDown, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Down', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('toggle-play-pause');
        if (settings?.shortcuts?.playPause) {
            globalShortcut.register(settings?.shortcuts?.playPause, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+Space', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('toggle-mute');
        if (settings?.shortcuts?.mute) {
            globalShortcut.register(settings?.shortcuts?.mute, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+M', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('toggle-like');
        if (settings?.shortcuts?.like) {
            globalShortcut.register(settings?.shortcuts?.like, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+L', clickFunc);
        }

        clickFunc = () => mainWindow.webContents.send('toggle-mode');
        if (settings?.shortcuts?.mode) {
            globalShortcut.register(settings?.shortcuts?.mode, clickFunc);
        } else if (!settings?.shortcuts) {
            globalShortcut.register('Alt+CommandOrControl+P', clickFunc);
        }

        clickFunc = () => {
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

    // 注册协议
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath);

    // 处理启动参数
    handleArgv(process.argv);

    // 处理第二个实例的启动参数
    app.on('second-instance', (event, commandLine) => {
        if (protocolMainWindow) {
    if (protocolMainWindow.isMinimized()) protocolMainWindow.restore();
    // 主窗口是隐藏播放宿主：把 Sigma 窗口带到前台
    const sigmaWin = sigmaWindow && !sigmaWindow.isDestroyed() ? sigmaWindow : createSigmaWindow();
    if (sigmaWin && !sigmaWin.isDestroyed()) {
        sigmaWin.show();
        sigmaWin.focus();
    }
            handleArgv(commandLine);
        }
    });

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
    const urlObj = new URL(url);

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
