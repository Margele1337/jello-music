<template>
  <div class="sigma-changing-button" @click="$emit('click')">
    <canvas ref="canvasRef" class="scb-canvas"></canvas>
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/button/types/ChangingButton.java
// repeat.png 三态雪碧图（与原版逐字节一致）：0=NO_REPEAT 顺序播放（空心双箭头）、
// 1=REPEAT 列表循环（白药丸+镂空箭头）、2=LOOP_CURRENT 单曲循环（+1 记号）。
// 原版 draw() 用 LIGHT_GREYISH_BLUE(0xFFFEFEFE，即白) @0.35 着色 —— 由容器
// opacity 0.35 等价实现。
// type=3 随机播放为魔改版新增（原版无此模式），按雪碧图的像素语言手绘：
// 交叉双箭头 + 实心箭头头 + 尾钩，2px 笔触与帧 0 同款。
// 雪碧图/像素图都用 canvas 按「最终物理分辨率」绘制（同 SigmaSmallImage）：
// pixelated 最近邻在分数 DPI 下会产生 1px/2px 交替条纹（锯齿）。
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import repeatImg from '../../assets/sigma/music/repeat.png';

const props = defineProps({
  type: { type: Number, default: 1 }
});

defineEmits(['click']);

const canvasRef = ref(null);
let imgEl = null;

// 随机播放像素图（27x20，# = 白色格）：右上/右下实心箭头头，左上/左下尾钩
const RANDOM_GRID = [
  '                           ',
  '                  ###      ',
  '  ##             #####     ',
  '  ## #           #####     ',
  '     ##         # ###      ',
  '      ##       ##          ',
  '       ##     ##           ',
  '        ##   ##            ',
  '        ##  ##             ',
  '          ###              ',
  '          ###              ',
  '         ## ##             ',
  '        ##   ##            ',
  '       ##     ##           ',
  '      ##       ##          ',
  '     ##         # ###      ',
  '  ## #           #####     ',
  '  ##             #####     ',
  '                  ###      ',
  '                           '
];

const drawRandom = (ctx, w, h) => {
  const cw = w / 27;
  const ch = h / 20;
  ctx.fillStyle = '#fff';
  for (let y = 0; y < RANDOM_GRID.length; y++) {
    const row = RANDOM_GRID[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') {
        ctx.fillRect(x * cw, y * ch, Math.ceil(cw), Math.ceil(ch));
      }
    }
  }
};

const render = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
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
  ctx.clearRect(0, 0, w, h);

  if (props.type === 3) {
    drawRandom(ctx, w, h);
    return;
  }
  if (!imgEl || !imgEl.complete || !imgEl.naturalWidth) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const sw = imgEl.naturalWidth / 3;
  ctx.drawImage(imgEl, props.type * sw, 0, sw, imgEl.naturalHeight, 0, 0, w, h);
};

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
