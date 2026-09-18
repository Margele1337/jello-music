<template>
  <div class="sigma-shell">
    <SigmaMusicPlayer v-show="view === 'player'" :player="player" />

    <!-- 设置界面（只在 Sigma 窗口内出现，左上角返回箭头） -->
    <div v-if="view === 'settings'" class="sigma-view sigma-view--settings">
      <div class="sigma-view-bar">
        <button type="button" class="sigma-back-btn" title="返回" aria-label="返回" @click="view = 'player'">
          <i class="fas fa-chevron-left"></i>
        </button>
        <button type="button" class="sigma-switch-account" @click="view = 'login'">切换账号</button>
      </div>
      <Settings />
    </div>

    <!-- 登录界面（未登录时自动显示；登录成功后回到播放器） -->
    <div v-if="view === 'login'" class="sigma-view sigma-view--login">
      <div class="sigma-view-bar">
        <button type="button" class="sigma-back-btn sigma-back-btn--light" title="返回" aria-label="返回" @click="view = 'player'">
          <i class="fas fa-chevron-left"></i>
        </button>
      </div>
      <div class="sigma-login-scroll">
        <Login />
      </div>
    </div>
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/impl/jello/ingame/clickgui/ClickGuiScreen.java（承载 MusicPlayer 的屏幕）
// 面板铺满窗口；元素尺寸/字号保持原版 1:1（左 250、封面条 94、控件坐标按右侧区域居中）
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SigmaMusicPlayer from './sigma/SigmaMusicPlayer.vue';
import Settings from '@/views/Settings.vue';
import Login from '@/views/Login.vue';
import { MoeAuthStore } from '@/stores/store';

defineProps({
  player: { type: Object, default: null }
});

const view = ref('player');
const MoeAuth = MoeAuthStore();

// 托盘右键「设置」/ 跳转列表任务：在 Sigma 窗口内显示设置页
const onOpenSettings = () => {
  view.value = 'settings';
};

// 设置页在本窗口内：改设置后把变更转发给主窗口，让频谱/桌面歌词等即时生效
const onSettingsChange = (event) => {
  const settings = event.detail?.settings;
  if (settings) {
    window.electron?.ipcRenderer?.send('settings-changed', settings);
  }
};

onMounted(() => {
  window.electron?.ipcRenderer?.on('open-settings', onOpenSettings);
  window.addEventListener('settings-change', onSettingsChange);
  // 启动时带 --settings（跳转列表任务）且 Sigma 窗口未就绪：主进程记为 pending，这里领取
  window.electron?.ipcRenderer?.invoke?.('consume-pending-settings').then((pending) => {
    if (pending) view.value = 'settings';
  }).catch(() => {});
  // 未登录：直接进登录页
  if (!MoeAuth.isAuthenticated) {
    view.value = 'login';
  }
});

onBeforeUnmount(() => {
  window.electron?.ipcRenderer?.removeListener('open-settings', onOpenSettings);
  window.removeEventListener('settings-change', onSettingsChange);
});

// 登录状态变化：登录成功后回播放器并通知主窗口同步登录态；UserInfo 变化覆盖「切换账号」
watch(() => MoeAuth.UserInfo, (info) => {
  if (!info) {
    view.value = 'login';
    return;
  }
  if (view.value === 'login') {
    view.value = 'player';
  }
  window.electron?.ipcRenderer?.send('auth-changed');
});
</script>

<style scoped>
.sigma-shell {
  position: fixed;
  inset: 0;
  /* 原播放器栏 z-index 为 98，必须高于它才能盖住，避免出现两条进度条 */
  z-index: 200;
  /* 原版是浮在虚化的游戏画面之上：半透明深色 + 背景模糊（虚化 Rise 背景） */
  background: rgba(6, 8, 12, 0.45);
  backdrop-filter: blur(24px) saturate(0.9);
  -webkit-backdrop-filter: blur(24px) saturate(0.9);
  overflow: hidden;
}

.sigma-view {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  /* 设置页原本按 (100vh - 160px) 取高，这里铺满窗口并给顶部返回栏留位置 */
  --settings-page-height: calc(100vh - 48px);
}

/* 设置页是浅色样式（深色文字），用浅色玻璃底，避免又暗又糊 */
.sigma-view--settings {
  background: rgba(247, 248, 251, 0.96);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

/* 登录页自身是深色样式，配深色底 */
.sigma-view--login {
  background: rgba(16, 17, 20, 0.96);
}

.sigma-view-bar {
  height: 48px;
  flex: 0 0 48px;
  display: flex;
  align-items: center;
  padding: 0 10px;
}

.sigma-back-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.06);
  color: #333;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.sigma-back-btn:hover {
  background: rgba(0, 0, 0, 0.12);
}

/* 深色视图（登录页）里的返回按钮 */
.sigma-back-btn--light {
  background: rgba(254, 254, 254, 0.1);
  color: #fefefe;
}

.sigma-back-btn--light:hover {
  background: rgba(254, 254, 254, 0.2);
}

.sigma-switch-account {
  margin-left: auto;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.06);
  color: #333;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.sigma-switch-account:hover {
  background: rgba(0, 0, 0, 0.12);
}

.sigma-login-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
</style>
