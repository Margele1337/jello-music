export const QUALITY_VALUES = Object.freeze(['128', '320', 'flac']);
export const DATA_SOURCE_VALUES = Object.freeze(['concept', 'official']);

export const SETTING_DEFAULTS = Object.freeze({
  language: '',
  quality: '320',
  dataSource: 'concept',
  volume: 1,
  minimizeToTray: true,
  desktopLyrics: false,
  spectrum: false,
  spectrumScale: 1,
  spectrumInfoScale: 1.25,
  spectrumInfoVisible: true,
  spectrumSigmaSmoothing: 0.335,
  spectrumAvDelayMs: 590,
  spectrumLocked: true
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

    if (key === 'minimizeToTray' || key === 'desktopLyrics' || key === 'spectrum'
      || key === 'spectrumInfoVisible' || key === 'spectrumLocked') {
      if (typeof value === 'boolean') next[key] = value;
      continue;
    }

    if (key === 'spectrumScale') {
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.5, Math.min(3, n));
      continue;
    }

    if (key === 'spectrumInfoScale') {
      const n = Number(value);
      if (Number.isFinite(n)) next[key] = Math.max(0.8, Math.min(2, n));
      continue;
    }

    if (key === 'spectrumSigmaSmoothing') {
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

    if (typeof value === 'string') next[key] = value;
  }
  return next;
};
