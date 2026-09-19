import { app, ipcMain, globalShortcut, dialog, Notification, shell, session, powerSaveBlocker, nativeImage, screen } from 'electron';
import {
    createWindow, createTray, createTouchBar, startApiServer,
    stopApiServer,
    registerShortcut,
    createLyricsWindow, setThumbarButtons,
    registerProtocolHandler, sendHashAfterLoad, getTray,
    createSpectrumWindow, stopSpectrumFullscreenWatcher,
    createKeystrokesWindow, closeKeystrokesWindow, getKeystrokesWindow,
    createSigmaWindow, closeSigmaWindow, getSigmaWindow, restoreSigmaWindow, moveSigmaWindow,
    finishSigmaDrag, applySigmaAnimatePosition, finishSigmaAnimate, openSettingsWindow,
    toggleSigmaWindowFromHotkey, raiseSigmaWindow, revealSigmaWindow
} from './appServices.js';
import { initializeExtensions, cleanupExtensions } from './extensions/extensions.js';
import apiService from './services/apiService.js';
import statusBarLyricsService from './services/statusBarLyricsService.js';
import customTrayMenuService from './services/customTrayMenuService.js';
import { setupDesktopShortcutIcon } from './services/desktopShortcutIcon.js';
import { openLogPath, exportLog } from './services/logHelper.js';
import { setupAutoUpdater, checkForUpdates } from './services/updater.js';
import { initGlobalKeyListener, stopGlobalKeyListener, setGlobalKeySuspended, setKeystrokeHandler } from './services/globalKeyService.js';
import Store from 'electron-store';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { t } from './language/i18n.js';

// 从旧版（MoeKoe-NextGen）迁移用户数据：设置、登录态、窗口位置等
const migrateLegacyUserData = () => {
    try {
        const newDir = app.getPath('userData');
        if (path.basename(newDir) !== 'Jello Music') return;
        if (fs.existsSync(path.join(newDir, 'config.json'))) return; // 已迁移过
        const legacyDir = path.join(path.dirname(newDir), 'MoeKoe-NextGen');
        if (!fs.existsSync(legacyDir)) return;
        fs.mkdirSync(newDir, { recursive: true });
        fs.cpSync(legacyDir, newDir, { recursive: true, force: false, errorOnExist: false });
        console.log('[Migration] 已迁移旧版用户数据:', legacyDir, '->', newDir);
    } catch (error) {
        console.error('[Migration] 迁移旧版用户数据失败:', error);
    }
};
migrateLegacyUserData();

let mainWindow = null;
let blockerId = null;
const store = new Store();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SETTINGS_ARG = '--settings';
let pendingOpenSettings = false;

// 渲染进程挂载后主动领取「启动时带 --settings」的请求
ipcMain.handle('consume-pending-settings', () => {
    const pending = pendingOpenSettings;
    pendingOpenSettings = false;
    return pending;
});

// 主窗口请求在 Sigma 窗口内打开设置（Sigma 窗口未就绪就先记下，等它挂载后领取）
ipcMain.on('sigma-request-settings', () => {
    const handled = openSettingsWindow(mainWindow);
    if (handled) return;
    pendingOpenSettings = true;
    const win = getSigmaWindow();
    if (!win || win.isDestroyed()) {
        // 窗口不存在时补创建一个，挂载后会领取 pending 设置请求
        createSigmaWindow();
    }
});

// Sigma 窗口登录/退出后：通知主窗口同步登录态
ipcMain.on('auth-changed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth-changed');
    }
});

// 设置页已移到 Sigma 窗口：把该窗口的 settings-change 转发给主窗口（频谱/桌面歌词等需要即时生效）
ipcMain.on('settings-changed', (_event, settings) => {
    if (settings && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('settings-changed', settings);
    }
});

// Windows 跳转列表：任务栏图标右键 → 任务 → 设置
const setupJumpList = () => {
    if (process.platform !== 'win32') return;
    app.setAppUserModelId('cn.jello.music');
    app.setUserTasks([
        {
            program: process.execPath,
            arguments: SETTINGS_ARG,
            title: t('settings'),
            description: t('settings'),
            iconPath: process.execPath,
            iconIndex: 0
        }
    ]);
};

if (process.argv.includes(SETTINGS_ARG)) {
    pendingOpenSettings = true;
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    process.exit(0);
} else {
    let protocolHandler;
    app.on('second-instance', (event, commandLine) => {
        if (!protocolHandler) {
            protocolHandler = registerProtocolHandler(null);
        }
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            if (commandLine.includes(SETTINGS_ARG)) {
                openSettingsWindow(mainWindow);
            } else {
                // 主窗口是隐藏播放宿主：把 Sigma 窗口提到最前（贴边收起会自动滑出）
                revealSigmaWindow(getSigmaWindow() || createSigmaWindow());
            }
        }
        protocolHandler.handleProtocolArgv(commandLine);
    });
}

