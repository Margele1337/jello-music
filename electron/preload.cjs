const { contextBridge, ipcRenderer } = require('electron');

// ── IPC 通道白名单 ──
// 渲染端只能使用应用自身用到的通道。
const SEND_CHANNELS = new Set([
    'auth-changed',
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
    'settings-changed',
    'set-tray-title',
    'sigma-command',
    'sigma-hotkey-suspend',
    'sigma-request-settings',
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
    'sigma-overhang-changed',
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

contextBridge.exposeInMainWorld('electronAPI', {
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    openLogPath: () => ipcRenderer.invoke('open-log-path'),
    exportLog: () => ipcRenderer.invoke('export-log'),
});
