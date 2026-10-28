<template>
  <div class="spectrum-hud" :class="{ 'hud-editing': !locked }" :style="{ '--info-scale': infoScale }">
    <canvas ref="canvasRef" class="spectrum-canvas"></canvas>
    <div class="spectrum-info" v-show="infoVisible && (title || cover)">
      <img v-if="cover" class="cover" :src="cover" alt="" />
      <div class="meta" v-if="title">
        <div class="title">{{ title }}</div>
        <div class="author" v-if="author">{{ author }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
// 所有者原创频谱 HUD（sigmarebase MusicManager renderSpectrum）移植：
// 114 条灰色底条 + 模糊封面条叠加，左下角封面/歌名信息。
import { onBeforeUnmount, onMounted, ref } from 'vue';

const BAR_COUNT = 114;
const SPECTRUM_SMOOTHING = 0.335;
const REFERENCE_DISPLAY_HEIGHT = 1080;
const REFERENCE_GAME_HEIGHT = 1009;
const REFERENCE_BAR_RATIO = REFERENCE_GAME_HEIGHT / REFERENCE_DISPLAY_HEIGHT;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const detectDisplayScale = () => {
  const pixelHeight = (window.screen?.height || 0) * (window.devicePixelRatio || 1);
  return pixelHeight ? clamp(pixelHeight / REFERENCE_DISPLAY_HEIGHT, 0.5, 4) : 1;
};

let displayScale = detectDisplayScale();
const infoScale = ref(1.25);
const infoVisible = ref(true);
const locked = ref(true);

const canvasRef = ref(null);
const cover = ref('');
const title = ref('');
const author = ref('');

const levels = new Float32Array(BAR_COUNT);
const targets = new Float32Array(BAR_COUNT);
const heights = new Float32Array(BAR_COUNT);
const barStyles = new Array(BAR_COUNT);
for (let i = 0; i < BAR_COUNT; i += 1) {
  barStyles[i] = `rgba(153, 153, 153, ${(0.2 * (1 - (i + 1) / BAR_COUNT)).toFixed(4)})`;
}

let lastDrawTime = 0;
let raf = null;
let pendingSnap = false;
let spectrumScale = 1;
let spectrumSmoothing = SPECTRUM_SMOOTHING;

let coverImage = null;
let blurredCover = null;
let blurredCoverStrip = null;
let coverLoadToken = 0;

const bumpCoverUrl = (url) => (typeof url === 'string'
  ? url.replace('/150/', '/480/').replace('{size}', '480')
  : url);

const loadCover = (url) => {
  if (!url) {
    coverLoadToken += 1;
    coverImage = null;
    blurredCover = null;
    blurredCoverStrip = null;
    return;
  }
  if (url === coverImage?.src) return;

  const token = ++coverLoadToken;
  coverImage = null;
  blurredCover = null;
  blurredCoverStrip = null;

  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (token !== coverLoadToken) return;
    coverImage = image;
    try {
      const canvas = document.createElement('canvas');
      const width = 400;
      const height = Math.max(1, Math.round((width * image.naturalHeight) / image.naturalWidth));
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.filter = 'blur(15px)';
      ctx.drawImage(image, 0, 0, width, height);
      blurredCover = canvas;

      const stripHeight = Math.max(1, Math.round(height * 0.2));
      const strip = document.createElement('canvas');
      strip.width = width;
      strip.height = stripHeight;
      const stripCtx = strip.getContext('2d');
      stripCtx.drawImage(canvas, 0, Math.round(height * 0.75), width, stripHeight, 0, 0, width, stripHeight);
      blurredCoverStrip = strip;
    } catch {
      blurredCover = null;
      blurredCoverStrip = null;
    }
  };
  image.onerror = () => {
    if (token !== coverLoadToken) return;
    coverImage = null;
    blurredCover = null;
    blurredCoverStrip = null;
  };
  image.src = url;
};

const resizeCanvas = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
};

const draw = (now = performance.now()) => {
  raf = requestAnimationFrame(draw);
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const dt = lastDrawTime > 0 ? Math.min(now - lastDrawTime, 100) : 1000 / 60;
  lastDrawTime = now;

  const tauMs = 1000 / (Math.max(0.001, spectrumSmoothing) * 60);
  const alpha = Math.min(1, 1 - Math.exp(-dt / tauMs));
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const next = levels[i] + (targets[i] - levels[i]) * alpha;
    levels[i] = Number.isFinite(next) ? Math.max(0, Math.min(2.256e7, next)) : 0;
  }

  const barWidth = Math.ceil(width / BAR_COUNT);
  const sigmaAmp = REFERENCE_BAR_RATIO * displayScale * spectrumScale;
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const refHeight = Math.sqrt(levels[i]) / 12 - 5;
    heights[i] = Math.min(height, Math.max(0, refHeight) * sigmaAmp);
  }

  for (let i = 0; i < BAR_COUNT; i += 1) {
    const x = i * barWidth;
    if (x >= width) break;
    ctx.fillStyle = barStyles[i];
    ctx.fillRect(x, height - heights[i], barWidth, heights[i]);
  }

  const overlay = blurredCoverStrip || blurredCover;
  if (overlay) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < BAR_COUNT; i += 1) {
      const x = i * barWidth;
      if (x >= width) break;
      ctx.rect(x, height - heights[i], barWidth, heights[i]);
    }
    ctx.clip();
    ctx.globalAlpha = 0.4;
    ctx.drawImage(overlay, 0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
};

