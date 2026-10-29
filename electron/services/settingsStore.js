import Store from 'electron-store';
import { SETTING_DEFAULTS, sanitizeSettings } from '../../shared/settings.js';

let store = null;

// GPU 开关要在 app.ready 之前读到，所以 initSettings 也必须在 ready 之前被调用；
// 幂等处理让 main.js 顶层与 whenReady 里的两次调用都不产生两个 store 实例。
export const initSettings = () => {
  if (store) return store;
  store = new Store({
    name: 'settings',
    defaults: { ...SETTING_DEFAULTS }
  });
  return store;
};

export const getSettings = () => {
  // settings.json 里遗留的 shortcuts 键随全局快捷键功能一并废弃，读出时丢弃
  const { shortcuts: legacyShortcuts, ...rest } = store?.store || {};
  void legacyShortcuts;
  return {
    ...SETTING_DEFAULTS,
    ...rest
  };
};

export const updateSettings = (patch) => {
  if (!store) throw new Error('settings store is not initialized');
  const clean = sanitizeSettings(patch);
  if (Object.keys(clean).length > 0) store.set(clean);
  return getSettings();
};
