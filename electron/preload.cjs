const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jello', {
  getVersion: () => ipcRenderer.invoke('app:version')
});
