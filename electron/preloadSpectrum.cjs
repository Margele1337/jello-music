const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jelloSpectrum', {
  onData: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('spectrum:data', handler);
    return () => ipcRenderer.removeListener('spectrum:data', handler);
  },
  onSettings: (callback) => {
    const handler = (_event, settings) => callback(settings);
    ipcRenderer.on('spectrum:settings', handler);
    return () => ipcRenderer.removeListener('spectrum:settings', handler);
  },
  setLocked: (value) => ipcRenderer.send('spectrum:lock-toggle', value === true),
  ready: () => ipcRenderer.send('spectrum:hud-ready')
});
