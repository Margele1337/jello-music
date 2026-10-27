<template>
  <div class="sigma-volume-slider" ref="root" @mousedown="onDown" @wheel.prevent="onWheel">
    <div class="sigma-volume-dark" :style="{ height: ((1 - value) * 100) + '%' }"></div>
    <div class="sigma-volume-fill" :style="{ height: (value * 100) + '%' }"></div>
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/impl/jello/ingame/clickgui/musicplayer/elements/VolumeSlider.java
// 顶部 #010101 @0.2（未填充），底部 #fefefe @0.2（已填充）；向上拖为增大音量
import { ref } from 'vue';

const props = defineProps({
  value: { type: Number, default: 1 }
});

const emit = defineEmits(['change']);

const root = ref(null);
let dragging = false;

const emitChange = (clientY) => {
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1 - (clientY - rect.top) / rect.height, 1));
  emit('change', ratio);
};

const onMove = (event) => {
  if (dragging) emitChange(event.clientY);
};

const onUp = () => {
  dragging = false;
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', onUp);
};

const onDown = (event) => {
  dragging = true;
  emitChange(event.clientY);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};

const onWheel = (event) => {
  const delta = event.deltaY > 0 ? -0.05 : 0.05;
  emit('change', Math.max(0, Math.min(props.value + delta, 1)));
};
</script>

<style scoped>
.sigma-volume-slider {
  position: absolute;
  overflow: hidden;
  cursor: pointer;
  background: rgba(1, 1, 1, 0.2);
}

.sigma-volume-dark {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  background: rgba(1, 1, 1, 0.2);
}

.sigma-volume-fill {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  background: rgba(254, 254, 254, 0.2);
  transition: height 0.1s linear;
}
</style>
