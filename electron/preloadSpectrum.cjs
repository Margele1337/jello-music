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
  // 关闭动画：主进程销毁窗口前通知渲染层播塌缩/淡出；动画期重开发 reopen
  onClose: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('spectrum:close', handler);
    return () => ipcRenderer.removeListener('spectrum:close', handler);
  },
  onReopen: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('spectrum:reopen', handler);
    return () => ipcRenderer.removeListener('spectrum:reopen', handler);
  },
  setLocked: (value) => ipcRenderer.send('spectrum:lock-toggle', value === true),
  sendBounds: (bounds) => ipcRenderer.send('spectrum:bounds', bounds),
  // 锁定切换握手：空帧已呈现，主进程可以安全换几何
  geometryReady: () => ipcRenderer.send('spectrum:geometry-ready'),
  ready: () => ipcRenderer.send('spectrum:hud-ready')
});
