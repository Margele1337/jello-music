// 音质阶梯（低 → 高）：顺序即降级顺序，播放失败时从当前档位向下回退
export const QUALITY_VALUES = Object.freeze([
  '128', '320', 'flac', 'high', 'viper_atmos', 'viper_clear', 'viper_tape'
]);

export const QUALITY_LABELS = Object.freeze({
  128: '标准',
  320: '高品',
  flac: 'FLAC',
  high: 'Hi-Res',
  viper_atmos: '全景声',
  viper_clear: '超清',
  viper_tape: '母带'
});

export const qualityLabel = (quality) => QUALITY_LABELS[quality] || '';

// 相邻下一档更低音质；已是 128 时返回空串表示无可降级空间
export const nextLowerQuality = (quality) => {
  const index = QUALITY_VALUES.indexOf(quality);
  return index > 0 ? QUALITY_VALUES[index - 1] : '';
};

export const DATA_SOURCE_VALUES = Object.freeze(['concept', 'official']);
export const PLAYBACK_RATES = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);

export const API_BASE_URL_MODES = Object.freeze(['default', 'custom']);

// 全局快捷键动作表：键名即「设置项 action」，值是 Electron accelerator。
// 与旧版 MoeKoe 的 12 组功能一一对应（旧版把显示/隐藏主窗口记作 mainWindow，
// 这里按契约统一为 showHide；媒体键由主进程固定注册，不在这张表里）。
export const SHORTCUT_ACTIONS = Object.freeze([
  'showHide', 'quitApp', 'previous', 'next', 'playPause', 'volumeUp',
  'volumeDown', 'mute', 'like', 'mode', 'desktopLyrics', 'desktopSpectrum'
]);

// 默认键位沿用旧版（Alt+Ctrl 系列），避免与旧版用户的肌肉记忆冲突；
// 旧版用 Ctrl+Shift+S 呼出主面板、Ctrl+Q 退出
export const DEFAULT_SHORTCUTS = Object.freeze({
  showHide: 'CommandOrControl+Shift+S',
  quitApp: 'CommandOrControl+Q',
  previous: 'Alt+CommandOrControl+Left',
  next: 'Alt+CommandOrControl+Right',
  playPause: 'Alt+CommandOrControl+Space',
  volumeUp: 'Alt+CommandOrControl+Up',
  volumeDown: 'Alt+CommandOrControl+Down',
  mute: 'Alt+CommandOrControl+M',
  like: 'Alt+CommandOrControl+L',
  mode: 'Alt+CommandOrControl+P',
  desktopLyrics: 'Alt+CommandOrControl+D',
  desktopSpectrum: 'Alt+CommandOrControl+S'
});

// 录键时统一显示成 CommandOrControl（跨平台语义），存规范形式便于主进程直接注册
// 跨平台主修饰键统一存 CommandOrControl（Windows=Ctrl / macOS=Cmd），
// 旧版写的是 Ctrl，这里两种写法都收但只落一个规范形式
const MODIFIER_ALIASES = Object.freeze({
  command: 'Cmd',
  cmd: 'Cmd',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  ctrlormeta: 'CommandOrControl',
  control: 'CommandOrControl',
  ctrl: 'CommandOrControl'
});
const ACCELERATOR_KEYS = [
  'plus', 'esc', 'escape', 'space', 'spacebar', 'enter', 'return', 'tab', 'backspace', 'delete', 'insert',
  'home', 'end', 'pageup', 'pagedown', 'up', 'down', 'left', 'right', 'printscreen', 'mediaplaypause',
  'mediastop', 'mediaprevious', 'medianext', 'volumeup', 'volumedown', 'videomute', 'mute'
];

// 不需要修饰键就能单独注册的热键：媒体键/音量键/功能键。
// 字母与数字必须带修饰键，否则裸 "A" 会把系统的 A 键全局劫持掉。
// 不需要修饰键就能单独注册的热键：媒体键/音量键/功能键。
// 字母与数字必须带修饰键，否则裸 "A" 会把系统的 A 键全局劫持掉。
const STANDALONE_KEY_RE = /^(F([1-9]|1[0-9]|2[0-4])|Esc|MediaPlayPause|MediaStop|MediaPreviousTrack|MediaNextTrack|VolumeUp|VolumeDown|VolumeMute)$/;

// 录键侧的常见别名 -> Electron 官方键名
const ACCELERATOR_KEY_ALIASES = Object.freeze({
  spacebar: 'Space',
  escape: 'Esc',
  return: 'Enter',
  mediaprevious: 'MediaPreviousTrack',
  medianext: 'MediaNextTrack',
  mediaplaypause: 'MediaPlayPause',
  mediastop: 'MediaStop',
  videomute: 'VolumeMute',
  mute: 'VolumeMute',
  volumeup: 'VolumeUp',
  volumedown: 'VolumeDown'
});

