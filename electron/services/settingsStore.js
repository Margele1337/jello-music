import Store from 'electron-store';
import { SETTING_DEFAULTS, sanitizeSettings } from '../../shared/settings.js';

let store = null;

export const initSettings = () => {
  store = new Store({
    name: 'settings',
    defaults: { ...SETTING_DEFAULTS }
  });
};

export const getSettings = () => ({
  ...SETTING_DEFAULTS,
  ...(store?.store || {})
});

export const updateSettings = (patch) => {
  if (!store) throw new Error('settings store is not initialized');
  const clean = sanitizeSettings(patch);
  if (Object.keys(clean).length > 0) store.set(clean);
  return getSettings();
};
