const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jello', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    openLogs: () => ipcRenderer.invoke('app:open-logs')
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
  desktopLyrics: {
    update: (state) => ipcRenderer.send('desktop-lyrics:update', state),
    progress: (payload) => ipcRenderer.send('desktop-lyrics:progress', payload)
  },
  player: {
    onCommand: (callback) => {
      const handler = (_event, command) => callback(command);
      ipcRenderer.on('player:command', handler);
      return () => ipcRenderer.removeListener('player:command', handler);
    }
  },
  spectrum: {
    update: (payload) => ipcRenderer.send('spectrum:update', payload),
    onRequestCurrent: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('spectrum:request-current', handler);
      return () => ipcRenderer.removeListener('spectrum:request-current', handler);
    }
  },
  windowControl: {
    toggleDock: () => ipcRenderer.send('window:dock-toggle'),
    getDocked: () => ipcRenderer.invoke('window:dock-get'),
    restore: () => ipcRenderer.send('window:restore'),
    onDockChanged: (callback) => {
      const handler = (_event, docked) => callback(docked);
      ipcRenderer.on('window:dock-changed', handler);
      return () => ipcRenderer.removeListener('window:dock-changed', handler);
    },
    onAnimateTo: (callback) => {
      const handler = (_event, target) => callback(target);
      ipcRenderer.on('window:animate-to', handler);
      return () => ipcRenderer.removeListener('window:animate-to', handler);
    },
    onAnimateStop: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('window:animate-stop', handler);
      return () => ipcRenderer.removeListener('window:animate-stop', handler);
    },
    sendAnimatePosition: (pos) => ipcRenderer.send('window:animate-position', pos),
    sendAnimateDone: () => ipcRenderer.send('window:animate-done'),
    sendMove: (position) => ipcRenderer.send('window:move', position),
    sendDragEnd: () => ipcRenderer.send('window:drag-end'),
    getBounds: () => ipcRenderer.invoke('window:get-bounds'),
    onOverhangChanged: (callback) => {
      const handler = (_event, value) => callback(value);
      ipcRenderer.on('window:overhang-changed', handler);
      return () => ipcRenderer.removeListener('window:overhang-changed', handler);
    }
  },
  updates: {
    get: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('update:state', handler);
      return () => ipcRenderer.removeListener('update:state', handler);
    }
  },
  api: {
    request: (request) => ipcRenderer.invoke('api:request', request)
  }
});
