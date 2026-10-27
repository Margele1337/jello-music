export const SETTING_DEFAULTS = Object.freeze({
  language: '',
  quality: '320',
  dataSource: 'concept',
  volume: 1,
  minimizeToTray: true
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

    if (key === 'minimizeToTray') {
      if (typeof value === 'boolean') next.minimizeToTray = value;
      continue;
    }

    if (typeof value === 'string') next[key] = value;
  }
  return next;
};