let playingState = false;

const applyPayload = (data) => {
  if (!data) return;

  const nowPlaying = data.playing === true;
  if (!nowPlaying) {
    playingState = false;
    levels.fill(0);
    targets.fill(0);
  } else {
    if (!playingState) pendingSnap = true;
    playingState = true;

    if (Array.isArray(data.levels) && data.levels.length) {
      const count = Math.min(BAR_COUNT, data.levels.length);
      for (let i = 0; i < count; i += 1) targets[i] = Number(data.levels[i]) || 0;
    }
    if (data.reset || pendingSnap) {
      levels.set(targets);
      pendingSnap = false;
    }
  }

  if (data.cover != null) {
    const url = bumpCoverUrl(data.cover);
    if (url !== cover.value) {
      cover.value = url;
      loadCover(url);
    }
  }
  if (data.title != null) title.value = data.title;
  if (data.author != null) author.value = data.author;
};

let unsubscribe = null;
let unsubscribeSettings = null;

const applySettings = (settings = {}) => {
  if (Number.isFinite(settings.scale)) displayScale = clamp(settings.scale, 0.5, 4);
  if (Number.isFinite(settings.spectrumScale)) spectrumScale = settings.spectrumScale;
  if (Number.isFinite(settings.spectrumSigmaSmoothing)) spectrumSmoothing = settings.spectrumSigmaSmoothing;
  if (Number.isFinite(settings.spectrumInfoScale)) infoScale.value = clamp(settings.spectrumInfoScale, 0.8, 2);
  if (settings.spectrumInfoVisible != null) infoVisible.value = settings.spectrumInfoVisible === true;
  if (settings.spectrumLocked != null) locked.value = settings.spectrumLocked === true;
};

const applyLockStyles = () => {
  if (locked.value) {
    document.body.style.setProperty('background', 'transparent', 'important');
  } else {
    document.body.style.setProperty('background', 'rgba(0, 0, 0, 0.25)', 'important');
  }
};

const handleDblClick = (event) => {
  if (event.target.closest('.spectrum-info')) return;
  locked.value = !locked.value;
  applyLockStyles();
  window.jelloSpectrum?.setLocked?.(locked.value);
};

onMounted(() => {
  document.body.style.backgroundColor = 'transparent';
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('dblclick', handleDblClick);

  unsubscribe = window.jelloSpectrum?.onData?.(applyPayload) || null;
  unsubscribeSettings = window.jelloSpectrum?.onSettings?.(applySettings) || null;
  window.jelloSpectrum?.ready?.();
  raf = requestAnimationFrame(draw);
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
  unsubscribeSettings?.();
  unsubscribeSettings = null;
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  window.removeEventListener('resize', resizeCanvas);
  document.removeEventListener('dblclick', handleDblClick);
});
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: transparent; overflow: hidden; }

.spectrum-hud {
  position: fixed;
  inset: 0;
  user-select: none;
  -webkit-app-region: no-drag;
}

.spectrum-hud.hud-editing {
  -webkit-app-region: drag;
  border: 2px dashed rgba(255, 255, 255, 0.4);
  border-radius: 6px;
}

.spectrum-canvas {
  position: absolute;
  inset: 0;
  display: block;
  -webkit-app-region: no-drag;
}

.spectrum-canvas {
  position: absolute;
  inset: 0;
  display: block;
  /* -webkit-app-region 不继承：canvas 铺满整个窗口，不显式继承的话默认 none，
     会把父级 .spectrum-hud.hud-editing 的 drag 区域整块挡住 → 解锁后拖不动窗口 */
  -webkit-app-region: inherit;
}

.spectrum-info {
  position: absolute;
  left: calc(14px * var(--info-scale, 1.25));
  bottom: calc(12px * var(--info-scale, 1.25));
  display: flex;
  align-items: center;
  gap: calc(10px * var(--info-scale, 1.25));
  -webkit-app-region: no-drag;
  pointer-events: none;
}

.spectrum-info .cover {
  width: calc(64px * var(--info-scale, 1.25));
  height: calc(64px * var(--info-scale, 1.25));
  border-radius: calc(10px * var(--info-scale, 1.25));
  object-fit: cover;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}

.spectrum-info .meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
}

.spectrum-info .title {
  color: #fff;
  font-family: 'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace;
  font-size: calc(15px * var(--info-scale, 1.25));
  font-weight: 600;
  white-space: nowrap;
  max-width: 40vw;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spectrum-info .author {
  color: rgba(255, 255, 255, 0.75);
  font-family: 'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace;
  font-size: calc(12px * var(--info-scale, 1.25));
  white-space: nowrap;
  max-width: 40vw;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
