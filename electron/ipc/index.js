import { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, shell } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { getSettings, updateSettings } from '../services/settingsStore.js';
import { getPlaybackState, savePlaybackState } from '../services/playbackStateStore.js';
import { isTrustedSender } from '../security/trustedSender.js';
import { resolveScopeWindows } from './scope.js';
import { proxyApiRequest, resetDeviceRegistration } from '../services/apiProxy.js';
import { clearAuthSession, getProfile, resetDeviceCookies } from '../services/authSession.js';
import { restartSidecar } from '../services/sidecar.js';
import { applyProxySettings, proxyUrlForSidecar, testProxy } from '../services/proxyService.js';
import { testApiBaseUrl } from '../services/apiEndpoint.js';
import { exportLogsDialog } from '../services/logSink.js';
import { syncTray } from '../tray.js';
import {
  getDesktopLyricsWindow,
  resendDesktopLyricsState,
  sendDesktopLyricsLyrics,
  sendDesktopLyricsProgress,
  setDesktopLyricsFont,
  syncDesktopLyrics
} from '../windows/desktopLyrics.js';
import { sanitizeDesktopLyricLyrics, sanitizeDesktopLyricProgress } from '../../shared/desktopLyrics.js';
import { sanitizeSpectrumPayload } from '../../shared/spectrum.js';
import { getSpectrumWindow, sendSpectrumData, syncSpectrumHud, sendSpectrumSettings, syncSpectrumHudSettings, resetSpectrumHudPosition, flushSpectrumGeometry } from '../windows/spectrumHud.js';
import {
  isMainWindowDocked,
  moveMainWindow,
  finishMainWindowDrag,
  getMainWindowBounds,
  restoreMainWindow,
  toggleMainWindowDock,
  applyAnimatePosition,
  finishAnimate
} from '../windows/sigmaDock.js';
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  installUpdate
} from '../services/updater.js';

let sleepBlockerId = null;

const applySystemSettings = (previous, next) => {
  if (next.autoStart !== previous.autoStart) {
    app.setLoginItemSettings({ openAtLogin: next.autoStart });
  }
  if (next.preventAppSuspension !== previous.preventAppSuspension) {
    if (next.preventAppSuspension && sleepBlockerId === null) {
      sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!next.preventAppSuspension && sleepBlockerId !== null) {
      powerSaveBlocker.stop(sleepBlockerId);
      sleepBlockerId = null;
    }
  }
};

// 代理改动要同时落到两层：Chromium 网络栈（渲染层 fetch/媒体下载，实时生效）
// 与 sidecar 的出站 axios（只在 spawn 时读一次 KUGOU_API_PROXY，必须重启进程）。
// 后者只在 http/https 代理时才有差异，socks 代理不重启、不打断正在播的歌。
const applyProxyChange = async (previous, next) => {
  await applyProxySettings(next);
  const before = proxyUrlForSidecar(previous);
  const after = proxyUrlForSidecar(next);
  if (before === after) return;
  const platform = next.dataSource === 'concept' ? 'lite' : 'official';
  await restartSidecar({ platform }).catch((error) => {
    console.error('[sidecar] 代理变更重启失败:', error?.message || error);
  });
};

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
};

/**
 * IPC 信任模型：handler 显式声明 scope（'main' | 'hud' | 'any'），
 * 由 resolveScopeWindows 统一解析成窗口集合再校验，注册器集中强制。
 * 此前默认信任「任意自家窗口」，清会话 / 代发 API / 重启 sidecar 等高危
 * 通道对 HUD 窗口（歌词/频谱，与主窗口跑同一个 bundle）同样开放。
 * 收紧对真实调用方零影响：HUD 窗口走窄 preload（jelloSpectrum/jelloLyrics），
 * 本来就没有这些桥。
 *
 * scope 约定：
 * - 'main'：危险通道与主窗口专属功能（settings/auth/api/update/window/net/log）。
 * - 'any'：保持现状即安全的通道（目前仅频谱数据面：update/hud-ready/
 *   lock-toggle/reset-position），刻意不改其信任集合以免惊动频谱链路。
 * - 桌面歌词/频谱的细节通道继续直接对特定窗口校验（getDesktopLyricsWindow /
 *   getSpectrumWindow），语义比 scope 更细，保持原样。
 */
