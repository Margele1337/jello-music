<template>
  <RouterView />
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import { useAuthStore } from './stores/auth.js';
import { useSettingsStore } from './stores/settings.js';

const settings = useSettingsStore();
const auth = useAuthStore();
let unsubscribeSettings = null;
let unsubscribeAuth = null;

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
