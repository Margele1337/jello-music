<template>
  <canvas ref="canvasRef" class="sigma-text" :style="canvasStyle"></canvas>
</template>

<script setup>
// Java2D 图集文本（对应 sigmarebase 的 Slick TrueTypeFont 渲染）
// 逐字形 1:1 贴图、不经过浏览器排版，英文/数字与原版逐像素一致（±1 混合取整）
// scroll=true 时复刻 MusicPlayer.method13192 的跑马灯：8500ms 周期、前 40% 静止、
// QuadraticEasing.easeInOutQuad 缓动，滑出副本按 (1 - t*0.75) 淡出，后方跟一份全亮副本。
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { loadSigmaAtlas, measureSigmaText, truncateSigmaText, drawSigmaText } from '../../utils/sigmaFontAtlas';

const MARQUEE_CYCLE_MS = 8500;
const MARQUEE_EXTRA_SHIFT = 50;
const MARQUEE_FADE = 0.75;

const props = defineProps({
  text: { type: String, default: '' },
  size: { type: Number, default: 14 },
  // 字体族：light = helvetica-neue-light（原版 JelloLightFont*）
  //        sans  = Java 逻辑字体（原版 getChineseFont，缩略图卡片）
  family: { type: String, default: 'light' },
  // 布局盒子（对应原 CSS 盒子的宽/高）：用于居中/右对齐、裁切与垂直对齐
  boxWidth: { type: Number, default: 0 },
  boxHeight: { type: Number, default: 0 },
  // fluid：宽度跟随父容器（百分比 + ResizeObserver），用于宽度不固定的列表项
  fluid: { type: Boolean, default: false },
  // truncate：超宽时省略号截断（对应 CSS text-overflow: ellipsis）
  truncate: { type: Boolean, default: false },
  align: { type: String, default: 'left' },
  color: { type: String, default: '#fefefe' },
  alpha: { type: Number, default: 1 },
  // 跑马灯（原版 method13194：长标题滚动）
  scroll: { type: Boolean, default: false },
  phase: { type: Number, default: 0 }
});

const canvasRef = ref(null);
const atlas = ref(null);
const measuredWidth = ref(0);
const lineHeight = computed(() => (atlas.value ? atlas.value.lineHeight : props.size));
// 缺字（中文）走浏览器度量时需要临时 context
const measureCtx = document.createElement('canvas').getContext('2d');

const canvasStyle = computed(() => ({
  width: props.fluid ? '100%' : (props.boxWidth ? props.boxWidth + 'px' : 'auto'),
  height: (props.boxHeight || lineHeight.value) + 'px'
}));

// 有效盒宽：显式 boxWidth 优先，其次 fluid 测量值
const effectiveWidth = () => props.boxWidth || measuredWidth.value || 0;

let rafId = null;
let resizeObserver = null;

const stopMarquee = () => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
};

// QuadraticEasing.easeInOutQuad(progress, 0, 1, 1)
const easeInOutQuad = (t, b = 0, c = 1, d = 1) => {
  let ratio = t / (d / 2);
  if (ratio < 1) return (c / 2) * ratio * ratio + b;
  ratio -= 1;
  return (-c / 2) * (ratio * (ratio - 2) - 1) + b;
};

const displayText = (atlasValue, width) => {
  if (!props.truncate || !atlasValue || width <= 0) return props.text;
  return truncateSigmaText(atlasValue, props.text, width, measureCtx);
};

const prepareCanvas = (width, height) => {
  const canvas = canvasRef.value;
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return ctx;
};

const renderStatic = (ctx, atlasValue, cssW, cssH, text) => {
  const textWidth = measureSigmaText(atlasValue, text, measureCtx);
  let x = 0;
  if (props.align === 'center') x = Math.floor((cssW - textWidth) / 2);
  else if (props.align === 'right') x = cssW - textWidth;
  // 半行距：让字形在盒子里的垂直位置与原 CSS 文本一致
  const y = Math.floor((cssH - atlasValue.lineHeight) / 2);
  drawSigmaText(ctx, atlasValue, text, x, y, props.alpha, props.color);
};

const renderMarqueeFrame = () => {
  const a = atlas.value;
  const canvas = canvasRef.value;
  if (!a || !canvas) return;
  const cssW = effectiveWidth();
  const cssH = props.boxHeight || a.lineHeight;
  const text = displayText(a, cssW);
  const textWidth = measureSigmaText(a, text, measureCtx);
  const y = Math.floor((cssH - a.lineHeight) / 2);
  const ctx = prepareCanvas(cssW, cssH);

  let progress = (((Date.now() + props.phase) % MARQUEE_CYCLE_MS) + MARQUEE_CYCLE_MS) % MARQUEE_CYCLE_MS;
  progress /= MARQUEE_CYCLE_MS;
  if (progress < 0.4) progress = 0;
  else progress = (progress - 0.4) * (1 / 0.6);
  const eased = easeInOutQuad(progress, 0, 1, 1);

  const visible = Math.min(cssW, textWidth);
  const baseX = Math.floor((cssW - visible) / 2);
  const shift = textWidth * eased;
  // 主副本：随缓动左移，按 (1 - t*0.75) 淡出
  drawSigmaText(ctx, a, text, baseX - shift - MARQUEE_EXTRA_SHIFT * eased, y,
    props.alpha * Math.min(1, Math.max(0, 1 - eased * MARQUEE_FADE)), props.color);
  // 跟随副本：从右侧进入，全亮
  if (eased > 0) {
    drawSigmaText(ctx, a, text, baseX - shift + textWidth, y, props.alpha, props.color);
  }
  rafId = requestAnimationFrame(renderMarqueeFrame);
};

const render = () => {
  stopMarquee();
  const canvas = canvasRef.value;
  if (!canvas) return;
  const a = atlas.value;
  const boxW = effectiveWidth();
  if (!a) {
    prepareCanvas(boxW || 1, props.boxHeight || props.size);
    return;
  }
  const text = displayText(a, boxW);
  const cssW = boxW || measureSigmaText(a, text, measureCtx);
  const cssH = props.boxHeight || a.lineHeight;
  const textWidth = measureSigmaText(a, text, measureCtx);
  // 只有超宽才滚动（原版：var10 <= var3 时 var9 = 0）
  if (props.scroll && !props.truncate && boxW > 0 && textWidth > boxW) {
    renderMarqueeFrame();
    return;
  }
  const ctx = prepareCanvas(cssW, cssH);
  renderStatic(ctx, a, cssW, cssH, text);
};

const loadAtlas = async () => {
  try {
    atlas.value = await loadSigmaAtlas(props.size, props.family);
  } catch (error) {
    console.error('[SigmaText] 字体图集加载失败:', error);
  }
  render();
};

onMounted(async () => {
  if (props.fluid && typeof ResizeObserver !== 'undefined' && canvasRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect?.width || 0);
      if (width > 0 && width !== measuredWidth.value) {
        measuredWidth.value = width;
        render();
      }
    });
    resizeObserver.observe(canvasRef.value);
  }
  await loadAtlas();
});

watch(
  () => [props.text, props.size, props.boxWidth, props.boxHeight, props.align, props.color, props.alpha, props.scroll, props.phase, props.truncate, props.fluid, props.family],
  render
);
watch(() => [props.size, props.family], (next, prev) => {
  if (prev && (next[0] !== prev[0] || next[1] !== prev[1])) loadAtlas();
});
watch(atlas, render);
onBeforeUnmount(() => {
  stopMarquee();
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.sigma-text {
  display: block;
  image-rendering: pixelated;
  pointer-events: none;
}
</style>
