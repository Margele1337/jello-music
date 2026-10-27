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
  api: {
    request: (request) => ipcRenderer.invoke('api:request', request)
  }
});
