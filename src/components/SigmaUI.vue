<template>
  <div class="sigma-shell">
    <SigmaMusicPlayer v-show="view === 'player'" :player="player" />

    <!-- 新手教程（首次安装打开的新手引导模板，第一步是 Keybind Manager） -->
    <div v-if="view === 'onboarding'" class="sigma-view sigma-view--onboarding">
      <SigmaKeybindManager title="快捷呼出" :highlight-keys="[344]" @select="onKeybindSelect" />
      <div class="onboarding-footer">
        <span class="onboarding-step">{{ onboardingStep }} / {{ onboardingTotal }}</span>
        <button type="button" class="onboarding-next" @click="finishOnboarding">完成</button>
      </div>
    </div>

    <!-- 设置界面（只在 Sigma 窗口内出现，左上角返回箭头） -->
    <Transition name="sigma-view-fade" :css="!skipViewTransition">
      <div v-if="view === 'settings'" class="sigma-view sigma-view--settings" @pointerdown="onSigmaDragPointerDown">
        <div class="sigma-view-bar">
          <button type="button" class="sigma-back-btn" title="返回" aria-label="返回" @click="view = 'player'">
            <i class="fas fa-chevron-left"></i>
          </button>
          <button type="button" class="sigma-switch-account" @click="view = 'login'">切换账号</button>
        </div>
        <Settings @show-tutorial="openTutorial" />
      </div>
    </Transition>

    <!-- 登录界面（未登录时自动显示；登录成功后回到播放器） -->
    <Transition name="sigma-view-fade" :css="!skipViewTransition">
      <div v-if="view === 'login'" class="sigma-view sigma-view--login" @pointerdown="onSigmaDragPointerDown">
        <div class="sigma-view-bar">
          <button type="button" class="sigma-back-btn sigma-back-btn--light" title="返回" aria-label="返回" @click="view = 'player'">
            <i class="fas fa-chevron-left"></i>
          </button>
        </div>
        <div class="sigma-login-scroll">
          <Login />
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/impl/jello/ingame/clickgui/ClickGuiScreen.java（承载 MusicPlayer 的屏幕）
// 面板铺满窗口；元素尺寸/字号保持原版 1:1（左 250、封面条 94、控件坐标按右侧区域居中）
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SigmaMusicPlayer from './sigma/SigmaMusicPlayer.vue';
import SigmaKeybindManager from './sigma/SigmaKeybindManager.vue';
import Settings from '@/views/Settings.vue';
import Login from '@/views/Login.vue';
import { MoeAuthStore } from '@/stores/store';
import { useSigmaWindowDrag } from '@/composables/useSigmaWindowDrag';

defineProps({
  player: { type: Object, default: null }
});

const view = ref('player');
const MoeAuth = MoeAuthStore();

// 设置/登录页的自绘拖拽：四边夹在屏幕内，向右拖出松手即贴边收起（主进程处理）
const SETTINGS_NO_DRAG_SELECTOR = [
  'button', 'input', 'select', 'textarea', 'a',
  '.setting-card', '.sidebar-item', '.settings-cards', '.settings-sidebar',
  '.scale-slider-container', '.api-settings-container', '.proxy-settings-container',
  '.font-list', '.font-search', '.modal', '.custom-modal', '.message-notification'
].join(', ');
const { onPointerDown: onSigmaDragPointerDown } = useSigmaWindowDrag(SETTINGS_NO_DRAG_SELECTOR);

