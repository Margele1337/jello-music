<template>
  <SigmaUI :player="player" />
</template>

<script setup>
// Sigma 独立透明窗口：窗口 800x600、透明，背景直接透到应用后面
import SigmaUI from '@/components/SigmaUI.vue';
import { useSigmaRemotePlayer } from '@/composables/useSigmaRemotePlayer';

const player = useSigmaRemotePlayer();
</script>
