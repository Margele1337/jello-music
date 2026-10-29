import Store from 'electron-store';
import { emptyPlaybackState, sanitizePlaybackState } from '../../shared/ipc.js';

const KEY = 'state';
let store = null;

const ensureStore = () => {
  if (!store) store = new Store({ name: 'playback' });
  return store;
};

// 读取即消毒：文件缺失/损坏/字段畸形一律静默回落为空状态
export const getPlaybackState = () => {
  try {
    return sanitizePlaybackState(ensureStore().get(KEY));
  } catch (error) {
    console.error('[playback] 读取持久化状态失败:', error.message);
    return emptyPlaybackState();
  }
};

export const savePlaybackState = (state) => {
  const clean = sanitizePlaybackState(state);
  try {
    ensureStore().set(KEY, clean);
  } catch (error) {
    // 落盘失败不影响播放主流程
    console.error('[playback] 写入持久化状态失败:', error.message);
  }
  return clean;
};
