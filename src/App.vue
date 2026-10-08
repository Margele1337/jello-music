<template>
    <!-- 根节点不带 id：index.html 里的 <div id="app"> 才是 Vue 挂载点，
         两者都用 id="app" 会让页面出现重复 id，document.querySelector('#app')
         拿到的是没有 class 的外层挂载点。CSS 改用 .rise-active / .blur-glass 选择。 -->
    <div :class="[riseClass, blurClass]">
        <RouterView />
        <StatusBarLyrics v-if="!isLyricsRoute" ref="statusBarLyricsRef" />
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import StatusBarLyrics from '@/components/StatusBarLyrics.vue';
import { useSigmaUI } from '@/composables/useSigmaUI';
import { MoeAuthStore } from '@/stores/store';
import { applyCustomFont } from '@/utils/utils';
import logoImageSrc from '@/assets/images/tray/tray-icon@2x.png?url';

const route = useRoute();
const isLyricsRoute = computed(() => route.path === '/lyrics' || route.path === '/spectrum-hud' || route.path === '/sigma' || route.path === '/keystrokes');
// 触发 useSigmaUI 初始化（主窗口启动时打开 Sigma 窗口）
useSigmaUI();

// 状态栏歌词逻辑
const statusBarLyricsRef = ref(null);
let cleanupStatusBarIPC = null;

// 强制浅色：深色模式已移除（setTheme 是唯一的 dark 类写入点，已随之删除），
// 这里显式清掉历史遗留的 class，避免旧版本残留样式影响当前渲染。
document.documentElement.classList.remove('dark');

// Rise 背景始终开启
const showRiseBackground = ref(true);

// 锁定磨砂玻璃
const blurStyle = ref('glass');

const riseClass = computed(() => showRiseBackground.value ? 'rise-active' : '');
const blurClass = computed(() => showRiseBackground.value ? `blur-${blurStyle.value}` : '');


const applyRiseStyles = (active) => {
    if (active) {
        document.body.style.backgroundColor = 'transparent';
    } else {
        document.body.style.backgroundColor = '';
    }
};

const loadSettings = () => {
    const settings = JSON.parse(localStorage.getItem('settings')) || {};
    showRiseBackground.value = true;
    applyRiseStyles(true);
    return settings;
};

const handleSettingsChange = (e) => {
    const settings = e.detail?.settings;
    if (settings) {
        showRiseBackground.value = true;
        applyRiseStyles(true);
    }
};

onMounted(async () => {
    const settings = loadSettings();
    // 自定义字体（Sigma 窗口内的设置页依赖该 CSS 变量）
    applyCustomFont(settings.font || '');

    const MoeAuth = MoeAuthStore();
    await MoeAuth.initDevice();

    // 初始化状态栏歌词
    cleanupStatusBarIPC = statusBarLyricsRef.value?.initStatusBar(logoImageSrc, settings);

    window.addEventListener('settings-change', handleSettingsChange);
});

onUnmounted(() => {
    statusBarLyricsRef.value?.cleanupStatusBar();
    cleanupStatusBarIPC?.();
    window.removeEventListener('settings-change', handleSettingsChange);
});
</script>

<style scoped>
.container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 20px;
}

.rise-back-btn {
    position: fixed;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 50;
    width: 48px;
    height: 80px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.45);
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: color 0.2s;
    padding: 0;
    text-shadow: 0 0 6px rgba(0, 0, 0, 0.3);
}

.rise-back-btn:hover {
    color: rgba(255, 255, 255, 0.85);
}
</style>

<style>
/* ===== Rise 背景公共样式 =====
   只用 :has() 两条：根节点是 body 的子元素，.rise-active ~ body 这种兄弟
   选择器永远匹配不到，已删除。 */
body:has(.rise-active),
html:has(.rise-active) body {
    background: transparent !important;
    background-color: transparent !important;
}

/* ===== 磨砂玻璃 glass =====
   blurStyle 恒为 'glass'，原先的 acrylic / blur / clear 三套变量与全部 html.dark
   变体已随不可达的设置项一并删除。
   下面保留的每个变量都有实际消费点：--glass-opacity 与 --glass-border 被
   src/utils/utils.js 拼进 --background-color / --border-color；其余由下方规则消费。 */
.blur-glass {
    --glass-opacity: 0.72;
    --glass-saturate: 1.0;
    --glass-brightness: 1.0;
    --glass-border: 0.30;
    --glass-input-opacity: 0.45;
    --glass-input-focus-opacity: 0.65;
}

/* 弹窗 - 液态玻璃 */
.rise-active .modal-content {
    background-color: transparent !important;
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid rgba(255, 255, 255, var(--glass-border));
    border-radius: 14px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}

/* 输入框（Settings / CustomModal 里的 type=text） */
.rise-active input[type="text"] {
    background-color: rgba(255, 255, 255, var(--glass-input-opacity)) !important;
    backdrop-filter: blur(calc(var(--glass-blur) * 0.5)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness));
    -webkit-backdrop-filter: blur(calc(var(--glass-blur) * 0.5)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness));
    border: 1px solid rgba(255, 255, 255, var(--glass-border));
    border-radius: 8px;
    transition: background-color 0.3s ease;
}

.rise-active input[type="text"]:focus {
    background-color: rgba(255, 255, 255, var(--glass-input-focus-opacity)) !important;
}
</style>

