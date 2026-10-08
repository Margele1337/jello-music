<template>
  <div class="sigma-shell" :class="shellClass">
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
import { onBeforeUnmount, onMounted, ref, computed, watch } from 'vue';
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
  '.font-list', '.font-search', '.modal', '.message-container'
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

// 面板缩放动画（复刻 sigmarebase ClickGuiScreen.draw 的 scale 曲线，1.25 起、
// 弹性过冲到 0.978 再回 1.0）。
//
// 只在展开（dock=false）时播；收起态用 .sigma-shell--docked 的 animation:none，
// 不播任何缩放 —— 早期版本这里复用了 sigma-reveal，收起时会播一段 1.5 → 1，
// 表现为「收起状态下先抖一下再弹出来」，那是要避免的。
//
// 靠 class 交替自然重播：主进程 setSigmaDocked 在值未变时 early-return，
// 所以这里收到的 dock 事件必然是真·状态切换，CSS animation 每次都会重放。
// 不要加 :key 强制重建，那会销毁播放器子组件状态。
const sigmaDockedState = ref(false);
const shellClass = computed(() => (sigmaDockedState.value
  ? 'sigma-shell--docked'
  : 'sigma-shell--reveal'));

const onSigmaDockChangedForReveal = (_event, docked) => {
  sigmaDockedState.value = !!docked;
  onSigmaDockChanged(_event, docked);
};

