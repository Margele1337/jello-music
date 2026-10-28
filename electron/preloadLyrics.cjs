const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('jelloLyrics', {
  onState: (callback) => subscribe('desktop-lyrics:state', callback),
  onProgress: (callback) => subscribe('desktop-lyrics:progress', callback),
  ready: () => ipcRenderer.send('desktop-lyrics:ready'),
  sendAction: (action) => ipcRenderer.send('desktop-lyrics:action', String(action)),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('desktop-lyrics:ignore-mouse', ignore === true),
  sendBounds: (bounds) => ipcRenderer.send('desktop-lyrics:bounds', bounds),
  setFixedSize: (payload) => ipcRenderer.send('desktop-lyrics:fixed-size', payload),
  getPointerState: () => ipcRenderer.invoke('desktop-lyrics:pointer-state')
});
