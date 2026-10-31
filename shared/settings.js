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
export const SPECTRUM_PRESET_VALUES = Object.freeze(['original', 'legacy']);

export const API_BASE_URL_MODES = Object.freeze(['default', 'custom']);


// 以下三个是安全白名单的单一事实来源：主进程 sanitize（本文件）、设置页
// 解释文案（addressChecks.js）与媒体协议诊断放行（mediaScheme.js）共用。
// 之前各自复制一份曾出现宽松度漂移（127.0.0.2 / [::1] 语义不一致），禁止再复制。
export const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
export const PROXY_SCHEMES = Object.freeze(['http', 'https', 'socks4', 'socks4a', 'socks5']);
export const isLoopbackHost = (hostname) => {
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
  // 音量合成器式应用级音量：与主界面音量相乘后输出（应用音量 50% × 主界面
  // 80% = 实际 40%），主界面滑杆语义不变
  masterVolume: 0.6,
  playbackRate: 1,
  loudnessNormalization: false,
  audioOutputDevice: 'default',
  minimizeToTray: true,
  desktopLyrics: false,
  desktopLyricsFont: '',
  spectrum: false,
  spectrumScale: 0.7,
  // 只作用于频谱条形层（幽灵条/实心条/条内封面叠加）的不透明度，默认 10%
  spectrumBarOpacity: 0.1,
  // 频谱信息卡（封面、歌名与四周柔边）的不透明度，1 = 原版
  spectrumInfoOpacity: 1,
  // 鼠标靠近透明：光标附近的条形/信息卡以圆形区域渐隐（半径随进入逐渐扩大），
  // 用来看清被频谱挡住的桌面内容
  spectrumMouseFade: true,
  // 渐隐圈最大半径（CSS 像素）
  spectrumMouseFadeRadius: 260,
  // 1.0 = 原版固定像素信息卡（封面 100×100、字号 18/20），纯倍率不叠加分辨率缩放
  spectrumInfoScale: 1,
  spectrumInfoVisible: true,
  spectrumSigmaSmoothing: 0.335,
  spectrumAvDelayMs: 590,
  // HUD 目标电平的刷新间隔：50ms ≈ 跟手；约 500ms ≈ 「一秒变一两次」的慢节奏
  spectrumUpdateMs: 500,
  // 频谱预设：legacy（预设 1，默认）= legacy 复刻——实时 tap（自解码分析不接管）、
  // 250ms 攒批推进 4 帧队首、FFT 输入不做响度归一、预读领先取设置原值、
  // HUD 用 legacy 平滑式（信息卡低音脉冲两个预设都有）；
  // original（预设 2）= 原版 sigmarebase——自解码精确时序 + 帧首 1024 个采样时刻
  // 打包窗 1024 点 FFT。
  // 切到 legacy 立即生效（停用自解码回到 tap）；切到 original 下一首生效。
  spectrumPreset: 'legacy',
  spectrumLocked: true,
  autoStart: false,
  preventAppSuspension: false,
  hotkeyIntroSeen: false,
  proxyEnabled: false,
  proxyUrl: '',
  apiBaseUrlMode: 'default',
  apiBaseUrl: '',
  // false = 关闭硬件加速并走软件合成（改后需重启生效，UI 自己提示）
  gpuAcceleration: true
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

    if (key === 'masterVolume') {
      const number = Number(value);
      if (Number.isFinite(number)) next.masterVolume = Math.max(0, Math.min(1, number));
      continue;
    }

    if (key === 'playbackRate') {
      const number = Number(value);
      if (Number.isFinite(number) && PLAYBACK_RATES.includes(number)) next.playbackRate = number;
      continue;
    }

    if (key === 'minimizeToTray' || key === 'desktopLyrics' || key === 'spectrum'
      || key === 'spectrumInfoVisible' || key === 'spectrumLocked' || key === 'spectrumMouseFade'
      || key === 'hotkeyIntroSeen'
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

    if (key === 'spectrumInfoOpacity') {
      // 歌曲信息卡不透明度；下限 0.1 防止调到几乎不可见
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.1, Math.min(1, n));
      continue;
    }

    if (key === 'spectrumMouseFadeRadius') {
      // 渐隐圈半径：过小失去避让意义，过大接近整窗透明
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(80, Math.min(600, Math.round(n)));
      continue;
    }

    if (key === 'spectrumBarOpacity') {
      // 条形层不透明度，与整窗透明度相乘；下限同上
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.1, Math.min(1, n));
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

    if (key === 'spectrumUpdateMs') {
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(50, Math.min(2000, Math.round(n)));
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

    if (key === 'spectrumPreset') {
      // 历史存档里的 wide（旧预设 2）迁移到 legacy；'wide' 不再是可取值
      const presetValue = value === 'wide' ? 'legacy' : value;
      if (SPECTRUM_PRESET_VALUES.includes(presetValue)) next.spectrumPreset = presetValue;
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
  // 旧「整窗透明度」键迁移为信息卡透明度（透明度概念已拆分为条形/信息两级）。
  // 已从 defaults 移除的键进不了上面的循环，只能在此后处理；新键优先
  if (next.spectrumInfoOpacity === undefined
    && Object.prototype.hasOwnProperty.call(patch, 'spectrumOpacity')) {
    const n = Number(patch.spectrumOpacity);
    if (Number.isFinite(n)) next.spectrumInfoOpacity = Math.max(0.1, Math.min(1, n));
  }

  return next;
};
