<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { claimDailyVip, formatVipDate } from '../services/api/vip.js';
import { useAuthStore } from '../stores/auth.js';
import { useSettingsStore } from '../stores/settings.js';

const router = useRouter();
const settings = useSettingsStore();
const auth = useAuthStore();

const version = ref('');
const switching = ref(false);
const notice = ref('');
const updateState = ref({ status: 'idle', version: '', percent: 0, error: '' });
const hasUpdateBridge = ref(false);
const claimingVip = ref(false);
const vipMessage = ref('');
const vipError = ref(false);
const claimedDay = ref('');
let noticeTimer = null;
let unsubscribeUpdates = null;

const setNotice = (text, duration = 3000) => {
  notice.value = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = '';
  }, duration);
};

const qualityOptions = [
  { value: '128', label: '128 kbps' },
  { value: '320', label: '320 kbps' },
  { value: 'flac', label: 'FLAC 无损' }
];

const quality = computed({
  get: () => settings.quality,
  set: (value) => {
    if (value === settings.quality) return;
    void settings.update({ quality: value })
      .then(() => setNotice('音质已更新'))
      .catch((error) => setNotice(error?.message || '保存失败'));
  }
});

const dataSource = computed({
  get: () => settings.dataSource,
  set: async (value) => {
    if (value === settings.dataSource || switching.value) return;
    switching.value = true;
    try {
      await settings.update({ dataSource: value });
      setNotice('数据源已切换，接口正在重启，稍后即可使用', 5000);
    } catch (error) {
      setNotice(error?.message || '数据源切换失败');
    } finally {
      switching.value = false;
    }
  }
});

const minimizeToTray = computed({
  get: () => settings.minimizeToTray,
  set: (value) => {
    void settings.update({ minimizeToTray: Boolean(value) })
      .catch((error) => setNotice(error?.message || '保存失败'));
  }
});

const desktopLyrics = computed({
  get: () => settings.desktopLyrics,
  set: (value) => {
    void settings.update({ desktopLyrics: Boolean(value) })
      .catch((error) => setNotice(error?.message || '保存失败'));
  }
});

const spectrum = computed({
  get: () => settings.spectrum,
  set: (value) => {
    void settings.update({ spectrum: Boolean(value) })
      .catch((error) => setNotice(error?.message || '保存失败'));
  }
});

const updateText = computed(() => {
  const state = updateState.value;
  switch (state.status) {
    case 'dev':
      return '开发模式不检查更新';
    case 'checking':
      return '正在检查更新…';
    case 'current':
      return '已是最新版本';
    case 'available':
      return state.version ? `发现新版本 v${state.version}` : '发现新版本';
    case 'downloading':
      return `正在下载更新 ${state.percent || 0}%`;
    case 'downloaded':
      return state.version ? `v${state.version} 已下载，重启后生效` : '更新已下载，重启后生效';
    case 'error':
      return state.error || '检查更新失败';
    default:
      return '尚未检查更新';
  }
});

const updateAction = computed(() => {
  if (updateState.value.status === 'available') return 'download';
  if (updateState.value.status === 'downloaded') return 'install';
  return 'check';
});

const updateLabel = computed(() => {
  if (updateAction.value === 'download') return '下载更新';
  if (updateAction.value === 'install') return '重启安装';
  return '检查更新';
});

const updateBusy = computed(() => ['checking', 'downloading'].includes(updateState.value.status));
const updateDisabled = computed(() => !hasUpdateBridge.value || updateBusy.value || updateState.value.status === 'dev');

const onUpdateAction = async () => {
  const bridge = window.jello?.updates;
  if (!bridge) return;
  try {
    if (updateAction.value === 'download') {
      updateState.value = await bridge.download();
    } else if (updateAction.value === 'install') {
      await bridge.install();
    } else {
      updateState.value = await bridge.check();
    }
  } catch (error) {
    setNotice(error?.message || '更新操作失败');
  }
};

const canClaimVip = computed(() => (
  auth.isAuthenticated
  && settings.dataSource === 'concept'
  && !claimingVip.value
  && claimedDay.value !== formatVipDate()
));

