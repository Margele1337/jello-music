<script setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import SigmaMusicPlayer from '../components/sigma/SigmaMusicPlayer.vue';
import { usePlayerStore } from '../stores/player.js';
import { useSettingsStore } from '../stores/settings.js';

const router = useRouter();
const player = usePlayerStore();
const settings = useSettingsStore();

player.initialize();

watch(() => settings.volume, (value) => player.applyPersistedVolume(value));

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
      <SigmaMusicPlayer
        :player="player"
        @request-login="router.push('/login')"
        @request-settings="router.push('/settings')"
      />
      <div v-if="toast" class="sigma-toast">{{ toast }}</div>
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
</style>
