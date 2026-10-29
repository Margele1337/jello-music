import Store from 'electron-store';
import { SETTING_DEFAULTS, normalizeShortcuts, sanitizeSettings } from '../../shared/settings.js';

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
  const raw = store?.store || {};
  return {
    ...SETTING_DEFAULTS,
    ...raw,
    // 旧版本/手工编辑过的 settings.json 里可能缺 shortcuts 或含非法键位，
    // 每次读取都补齐成完整 12 键，调用方与渲染层都不用再做默认值合并
    shortcuts: normalizeShortcuts(raw.shortcuts)
  };
};

export const updateSettings = (patch) => {
  if (!store) throw new Error('settings store is not initialized');
  const clean = sanitizeSettings(patch);
  if (Object.keys(clean).length > 0) store.set(clean);
  return getSettings();
};
