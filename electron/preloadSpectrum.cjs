const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jelloSpectrum', {
  onData: (callback) => {
    const handler = (_event, bands) => callback(bands);
    ipcRenderer.on('spectrum:data', handler);
    return () => ipcRenderer.removeListener('spectrum:data', handler);
  }
});
