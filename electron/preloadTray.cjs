const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('jelloTray', {
  onState: (callback) => subscribe('tray-menu:state', callback),
  ready: () => ipcRenderer.send('tray-menu:ready'),
  hide: () => ipcRenderer.send('tray-menu:hide'),
  sendAction: (action) => ipcRenderer.send('tray-menu:action', String(action)),
  rendered: (token) => ipcRenderer.send('tray-menu:rendered', token)
});