app.on('ready', () => {
    startApiServer().then(() => {
        try {
            mainWindow = createWindow();
            createTray(mainWindow);
            setupJumpList();
            customTrayMenuService.init(() => mainWindow, getTray);

            // 初始化状态栏歌词服务
            statusBarLyricsService.init(mainWindow, store, getTray, createTray);

            if (process.platform === "darwin" && store.get('settings')?.touchBar == 'on') createTouchBar(mainWindow);
            registerShortcut();
            apiService.init(mainWindow);
            registerProtocolHandler(mainWindow);
            sendHashAfterLoad(mainWindow);
            setupAutoUpdater(mainWindow);
            checkForUpdates(true);
            initGlobalKeyListener({ onRightShift: () => toggleSigmaWindowFromHotkey() });
            setKeystrokeHandler((payload) => {
                const win = getKeystrokesWindow();
                if (win && !win.isDestroyed()) {
                    win.webContents.send('keystrokes-input', payload);
                }
            });
            void initializeExtensions();
            setupDesktopShortcutIcon();
        } catch (error) {
            console.log('初始化应用时发生错误:', error);
            createTray(null);
            dialog.showMessageBox({
                type: 'error',
                title: t('error'),
                message: t('init-error'),
                buttons: [t('ok')]
            }).then(result => {
                if (result.response === 0) {
                    app.isQuitting = true;
                    app.quit();
                }
            });
        }
    }).catch((error) => {
        console.log('API 服务启动失败:', error);
        createTray(null);
        dialog.showMessageBox({
            type: 'error',
            title: t('error'),
            message: t('api-error'),
            buttons: [t('ok')]
        }).then(result => {
            if (result.response === 0) {
                app.isQuitting = true;
                app.quit();
            }
            return;
        });
    });
});

const settings = store.get('settings');
if (settings?.gpuAcceleration === 'on') {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('enable-transparent-visuals');
    app.commandLine.appendSwitch('disable-gpu-compositing');
}

if (settings?.preventAppSuspension === 'on') {
    blockerId = powerSaveBlocker.start('prevent-display-sleep');
}

if (settings?.highDpi === 'on') {
    app.commandLine.appendSwitch('high-dpi-support', '1');
    app.commandLine.appendSwitch('force-device-scale-factor', settings?.dpiScale || '1');
}

if (settings?.apiMode === 'on') {
    apiService.start();
}

// 即将退出
app.on('before-quit', () => {
    if (mainWindow && !mainWindow.isMaximized()) {
        const windowBounds = mainWindow.getBounds();
        store.set('windowState', windowBounds);
    }
    if (blockerId !== null) {
        powerSaveBlocker.stop(blockerId);
    }

    // 清理状态栏歌词服务
    setImmediate(() => {
        statusBarLyricsService.cleanup();
        customTrayMenuService.cleanup();

        stopApiServer();
                stopSpectrumFullscreenWatcher();
        apiService.stop();
        cleanupExtensions();
        app.exit(0);
    });
});
// 关闭所有窗口
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.isQuitting = true;
        app.quit(); // 非 mpcOS 系统上关闭所有窗口后退出应用
    }
});
// 图标被点击
app.on('activate', () => {
    if (!mainWindow) {
        mainWindow = createWindow();
    }
    const sigmaWin = getSigmaWindow();
    if (sigmaWin && !sigmaWin.isDestroyed()) {
        revealSigmaWindow(sigmaWin);
    } else {
        revealSigmaWindow(createSigmaWindow());
    }
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    console.error('Unhandled Exception:', error);
});

// 新手教程等场景：临时挂起 RSHIFT 热键
ipcMain.on('sigma-hotkey-suspend', (_event, flag) => {
    setGlobalKeySuspended(!!flag);
});

// 应用版本（渲染端用于设置页/扩展兼容显示）
ipcMain.handle('get-app-version', () => app.getVersion());

app.on('will-quit', () => {
    stopGlobalKeyListener();
    globalShortcut.unregisterAll();
});
ipcMain.on('save-settings', (event, settings) => {
    store.set('settings', settings);
    if (['on', 'off'].includes(settings?.autoStart)) {
        app.setLoginItemSettings({
            openAtLogin: settings?.autoStart === 'on',
            path: app.getPath('exe'),
        });
    }
});
ipcMain.on('clear-settings', (event) => {
    store.clear();
    session.defaultSession.clearCache();
    session.defaultSession.clearStorageData();
    const userDataPath = app.getPath('userData');
    shell.openPath(userDataPath);
});
ipcMain.on('custom-shortcut', (event) => {
    registerShortcut();
});

