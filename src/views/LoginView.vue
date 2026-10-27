<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '../services/api/client.js';
import {
  authErrorMessage,
  isChineseMobile,
  isLoginSuccess
} from '../services/api/auth.js';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();

const tab = ref('qr');
const qrCode = ref('');
const qrKey = ref('');
const status = ref('正在生成二维码…');
const error = ref('');
const scanned = ref(false);
const loading = ref(false);

const phone = ref('');
const code = ref('');
const sendingCode = ref(false);
const loggingIn = ref(false);
const countdown = ref(0);

let pollTimer = null;
let countdownTimer = null;
let qrToken = 0;
let disposed = false;

const title = computed(() => (tab.value === 'qr' ? '扫码登录' : '手机登录'));
const subtitle = computed(() => (
  tab.value === 'qr'
    ? '使用酷狗音乐 App 扫描二维码，登录后回到播放器。'
    : '使用手机号接收验证码登录。'
));

const clearPoll = () => {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
};

const clearCountdown = () => {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
};

const fail = (message, fallback) => {
  error.value = message || fallback;
  status.value = tab.value === 'qr' ? '无法生成二维码' : '登录未完成';
  if (tab.value === 'qr') clearPoll();
};

const pollStatus = (key) => {
  clearPoll();
  pollTimer = setInterval(async () => {
    if (disposed || tab.value !== 'qr') return;
    try {
      const response = await apiRequest({
        method: 'GET',
        path: '/login/qr/check',
        params: { key, timestamp: Date.now() }
      });
      const codeValue = response?.data?.status;
      if (codeValue === 2) {
        scanned.value = true;
        status.value = '已扫码，请在手机上确认';
      } else if (codeValue === 4) {
        clearPoll();
        auth.setProfile(response.data || {});
        router.push('/');
      } else if (codeValue === 0) {
        clearPoll();
        status.value = '二维码已过期，正在刷新…';
        await createQr();
      }
    } catch (requestError) {
      fail(requestError?.message, '二维码状态检查失败');
    }
  }, 2000);
};

const createQr = async () => {
  if (disposed || tab.value !== 'qr') return;
  const token = ++qrToken;
  loading.value = true;
  error.value = '';
  scanned.value = false;
  qrCode.value = '';
  qrKey.value = '';
  clearPoll();

  try {
    const keyResponse = await apiRequest({ method: 'GET', path: '/login/qr/key' });
    if (token !== qrToken || disposed || tab.value !== 'qr') return;
    const key = keyResponse?.data?.qrcode;
    if (!key) throw new Error('登录服务未返回二维码 key');

    const qrResponse = await apiRequest({
      method: 'GET',
      path: '/login/qr/create',
      params: { key, qrimg: true }
    });
    if (token !== qrToken || disposed || tab.value !== 'qr') return;
    const base64 = qrResponse?.data?.base64 || keyResponse?.data?.qrcode_img || '';
    if (!base64) throw new Error('二维码生成失败');

    qrCode.value = base64;
    qrKey.value = key;
    status.value = '请使用酷狗音乐 App 扫码';
    pollStatus(key);
  } catch (requestError) {
    if (token === qrToken && !disposed) {
      fail(requestError?.message, '二维码生成失败');
    }
  } finally {
    loading.value = false;
  }
};

const switchTab = (next) => {
  if (next === tab.value) return;
  tab.value = next;
  error.value = '';

  if (next === 'qr') {
    status.value = qrCode.value ? '请使用酷狗音乐 App 扫码' : '正在生成二维码…';
    if (qrCode.value && qrKey.value) pollStatus(qrKey.value);
    else void createQr();
    return;
  }

  clearPoll();
  status.value = '输入手机号和验证码登录';
};

const startCountdown = () => {
  clearCountdown();
  countdown.value = 60;
  countdownTimer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0) {
      countdown.value = 0;
      clearCountdown();
    }
  }, 1000);
};

const sendCode = async () => {
  const mobile = phone.value.trim();
  if (!isChineseMobile(mobile)) {
    error.value = '请输入正确的 11 位手机号';
    return;
  }

  sendingCode.value = true;
  error.value = '';
  try {
    const response = await apiRequest({
      method: 'POST',
      path: '/captcha/sent',
      data: { mobile }
    });
    if (response?.status === 1 || response?.status === 200) {
      status.value = '验证码已发送，请查收短信';
      startCountdown();
    } else {
      error.value = authErrorMessage(response, '验证码发送失败');
    }
  } catch (requestError) {
    error.value = requestError?.message || '验证码发送失败';
  } finally {
    sendingCode.value = false;
  }
};

