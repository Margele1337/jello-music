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

onMounted(async () => {
  await Promise.all([settings.load(), auth.load()]);
  unsubscribeSettings = window.jello?.settings?.onChange?.((next) => settings.apply(next)) || null;
  unsubscribeAuth = auth.subscribe();
});

onBeforeUnmount(() => {
  unsubscribeSettings?.();
  unsubscribeAuth?.();
});
</script>