const vipButtonLabel = computed(() => {
  if (claimingVip.value) return '领取中…';
  if (claimedDay.value === formatVipDate()) return '今日已领取';
  return '领取今日 VIP';
});

const claimVip = async () => {
  if (!auth.isAuthenticated) {
    vipMessage.value = '请先登录';
    vipError.value = true;
    return;
  }
  if (settings.dataSource !== 'concept') {
    vipMessage.value = '概念版 VIP 仅在概念版数据源下可领取';
    vipError.value = true;
    return;
  }

  claimingVip.value = true;
  vipMessage.value = '';
  vipError.value = false;
  try {
    const result = await claimDailyVip();
    claimedDay.value = result.day;
    vipMessage.value = result.upgradeOk
      ? '今日概念版 VIP 已领取并升级'
      : `今日 VIP 已领取${result.upgradeMessage ? `（${result.upgradeMessage}）` : ''}`;
  } catch (error) {
    vipMessage.value = error?.message || '领取失败';
    vipError.value = true;
  } finally {
    claimingVip.value = false;
  }
};

const accountName = computed(() => {
  const profile = auth.profile;
  if (!profile) return '';
  return String(profile.nickname || profile.userid || '');
});

const goBack = () => router.push('/');
const goLogin = () => router.push('/login');

const logout = async () => {
  await auth.clear();
  setNotice('已退出登录');
};

