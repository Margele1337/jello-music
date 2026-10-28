<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import SigmaMusicPlayer from '../components/sigma/SigmaMusicPlayer.vue';
import SigmaHotkeyIntro from '../components/sigma/SigmaHotkeyIntro.vue';
import { usePlayerStore } from '../stores/player.js';
import { useSettingsStore } from '../stores/settings.js';
const router = useRouter();
const player = usePlayerStore();
const settings = useSettingsStore();

player.initialize();

watch(() => settings.volume, (value) => player.applyPersistedVolume(value));

const toggleSpectrum = () => {
  void settings.update({ spectrum: !settings.spectrum }).catch((error) => {
    console.error('[SigmaView] 频谱设置保存失败:', error?.message || error);
  });
};

const showHotkeyIntro = computed(() => settings.ready && !settings.hotkeyIntroSeen);

const finishHotkeyIntro = () => {
  void settings.update({ hotkeyIntroSeen: true }).catch(() => {});
};

const toast = ref('');
let toastTimer = null;

watch(() => player.error, (message) => {
  if (!message) return;
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
  }, 4000);
});

onBeforeUnmount(() => {
  clearTimeout(toastTimer);
  window.removeEventListener('jello:toast', onToastEvent);
});

const onToastEvent = (event) => {
  toast.value = String(event.detail || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
  }, 3000);
};

onMounted(() => {
  window.addEventListener('jello:toast', onToastEvent);
});
</script>

<template>
  <main class="sigma-page">
    <div class="sigma-stage">
      <div class="sigma-shell">
        <SigmaMusicPlayer
          :player="player"
          :spectrum-enabled="settings.spectrum"
          @request-login="router.push('/login')"
          @request-settings="router.push('/settings')"
          @request-lyrics="router.push('/lyrics')"
          @toggle-spectrum="toggleSpectrum"
        />
      </div>
      <div v-if="toast" class="sigma-toast">{{ toast }}</div>
      <Teleport to="body">
        <div v-if="showHotkeyIntro" class="hotkey-intro-overlay">
          <SigmaHotkeyIntro @select="finishHotkeyIntro" />
          <div class="hotkey-intro-footer">
            <button type="button" class="hotkey-intro-done" @click="finishHotkeyIntro">开始使用</button>
          </div>
        </div>
      </Teleport>
    </div>
  </main>
</template>

<style scoped>
.sigma-page {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  /* 无边框透明窗口：页面自身不再铺底色，桌面透出半透明面板（原版观感） */
  background: transparent;
}

.sigma-stage {
  width: 800px;
  height: 600px;
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
}

/* 面板自身唯一的背衬：alpha 对齐原版 ClickGuiScreen.draw:309 的 DEEP_TEAL 0.2×a 静息值 */
.sigma-shell {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: rgba(6, 8, 12, 0.2);
}

.sigma-toast {
  position: absolute;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  max-width: 420px;
  padding: 7px 14px;
  background: rgba(1, 1, 1, 0.72);
  color: rgba(254, 254, 254, 0.9);
  font-family: 'SigmaLight', sans-serif;
  font-size: 13px;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  z-index: 60;
}

.hotkey-intro-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(6, 8, 12, 0.85);
}

.hotkey-intro-footer {
  margin-top: 16px;
}

.hotkey-intro-done {
  height: 40px;
  padding: 0 32px;
  border: none;
  border-radius: 999px;
  background: #ff69b4;
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.hotkey-intro-done:hover {
  background: #ff8fc7;
}
</style>
