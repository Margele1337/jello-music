<script setup>
import { computed } from 'vue';
import { useSettingsStore } from '../stores/settings.js';

const settings = useSettingsStore();

const quality = computed({
  get: () => settings.quality,
  set: (value) => settings.update({ quality: value })
});

const dataSource = computed({
  get: () => settings.dataSource,
  set: (value) => settings.update({ dataSource: value })
});

const minimizeToTray = computed({
  get: () => settings.minimizeToTray,
  set: (value) => settings.update({ minimizeToTray: Boolean(value) })
});
</script>

<template>
  <main class="shell">
    <p class="eyebrow">JELLO MUSIC · CLEAN-ROOM/MIT</p>
    <h1>jello <b>music</b></h1>
    <p class="lead">
      Architecture foundation: one secure window, main-owned settings and API,
      narrow IPC, Pinia renderer stores. Sigma UI comes next.
    </p>

    <section class="status">
      <div><dt>Renderer</dt><dd>Vue 3 · Pinia · Router</dd></div>
      <div><dt>Main</dt><dd>Electron 45 · trusted IPC</dd></div>
      <div><dt>Settings</dt><dd>electron-store · single source</dd></div>
      <div><dt>API</dt><dd>main proxy · sidecar pending</dd></div>
    </section>

    <section class="panel">
      <h2>Settings smoke test</h2>
      <label>
        <span>Quality</span>
        <select v-model="quality">
          <option value="128">128</option>
          <option value="320">320</option>
          <option value="flac">FLAC</option>
        </select>
      </label>
      <label>
        <span>Data source</span>
        <select v-model="dataSource">
          <option value="concept">Concept</option>
          <option value="official">Official</option>
        </select>
      </label>
      <label class="check">
        <input v-model="minimizeToTray" type="checkbox" />
        <span>Minimize to tray</span>
      </label>
    </section>
  </main>
</template>