const onKeyDown = (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  goBack();
};

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown);
  try {
    version.value = await window.jello?.app?.getVersion?.() || '';
  } catch {
    version.value = '';
  }

  if (window.jello?.updates) {
    hasUpdateBridge.value = true;
    try {
      updateState.value = await window.jello.updates.get();
    } catch {
      /* keep default state */
    }
    unsubscribeUpdates = window.jello.updates.onState((next) => {
      updateState.value = next || updateState.value;
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  clearTimeout(noticeTimer);
  unsubscribeUpdates?.();
  unsubscribeUpdates = null;
});
</script>

<template>
  <main class="settings-page">
    <header class="settings-header">
      <button type="button" class="back-button" aria-label="返回" @click="goBack">←</button>
      <div class="title-block">
        <p class="eyebrow">JELLO MUSIC</p>
        <h1>设置</h1>
      </div>
      <span class="version">{{ version ? `v${version}` : '' }}</span>
    </header>

    <div class="settings-grid">
    <section class="card">
      <h2>播放</h2>
      <label class="row">
        <span>音质</span>
        <select v-model="quality">
          <option v-for="option in qualityOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>
      <p class="hint">默认 320 kbps；目标音质不可用时自动降级。</p>
    </section>

    <section class="card">
      <h2>数据源</h2>
      <label class="row">
        <span>接口数据源</span>
        <select v-model="dataSource" :disabled="switching">
          <option value="concept">概念版</option>
          <option value="official">正式版</option>
        </select>
      </label>
      <p class="hint">
        数据源决定曲库和会员权益，切换后接口会自动重启；音质与数据源相互独立。
      </p>
    </section>

    <section class="card">
      <h2>账号</h2>
      <div class="account">
        <template v-if="auth.isAuthenticated">
          <span class="account-name">已登录<template v-if="accountName"> · {{ accountName }}</template></span>
          <button type="button" class="action ghost" @click="logout">退出登录</button>
        </template>
        <template v-else>
          <span class="account-name">{{ auth.ready ? '未登录' : '登录状态读取中…' }}</span>
          <button type="button" class="action" :disabled="!auth.ready" @click="goLogin">扫码登录</button>
        </template>
      </div>
      <template v-if="auth.isAuthenticated">
        <div class="vip-row">
          <span>概念版 VIP</span>
          <button type="button" class="action ghost" :disabled="!canClaimVip" @click="claimVip">
            {{ vipButtonLabel }}
          </button>
        </div>
        <p class="hint">
          {{ settings.dataSource === 'concept' ? '每日可手动领取一次，请勿频繁调用。' : '切换到概念版数据源后可领取。' }}
        </p>
        <p v-if="vipMessage" class="vip-message" :class="{ error: vipError }">{{ vipMessage }}</p>
      </template>
    </section>

    <section class="card">
      <h2>窗口</h2>
      <label class="row check-row">
        <span>关闭或最小化时收起到托盘</span>
        <input v-model="minimizeToTray" type="checkbox" />
      </label>
      <label class="row check-row">
        <span>显示桌面歌词</span>
        <input v-model="desktopLyrics" type="checkbox" />
      </label>
      <label class="row check-row">
        <span>显示频谱</span>
        <input v-model="spectrum" type="checkbox" />
      </label>
    </section>

    <section class="card update-card">
      <div class="update-row">
        <div class="update-info">
          <h2>更新</h2>
          <p class="update-status" :class="{ error: updateState.status === 'error' }">{{ updateText }}</p>
        </div>
        <button type="button" class="action" :disabled="updateDisabled" @click="onUpdateAction">
          {{ updateLabel }}
        </button>
      </div>
    </section>
    </div>

    <p v-if="notice" class="notice">{{ notice }}</p>
  </main>
</template>

<style scoped>
.settings-page {
  min-height: 100%;
  max-width: 620px;
  margin: 0 auto;
  padding: 24px 36px 28px;
  overflow-y: auto;
}

.settings-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.back-button {
  width: 34px;
  height: 34px;
  border: 1px solid #2a2434;
  border-radius: 50%;
  background: transparent;
  color: #b9b1c6;
  font: inherit;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.back-button:hover {
  border-color: #ff69b4;
  color: #fff;
}

.title-block {
  flex: 1;
}

.title-block .eyebrow {
  font-size: 10px;
  letter-spacing: 3px;
}

.title-block h1 {
  margin: 2px 0 0;
  font-size: 26px;
  font-weight: 600;
}

.version {
  color: #544c60;
  font-size: 12px;
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 14px;
}

.card {
  padding: 14px 16px;
  border: 1px solid #2a2434;
  border-radius: 14px;
  background: rgba(254, 254, 254, 0.045);
}

.update-card {
  grid-column: 1 / -1;
}

.card h2 {
  margin: 0 0 12px;
  font-size: 13px;
  font-weight: 600;
  color: #f2eef6;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  color: #b9b1c6;
  font-size: 13px;
}

.row select {
  min-width: 150px;
  padding: 7px 10px;
  border: 1px solid #2a2434;
  border-radius: 8px;
  background: #17121d;
  color: #f2eef6;
  font: inherit;
  outline: none;
}

.row select:focus {
  border-color: #ff69b4;
}

.row select:disabled {
  opacity: 0.55;
}

.check-row + .check-row {
  margin-top: 8px;
}

.check-row input {
  width: 16px;
  height: 16px;
  accent-color: #ff69b4;
  cursor: pointer;
}

.hint {
  margin: 10px 0 0;
  color: #776f83;
  font-size: 12px;
  line-height: 1.65;
}

.account {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.account-name {
  color: #b9b1c6;
  font-size: 13px;
}

.vip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 12px;
  color: #b9b1c6;
  font-size: 13px;
}

.vip-message {
  margin: 8px 0 0;
  color: #9fe6c8;
  font-size: 12px;
  line-height: 1.5;
}

.vip-message.error {
  color: #ff8f9f;
}

.action {
  height: 34px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  background: #fff;
  color: #17121c;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.action:hover:not(:disabled) {
  background: #ff69b4;
  color: #fff;
}

.action.ghost {
  background: transparent;
  color: #b9b1c6;
  border: 1px solid #2a2434;
}

.action.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.action:disabled {
  opacity: 0.5;
  cursor: default;
}

.update-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.update-info {
  min-width: 0;
}

.update-info h2 {
  margin-bottom: 4px;
}

.update-status {
  margin: 0;
  color: #837b8f;
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.update-status.error {
  color: #ff8f9f;
}

.notice {
  margin: 16px 0 0;
  padding: 9px 14px;
  border-radius: 10px;
  background: rgba(255, 105, 180, 0.12);
  color: #ffc2e2;
  font-size: 12px;
  text-align: center;
}
</style>
