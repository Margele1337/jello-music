const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jello', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:version')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: (callback) => {
      const handler = (_event, settings) => callback(settings);
      ipcRenderer.on('settings:changed', handler);
      return () => ipcRenderer.removeListener('settings:changed', handler);
    }
  },
  auth: {
    get: () => ipcRenderer.invoke('auth:get'),
    clear: () => ipcRenderer.invoke('auth:clear'),
    onChange: (callback) => {
      const handler = (_event, profile) => callback(profile);
      ipcRenderer.on('auth:changed', handler);
      return () => ipcRenderer.removeListener('auth:changed', handler);
    }
  },
  api: {
    request: (request) => ipcRenderer.invoke('api:request', request)
  }
});