ipcMain.on('lyrics-data', (event, lyricsData) => {
    const lyricsWindow = mainWindow?.lyricsWindow;
    if (lyricsWindow) {
        lyricsWindow.webContents.send('lyrics-data', lyricsData);
    }

    // 状态栏歌词功能服务处理（仅支持Mpc系统）
    if (process.platform === 'darwin') {
        statusBarLyricsService.handleLyricsData(lyricsData);
    }
});

// 转发频谱可视化数据到桌面频谱窗口
ipcMain.on('spectrum-data', (event, data) => {
    const spectrumWindow = mainWindow?.spectrumWindow;
    if (spectrumWindow) {
        spectrumWindow.webContents.send('spectrum-data', data);
    }
});

// 频谱窗口就绪，请求主窗口重发当前频谱/封面信息
ipcMain.on('spectrum-hud-ready', () => {
    if (mainWindow && mainWindow.spectrumWindow) {
        mainWindow.webContents.send('request-current-spectrum');
    }
});

// 转发设置变更到频谱窗口（实时生效，无需重启）
ipcMain.on('spectrum-setting-update', (_event, { key, value }) => {
    const spectrumWindow = mainWindow?.spectrumWindow;
    if (spectrumWindow) {
        spectrumWindow.webContents.send('spectrum-setting-changed', { key, value });
    }
});

ipcMain.on('server-lyrics', (event, lyricsData) => {
    apiService.updateLyrics(lyricsData);
});

// 监听桌面歌词操作
ipcMain.on('desktop-lyrics-action', (event, action) => {
    switch (action) {
        case 'previous-song':
            mainWindow.webContents.send('play-previous-track');
            break;
        case 'next-song':
            mainWindow.webContents.send('play-next-track');
            break;
        case 'toggle-play':
            mainWindow.webContents.send('toggle-play-pause');
            break;
        case 'close-lyrics':
            const lyricsWindow = mainWindow.lyricsWindow;
            if (lyricsWindow) {
                lyricsWindow.close();
                new Notification({
                    title: t('desktop-lyrics-closed'),
                    icon: path.join(__dirname, '../build/icons/logo.png')
                }).show();
                mainWindow.lyricsWindow = null;
            }
            syncDesktopLyricsSetting('off');
            break;
        case 'display-lyrics':
            if (!mainWindow.lyricsWindow) createLyricsWindow();
            syncDesktopLyricsSetting('on');
            break;
    }
});

const syncDesktopLyricsSetting = (value) => {
    const settings = store.get('settings') || {};
    store.set('settings', {
        ...settings,
        desktopLyrics: value
    });
};

// 监听桌面频谱操作
ipcMain.on('desktop-spectrum-action', (event, action) => {
    switch (action) {
        case 'display-spectrum':
            if (!mainWindow.spectrumWindow) createSpectrumWindow();
            syncDesktopSpectrumSetting('on');
            break;
        case 'close-spectrum':
            const spectrumWindow = mainWindow.spectrumWindow;
            if (spectrumWindow) {
                spectrumWindow.close();
                mainWindow.spectrumWindow = null;
            }
            syncDesktopSpectrumSetting('off');
            break;
    }
});

const syncDesktopSpectrumSetting = (value) => {
    const settings = store.get('settings') || {};
    store.set('settings', {
        ...settings,
        desktopSpectrum: value
    });
};

// 监听 KeyStrokes 覆盖层开关
ipcMain.on('desktop-keystrokes-action', (event, action) => {
    switch (action) {
        case 'display-keystrokes':
            if (!getKeystrokesWindow()) createKeystrokesWindow();
            syncDesktopKeystrokesSetting('on');
            break;
        case 'close-keystrokes': {
            const win = getKeystrokesWindow();
            if (win) win.close();
            syncDesktopKeystrokesSetting('off');
            break;
        }
    }
});

const syncDesktopKeystrokesSetting = (value) => {
    const settings = store.get('settings') || {};
    store.set('settings', {
        ...settings,
        desktopKeystrokes: value
    });
};

