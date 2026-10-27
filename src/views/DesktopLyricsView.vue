<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

const state = ref({ title: '', artist: '', current: '', next: '', playing: false });
let unsubscribe = null;

onMounted(() => {
  unsubscribe = window.jelloLyrics?.onState?.((next) => {
    state.value = next || {};
  }) || null;
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
});
</script>

<template>
  <main class="desktop-lyrics" :class="{ paused: !state.playing }">
    <p class="line current">
      {{ state.current || (state.title ? `${state.title}${state.artist ? ' · ' + state.artist : ''}` : 'Jello Music') }}
    </p>
    <p v-if="state.next" class="line next">{{ state.next }}</p>
  </main>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  background: transparent !important;
  overflow: hidden;
}

.desktop-lyrics {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 24px;
  text-align: center;
  pointer-events: none;
  user-select: none;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
}

.line {
  width: 100%;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.95);
}

.current {
  color: #fff;
  font-size: 30px;
  font-weight: 600;
  line-height: 1.2;
}

.next {
  color: rgba(255, 255, 255, 0.55);
  font-size: 17px;
  line-height: 1.3;
}

.paused .current {
  color: rgba(255, 255, 255, 0.6);
}
</style>
