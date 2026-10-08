<template>
    <div id="app" :class="[riseClass, blurClass]">
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
import { applyColorTheme, applyCustomFont } from '@/utils/utils';
import logoImageSrc from '@/assets/images/tray/tray-icon@2x.png?url';

const route = useRoute();
const isLyricsRoute = computed(() => route.path === '/lyrics' || route.path === '/spectrum-hud' || route.path === '/sigma' || route.path === '/keystrokes');
// 触发 useSigmaUI 初始化（主窗口启动时打开 Sigma 窗口）
useSigmaUI();

// 状态栏歌词逻辑
const statusBarLyricsRef = ref(null);
let cleanupStatusBarIPC = null;

// 强制浅色 + Rise 背景
document.documentElement.classList.remove('dark');
localStorage.setItem('theme', 'light');

// Rise 背景始终开启
const showRiseBackground = ref(true);

// 锁定磨砂玻璃
const blurStyle = ref('glass');
const blurRadius = ref('12');

const riseClass = computed(() => showRiseBackground.value ? 'rise-active' : '');
const blurClass = computed(() => showRiseBackground.value ? `blur-${blurStyle.value}` : '');

const applyBlurRadius = (val) => {
    blurRadius.value = val;
    document.documentElement.style.setProperty('--glass-blur', val + 'px');
};

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
    applyBlurRadius(settings.blurRadius || '12');
    applyRiseStyles(true);
    return settings;
};

const handleSettingsChange = (e) => {
    const settings = e.detail?.settings;
    if (settings) {
        showRiseBackground.value = true;
        applyBlurRadius(settings.blurRadius || '12');
        applyRiseStyles(true);
    }
};

onMounted(async () => {
    const settings = loadSettings();

    // 主题色/自定义字体（Sigma 窗口内的设置页依赖这些 CSS 变量）
    applyColorTheme(settings.themeColor);
    applyCustomFont(settings.font || '');

    const MoeAuth = MoeAuthStore();
    await MoeAuth.initDevice();

    // 初始化状态栏歌词
    cleanupStatusBarIPC = statusBarLyricsRef.value?.initStatusBar(logoImageSrc, settings);

    window.addEventListener('settings-change', handleSettingsChange);
    window.addEventListener('blur-radius-change', (e) => {
        applyBlurRadius(e.detail?.blurRadius || '12');
    });
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
/* ===== Rise 背景公共样式 ===== */
#app.rise-active ~ body,
body:has(#app.rise-active),
html:has(#app.rise-active) body {
    background: transparent !important;
    background-color: transparent !important;
}

/* ===== 磨砂玻璃 glass =====
   blurStyle 恒为 'glass'：App.vue 里没有任何地方给它赋值，也没有 blur-style-change
   的监听者（Settings.vue 的 applyBlurStyle 是 selectAction，但 settings.js 里没有
   对应项），所以只有这一套变量真正生效。原先的 acrylic / blur / clear 三套变量与
   全部 html.dark 变体永远不会匹配，已删除。
   下面保留的每个变量都有实际消费点：--glass-opacity 与 --glass-border 被
   src/utils/utils.js 拼进 --background-color / --border-color；其余由下方规则消费。 */
#app.blur-glass {
    --glass-opacity: 0.72;
    --glass-saturate: 1.0;
    --glass-brightness: 1.0;
    --glass-border: 0.30;
    --glass-input-opacity: 0.45;
    --glass-input-focus-opacity: 0.65;
}

/* 弹窗 - 液态玻璃 */
#app.rise-active .modal-content {
    background-color: transparent !important;
    backdrop-filter: blur(var(--glass-blur));
    -webkit-backdrop-filter: blur(var(--glass-blur));
    border: 1px solid rgba(255, 255, 255, var(--glass-border));
    border-radius: 14px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
}

/* 输入框（Settings / CustomModal / ExtensionManager 里的 type=text） */
#app.rise-active input[type="text"] {
    background-color: rgba(255, 255, 255, var(--glass-input-opacity)) !important;
    backdrop-filter: blur(calc(var(--glass-blur) * 0.5)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness));
    -webkit-backdrop-filter: blur(calc(var(--glass-blur) * 0.5)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness));
    border: 1px solid rgba(255, 255, 255, var(--glass-border));
    border-radius: 8px;
    transition: background-color 0.3s ease;
}

#app.rise-active input[type="text"]:focus {
    background-color: rgba(255, 255, 255, var(--glass-input-focus-opacity)) !important;
}
</style>

