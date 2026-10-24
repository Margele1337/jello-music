<template>
  <div class="sigma-changing-button" :style="containerStyle" @click="$emit('click')">
    <canvas v-if="type !== 3" ref="canvasRef" class="scb-canvas"></canvas>
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/button/types/ChangingButton.java
// repeat.png 为三态横向雪碧图：0=NO_REPEAT / 1=REPEAT / 2=LOOP_CURRENT，透明度 0.35
// type=3 为魔改版新增的「随机播放」图标（原版没有随机模式），用内联 SVG（矢量，无锯齿）
//
// 雪碧图用 canvas 按「最终物理分辨率」绘制（同 SigmaSmallImage）：pixelated 最近邻
// 在分数 DPI 下会产生 1px/2px 交替条纹（锯齿），高质量重采样到 ceil(css × dpr) 干净
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import repeatImg from '../../assets/sigma/music/repeat.png';

const props = defineProps({
  type: { type: Number, default: 1 }
});

defineEmits(['click']);

const canvasRef = ref(null);
let imgEl = null;

const RANDOM_ICON = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>'
)}")`;

const containerStyle = computed(() => {
  if (props.type === 3) {
    return {
      backgroundImage: RANDOM_ICON,
      backgroundPosition: 'center',
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat'
    };
  }
  return {};
});

const render = () => {
  if (props.type === 3) return;
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
