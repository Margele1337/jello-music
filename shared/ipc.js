export const IPC = Object.freeze({
  APP_VERSION: 'app:version',
  APP_OPEN_LOGS: 'app:open-logs',
  // 启动意图（跳转列表 --settings / jello:// 深链）：渲染层挂载后拉取一次
  APP_LAUNCH_INTENT: 'app:launch-intent',
  // 运行期到达的深链参数由主进程直接推送
  APP_DEEP_LINK: 'app:deep-link',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed',
  AUTH_GET: 'auth:get',
  AUTH_CLEAR: 'auth:clear',
  AUTH_CHANGED: 'auth:changed',
  API_REQUEST: 'api:request',
  PLAYER_COMMAND: 'player:command',
  // 播放状态持久化（队列/索引/模式/进度），主进程 electron-store 落盘
  PLAYBACK_STATE_GET: 'playback-state:get',
  PLAYBACK_STATE_SET: 'playback-state:set',
  UI_NAVIGATE: 'ui:navigate',
  DESKTOP_LYRICS_UPDATE: 'desktop-lyrics:update',
  DESKTOP_LYRICS_PROGRESS: 'desktop-lyrics:progress',
  DESKTOP_LYRICS_STATE: 'desktop-lyrics:state',
  DESKTOP_LYRICS_READY: 'desktop-lyrics:ready',
  DESKTOP_LYRICS_ACTION: 'desktop-lyrics:action',
  DESKTOP_LYRICS_IGNORE_MOUSE: 'desktop-lyrics:ignore-mouse',
  DESKTOP_LYRICS_BOUNDS: 'desktop-lyrics:bounds',
  DESKTOP_LYRICS_FIXED_SIZE: 'desktop-lyrics:fixed-size',
  DESKTOP_LYRICS_POINTER_STATE: 'desktop-lyrics:pointer-state',
  DESKTOP_LYRICS_FONT: 'desktop-lyrics:font',
  SPECTRUM_UPDATE: 'spectrum:update',
  SPECTRUM_DATA: 'spectrum:data',
  SPECTRUM_HUD_READY: 'spectrum:hud-ready',
  SPECTRUM_REQUEST_CURRENT: 'spectrum:request-current',
  SPECTRUM_SETTINGS: 'spectrum:settings',
  SPECTRUM_LOCK_TOGGLE: 'spectrum:lock-toggle',
  SPECTRUM_BOUNDS: 'spectrum:bounds',
  WINDOW_DOCK_TOGGLE: 'window:dock-toggle',
  WINDOW_DOCK_GET: 'window:dock-get',
  WINDOW_RESTORE: 'window:restore',
  WINDOW_DOCK_CHANGED: 'window:dock-changed',
  WINDOW_ANIMATE_TO: 'window:animate-to',
  WINDOW_ANIMATE_POSITION: 'window:animate-position',
  WINDOW_ANIMATE_DONE: 'window:animate-done',
  WINDOW_ANIMATE_STOP: 'window:animate-stop',
  WINDOW_MOVE: 'window:move',
  WINDOW_DRAG_END: 'window:drag-end',
  WINDOW_GET_BOUNDS: 'window:get-bounds',
  WINDOW_OVERHANG_CHANGED: 'window:overhang-changed',
  UPDATE_GET: 'update:get',
  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_STATE: 'update:state'
});

// ===== 系统集成纯函数（主进程/测试共用，无 Electron 依赖） =====

// 跳转列表与命令行共用的「直接打开设置」参数
export const SETTINGS_ARG = '--settings';
export const DEEP_LINK_SCHEME = 'jello:';

export const hasSettingsArg = (argv) => (
  Array.isArray(argv) && argv.includes(SETTINGS_ARG)
);

// Windows 上协议唤起/jump list 的参数混在普通 argv 里，按前缀挑出深链 URL
export const findDeepLinkArg = (argv) => {
  if (!Array.isArray(argv)) return null;
  const hit = argv.find((arg) => typeof arg === 'string' && arg.toLowerCase().startsWith(DEEP_LINK_SCHEME));
  return hit || null;
};

