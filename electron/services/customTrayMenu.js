import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkForUpdates } from './updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAY_MENU_WIDTH = 260;
const TRAY_MENU_HEIGHT = 340;

// 自定义托盘菜单（移植旧版 customTrayMenuService）：右键托盘弹出的自绘 HTML
// 菜单窗（歌曲卡片 + 播放控制 + 动作列表），失焦/ESC 关闭。
class CustomTrayMenuService {
  constructor() {
    this.menuWindow = null;
    this.getMainWindow = null;
    this.getTray = null;
    this.actions = null;
    this.initialized = false;
    this.pendingState = null;
    this.renderToken = 0;
    this.pendingRenderResolve = null;
    this.pendingRenderTimer = null;
  }

  init(getMainWindow, getTray, actions) {
    this.getMainWindow = getMainWindow;
    this.getTray = getTray;
    this.actions = actions;

    if (this.initialized) return;
    this.initialized = true;

    const isMenuSender = (event) => {
      const sender = event.sender;
      return !!this.menuWindow && !this.menuWindow.isDestroyed() && this.menuWindow.webContents === sender;
    };

    ipcMain.on('tray-menu:ready', () => {
      if (this.pendingState) this.pushState(this.pendingState);
      else void this.refresh();
    });

    ipcMain.on('tray-menu:hide', () => this.hide());

    ipcMain.on('tray-menu:action', (event, action) => {
      if (!isMenuSender(event)) {
        console.warn('[tray-menu] 动作来自非菜单窗口，已忽略:', action);
        return;
      }
      console.info('[tray-menu] 主进程收到动作:', action);
      void this.handleAction(String(action));
    });

    ipcMain.on('tray-menu:rendered', (event, token) => {
      if (!isMenuSender(event)) return;
      if (token !== this.renderToken || !this.pendingRenderResolve) return;
      this.finishRenderWait();
    });
  }

  isVisible() {
    return !!this.menuWindow && !this.menuWindow.isDestroyed() && this.menuWindow.isVisible();
  }

  async toggle() {
    if (this.isVisible()) {
      this.hide();
      return;
    }
    await this.show();
  }

  async show() {
    const tray = this.getTray?.();
    const mainWindow = this.getMainWindow?.();
    if (!tray || tray.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) return;

    await this.ensureWindow();
    this.pendingState = await this.getMenuState(mainWindow);
    const renderPromise = this.waitForRender();
    this.pushState({ ...this.pendingState, renderToken: this.renderToken });
    await renderPromise;

    if (!this.menuWindow || this.menuWindow.isDestroyed()) return;

    this.positionWindow(tray);
    this.menuWindow.show();
    this.menuWindow.focus();
  }

  hide() {
    if (this.menuWindow && !this.menuWindow.isDestroyed()) {
      this.menuWindow.destroy();
    }
    this.menuWindow = null;
    this.finishRenderWait();
  }

  cleanup() {
    this.hide();
  }

  async ensureWindow() {
    if (this.menuWindow && !this.menuWindow.isDestroyed()) return;

    this.menuWindow = new BrowserWindow({
      width: TRAY_MENU_WIDTH,
      height: TRAY_MENU_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      roundedCorners: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preloadTray.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });

    // 频谱 HUD 与桌面歌词都是 'screen-saver' 层级，托盘菜单必须压在它们之上，
    // 否则覆盖层（尤其解锁态）会在 z 序上挡住菜单的点击
    this.menuWindow.setAlwaysOnTop(true, 'screen-saver', 2);
    this.menuWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    this.menuWindow.on('blur', () => this.hide());
    this.menuWindow.on('closed', () => {
      this.menuWindow = null;
      this.finishRenderWait();
    });
    this.menuWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.menuWindow.webContents.on('will-navigate', (event) => event.preventDefault());

    await this.menuWindow.loadFile(path.join(__dirname, '..', 'view', 'tray-menu.html'));
  }

