<template>
  <RouterView />
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue';
import { useSettingsStore } from './stores/settings.js';

const settings = useSettingsStore();
let unsubscribe = null;

onMounted(async () => {
  await settings.load();
  unsubscribe = window.jello?.settings?.onChange?.((next) => settings.apply(next)) || null;
});

onBeforeUnmount(() => {
  unsubscribe?.();
});
</script>
