import Store from 'electron-store';
import { safeStorage } from 'electron';

const KEY = 'auth';
let store = null;

const ensureStore = () => {
  if (!store) store = new Store({ name: 'session' });
  return store;
};

export const loadSession = () => {
  const record = ensureStore().get(KEY);
  if (!record || typeof record !== 'object') return null;

  try {
    if (record.encrypted && safeStorage.isEncryptionAvailable()) {
      return JSON.parse(safeStorage.decryptString(Buffer.from(record.encrypted, 'base64')));
    }
  } catch (error) {
    console.error('[session] 会话解密失败:', error.message);
  }

  ensureStore().delete(KEY);
  return null;
};

export const saveSession = (session) => {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const encrypted = safeStorage.encryptString(JSON.stringify(session)).toString('base64');
  ensureStore().set(KEY, { encrypted });
  return true;
};

export const clearStoredSession = () => {
  ensureStore().delete(KEY);
};
