<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { apiRequest } from '../services/api/client.js';
import {
  authErrorMessage,
  buildPasswordLoginData,
  buildPhoneLoginData,
  extractAccountInfoList,
  isChineseMobile,
  isLoginSuccess
} from '../services/api/auth.js';
import { useAuthStore } from '../stores/auth.js';
import { useSigmaWindowDrag } from '../composables/useSigmaWindowDrag.js';

const router = useRouter();
const auth = useAuthStore();

// 无边框窗口：登录页非控件区域拖动窗口
const { onPointerDown: onLoginDragPointerDown } = useSigmaWindowDrag({
  noDragSelector: 'button, input, a, .login-card'
});

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

// 账号密码登录（username 可为邮箱或 userid）
const account = ref('');
const password = ref('');
const loggingInAccount = ref(false);

// 一个手机号绑定多账号：候选列表 + 选择视图
const phoneAccounts = ref([]);
const choosingAccount = ref(false);

// 注册引导：官方网页注册已关闭，只给文字说明（不内置二维码资源）
const showRegisterHint = ref(false);

let pollTimer = null;
let countdownTimer = null;
let qrToken = 0;
let disposed = false;

const TAB_TITLES = { qr: '扫码登录', phone: '手机登录', account: '账号密码登录' };
const TAB_SUBTITLES = {
  qr: '使用酷狗音乐 App 扫描二维码，登录后回到播放器。',
  phone: '使用手机号接收验证码登录。',
  account: '使用账号（邮箱/用户名）和密码登录。'
};

const title = computed(() => {
  if (tab.value === 'phone' && choosingAccount.value) return '选择账号';
  return TAB_TITLES[tab.value] || '登录';
});
const subtitle = computed(() => {
  if (tab.value === 'phone' && choosingAccount.value) return '该手机号绑定了多个账号，请选择要登录的账号。';
  return TAB_SUBTITLES[tab.value] || '';
});

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
  choosingAccount.value = false;
  phoneAccounts.value = [];

  if (next === 'qr') {
    status.value = qrCode.value ? '请使用酷狗音乐 App 扫码' : '正在生成二维码…';
    if (qrCode.value && qrKey.value) pollStatus(qrKey.value);
    else void createQr();
    return;
  }

  clearPoll();
  status.value = next === 'account' ? '输入账号和密码登录' : '输入手机号和验证码登录';
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

// selectedUserid 为空即首次提交；多账号时带 userid 重新提交（对齐旧版流程）
const loginPhone = async (selectedUserid = null) => {
  const mobile = phone.value.trim();
  const smsCode = code.value.trim();

  if (!selectedUserid) {
    if (!isChineseMobile(mobile)) {
      error.value = '请输入正确的 11 位手机号';
      return;
    }
    if (!/^\d{4,6}$/.test(smsCode)) {
      error.value = '请输入短信验证码';
      return;
    }
  }

  loggingIn.value = true;
  error.value = '';
  try {
    const response = await apiRequest({
      method: 'POST',
      path: '/login/cellphone',
      data: buildPhoneLoginData({ mobile, code: smsCode, userid: selectedUserid })
    });
    if (isLoginSuccess(response)) {
      choosingAccount.value = false;
      phoneAccounts.value = [];
      auth.setProfile(response.data || {});
      router.push('/');
      return;
    }
    // 该手机号绑定多个账号：代理不抛错，info_list 直接随 body 返回
    const list = extractAccountInfoList(response);
    if (list.length > 1) {
      phoneAccounts.value = list;
      choosingAccount.value = true;
      error.value = '';
      return;
    }
    error.value = authErrorMessage(response, '登录失败');
  } catch (requestError) {
    // 少数部署会把多账号候选包在抛出的错误响应里
    const list = extractAccountInfoList(requestError);
    if (list.length > 1) {
      phoneAccounts.value = list;
      choosingAccount.value = true;
      return;
    }
    error.value = requestError?.message || '登录失败';
  } finally {
    loggingIn.value = false;
  }
};

const selectAccount = (item) => {
  if (!item?.userid) return;
  void loginPhone(item.userid);
};

const backToPhoneForm = () => {
  choosingAccount.value = false;
  phoneAccounts.value = [];
  error.value = '';
};

const loginPassword = async () => {
  const username = account.value.trim();
  const pwd = password.value;
  if (!username) {
    error.value = '请输入账号（邮箱或用户名）';
    return;
  }
  if (!pwd) {
    error.value = '请输入密码';
    return;
  }

  loggingInAccount.value = true;
  error.value = '';
  try {
    const response = await apiRequest({
      method: 'POST',
      path: '/login',
      data: buildPasswordLoginData(username, pwd)
    });
    if (isLoginSuccess(response) || response?.code === 200) {
      auth.setProfile(response.data || {});
      router.push('/');
      return;
    }
    error.value = authErrorMessage(response, '登录失败');
  } catch (requestError) {
    error.value = requestError?.message || '登录失败';
  } finally {
    loggingInAccount.value = false;
  }
};

