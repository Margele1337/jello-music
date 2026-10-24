<template>
  <div class="sigma-changing-button" :style="containerStyle" @click="$emit('click')">
    <canvas v-if="type === 0" ref="canvasRef" class="scb-canvas"></canvas>
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/button/types/ChangingButton.java
// 0=NO_REPEAT（顺序，雪碧图帧 0：空心箭头轮廓）
// 1=REPEAT（列表循环）/ 2=LOOP_CURRENT（单曲循环）/ 3=随机（魔改版新增）
// 原雪碧图帧 1/2 是「白色药丸底 + 镂空箭头」：27x20 尺寸下白底糊成一条白杠，
// 且两帧只差几个像素无法区分——改为与随机图标同风格的 Material 矢量轮廓
// （repeat / repeat_one），四种模式一眼可辨
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import repeatImg from '../../assets/sigma/music/repeat.png';

const props = defineProps({
  type: { type: Number, default: 1 }
});

defineEmits(['click']);

const canvasRef = ref(null);
let imgEl = null;

const svgIcon = (path) => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff">${path}</svg>`
)}")`;

const ICONS = {
  1: svgIcon('<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>'),                    // 列表循环 repeat
  2: svgIcon('<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/>'), // 单曲循环 repeat_one
  3: svgIcon('<path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>') // 随机 shuffle
};

const containerStyle = computed(() => {
  const icon = ICONS[props.type];
  if (icon) {
    return {
      backgroundImage: icon,
      backgroundPosition: 'center',
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat'
    };
  }
  return {};
});

const render = () => {
  if (props.type !== 0) return;
  const canvas = canvasRef.value;
  if (!canvas || !imgEl || !imgEl.complete || !imgEl.naturalWidth) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, w, h);
  const sw = imgEl.naturalWidth / 3;
  ctx.drawImage(imgEl, props.type * sw, 0, sw, imgEl.naturalHeight, 0, 0, w, h);
};

// post：type 从 3（SVG）切回 0-2 时 canvas 由 v-if 重建，pre-flush 会画在挂载前
watch(() => props.type, () => render(), { flush: 'post' });

const onResize = () => render();

onMounted(() => {
  imgEl = new Image();
  imgEl.onload = render;
  imgEl.src = repeatImg;
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  imgEl = null;
});
</script>

<style scoped>
.sigma-changing-button {
  position: absolute;
  width: 27px;
  height: 20px;
  opacity: 0.35;
  cursor: pointer;
}

.scb-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>
