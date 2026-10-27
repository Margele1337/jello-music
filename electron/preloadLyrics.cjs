const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jelloLyrics', {
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('desktop-lyrics:state', handler);
    return () => ipcRenderer.removeListener('desktop-lyrics:state', handler);
  }
});