/**
 * 归一化单个 accelerator：合法则返回规范形式，非法返回空串。
 * 只接受「修饰键 + 主键」的形状，逗号/空白/非法字符一律拒绝——
 * accelerator 会直接进 globalShortcut.register，不能把任意字符串透传下去。
 */
export const normalizeAccelerator = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 64) return '';
  // 允许 "Ctrl+Shift+S" 与 "Ctrl + Shift + S" 两种录入形状
  const parts = raw.split('+').map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 5) return '';

  const canonical = (part) => {
    const lower = part.toLowerCase();
    if (MODIFIER_ALIASES[lower]) return MODIFIER_ALIASES[lower];
    if (ACCELERATOR_KEYS.includes(lower)) {
      if (ACCELERATOR_KEY_ALIASES[lower]) return ACCELERATOR_KEY_ALIASES[lower];
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    if (/^[a-z0-9]$/.test(lower) || /^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase();
    return '';
  };

  const mapped = parts.map(canonical);
  if (mapped.some((part) => !part)) return '';
  // 重复 token（"Ctrl+Ctrl+S"、"S+S"）Electron 会当非法 accelerator 抛错，这里先拒
  if (new Set(mapped).size !== mapped.length) return '';

  const isModifierToken = (token) => Object.values(MODIFIER_ALIASES).includes(token);
  const key = mapped[mapped.length - 1];
  const modifiers = mapped.slice(0, -1);
  // 纯修饰键（"Ctrl+Shift"）不构成快捷键
  if (isModifierToken(key)) return '';
  // 主键之前必须全是修饰键："Ctrl+A+B" 在 Electron 侧是非法 accelerator
  if (modifiers.some((token) => !isModifierToken(token))) return '';
  // 全局热键要么带修饰键，要么就是媒体/音量/功能键：裸 "A" 会劫持系统打字
  if (modifiers.length === 0 && !STANDALONE_KEY_RE.test(key)) return '';
  return mapped.join('+');
};

// 逐键规范化：非法/缺失一律回落默认值，保证设置里永远是完整 12 键
export const normalizeShortcuts = (value) => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const next = {};
  for (const action of SHORTCUT_ACTIONS) {
    const accelerator = normalizeAccelerator(source[action]);
    next[action] = accelerator || DEFAULT_SHORTCUTS[action];
  }
  return next;
};

// 逐键比对：设置里每次 get 都会生成新对象，引用比较会把「没改快捷键」也当成改动，
// 触发一次无谓的热键摘挂（期间用户按键会丢事件）
export const shortcutsEqual = (left, right) => {
  const a = normalizeShortcuts(left);
  const b = normalizeShortcuts(right);
  return SHORTCUT_ACTIONS.every((action) => a[action] === b[action]);
};

const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const PROXY_SCHEMES = Object.freeze(['http', 'https', 'socks4', 'socks4a', 'socks5']);
const isLoopbackHost = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  return /^127(\.\d{1,3}){3}$/.test(host);
};

const stripTrailingSlashes = (value) => value.replace(/\/+$/, '');

const decodeAuthPart = (value) => {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
};

/**
 * 校验代理地址：只放行 http/https/socks4/socks4a/socks5（旧版同款白名单）。
 * 主进程会把它同时喂给 Chromium setProxy 与侧车环境变量，必须先归一；
 * 路径/查询段一律丢弃，避免把 "http://host:8080/admin" 当成代理规则。
 */
export const normalizeProxyUrl = (value) => {
  const raw = String(value ?? '').trim().slice(0, 512);
  if (!raw) return '';
  // 允许省略协议（用户常写 127.0.0.1:7890），按 http 代理补齐
  const candidate = PROTOCOL_RE.test(raw) ? raw : `http://${raw}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return '';
  }
  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  // "socks://" 业界惯例等同 SOCKS5（旧版设置页也这么写），归一到 socks5 再校验
  if (scheme === 'socks') return normalizeProxyUrl(`socks5://${parsed.host}`);
  if (!PROXY_SCHEMES.includes(scheme)) return '';
  const host = parsed.hostname.toLowerCase();
  if (!host || !/^[a-z0-9._[\]:-]+$/.test(host)) return '';
  // socks 系没有公认默认端口，漏写端口时 Chromium 会连到 1080/80，直接拒绝更清楚
  if (!parsed.port && !['http', 'https'].includes(scheme)) return '';

  const user = decodeAuthPart(parsed.username);
  const password = decodeAuthPart(parsed.password);
  const auth = user ? `${user}${password ? `:${password}` : ''}@` : '';
  const port = parsed.port ? `:${parsed.port}` : '';
  const result = `${scheme}://${auth}${host}${port}`;
  return result.length <= 512 ? result : '';
};