ipcMain.on('set-ignore-mouse-events', (event, ignore) => {
    const lyricsWindow = mainWindow.lyricsWindow;
    if (lyricsWindow) {
        lyricsWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
});

ipcMain.on('set-spectrum-ignore-mouse-events', (event, ignore) => {
    const spectrumWindow = mainWindow?.spectrumWindow;
    if (spectrumWindow) {
        spectrumWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
});

ipcMain.on('window-drag', (event, { x, y, width, height }) => {
    const lyricsWindow = mainWindow.lyricsWindow;
    if (!lyricsWindow) return
    const bounds = lyricsWindow.getBounds();
    const nextBounds = {
        x: Math.round(x ?? bounds.x),
        y: Math.round(y ?? bounds.y),
        width: Math.round(width ?? bounds.width),
        height: Math.round(height ?? bounds.height)
    };
    lyricsWindow.setBounds(nextBounds)
    store.set('lyricsWindowPosition', { x: nextBounds.x, y: nextBounds.y });
    store.set('lyricsWindowSize', { width: nextBounds.width, height: nextBounds.height });
})

ipcMain.on('spectrum-window-drag', (event, { x, y, width, height }) => {
    const spectrumWindow = mainWindow.spectrumWindow;
    if (!spectrumWindow) return
    const bounds = spectrumWindow.getBounds();
    const nextBounds = {
        x: Math.round(x ?? bounds.x),
        y: Math.round(y ?? bounds.y),
        width: Math.round(width ?? bounds.width),
        height: Math.round(height ?? bounds.height)
    };
    spectrumWindow.setBounds(nextBounds)
    store.set('spectrumWindowPosition', { x: nextBounds.x, y: nextBounds.y });
    store.set('spectrumWindowSize', { width: nextBounds.width, height: nextBounds.height });
})

ipcMain.on('lyrics-window-fixed-size', (event, { width, height, fixed }) => {
    const lyricsWindow = mainWindow.lyricsWindow;
    if (!lyricsWindow) return
    if (fixed) {
        lyricsWindow.setMaximumSize(Math.round(width), Math.round(height));
        return
    }
    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    lyricsWindow.setMaximumSize(screenWidth, screenHeight);
})

// Sigma UI：独立透明窗口（固定 800x600），主窗口隐藏但继续播放
ipcMain.on('sigma-window-enter', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    createSigmaWindow();
    mainWindow.hide();
});

ipcMain.on('sigma-window-exit', () => {
    closeSigmaWindow();
});

// 转发 Sigma 窗口的播放指令到主窗口
ipcMain.on('sigma-command', (_event, command) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sigma-command', command);
    }
});

// 转发主窗口的播放状态到 Sigma 窗口
ipcMain.on('sigma-state', (_event, state) => {
    const win = getSigmaWindow();
    if (win && !win.isDestroyed()) {
        win.webContents.send('sigma-state', state);
    }
});

ipcMain.on('sigma-request-state', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sigma-request-state');
    }
});

// 收起状态下从右侧滑出（悬停/点击收起条时触发）
ipcMain.on('sigma-window-restore', () => {
    restoreSigmaWindow();
});

// 自绘拖拽：渲染进程发来期望位置，主进程负责夹取范围/贴边收起
ipcMain.on('sigma-window-move', (_event, position) => {
    if (!position) return;
    moveSigmaWindow(position.x, position.y, position.movedX);
});

// 松手：决定是否吸附收起
ipcMain.on('sigma-window-drag-end', () => {
    finishSigmaDrag();
});

// 渲染进程 rAF 动画回传
ipcMain.on('sigma-window-animate-position', (_event, position) => {
    if (!position) return;
    applySigmaAnimatePosition(position.x, position.y);
});

ipcMain.on('sigma-window-animate-done', () => {
    finishSigmaAnimate();
});

ipcMain.handle('sigma-window-get-bounds', () => {
    const win = getSigmaWindow();
    if (!win || win.isDestroyed()) return null;
    return win.getBounds();
});

ipcMain.handle('lyrics-window-pointer-state', () => {
    const lyricsWindow = mainWindow.lyricsWindow;
    if (!lyricsWindow) return null
    return {
        cursor: screen.getCursorScreenPoint(),
        bounds: lyricsWindow.getBounds()
    };
})

ipcMain.on('play-pause-action', (event, playing, currentTime) => {
    const lyricsWindow = mainWindow.lyricsWindow;
    if (lyricsWindow) {
        lyricsWindow.webContents.send('playing-status', playing);
    }
    const spectrumWindow = mainWindow.spectrumWindow;
    if (spectrumWindow) {
        spectrumWindow.webContents.send('playing-status', playing);
    }
    apiService.updatePlayerState({ isPlaying: playing, currentTime: currentTime });
    setThumbarButtons(mainWindow, playing);
    customTrayMenuService.updatePlaybackState(playing, currentTime);
})

ipcMain.on('open-url', (event, url) => {
    shell.openExternal(url);
})

ipcMain.on('set-tray-title', (event, title) => {
    createTray(mainWindow, t('now-playing') + title);
    mainWindow.setTitle(title);
    void customTrayMenuService.refresh();
})


ipcMain.handle('open-log-path', async (e) => {
    try {
        const result = await openLogPath();
        return result ? { error: result } : { success: true };
    }
    catch (err) { return { error: err }; }
});

ipcMain.handle('export-log', async (e) => {
    try { return await exportLog(); }
    catch (err) { return { error: err }; }
});

