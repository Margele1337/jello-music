<template>
  <canvas ref="canvasRef" class="sigma-text" :style="canvasStyle"></canvas>
</template>

<script setup>
// Java2D 图集文本（对应 sigmarebase 的 Slick TrueTypeFont 渲染）
// 逐字形 1:1 贴图、不经过浏览器排版，英文/数字与原版逐像素一致（±1 混合取整）
import { computed, onMounted, ref, watch } from 'vue';
import { loadSigmaAtlas, measureSigmaText, drawSigmaText } from '../../utils/sigmaFontAtlas';

const props = defineProps({
  text: { type: String, default: '' },
  size: { type: Number, default: 14 },
  // 布局盒子（对应原 CSS 盒子的宽/高）：用于居中/右对齐、裁切与垂直对齐
  boxWidth: { type: Number, default: 0 },
  boxHeight: { type: Number, default: 0 },
  align: { type: String, default: 'left' },
  color: { type: String, default: '#fefefe' },
  alpha: { type: Number, default: 1 }
});

const canvasRef = ref(null);
const atlas = ref(null);
const lineHeight = computed(() => (atlas.value ? atlas.value.lineHeight : props.size));

const canvasStyle = computed(() => ({
  width: props.boxWidth ? props.boxWidth + 'px' : 'auto',
  height: (props.boxHeight || lineHeight.value) + 'px'
}));

const render = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const a = atlas.value;
  const cssW = props.boxWidth || (a ? measureSigmaText(a, props.text) : 1);
  const cssH = props.boxHeight || (a ? a.lineHeight : props.size);
  canvas.width = Math.max(1, Math.round(cssW));
  canvas.height = Math.max(1, Math.round(cssH));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!a || !props.text) return;
  const textWidth = measureSigmaText(a, props.text);
  let x = 0;
  if (props.align === 'center') x = Math.floor((cssW - textWidth) / 2);
  else if (props.align === 'right') x = cssW - textWidth;
  // 半行距：让字形在盒子里的垂直位置与原 CSS 文本一致
  const y = Math.floor((cssH - a.lineHeight) / 2);
  drawSigmaText(ctx, a, props.text, x, y, props.alpha, props.color);
};

onMounted(async () => {
  try {
    atlas.value = await loadSigmaAtlas(props.size);
  } catch (error) {
    console.error('[SigmaText] 字体图集加载失败:', error);
  }
  render();
});

watch(() => [props.text, props.size, props.boxWidth, props.boxHeight, props.align, props.color, props.alpha], render);
watch(atlas, render);
</script>

<style scoped>
.sigma-text {
  display: block;
  image-rendering: pixelated;
  pointer-events: none;
}
</style>
