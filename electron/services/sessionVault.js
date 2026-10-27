import Store from 'electron-store';
import { safeStorage } from 'electron';

const KEY = 'auth';
let store = null;

const ensureStore = () => {
  if (!store) store = new Store({ name: 'session' });
  return store;
};

export const loadSession = async () => {
  const record = ensureStore().get(KEY);
  if (!record || typeof record !== 'object' || !record.encrypted) return null;

  try {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      // 加密暂不可用时保留记录，下次启动再尝试（不要静默删除登录态）
      return null;
    }
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(record.encrypted, 'base64'));
    const text = typeof decrypted === 'string' ? decrypted : decrypted?.result;
    return text ? JSON.parse(text) : null;
  } catch (error) {
    console.error('[session] 会话解密失败:', error.message);
    ensureStore().delete(KEY);
    return null;
  }
};

export const saveSession = async (session) => {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(session));
  ensureStore().set(KEY, { encrypted: encrypted.toString('base64') });
  return true;
};

export const clearStoredSession = () => {
  ensureStore().delete(KEY);
};