const goGuest = () => {
  // 记住「跳过登录」，下次启动不再打扰；首次进入才提示，避免每次返回都刷屏
  const alreadyGuest = auth.guestRemembered;
  auth.rememberGuest();
  if (!alreadyGuest) {
    window.dispatchEvent(new CustomEvent('jello:toast', { detail: '游客模式：部分歌曲仅支持试听' }));
  }
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
  <main class="login-page" @pointerdown="onLoginDragPointerDown">
    <section class="login-card">
      <p class="eyebrow">JELLO MUSIC</p>
      <h1>{{ title }}</h1>
      <p class="sub">{{ subtitle }}</p>

      <div v-if="!(tab === 'phone' && choosingAccount)" class="tabs" role="tablist">
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
        <button
          type="button"
          class="tab"
          :class="{ active: tab === 'account' }"
          role="tab"
          :aria-selected="tab === 'account'"
          @click="switchTab('account')"
        >
          账号密码
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

      <template v-else-if="tab === 'phone'">
        <div v-if="choosingAccount" class="account-list">
          <button
            v-for="item in phoneAccounts"
            :key="item.userid"
            type="button"
            class="account-item"
            :disabled="loggingIn"
            @click="selectAccount(item)"
          >
            <img class="account-avatar" :src="item.pic || item.avatar || ''" :alt="item.nickname || ''" @error="$event.target.style.visibility = 'hidden'" />
            <span class="account-meta">
              <span class="account-name">{{ item.nickname || '未命名用户' }}</span>
              <span class="account-sub">UID {{ item.userid }}{{ item.p_grade != null ? ` · Lv ${item.p_grade}` : '' }}</span>
            </span>
          </button>
          <p class="status" :class="{ error: !!error }">{{ error }}</p>
          <div class="actions">
            <button type="button" class="btn ghost" @click="backToPhoneForm" :disabled="loggingIn">返回登录</button>
          </div>
        </div>

        <form v-else class="phone-form" @submit.prevent="loginPhone()">
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

        <p v-if="!choosingAccount" class="status" :class="{ error: !!error }">{{ error || status }}</p>

        <div v-if="!choosingAccount" class="actions">
          <button type="button" class="btn ghost" @click="goGuest">游客模式</button>
        </div>
      </template>

      <template v-else>
        <form class="phone-form" @submit.prevent="loginPassword">
          <input
            v-model="account"
            class="field"
            type="text"
            placeholder="账号 / 邮箱 / 用户名"
            autocomplete="username"
          />
          <input
            v-model="password"
            class="field"
            type="password"
            placeholder="密码"
            autocomplete="current-password"
          />
          <button type="submit" class="btn phone-submit" :disabled="loggingInAccount">
            {{ loggingInAccount ? '登录中…' : '登录' }}
          </button>
        </form>

        <p class="status" :class="{ error: !!error }">{{ error || status }}</p>

        <div class="actions">
          <button type="button" class="btn ghost" @click="goGuest">游客模式</button>
        </div>
      </template>

      <p v-if="!(tab === 'phone' && choosingAccount)" class="register-link">
        还没有账号？<a href="#" @click.prevent="showRegisterHint = true">查看注册方式</a>
      </p>
    </section>

    <div v-if="showRegisterHint" class="register-mask" @click.self="showRegisterHint = false">
      <div class="register-card" role="dialog" aria-modal="true" aria-label="注册说明">
        <p class="register-title">注册说明</p>
        <p class="register-body">
          酷狗官方网页版注册入口已关闭，桌面端无法直接注册新账号。
          请在手机上下载「酷狗音乐」App，或在登录页使用微信 / QQ 授权完成注册与登录；
          已有账号可回到本页用手机号或账号密码登录。
        </p>
        <p class="register-note">如需帮助，可访问酷狗官方站点后按提示操作：</p>
        <p class="register-url">https://www.kugou.com/</p>
        <button type="button" class="btn register-close" @click="showRegisterHint = false">我知道了</button>
      </div>
    </div>
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
.code-button:disabled,
.account-item:disabled {
  opacity: 0.5;
  cursor: default;
}

.account-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.account-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1px solid #2a2434;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.account-item:hover:not(:disabled) {
  border-color: #ff69b4;
  background: rgba(255, 105, 180, 0.08);
}

.account-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  flex: 0 0 auto;
  background: #201a28;
}

.account-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 3px;
}

.account-name {
  color: #f2eef6;
  font-size: 14px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.account-sub {
  color: #837b8f;
  font-size: 11.5px;
}

.register-link {
  margin: 18px 0 0;
  color: #544c60;
  font-size: 12px;
}

.register-link a {
  color: #b9b1c6;
  text-decoration: none;
  cursor: pointer;
}

.register-link a:hover {
  color: #ff69b4;
}

.register-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 6, 11, 0.72);
}

.register-card {
  width: min(320px, 100%);
  padding: 22px 20px;
  border: 1px solid #2a2434;
  border-radius: 18px;
  background: #17121d;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  text-align: center;
}

.register-title {
  margin: 0 0 12px;
  color: #f2eef6;
  font-size: 16px;
  font-weight: 600;
}

.register-body {
  margin: 0;
  color: #b9b1c6;
  font-size: 13px;
  line-height: 1.7;
  text-align: left;
}

.register-note {
  margin: 14px 0 2px;
  color: #837b8f;
  font-size: 12px;
  text-align: left;
}

/* 链接以可选中文本呈现（登录卡默认 user-select:none，这里放开） */
.register-url {
  margin: 0;
  color: #ff8fc7;
  font-size: 13px;
  text-align: left;
  user-select: text;
  cursor: text;
  word-break: break-all;
}

.register-close {
  margin-top: 18px;
  height: 38px;
  padding: 0 28px;
}
</style>