export const registerIpc = (windows, intents = {}) => {
  const windowsInScope = (scope) => resolveScopeWindows(scope, windows);

  const assertTrusted = (event, scope) => {
    if (!isTrustedSender(event, windowsInScope(scope))) {
      throw new Error('unauthorized ipc sender');
    }
  };

  // ipcMain.on 的静默拒绝版：非法来源直接丢帧，不回错误
  const trustedInScope = (event, scope) => isTrustedSender(event, windowsInScope(scope));

  ipcMain.handle(IPC.APP_VERSION, (event) => {
    assertTrusted(event, 'main');
    return app.getVersion();
  });

  // 渲染层挂载后拉取一次启动意图（--settings / jello:// 深链），返回即清空。
  // 仅主窗口可消费：HUD 窗口（桌面歌词/频谱）跑同一个 App.vue，scope 'main'
  // 已在注册器层挡住，不再需要运行期补判
  ipcMain.handle(IPC.APP_LAUNCH_INTENT, (event) => {
    assertTrusted(event, 'main');
    return intents.consumeLaunchIntent?.() ?? { openSettings: false, deepLink: null };
  });

  ipcMain.handle(IPC.APP_OPEN_LOGS, (event) => {
    assertTrusted(event, 'main');
    return shell.openPath(app.getPath('userData'));
  });

  // 导出的是「脱敏副本」：原始 main.log 留在 userData 便于本地排查，
  // 用户拿出去反馈问题的这份先过 token/手机号/设备标识的替换规则
  ipcMain.handle(IPC.APP_EXPORT_LOGS, async (event) => {
    assertTrusted(event, 'main');
    const main = windows.main();
    const parent = main && !main.isDestroyed() ? main : null;
    try {
      return await exportLogsDialog(parent);
    } catch (error) {
      return { ok: false, error: String(error?.message || error).slice(0, 300) };
    }
  });

  // 代理连通性：主进程用独立 session 代发，返回探测到的公网 IP；
  // 渲染层做不了这件事（fetch 不能设 agent，Proxy-Authorization 是 forbidden header）
  ipcMain.handle(IPC.NET_TEST_PROXY, async (event, payload) => {
    assertTrusted(event, 'main');
    return testProxy(payload?.url ?? payload);
  });

  ipcMain.handle(IPC.NET_TEST_API_BASE, async (event, payload) => {
    assertTrusted(event, 'main');
    return testApiBaseUrl(payload?.url ?? payload);
  });

  // GPU 开关之类「重启后才生效」的设置：重启动作由用户点确认，主进程只负责
  // relaunch + 退出（走 before-quit 清理链，把 sidecar 与 session 落盘做完）
  ipcMain.handle(IPC.APP_RESTART, (event) => {
    assertTrusted(event, 'main');
    intents.restartApp?.();
    return true;
  });

  ipcMain.handle(IPC.SETTINGS_GET, (event) => {
    assertTrusted(event, 'main');
    return getSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SET, async (event, patch) => {
    assertTrusted(event, 'main');
    const previous = getSettings();
    const next = updateSettings(patch);

    // 数据源切换要等新平台实例真正就绪（上限 12s）再广播与返回：UI 的
    // 「已切换」必须属实。失败时设置保持已保存状态，waitForSidecar 会在
    // 下次请求前按新平台重试；广播先于报错，保证渲染器设置不与服务端脱节
    let dataSourceRestartError = null;
    if (next.dataSource !== previous.dataSource) {
      resetDeviceRegistration();
      resetDeviceCookies();
      const platform = next.dataSource === 'concept' ? 'lite' : 'official';
      try {
        await Promise.race([
          restartSidecar({ platform }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('重启超时')), 12000))
        ]);
      } catch (error) {
        dataSourceRestartError = error;
        console.error('[sidecar] 数据源切换重启失败:', error.message);
      }
    }

    // 代理与自定义 RPC 地址都是「改了就要立刻能在下一次请求上体现」的设置：
    // 代理走 fire-and-forget（setProxy 可能要等网络栈切换），RPC 地址由 apiProxy
    // 每次请求现读，不需要额外通知。设备注册状态与 baseURL 绑定，改地址要重来一次。
    if (next.proxyEnabled !== previous.proxyEnabled || next.proxyUrl !== previous.proxyUrl) {
      void applyProxyChange(previous, next).catch((error) => {
        console.error('[proxy] 应用代理失败:', error?.message || error);
      });
    }
    if (next.apiBaseUrlMode !== previous.apiBaseUrlMode || next.apiBaseUrl !== previous.apiBaseUrl) {
      resetDeviceRegistration();
    }

    if (next.minimizeToTray !== previous.minimizeToTray) {
      syncTray(next.minimizeToTray);
    }

    if (next.desktopLyrics !== previous.desktopLyrics) {
      syncDesktopLyrics(next.desktopLyrics);
    }

    if (next.desktopLyricsFont !== previous.desktopLyricsFont) {
      setDesktopLyricsFont(next.desktopLyricsFont);
    }

    applySystemSettings(previous, next);

    if (next.spectrum !== previous.spectrum) {
      syncSpectrumHud(next.spectrum);
    }

    syncSpectrumHudSettings(next);

    broadcast(IPC.SETTINGS_CHANGED, next);
    if (dataSourceRestartError) {
      throw new Error(`数据源已保存，但接口重启失败：${dataSourceRestartError.message}`);
    }
    return next;
  });

  ipcMain.handle(IPC.AUTH_GET, (event) => {
    assertTrusted(event, 'main');
    return getProfile();
  });

  // 播放状态持久化：仅主窗口可读写（HUD 窗口跑同一个 App.vue，不拦会被抢走/误写）。
  // scope 'main' 在注册器层强制，无需运行期补判
  ipcMain.handle(IPC.PLAYBACK_STATE_GET, (event) => {
    assertTrusted(event, 'main');
    return getPlaybackState();
  });

  ipcMain.on(IPC.PLAYBACK_STATE_SET, (event, state) => {
    if (!trustedInScope(event, 'main')) return;
    savePlaybackState(state);
  });

  ipcMain.handle(IPC.AUTH_CLEAR, (event) => {
    assertTrusted(event, 'main');
    clearAuthSession();
    broadcast(IPC.AUTH_CHANGED, null);
    return null;
  });

  ipcMain.handle(IPC.API_REQUEST, async (event, request) => {
    assertTrusted(event, 'main');
    const response = await proxyApiRequest(request);
    const loginPath = String(request?.path || '');
    if (loginPath === '/login' || loginPath.startsWith('/login/')) {
      const profile = getProfile();
      if (profile) broadcast(IPC.AUTH_CHANGED, profile);
    }
    return response;
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_UPDATE, (event, state) => {
    if (!trustedInScope(event, 'main')) return;
    sendDesktopLyricsLyrics(sanitizeDesktopLyricLyrics(state));
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_PROGRESS, (event, payload) => {
    if (!trustedInScope(event, 'main')) return;
    sendDesktopLyricsProgress(sanitizeDesktopLyricProgress(payload));
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_READY, (event) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    resendDesktopLyricsState();
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_ACTION, (event, action) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const commandMap = {
      'toggle-play': 'toggle',
      'previous-song': 'previous',
      'next-song': 'next'
    };
    if (action === 'close-lyrics') {
      updateSettings({ desktopLyrics: false });
      syncDesktopLyrics(false);
      broadcast(IPC.SETTINGS_CHANGED, getSettings());
      return;
    }
    const command = commandMap[action];
    if (!command) return;
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && window !== getDesktopLyricsWindow()) {
        window.webContents.send(IPC.PLAYER_COMMAND, command);
      }
    }
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_IGNORE_MOUSE, (event, ignore) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const window = getDesktopLyricsWindow();
    if (window && !window.isDestroyed()) {
      window.setIgnoreMouseEvents(ignore === true, { forward: true });
    }
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_BOUNDS, (event, bounds) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const window = getDesktopLyricsWindow();
    if (!window || window.isDestroyed() || !bounds || typeof bounds !== 'object') return;
    const clamp = (value, fallback) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };
    const current = window.getBounds();
    window.setBounds({
      x: clamp(bounds.x, current.x),
      y: clamp(bounds.y, current.y),
      width: clamp(bounds.width, current.width),
      height: clamp(bounds.height, current.height)
    });
  });

  ipcMain.on(IPC.DESKTOP_LYRICS_FIXED_SIZE, (event, payload) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return;
    const window = getDesktopLyricsWindow();
    if (!window || window.isDestroyed()) return;
    const area = screen.getPrimaryDisplay().workArea;
    if (payload?.fixed) {
      const width = Math.max(800, Math.round(Number(payload.width) || area.width));
      const height = Math.max(160, Math.round(Number(payload.height) || 160));
      window.setMaximumSize(Math.min(width, area.width), Math.min(height, area.height));
    } else {
      window.setMaximumSize(area.width, area.height);
    }
  });

  ipcMain.handle(IPC.DESKTOP_LYRICS_POINTER_STATE, (event) => {
    if (!isTrustedSender(event, getDesktopLyricsWindow())) return null;
    const window = getDesktopLyricsWindow();
    if (!window || window.isDestroyed()) return null;
    return {
      cursor: screen.getCursorScreenPoint(),
      bounds: window.getBounds()
    };
  });

  // 频谱数据面通道保持既有信任集合不变（any = 三窗口之一）：
  // 频谱链路敏感，本次只收紧危险通道，不惊动频谱
  ipcMain.on(IPC.SPECTRUM_UPDATE, (event, payload) => {
    if (!trustedInScope(event, 'any')) return;
    sendSpectrumData(sanitizeSpectrumPayload(payload));
  });

  ipcMain.on(IPC.SPECTRUM_HUD_READY, (event) => {
    if (!trustedInScope(event, 'any')) return;
    const settings = getSettings();
    sendSpectrumSettings({ ...settings, scale: 1 });
    const main = windows.main();
    if (main && !main.isDestroyed()) {
      main.webContents.send('spectrum:request-current');
    }
  });

  ipcMain.on(IPC.SPECTRUM_LOCK_TOGGLE, (event, value) => {
    if (!trustedInScope(event, 'any')) return;
    updateSettings({ spectrumLocked: value === true });
    syncSpectrumHudSettings(getSettings());
  });

  // 解锁态的拖动：渲染层算好新 bounds，主进程 setBounds（CSS drag region 在
  // 高 DPI 缩放屏上 hit-test 不可靠，桌面歌词窗口同款方案）。
  // 只写提供的字段：宽高跟着写回会在 150% 缩放的 DIP↔物理往返中 ±1 漂移
  ipcMain.on(IPC.SPECTRUM_BOUNDS, (event, bounds) => {
    if (!isTrustedSender(event, getSpectrumWindow())) return;
    const window = getSpectrumWindow();
    if (!window || window.isDestroyed() || !bounds || typeof bounds !== 'object') return;
    const next = {};
    for (const key of ['x', 'y', 'width', 'height']) {
      const num = Number(bounds[key]);
      if (Number.isFinite(num)) next[key] = Math.round(num);
    }
    if (Object.keys(next).length) window.setBounds(next);
  });

  // 设置页「重置频谱位置」：清拖动记录回到默认锚点（主窗口发起）
  ipcMain.on(IPC.SPECTRUM_RESET_POSITION, (event) => {
    if (!trustedInScope(event, 'any')) return;
    resetSpectrumHudPosition();
  });

  // 锁定切换握手：渲染层呈现空帧后回报，此刻 setBounds 才无旧内容可闪
  ipcMain.on(IPC.SPECTRUM_GEOMETRY_READY, (event) => {
    if (!isTrustedSender(event, getSpectrumWindow())) return;
    flushSpectrumGeometry();
  });

  ipcMain.on(IPC.WINDOW_DOCK_TOGGLE, (event) => {
    if (!trustedInScope(event, 'main')) return;
    toggleMainWindowDock();
  });

  ipcMain.handle(IPC.WINDOW_DOCK_GET, (event) => {
    assertTrusted(event, 'main');
    return isMainWindowDocked();
  });

  ipcMain.on(IPC.WINDOW_RESTORE, (event) => {
    if (!trustedInScope(event, 'main')) return;
    restoreMainWindow();
  });

  ipcMain.on(IPC.WINDOW_ANIMATE_POSITION, (event, pos) => {
    if (!trustedInScope(event, 'main')) return;
    applyAnimatePosition(Number(pos?.x), Number(pos?.y));
  });

  ipcMain.on(IPC.WINDOW_ANIMATE_DONE, (event) => {
    if (!trustedInScope(event, 'main')) return;
    finishAnimate();
  });

  ipcMain.on(IPC.WINDOW_MOVE, (event, position) => {
    if (!trustedInScope(event, 'main')) return;
    moveMainWindow(Number(position?.x), Number(position?.y), Number(position?.movedX) || 0);
  });

  ipcMain.on(IPC.WINDOW_DRAG_END, (event) => {
    if (!trustedInScope(event, 'main')) return;
    finishMainWindowDrag();
  });

  ipcMain.handle(IPC.WINDOW_GET_BOUNDS, (event) => {
    assertTrusted(event, 'main');
    return getMainWindowBounds();
  });

  ipcMain.handle(IPC.UPDATE_GET, (event) => {
    assertTrusted(event, 'main');
    return getUpdateState();
  });

  ipcMain.handle(IPC.UPDATE_CHECK, async (event) => {
    assertTrusted(event, 'main');
    return checkForUpdates();
  });

  ipcMain.handle(IPC.UPDATE_DOWNLOAD, async (event) => {
    assertTrusted(event, 'main');
    return downloadUpdate();
  });

  ipcMain.handle(IPC.UPDATE_INSTALL, (event) => {
    assertTrusted(event, 'main');
    installUpdate();
    return true;
  });
};