  positionWindow(tray) {
    if (!this.menuWindow || this.menuWindow.isDestroyed()) return;

    const trayBounds = tray.getBounds();
    const display = screen.getDisplayMatching(trayBounds);
    const workArea = display.workArea;
    const isBottomTray = trayBounds.y > workArea.y + workArea.height / 2;

    let x = trayBounds.x + Math.round(trayBounds.width / 2) - Math.round(TRAY_MENU_WIDTH / 2);
    let y = isBottomTray
      ? trayBounds.y - TRAY_MENU_HEIGHT - 10
      : trayBounds.y + trayBounds.height + 10;

    x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - TRAY_MENU_WIDTH - 8));
    y = Math.max(workArea.y + 8, Math.min(y, workArea.y + workArea.height - TRAY_MENU_HEIGHT - 8));

    this.menuWindow.setBounds({
      x,
      y,
      width: TRAY_MENU_WIDTH,
      height: TRAY_MENU_HEIGHT
    });
  }

  pushState(state) {
    if (!this.menuWindow || this.menuWindow.isDestroyed()) return;
    this.menuWindow.webContents.send('tray-menu:state', state);
  }

  waitForRender() {
    this.renderToken += 1;
    if (this.pendingRenderTimer) {
      clearTimeout(this.pendingRenderTimer);
      this.pendingRenderTimer = null;
    }

    return new Promise((resolve) => {
      this.pendingRenderResolve = resolve;
      this.pendingRenderTimer = setTimeout(() => {
        this.finishRenderWait();
      }, 120);
    });
  }

  finishRenderWait() {
    if (this.pendingRenderTimer) {
      clearTimeout(this.pendingRenderTimer);
      this.pendingRenderTimer = null;
    }
    const resolve = this.pendingRenderResolve;
    this.pendingRenderResolve = null;
    resolve?.();
  }

  // 打开菜单瞬间从主窗口的播放器 store 拉一次状态，之后由菜单页本地每秒自增
  async getMenuState(mainWindow) {
    const fallback = { playing: false, time: 0, title: '', artist: '', cover: '', duration: 0 };
    const raw = await mainWindow.webContents.executeJavaScript(`
      (() => {
        try {
          const app = document.querySelector('#app')?.__vue_app__;
          const player = app?.config?.globalProperties?.$pinia?._s?.get('player');
          const song = player?.currentSong || null;
          const audio = player?.audio || null;
          const duration = song?.timeLength ? Number(song.timeLength) / 1000 : (Number(audio?.duration) || 0);
          return JSON.stringify({
            playing: !!player?.playing,
            time: Number(audio?.currentTime) || 0,
            title: String(song?.name || ''),
            artist: String(song?.author || ''),
            cover: String(song?.img || ''),
            duration
          });
        } catch (error) {
          return '{}';
        }
      })();
    `, true).catch(() => '{}');

    let data = fallback;
    try {
      data = { ...fallback, ...JSON.parse(raw || '{}') };
    } catch {
      /* 保持 fallback */
    }

    return {
      isPlaying: !!data.playing,
      song: this.normalizeSong(data),
      labels: this.getLabels()
    };
  }

  normalizeSong(data) {
    if (!data?.title && !data?.artist && !data?.cover) return null;

    const duration = Number(data.duration) || 0;
    const currentTime = Math.max(0, Math.min(Number(data.time) || 0, duration || Number.MAX_SAFE_INTEGER));
    const progressPercent = duration > 0
      ? Math.max(0, Math.min((currentTime / duration) * 100, 100))
      : 0;

    return {
      title: data.title || 'Jello Music',
      artist: data.artist || 'Jello',
      cover: data.cover || '',
      currentTime,
      duration,
      currentTimeText: this.formatTime(currentTime),
      durationText: this.formatTime(duration),
      progressPercent
    };
  }

  formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainSeconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainSeconds).padStart(2, '0')}`;
  }

  getLabels() {
    return {
      noSong: '没有正在播放的歌曲',
      projectHome: '项目主页',
      prevTrack: '上一首',
      playPause: '播放 / 暂停',
      nextTrack: '下一首',
      restartApp: '重启应用',
      settings: '设置',
      checkUpdates: '检查更新',
      showHide: '显示 / 收起面板',
      quit: '退出'
    };
  }

  async handleAction(action) {
    const keepOpenActions = new Set(['prev-track', 'toggle-play-pause', 'next-track']);

    switch (action) {
      case 'project-home':
        shell.openExternal('https://github.com/Margele1337/jello-music');
        break;
      case 'settings':
        this.actions?.openSettings?.();
        break;
      case 'prev-track':
        this.actions?.previous?.();
        break;
      case 'toggle-play-pause':
        this.actions?.playPause?.();
        break;
      case 'next-track':
        this.actions?.next?.();
        break;
      case 'check-updates':
        void checkForUpdates();
        break;
      case 'restart-app':
        // dev 模式 vite/api 由 npm run dev 托管，relaunch 只能重启 Electron 本身，
        // 新实例加载不到 dev server 会白屏 —— dev 下诚实退出
        if (app.isPackaged) {
          app.relaunch();
          app.quit();
        } else {
          console.log('[tray-menu] dev 模式不自动重启，请重新 npm run dev');
          app.quit();
        }
        return;
      case 'show-hide':
        this.actions?.showHide?.();
        break;
      case 'quit':
        this.actions?.quit?.();
        return;
      default:
        return;
    }

    if (keepOpenActions.has(action)) {
      setTimeout(() => {
        void this.refresh();
      }, 180);
      return;
    }

    this.hide();
  }

  async refresh() {
    if (!this.isVisible()) return;
    const mainWindow = this.getMainWindow?.();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    this.pendingState = await this.getMenuState(mainWindow);
    this.pushState(this.pendingState);
  }
}

export default new CustomTrayMenuService();
