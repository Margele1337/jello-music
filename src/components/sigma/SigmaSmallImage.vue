<template>
  <canvas ref="canvasRef" class="sigma-small-image" :title="alt" @click="$emit('click')"></canvas>
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/image/types/SmallImage.java
// 图标按钮：恒 100% 不透明（原版按钮 alpha 来自颜色自身），悬停仅轻微变暗
//
// 用 canvas 按「最终物理分辨率」绘制而不是 <img>：
// image-rendering: pixelated（最近邻）在 100% DPI 是 1:1 完美锐利，但在 150%/125%
// 这类分数缩放下，源像素会被缩成 1px/2px 交替的条纹——控制按钮锯齿的来源。
// canvas 在 ceil(css × dpr) 背板上一次高质量重采样，两种 DPI 都干净。
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';

const props = defineProps({
  src: { type: String, required: true },
  alt: { type: String, default: '' }
});

defineEmits(['click']);

const canvasRef = ref(null);
let imgEl = null;

const render = () => {
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
  ctx.drawImage(imgEl, 0, 0, w, h);
};

const loadSrc = (src) => {
  imgEl = new Image();
  imgEl.onload = render;
  imgEl.src = src;
};

watch(() => props.src, (src) => loadSrc(src));

// 跨显示器拖动后 dpr 变化会触发 resize，重绘到新物理分辨率
const onResize = () => render();

onMounted(() => {
  loadSrc(props.src);
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  imgEl = null;
});
</script>

<style scoped>
.sigma-small-image {
  position: absolute;
  display: block;
  opacity: 1;
  cursor: pointer;
  transition: filter 0.12s ease;
  -webkit-user-drag: none;
}

.sigma-small-image:hover {
  filter: brightness(0.94);
}
</style>