const loginPhone = async () => {
  const mobile = phone.value.trim();
  const smsCode = code.value.trim();

  if (!isChineseMobile(mobile)) {
    error.value = '请输入正确的 11 位手机号';
    return;
  }
  if (!/^\d{4,6}$/.test(smsCode)) {
    error.value = '请输入短信验证码';
    return;
  }

  loggingIn.value = true;
  error.value = '';
  try {
    const response = await apiRequest({
      method: 'POST',
      path: '/login/cellphone',
      data: { mobile, code: smsCode }
    });
    if (isLoginSuccess(response)) {
      auth.setProfile(response.data || {});
      router.push('/');
      return;
    }
    error.value = authErrorMessage(response, '登录失败');
  } catch (requestError) {
    error.value = requestError?.message || '登录失败';
  } finally {
    loggingIn.value = false;
  }
};

const goGuest = () => {
  router.push('/');
};

onMounted(() => {
  if (tab.value === 'qr') void createQr();
});

onBeforeUnmount(() => {
  disposed = true;
  qrToken += 1;
  clearPoll();
  clearCountdown();
});
</script>

<template>
  <main class="login-page">
    <section class="login-card">
      <p class="eyebrow">JELLO MUSIC</p>
      <h1>{{ title }}</h1>
      <p class="sub">{{ subtitle }}</p>

      <div class="tabs" role="tablist">
        <button
          type="button"
          class="tab"
          :class="{ active: tab === 'qr' }"
          role="tab"
          :aria-selected="tab === 'qr'"
          @click="switchTab('qr')"
        >
          扫码登录
        </button>
        <button
          type="button"
          class="tab"
          :class="{ active: tab === 'phone' }"
          role="tab"
          :aria-selected="tab === 'phone'"
          @click="switchTab('phone')"
        >
          手机验证码
        </button>
      </div>

      <template v-if="tab === 'qr'">
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
      </template>

      <template v-else>
        <form class="phone-form" @submit.prevent="loginPhone">
          <input
            v-model="phone"
            class="field"
            type="tel"
            inputmode="numeric"
            maxlength="11"
            placeholder="手机号"
            autocomplete="tel"
          />
          <div class="code-row">
            <input
              v-model="code"
              class="field"
              type="text"
              inputmode="numeric"
              maxlength="6"
              placeholder="短信验证码"
              autocomplete="one-time-code"
            />
            <button
              type="button"
              class="code-button"
              :disabled="countdown > 0 || sendingCode"
              @click="sendCode"
            >
              {{ countdown > 0 ? `${countdown}s` : (sendingCode ? '发送中…' : '获取验证码') }}
            </button>
          </div>
          <button type="submit" class="btn phone-submit" :disabled="loggingIn">
            {{ loggingIn ? '登录中…' : '登录' }}
          </button>
        </form>

        <p class="status" :class="{ error: !!error }">{{ error || status }}</p>

        <div class="actions">
          <button type="button" class="btn ghost" @click="goGuest">游客模式</button>
        </div>
      </template>
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
  margin: 0 0 18px;
  color: #837b8f;
  font-size: 13px;
  line-height: 1.6;
}

.tabs {
  display: flex;
  width: 100%;
  padding: 4px;
  margin-bottom: 16px;
  border: 1px solid #2a2434;
  border-radius: 999px;
  background: rgba(254, 254, 254, 0.03);
}

.tab {
  flex: 1;
  height: 30px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #837b8f;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.tab.active {
  background: rgba(255, 255, 255, 0.09);
  color: #fff;
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

.phone-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  width: 100%;
  height: 42px;
  padding: 0 14px;
  border: 1px solid #2a2434;
  border-radius: 12px;
  background: #17121d;
  color: #f2eef6;
  font: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.field:focus {
  border-color: #ff69b4;
}

.field::placeholder {
  color: #544c60;
}

.code-row {
  display: flex;
  gap: 8px;
}

.code-row .field {
  flex: 1;
  min-width: 0;
}

.code-button {
  flex: 0 0 auto;
  height: 42px;
  padding: 0 14px;
  border: 1px solid #2a2434;
  border-radius: 12px;
  background: transparent;
  color: #b9b1c6;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.code-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.phone-submit {
  width: 100%;
  height: 40px;
}

.status {
  min-height: 20px;
  margin: 14px 0 0;
  color: #b9b1c6;
  font-size: 13px;
}

.status.error {
  color: #ff8f9f;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
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

.btn:disabled,
.code-button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