/**
 * 校验自定义 RPC 地址：只允许 https，或 http 回环（本机侧车）。
 * 登录凭据（token/userid/dfid/mid）会随请求头外发，明文 http 指向远端主机
 * 等于凭据泄露，必须在 sanitize 层直接否掉。
 */
export const normalizeApiBaseUrl = (value) => {
  const raw = String(value ?? '').trim().slice(0, 512);
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(PROTOCOL_RE.test(raw) ? raw : `http://${raw}`);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) return '';
  if (parsed.username || parsed.password) return '';
  return stripTrailingSlashes(parsed.origin);
};

export const SETTING_DEFAULTS = Object.freeze({
  language: '',
  quality: '320',
  dataSource: 'concept',
  volume: 1,
  playbackRate: 1,
  loudnessNormalization: false,
  audioOutputDevice: 'default',
  minimizeToTray: true,
  desktopLyrics: false,
  desktopLyricsFont: '',
  spectrum: false,
  spectrumScale: 1,
  // 1.0 = 原版固定像素信息卡（封面 100×100、字号 18/20），纯倍率不叠加分辨率缩放
  spectrumInfoScale: 1,
  spectrumInfoVisible: true,
  spectrumSigmaSmoothing: 0.335,
  spectrumAvDelayMs: 590,
  spectrumLocked: true,
  autoStart: false,
  preventAppSuspension: false,
  hotkeyIntroSeen: false,
  proxyEnabled: false,
  proxyUrl: '',
  apiBaseUrlMode: 'default',
  apiBaseUrl: '',
  // false = 关闭硬件加速并走软件合成（改后需重启生效，UI 自己提示）
  gpuAcceleration: true,
  shortcuts: DEFAULT_SHORTCUTS
});

export const SETTING_KEYS = Object.freeze(Object.keys(SETTING_DEFAULTS));

export const sanitizeSettings = (patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};

  const next = {};
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = patch[key];

    if (key === 'volume') {
      const number = Number(value);
      if (Number.isFinite(number)) next.volume = Math.max(0, Math.min(1, number));
      continue;
    }

    if (key === 'playbackRate') {
      const number = Number(value);
      if (Number.isFinite(number) && PLAYBACK_RATES.includes(number)) next.playbackRate = number;
      continue;
    }

    if (key === 'minimizeToTray' || key === 'desktopLyrics' || key === 'spectrum'
      || key === 'spectrumInfoVisible' || key === 'spectrumLocked' || key === 'hotkeyIntroSeen'
      || key === 'loudnessNormalization' || key === 'autoStart' || key === 'preventAppSuspension'
      || key === 'proxyEnabled' || key === 'gpuAcceleration') {
      if (typeof value === 'boolean') next[key] = value;
      continue;
    }

    if (key === 'proxyUrl') {
      next.proxyUrl = normalizeProxyUrl(value);
      continue;
    }

    if (key === 'apiBaseUrl') {
      next.apiBaseUrl = normalizeApiBaseUrl(value);
      continue;
    }

    if (key === 'apiBaseUrlMode') {
      next.apiBaseUrlMode = API_BASE_URL_MODES.includes(value) ? value : 'default';
      continue;
    }

    if (key === 'shortcuts') {
      next.shortcuts = normalizeShortcuts(value);
      continue;
    }

    if (key === 'spectrumScale') {
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.5, Math.min(3, n));
      continue;
    }

    if (key === 'spectrumInfoScale') {
      // 与 shared/spectrumHud.js 的 clampInfoScale 同区间：信息卡倍率，1.0 = 原版
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.5, Math.min(2, n));
      continue;
    }

    if (key === 'spectrumSigmaSmoothing') {
      // 直接替换原版 MusicManager.java:149 的常量 0.335 作为每帧逼近乘数
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.05, Math.min(1, n));
      continue;
    }

    if (key === 'spectrumAvDelayMs') {
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0, Math.min(2000, Math.round(n)));
      continue;
    }

    if (key === 'quality') {
      if (QUALITY_VALUES.includes(value)) next.quality = value;
      continue;
    }

    if (key === 'dataSource') {
      if (DATA_SOURCE_VALUES.includes(value)) next.dataSource = value;
      continue;
    }

    if (key === 'audioOutputDevice') {
      // 设备 ID 为浏览器枚举值，仅做长度与字符白名单限制
      if (typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9._\-:=+/]*$/.test(value)) {
        next.audioOutputDevice = value || 'default';
      }
      continue;
    }

    if (typeof value === 'string') next[key] = value;
  }
  return next;
};
