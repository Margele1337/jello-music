const { contextBridge, ipcRenderer } = require('electron');

// ── IPC 通道白名单 ──
// 渲染端只能使用应用自身用到的通道；扩展页面使用 electron/preload-extension.cjs（不含原始 ipcRenderer）。
const SEND_CHANNELS = new Set([
    'custom-shortcut',
    'desktop-keystrokes-action',
    'desktop-lyrics-action',
    'desktop-spectrum-action',
    'lyrics-data',
    'lyrics-window-fixed-size',
    'open-url',
    'play-pause-action',
    'save-settings',
    'server-lyrics',
    'set-ignore-mouse-events',
    'set-spectrum-ignore-mouse-events',
    'set-tray-title',
    'sigma-command',
    'sigma-request-state',
    'sigma-state',
    'sigma-window-animate-done',
    'sigma-window-animate-position',
    'sigma-window-drag-end',
    'sigma-window-enter',
    'sigma-window-move',
    'sigma-window-restore',
    'spectrum-data',
    'spectrum-hud-ready',
    'spectrum-setting-update',
    'tray-menu-action',
    'tray-menu-hide',
    'tray-menu-ready',
    'tray-menu-rendered',
    'update-statusbar-image',
    'window-drag'
]);

const INVOKE_CHANNELS = new Set([
    'consume-pending-settings',
    'get-app-version',
    'lyrics-window-pointer-state',
    'sigma-window-get-bounds'
]);

const RECEIVE_CHANNELS = new Set([
    'auth-changed',
    'generate-statusbar-image',
    'keystrokes-input',
    'lyrics-data',
    'open-settings',
    'playing-status',
    'play-next-track',
    'play-previous-track',
    'request-current-spectrum',
    'settings-changed',
    'sigma-animate-stop',
    'sigma-animate-to',
    'sigma-command',
    'sigma-dock-changed',
    'sigma-request-state',
    'sigma-state',
    'spectrum-data',
    'spectrum-setting-changed',
    'toggle-like',
    'toggle-mode',
    'toggle-mute',
    'toggle-play-pause',
    'tray-menu-state',
    'tray-menu-theme-updated',
    'url-params',
    'volume-down',
    'volume-up'
]);

const isAllowed = (allowed, channel) => {
    if (allowed.has(channel)) return true;
    console.warn(`[preload] 已拦截未授权的 IPC 通道: ${channel}`);
    return false;
};

contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: {
        send: (channel, ...args) => {
            if (!isAllowed(SEND_CHANNELS, channel)) return;
            ipcRenderer.send(channel, ...args);
        },
        invoke: (channel, ...args) => {
            if (!isAllowed(INVOKE_CHANNELS, channel)) {
                return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
            }
            return ipcRenderer.invoke(channel, ...args);
        },
        on: (channel, listener) => {
            if (!isAllowed(RECEIVE_CHANNELS, channel)) return;
            ipcRenderer.on(channel, listener);
        },
        once: (channel, listener) => {
            if (!isAllowed(RECEIVE_CHANNELS, channel)) return;
            ipcRenderer.once(channel, listener);
        },
        removeListener: (channel, listener) => {
            if (!isAllowed(RECEIVE_CHANNELS, channel)) return;
            ipcRenderer.removeListener(channel, listener);
        },
        removeAllListeners: (channel) => {
            if (!isAllowed(RECEIVE_CHANNELS, channel)) return;
            ipcRenderer.removeAllListeners(channel);
        }
    },
    platform: process.platform
});

// 添加插件管理 API
contextBridge.exposeInMainWorld('electronAPI', {
    // 插件管理
    getExtensions: () => ipcRenderer.invoke('get-extensions'),
    getExtensionsDetailed: () => ipcRenderer.invoke('get-extensions-detailed'),
    reloadExtensions: () => ipcRenderer.invoke('reload-extensions'),
    openExtensionsDir: () => ipcRenderer.invoke('open-extensions-dir'),
    openExtensionPopup: (extensionId) => ipcRenderer.invoke('open-extension-popup', extensionId),
    installExtension: (extensionPath) => ipcRenderer.invoke('install-extension', extensionPath),
    uninstallExtension: (extensionId, extensionDir) => ipcRenderer.invoke('uninstall-extension', extensionId, extensionDir),
    validateExtension: (extensionPath) => ipcRenderer.invoke('validate-extension', extensionPath),
    getExtensionsDirectory: () => ipcRenderer.invoke('get-extensions-directory'),
    ensureExtensionsDirectory: () => ipcRenderer.invoke('ensure-extensions-directory'),
    installPluginFromZip: (zipPath) => ipcRenderer.invoke('install-plugin-from-zip', zipPath),
    installPluginFromUrl: (downloadUrl, extensionId = '', extensionDir = '') => ipcRenderer.invoke('install-plugin-from-url', {
        downloadUrl,
        extensionId,
        extensionDir,
    }),
    setNativeHostAuthorization: (extensionId, hostId, authorized) => ipcRenderer.invoke('set-native-host-authorization', extensionId, hostId, authorized),
    nativeHost: {
        getStatus: (hostId) => ipcRenderer.invoke('native-host-get-status', hostId),
        send: (hostId, payload) => ipcRenderer.invoke('native-host-send', hostId, payload),
        onMessage: (listener) => {
            const wrapped = (_event, payload) => listener(payload);
            ipcRenderer.on('native-host-message', wrapped);
            return () => ipcRenderer.removeListener('native-host-message', wrapped);
        }
    },
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    openLogPath: () => ipcRenderer.invoke('open-log-path'),
    exportLog: () => ipcRenderer.invoke('export-log'),
});