// 收起后回到播放器视图，显示主界面收起的样式。
// - 拖到右边缘收起：dock 持续 → 300ms 后切换（带 0.3s 淡出过渡）
// - RSHIFT 隐藏/弹出：dock(true) 后紧接着 dock(false) → 直接瞬时切到主界面（无过渡），
//   这样弹出时看到的就是主界面自己的滑出动画
const skipViewTransition = ref(false);
let dockSwitchTimer = null;
const switchToPlayer = (instant) => {
  if (view.value === 'player') return;
  skipViewTransition.value = instant;
  view.value = 'player';
  // 用 setTimeout 而不是 rAF：窗口隐藏时 rAF 不触发，标志位会一直留着
  setTimeout(() => { skipViewTransition.value = false; }, 0);
};
const onSigmaDockChanged = (_event, docked) => {
  if (docked) {
    if (view.value === 'player' || dockSwitchTimer) return;
    dockSwitchTimer = setTimeout(() => {
      dockSwitchTimer = null;
      switchToPlayer(false);
    }, 300);
    return;
  }
  // dock(false)：RSHIFT 弹出会走「瞬时 dock(true) → dock(false)」，取消延迟并瞬时切换
  if (dockSwitchTimer) {
    clearTimeout(dockSwitchTimer);
    dockSwitchTimer = null;
    switchToPlayer(true);
  }
};

// 新手教程（首次安装打开）：完成后写入标记
const ONBOARDING_DONE_KEY = 'jello-onboarding-done';
const onboardingStep = ref(1);
const onboardingTotal = ref(1);
const tutorialKey = ref(null);
const tutorialReturnView = ref(null);

const onKeybindSelect = (payload) => {
  tutorialKey.value = payload;
  console.log('[Onboarding] 选中按键:', payload);
};

// 设置页「重新观看教程」：记住来源视图，完成后返回
const openTutorial = () => {
  tutorialReturnView.value = view.value;
  view.value = 'onboarding';
};

const finishOnboarding = () => {
  localStorage.setItem(ONBOARDING_DONE_KEY, '1');
  if (tutorialReturnView.value) {
    view.value = tutorialReturnView.value;
    tutorialReturnView.value = null;
    return;
  }
  view.value = MoeAuth.isAuthenticated ? 'player' : 'login';
};

// 教程期间挂起 RSHIFT 热键（避免在教程里按 Shift 时把窗口收起）
watch(view, (next) => {
  window.electron?.ipcRenderer?.send('sigma-hotkey-suspend', next === 'onboarding');
}, { immediate: true });

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
  window.electron?.ipcRenderer?.on('sigma-dock-changed', onSigmaDockChanged);
  // 启动时带 --settings（跳转列表任务）且 Sigma 窗口未就绪：主进程记为 pending，这里领取
  window.electron?.ipcRenderer?.invoke?.('consume-pending-settings').then((pending) => {
    if (pending) view.value = 'settings';
  }).catch(() => {});
  // 首次安装：先进新手教程；否则未登录进登录页
  if (localStorage.getItem(ONBOARDING_DONE_KEY) !== '1') {
    view.value = 'onboarding';
  } else if (!MoeAuth.isAuthenticated) {
    view.value = 'login';
  }
});

onBeforeUnmount(() => {
  window.electron?.ipcRenderer?.removeListener('open-settings', onOpenSettings);
  window.removeEventListener('settings-change', onSettingsChange);
  window.electron?.ipcRenderer?.removeListener('sigma-dock-changed', onSigmaDockChanged);
  if (dockSwitchTimer) {
    clearTimeout(dockSwitchTimer);
    dockSwitchTimer = null;
  }
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

/* 设置/登录浮层淡出：收起回主界面时主界面瞬时出现，浮层渐隐（0.3s） */
.sigma-view-fade-leave-active {
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.sigma-view-fade-leave-to {
  opacity: 0;
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

/* 新手教程：原版 KeyboardScreen 的 DEEP_TEAL 25% 覆盖 + 背景模糊 */
.sigma-view--onboarding {
  align-items: center;
  justify-content: center;
  background: rgba(1, 1, 1, 0.25);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}

.onboarding-footer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}

.onboarding-step {
  font-family: 'JelloLight', sans-serif;
  font-size: 14px;
  color: rgba(254, 254, 254, 0.6);
}

.onboarding-next {
  height: 34px;
  padding: 0 22px;
  border: none;
  border-radius: 8px;
  background: #f0f0f0;
  color: rgba(1, 1, 1, 0.7);
  font-family: 'JelloLight', sans-serif;
  font-size: 15px;
  cursor: pointer;
  transition: transform 0.1s linear, background 0.1s linear;
}

.onboarding-next:hover {
  background: #fefefe;
  transform: translateY(-2px);
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
