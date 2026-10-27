<script setup>
import { onMounted, ref } from 'vue';

const version = ref('web');

onMounted(async () => {
  version.value = (await window.jello?.getVersion?.()) || 'web';
});
</script>

<template>
  <main class="shell">
    <p class="eyebrow">JELLO MUSIC · CLEAN-ROOM/MIT</p>
    <h1>jello <b>music</b></h1>
    <p class="lead">Independent clean-room desktop client. No MoeKoe/GPL code in this repository.</p>
    <dl class="status">
      <div><dt>Version</dt><dd>{{ version }}</dd></div>
      <div><dt>Renderer</dt><dd>Vue 3 + Vite</dd></div>
      <div><dt>Shell</dt><dd>Electron 45 · webSecurity on</dd></div>
      <div><dt>API</dt><dd>KuGouMusicApi sidecar (planned)</dd></div>
    </dl>
  </main>
</template>
