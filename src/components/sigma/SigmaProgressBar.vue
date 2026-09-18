<template>
  <div class="sigma-progress-bar" ref="root" @mousedown="onDown">
    <div class="sigma-progress-track"></div>
    <div class="sigma-progress-remaining" :style="{ left: (percent * 100) + '%' }"></div>
    <div class="sigma-progress-played" :style="{ width: (percent * 100) + '%' }"></div>
    <img
      v-if="percent > 0"
      class="sigma-progress-knob"
      :src="shadowRightImg"
      :style="{ left: (percent * 100) + '%' }"
      alt=""
    />
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/impl/jello/ingame/clickgui/musicplayer/elements/ProgressBar.java
// 底 #999999 @0.075；未播 #010101 @0.43；已播 #fefefe；末端 shadow_right.png 5x5
import { ref } from 'vue';
import shadowRightImg from '../../assets/sigma/jello/shadow_right.png';

defineProps({
  percent: { type: Number, default: 0 }
});

const emit = defineEmits(['seek']);

const root = ref(null);
let dragging = false;

const emitSeek = (clientX) => {
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
  emit('seek', ratio);
};

const onMove = (event) => {
  if (dragging) emitSeek(event.clientX);
};

const onUp = () => {
  dragging = false;
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', onUp);
};

const onDown = (event) => {
  dragging = true;
  emitSeek(event.clientX);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};
</script>

<style scoped>
.sigma-progress-bar {
  position: absolute;
  cursor: pointer;
}

.sigma-progress-track {
  position: absolute;
  inset: 0;
  background: rgba(153, 153, 153, 0.075);
}

.sigma-progress-remaining {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  background: rgba(1, 1, 1, 0.43);
}

.sigma-progress-played {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: #fefefe;
}

.sigma-progress-knob {
  position: absolute;
  top: 0;
  width: 5px;
  height: 5px;
  margin-left: -5px;
  pointer-events: none;
}
</style>