// 解析 jello://share?hash=… / jello://share?listid=…（旧版分享链接形状）。
// 深链内容来自外部不可控：畸形 URL 一律返回 null，调用方不得抛异常。
export const parseDeepLink = (url) => {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return null;
  }
  if (parsed.protocol !== DEEP_LINK_SCHEME) return null;
  const hash = parsed.searchParams.get('hash') || '';
  const listid = parsed.searchParams.get('listid') || '';
  if (!hash && !listid) return null;
  return { hash, listid, urlPath: parsed.pathname.replace(/^\/+/, '') };
};

// 托盘悬停提示：播放中/暂停有歌时带曲目信息，否则回退应用名
export const formatTrayTooltip = (state) => {
  const title = String(state?.title || '').trim();
  if (!title) return 'Jello Music';
  const artist = String(state?.artist || '').trim();
  const track = artist ? `${title} - ${artist}` : title;
  return state?.playing ? `正在播放：${track}` : `已暂停：${track}`;
};

// ===== 播放状态持久化纯函数（主进程 sanitize/截断，测试共用，无 Electron 依赖） =====

export const PLAYBACK_QUEUE_LIMIT = 500;
export const PLAYBACK_MODES = Object.freeze([0, 1, 2]);
export const DEFAULT_PLAYBACK_MODE = 1;

const asText = (value, maxLength = 2048) => {
  if (typeof value === 'string') return value.slice(0, maxLength);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const asSeconds = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
};

// 只保留播放一首歌所需的最小字段集，丢弃 url/歌词等临时或大块数据
export const sanitizePlaybackSong = (song) => {
  if (!song || typeof song !== 'object') return null;
  const hash = asText(song.hash, 128).trim();
  if (!hash) return null;
  const timeLength = Number(song.timeLength);
  return {
    hash,
    name: asText(song.name, 512),
    author: asText(song.author, 512),
    img: asText(song.img),
    timeLength: Number.isFinite(timeLength) && timeLength > 0 ? Math.round(timeLength) : 0,
    albumId: asText(song.albumId, 128),
    albumAudioId: asText(song.albumAudioId, 128)
  };
};

export const emptyPlaybackState = (mode = DEFAULT_PLAYBACK_MODE) => ({
  queue: [],
  index: -1,
  mode: PLAYBACK_MODES.includes(mode) ? mode : DEFAULT_PLAYBACK_MODE,
  progress: 0
});

// 永不抛异常：任何缺失/畸形输入都收敛为合法状态（队列非法时等价于「空启动」）
export const sanitizePlaybackState = (state) => {
  // ?? NaN：mode 缺失（null/undefined）必须落默认列表循环，Number(null)===0 会被误判成随机
  const rawMode = Math.round(Number(state?.mode ?? NaN));
  const mode = PLAYBACK_MODES.includes(rawMode) ? rawMode : DEFAULT_PLAYBACK_MODE;
  if (!state || typeof state !== 'object') return emptyPlaybackState(mode);

  const queue = (Array.isArray(state.queue) ? state.queue : [])
    .map(sanitizePlaybackSong)
    .filter(Boolean)
    .slice(0, PLAYBACK_QUEUE_LIMIT);
  if (!queue.length) return emptyPlaybackState(mode);

  const rawIndex = Math.round(Number(state.index));
  const index = Number.isFinite(rawIndex) && rawIndex > 0
    ? Math.min(rawIndex, queue.length - 1)
    : 0;

  // progress 单位是秒；timeLength 单位是毫秒（library.js 约定），钳制上界需换算
  const { timeLength } = queue[index];
  const ceiling = timeLength > 0 ? timeLength / 1000 : Number.MAX_SAFE_INTEGER;
  const progress = Math.min(asSeconds(state.progress), ceiling);

  return { queue, index, mode, progress };
};
