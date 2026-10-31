export const IPC = Object.freeze({
  APP_VERSION: 'app:version',
  APP_OPEN_LOGS: 'app:open-logs',
  // 导出脱敏日志副本（主进程弹保存框，返回 {ok, path} / {ok:false, canceled:true}）
  APP_EXPORT_LOGS: 'app:export-logs',
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
  // 代理/RPC 连通性自检：主进程代发请求，渲染层拿不到 Proxy-Authorization 能力
  NET_TEST_PROXY: 'net:test-proxy',
  NET_TEST_API_BASE: 'net:test-api-base',
  // GPU 开关等「需重启」项：主进程只记账，重启动作由用户点「立即重启」触发
  APP_RESTART: 'app:restart',
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
  // 设置页「重置频谱位置」：清除拖动记录，回到左下贴底锚点
  SPECTRUM_RESET_POSITION: 'spectrum:reset-position',
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

// ===== 系统集成纯函数（主进程/渲染/测试共用，无 Electron 依赖） =====

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

// 侧车守卫（electron/sidecar-guard.cjs，CJS 侧各自保留字面量）自带的两个控制路由：
// health 用于「复用上轮遗留实例」前的兼容性探针，shutdown 让它自杀退出。
// 两者都必须带 x-jello-token 头，否则守卫直接 401。
export const SIDECAR_HEALTH_PATH = '/__jello-health';
export const SIDECAR_SHUTDOWN_PATH = '/__jello-shutdown';

// 托盘悬停提示：播放中/暂停有歌时带曲目信息，否则回退应用名
export const formatTrayTooltip = (state) => {
  const title = String(state?.title || '').trim();
  if (!title) return 'Jello Music';
  const artist = String(state?.artist || '').trim();
  const track = artist ? `${title} - ${artist}` : title;
  return state?.playing ? `正在播放：${track}` : `已暂停：${track}`;
};

// ===== 日志脱敏纯函数（导出日志副本前必须过一遍，主进程与测试共用） =====

// 侧车/上游把 token、key、dfid 之类都拼在 query string 里打日志，
// 逐条替换比整文件打码有用：用户拿这份副本反馈问题时线索还在。
export const LOG_REDACTION_PATTERNS = Object.freeze([
  // 手机号：11 位、1[3-9] 开头
  {
    pattern: /\b(mobile|phone|tel|手机号)(?![A-Za-z0-9_])\s*[=:]\s*"?1[3-9]\d{9}"?/gi,
    replacement: '$1=1**********'
  },
  // token / key / code 等凭据：值截到下一个分隔符为止。
  // 不收 cookie：它是整行头名，正则会把后面的 dfid=… 一起吃掉，反而丢掉线索。
  {
    pattern: /\b(token|access_?token|app_?key|appkey|clientkey|signkey|password|passwd|secret|api_?key|key|code)(?![A-Za-z0-9_])\s*[=:]\s*"?[^&"'\s,}]+"?/gi,
    replacement: '$1=***'
  },
  // 设备与用户标识
  {
    pattern: /\b(userid|user_id|dfid|guid|sid|token_userid|mid|imei|mac)(?![A-Za-z0-9_])\s*[=:]\s*"?[^&"'\s,}]+"?/gi,
    replacement: '$1=***'
  },
  // 带凭据的 URL（代理/上游地址里的 user:pass@）
  { pattern: /\/\/[^\s/@:]+:[^\s@]*@/g, replacement: '//***:***@' }
]);

export const redactLogText = (text) => {
  let output = String(text ?? '');
  for (const rule of LOG_REDACTION_PATTERNS) {
    output = output.replace(rule.pattern, rule.replacement);
  }
  return output;
};

// ===== 更新日志纯函数（electron-updater 的 releaseNotes 形状不固定） =====

// GitHub provider 回 Markdown 字符串；部分 provider 回 [{note,url}] 数组；
// 版本不存在时回 null。全部收敛成一段纯文本，截断避免撑爆 IPC。
export const RELEASE_NOTES_LIMIT = 4000;

const stripMarkdown = (value) => String(value || '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '$1')
  .replace(/^#{1,6}\s*/gm, '')
  .replace(/[*_`>]+/g, '')
  .trim();

export const formatReleaseNotes = (releaseNotes) => {
  if (releaseNotes == null || releaseNotes === '') return '';
  let text = '';
  if (typeof releaseNotes === 'string') {
    text = releaseNotes;
  } else if (Array.isArray(releaseNotes)) {
    text = releaseNotes
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry === 'object') return String(entry.note || entry.text || entry.url || '');
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  } else if (typeof releaseNotes === 'object') {
    text = String(releaseNotes.note || releaseNotes.text || '');
  }
  text = stripMarkdown(text).replace(/\r\n/g, '\n');
  return text.length > RELEASE_NOTES_LIMIT ? `${text.slice(0, RELEASE_NOTES_LIMIT - 3)}...` : text;
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
