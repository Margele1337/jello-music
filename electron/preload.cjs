const { contextBridge, ipcRenderer } = require('electron');

// 探测类通道统一收 { url } 形状：UI 传字符串或 { url } 都行，主进程只认后者
const asUrlPayload = (input) => ({ url: typeof input === 'string' ? input : String(input?.url ?? '') });

contextBridge.exposeInMainWorld('jello', {
  app: {
    // 设置页页脚展示「V{version} - {platform}」用，非 IPC（直接读进程常量）
    platform: process.platform,
    getVersion: () => ipcRenderer.invoke('app:version'),
    openLogs: () => ipcRenderer.invoke('app:open-logs'),
    // 导出脱敏日志副本：主进程弹保存框，返回 { ok, path } 或 { ok:false, canceled:true }
    exportLogs: () => ipcRenderer.invoke('app:export-logs'),
    // GPU 开关等「需重启」设置的确认入口，由用户在 UI 上主动触发
    restart: () => ipcRenderer.invoke('app:restart'),
    // 启动意图（跳转列表 --settings / 冷启动 jello:// 深链）：挂载后拉取一次即清空
    consumeLaunchIntent: () => ipcRenderer.invoke('app:launch-intent'),
    // 运行期到达的 jello:// 深链由主进程推送
    onDeepLink: (callback) => {
      const handler = (_event, params) => callback(params);
      ipcRenderer.on('app:deep-link', handler);
      return () => ipcRenderer.removeListener('app:deep-link', handler);
    }
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
  playbackState: {
    get: () => ipcRenderer.invoke('playback-state:get'),
    // 高频写入（播放中每 5 秒 + 暂停/换歌/退出），单向 send 即可，无需回执
    save: (state) => ipcRenderer.send('playback-state:set', state)
  },
  ui: {
    onNavigate: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('ui:navigate', handler);
      return () => ipcRenderer.removeListener('ui:navigate', handler);
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
  net: {
    // 代理连通性：主进程用独立 session 代发（渲染层 fetch 无法设 agent）
    testProxy: (input) => ipcRenderer.invoke('net:test-proxy', asUrlPayload(input)),
    testApiBase: (input) => ipcRenderer.invoke('net:test-api-base', asUrlPayload(input))
  },
  shortcuts: {
    getStatus: () => ipcRenderer.invoke('shortcuts:get-status'),
    // 录键期间挂起全部热键，关闭弹窗时恢复；恢复返回最新注册结果
    setSuspended: (value) => ipcRenderer.invoke('shortcuts:set-suspended', { suspended: value === true }),
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('shortcuts:status', handler);
      return () => ipcRenderer.removeListener('shortcuts:status', handler);
    }
  },
  api: {
    request: (request) => ipcRenderer.invoke('api:request', request)
  }
});
