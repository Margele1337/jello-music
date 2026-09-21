const { contextBridge, ipcRenderer } = require('electron');

// 扩展页面（popup / native host bridge）专用 preload：
// 只暴露插件 API，不提供原始 ipcRenderer，避免第三方扩展调用应用任意 IPC 通道。
contextBridge.exposeInMainWorld('electron', {
    platform: process.platform
});

contextBridge.exposeInMainWorld('electronAPI', {
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
