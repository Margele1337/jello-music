<template>
  <RouterView />
</template>

<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useAuthStore } from './stores/auth.js';
import { usePlayerStore } from './stores/player.js';
import { useSettingsStore } from './stores/settings.js';

const settings = useSettingsStore();
const auth = useAuthStore();
const player = usePlayerStore();
let unsubscribeSettings = null;
let unsubscribeAuth = null;

watch(() => settings.quality, (next, previous) => {
  if (previous && next !== previous) player.reloadCurrent();
});

const isInteractive = (target) => (
  ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target?.tagName)
  || target?.isContentEditable
);

const onKeyDown = (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (isInteractive(event.target)) return;

  switch (event.code) {
    case 'Space':
      event.preventDefault();
      player.togglePlayPause();
      break;
    case 'ArrowLeft':
      event.preventDefault();
      player.seekBy(-5);
      break;
    case 'ArrowRight':
      event.preventDefault();
      player.seekBy(5);
      break;
    case 'ArrowUp':
      event.preventDefault();
      player.changeVolume(5);
      break;
    case 'ArrowDown':
      event.preventDefault();
      player.changeVolume(-5);
      break;
    default:
      break;
  }
};

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown);
  await Promise.all([settings.load(), auth.load()]);
  unsubscribeSettings = window.jello?.settings?.onChange?.((next) => settings.apply(next)) || null;
  unsubscribeAuth = auth.subscribe();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  unsubscribeSettings?.();
  unsubscribeAuth?.();
});
</script>