onMounted(() => {
  window.electron?.ipcRenderer?.on('open-settings', onOpenSettings);
  window.addEventListener('settings-change', onSettingsChange);
  window.electron?.ipcRenderer?.on('sigma-dock-changed', onSigmaDockChangedForReveal);
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
  window.electron?.ipcRenderer?.removeListener('sigma-dock-changed', onSigmaDockChangedForReveal);
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
  /* 半透明深色底，让面板与桌面有层次。
     原先这里配合 DWM 亚克力层用（补一点冷色偏、避免叠色发灰），
     亚克力已删除，这层就是面板自身唯一的背衬。
     alpha 与原版 ClickGuiScreen.draw:309 的 DEEP_TEAL 0.2×a 静息值对齐。 */
  background: rgba(6, 8, 12, 0.2);
  /* 原版 ClickGuiScreen.draw:304-346 的面板动画，1:1 复刻：
     offset = (panelCenter - viewportCenter) × (1 - a) × 0.5   → Sigma 固定居中，恒为 0
     scale  = 1.5 - a × 0.5        （method13279 → glScalef，以自身中心为原点）
     a      = easeOutElastic(p)，p = t / 450ms（开）或 t / 125ms（关）
     底色 alpha = 0.16 × a         （原版 :315 背景 alpha = 0.2 × partialTicks × a）
     内容 alpha = min(1, a)        （原版 :346 super.draw(partialTicks × min(1, a) × fade)）

     缓动是 elastic 而非线性：a 会冲过 1 再回弹，所以 scale 先过冲到 ~0.978
     再回到 1.0。这一段过冲是原版观感的一部分，不能换成 cubic-bezier 抹平。

     打开与关闭用的 period 不同（见 @keyframes 注释），故拆成两组关键帧。 */
  animation: sigma-reveal 450ms linear both;
  transform-origin: 50% 50%;
  overflow: hidden;
}

/* 收起态：不给缩放动画。
   这里曾经复用 sigma-reveal（from: scale(1.5)），于是收起时会在屏幕最右侧
   先播一段 1.5 → 1 的缩小，之后再滑出 —— 就是那个「先在最右侧抖一下」。
   原版里缩放也只绑定 GUI 开/关，吸附走的是另一条分支、不碰 alphaFactor，
   scale 恒为 1。中间还短暂用过终点为 scale(1.5) 的 sigma-hide，
   配合 fill-mode both 会把面板永久钉在 1.5（触发条被放大、位置漂移）。 */
.sigma-shell--docked {
  animation: none;
}

/* 关键帧由原版公式离线采样 26 点生成：
   elastic(p,period) = 2^(-10p) × sin((p - period/4) × 2π / period) + 1
   （ClickGuiScreen.method13317:300）

   打开：a = elastic(p, 0.8) × 0.5 + 0.5
   → 起始 a=0.5 即 scale 1.25（不是 1.5），前 20% 就冲到 1.0 附近，
     随后 elastic 回弹在 0.978 ↔ 1.001 之间收敛，最后 40% 几乎静止。 */
@keyframes sigma-reveal {
  0% { transform: scale(1.25); background-color: rgba(6, 8, 12, 0.1); opacity: 0.5; }
  3.85% { transform: scale(1.1828); background-color: rgba(6, 8, 12, 0.1269); opacity: 0.6343; }
  7.69% { transform: scale(1.1207); background-color: rgba(6, 8, 12, 0.1517); opacity: 0.7586; }
  11.54% { transform: scale(1.0693); background-color: rgba(6, 8, 12, 0.1723); opacity: 0.8614; }
  15.38% { transform: scale(1.0305); background-color: rgba(6, 8, 12, 0.1878); opacity: 0.939; }
  19.23% { transform: scale(1.004); background-color: rgba(6, 8, 12, 0.1984); opacity: 0.992; }
  23.08% { transform: scale(0.9879); background-color: rgba(6, 8, 12, 0.2048); opacity: 1; }
  26.92% { transform: scale(0.98); background-color: rgba(6, 8, 12, 0.208); opacity: 1; }
  30.77% { transform: scale(0.9778); background-color: rgba(6, 8, 12, 0.2089); opacity: 1; }
  34.62% { transform: scale(0.9793); background-color: rgba(6, 8, 12, 0.2083); opacity: 1; }
  38.46% { transform: scale(0.9827); background-color: rgba(6, 8, 12, 0.2069); opacity: 1; }
  42.31% { transform: scale(0.9869); background-color: rgba(6, 8, 12, 0.2052); opacity: 1; }
  46.15% { transform: scale(0.991); background-color: rgba(6, 8, 12, 0.2036); opacity: 1; }
  50% { transform: scale(0.9945); background-color: rgba(6, 8, 12, 0.2022); opacity: 1; }
  53.85% { transform: scale(0.9972); background-color: rgba(6, 8, 12, 0.2011); opacity: 1; }
  57.69% { transform: scale(0.9992); background-color: rgba(6, 8, 12, 0.2003); opacity: 1; }
  61.54% { transform: scale(1.0004); background-color: rgba(6, 8, 12, 0.1998); opacity: 0.9992; }
  65.38% { transform: scale(1.0011); background-color: rgba(6, 8, 12, 0.1996); opacity: 0.9978; }
  69.23% { transform: scale(1.0014); background-color: rgba(6, 8, 12, 0.1995); opacity: 0.9973; }
  73.08% { transform: scale(1.0014); background-color: rgba(6, 8, 12, 0.1995); opacity: 0.9973; }
  76.92% { transform: scale(1.0012); background-color: rgba(6, 8, 12, 0.1995); opacity: 0.9977; }
  80.77% { transform: scale(1.0009); background-color: rgba(6, 8, 12, 0.1996); opacity: 0.9982; }
  84.62% { transform: scale(1.0007); background-color: rgba(6, 8, 12, 0.1997); opacity: 0.9987; }
  88.46% { transform: scale(1.0004); background-color: rgba(6, 8, 12, 0.1998); opacity: 0.9991; }
  92.31% { transform: scale(1.0002); background-color: rgba(6, 8, 12, 0.1999); opacity: 0.9995; }
  96.15% { transform: scale(1.0001); background-color: rgba(6, 8, 12, 0.2); opacity: 0.9998; }
  100% { transform: scale(1); background-color: rgba(6, 8, 12, 0.2); opacity: 1; }
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
