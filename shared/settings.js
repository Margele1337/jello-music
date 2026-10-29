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
export const PLAYBACK_RATES = Object.freeze([0.75, 1, 1.25, 1.5, 2]);

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
  hotkeyIntroSeen: false
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
      || key === 'loudnessNormalization' || key === 'autoStart' || key === 'preventAppSuspension') {
      if (typeof value === 'boolean') next[key] = value;
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
