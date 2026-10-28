<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
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

onBeforeUnmount(() => clearTimeout(toastTimer));
</script>

<template>
  <main class="sigma-page">
    <div class="sigma-stage">
      <div class="sigma-shell" :class="{ 'sigma-shell--docked': player.docked }">
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
  background: radial-gradient(120% 120% at 25% 0%, #2a2233 0%, #17121d 55%, #0e0c12 100%);
}

.sigma-stage {
  width: 800px;
  height: 600px;
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
}

/* 呼出时播 elastic reveal 动画（原版 ClickGuiScreen.draw 1:1 复刻） */
.sigma-shell {
  width: 100%;
  height: 100%;
  overflow: hidden;
  animation: sigma-shell-reveal 450ms linear both;
  transform-origin: 50% 50%;
}

.sigma-shell--docked {
  animation: none;
}

@keyframes sigma-shell-reveal {
  0% { transform: scale(1.25); opacity: 0.5; }
  3.85% { transform: scale(1.1828); opacity: 0.6343; }
  7.69% { transform: scale(1.1207); opacity: 0.7586; }
  11.54% { transform: scale(1.0693); opacity: 0.8614; }
  15.38% { transform: scale(1.0305); opacity: 0.939; }
  19.23% { transform: scale(1.004); opacity: 0.992; }
  23.08% { transform: scale(0.9879); opacity: 1; }
  26.92% { transform: scale(0.98); opacity: 1; }
  30.77% { transform: scale(0.9778); opacity: 1; }
  34.62% { transform: scale(0.9793); opacity: 1; }
  38.46% { transform: scale(0.9827); opacity: 1; }
  42.31% { transform: scale(0.9869); opacity: 1; }
  46.15% { transform: scale(0.991); opacity: 1; }
  50% { transform: scale(0.9945); opacity: 1; }
  53.85% { transform: scale(0.9972); opacity: 1; }
  57.69% { transform: scale(0.9992); opacity: 1; }
  61.54% { transform: scale(1.0004); opacity: 0.9992; }
  65.38% { transform: scale(1.0011); opacity: 0.9978; }
  69.23% { transform: scale(1.0014); opacity: 0.9973; }
  73.08% { transform: scale(1.0014); opacity: 0.9973; }
  76.92% { transform: scale(1.0012); opacity: 0.9977; }
  80.77% { transform: scale(1.0009); opacity: 0.9982; }
  84.62% { transform: scale(1.0007); opacity: 0.9987; }
  88.46% { transform: scale(1.0004); opacity: 0.9991; }
  92.31% { transform: scale(1.0002); opacity: 0.9995; }
  96.15% { transform: scale(1.0001); opacity: 0.9998; }
  100% { transform: scale(1); opacity: 1; }
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
