<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '../services/api/client.js';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();

const qrCode = ref('');
const status = ref('正在生成二维码…');
const error = ref('');
const scanned = ref(false);
const loading = ref(false);

let pollTimer = null;
let disposed = false;

const clearPoll = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

const fail = (message) => {
  error.value = message || '登录服务暂不可用';
  status.value = '无法生成二维码';
  clearPoll();
};

const pollStatus = (key) => {
  clearPoll();
  pollTimer = setInterval(async () => {
    if (disposed) return;
    try {
      const response = await apiRequest({
        method: 'GET',
        path: '/login/qr/check',
        params: { key, timestamp: Date.now() }
      });
      const code = response?.data?.status;
      if (code === 2) {
        scanned.value = true;
        status.value = '已扫码，请在手机上确认';
      } else if (code === 4) {
        clearPoll();
        auth.setProfile(response.data || {});
        router.push('/');
      } else if (code === 0) {
        clearPoll();
        status.value = '二维码已过期，正在刷新…';
        await createQr();
      }
    } catch (requestError) {
      fail(requestError?.message || '二维码状态检查失败');
    }
  }, 2000);
};

const createQr = async () => {
  if (disposed) return;
  loading.value = true;
  error.value = '';
  scanned.value = false;
  qrCode.value = '';
  clearPoll();
  try {
    const keyResponse = await apiRequest({ method: 'GET', path: '/login/qr/key' });
    const key = keyResponse?.data?.qrcode;
    if (!key) throw new Error('登录服务未返回二维码 key');

    const qrResponse = await apiRequest({
      method: 'GET',
      path: '/login/qr/create',
      params: { key, qrimg: true }
    });
    qrCode.value = qrResponse?.data?.base64 || keyResponse?.data?.qrcode_img || '';
    if (!qrCode.value) throw new Error('二维码生成失败');

    status.value = '请使用酷狗音乐 App 扫码';
    pollStatus(key);
  } catch (requestError) {
    fail(requestError?.message || '二维码生成失败');
  } finally {
    loading.value = false;
  }
};

const goGuest = () => {
  router.push('/');
};

onMounted(createQr);
onBeforeUnmount(() => {
  disposed = true;
  clearPoll();
});
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <p class="eyebrow">JELLO MUSIC</p>
      <h1>扫码登录</h1>
      <p class="sub">使用酷狗音乐 App 扫描二维码，登录后回到播放器。</p>

      <div class="qr-box" :class="{ scanned }">
        <img v-if="qrCode" :src="qrCode" alt="酷狗登录二维码" />
        <div v-else class="qr-empty">
          <span>{{ loading ? '正在生成…' : '二维码不可用' }}</span>
        </div>
      </div>

      <p class="status" :class="{ error: !!error }">{{ error || status }}</p>

      <div class="actions">
        <button type="button" class="btn ghost" @click="createQr" :disabled="loading">刷新二维码</button>
        <button type="button" class="btn" @click="goGuest">游客模式</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  background: radial-gradient(100% 120% at 50% 0%, #241c2e 0%, #131017 60%, #0e0c12 100%);
  color: #f2eef6;
}

.login-card {
  width: min(340px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.eyebrow {
  margin: 0;
  color: #837b8f;
  font-size: 11px;
  letter-spacing: 4px;
}

h1 {
  margin: 10px 0 6px;
  font-size: 28px;
  font-weight: 600;
}

.sub {
  margin: 0 0 20px;
  color: #837b8f;
  font-size: 13px;
  line-height: 1.6;
}

.qr-box {
  width: 212px;
  height: 212px;
  padding: 12px;
  border-radius: 18px;
  background: #fff;
  box-sizing: border-box;
  transition: opacity 0.2s;
}

.qr-box.scanned {
  opacity: 0.55;
}

.qr-box img {
  width: 100%;
  height: 100%;
  display: block;
}

.qr-empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: #8d8798;
  font-size: 12px;
}

.status {
  min-height: 20px;
  margin: 16px 0 0;
  color: #b9b1c6;
  font-size: 13px;
}

.status.error {
  color: #ff8f9f;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.btn {
  height: 38px;
  padding: 0 20px;
  border: none;
  border-radius: 999px;
  background: #fff;
  color: #17121c;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.btn:hover:not(:disabled) {
  background: #ff69b4;
  color: #fff;
}

.btn.ghost {
  background: transparent;
  color: #b9b1c6;
  border: 1px solid #2a2434;
}

.btn.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
