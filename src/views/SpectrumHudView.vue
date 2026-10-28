<template>
  <div class="spectrum-hud" :class="{ 'hud-editing': !locked }" :style="{ '--info-scale': infoScale }">
    <canvas ref="canvasRef" class="spectrum-canvas"></canvas>
    <!-- 原版信息卡画在 renderSpectrum 内部，暂停时整体不绘制，这里用 playing 同步隐藏 -->
    <div class="spectrum-info" v-show="infoVisible && playing && (title || cover)">
      <div class="cover-pulse" v-if="cover" ref="coverPulseRef">
        <img class="cover" :src="cover" alt="" />
      </div>
      <div class="meta" v-if="title">
        <!-- 原版把歌名同位置画两遍：深色底（阴影）+ 浅色主体 -->
        <div class="title" :class="{ solo: !author }">
          <span class="underlay" aria-hidden="true">{{ title }}</span>
          <span class="main">{{ title }}</span>
        </div>
        <div class="author" v-if="author">
          <span class="underlay" aria-hidden="true">{{ author }}</span>
          <span class="main">{{ author }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// 所有者原创频谱 HUD（sigmarebase MusicManager renderSpectrum）移植：
// 114 条灰色底条 + 模糊封面条全窗叠加 @0.4（原版 songThumbnail 即 blur15+底部20%条，
// 见 processVideoThumbnail），左下角封面/歌名信息随低音脉冲缩放，暂停时整体消失。
import { onBeforeUnmount, onMounted, ref } from 'vue';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';

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
const playing = ref(false);

const canvasRef = ref(null);
const coverPulseRef = ref(null);
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

// 原版 renderSpectrum :206-212 低音脉冲：对平滑后的 bin0..2 取 max(sqrt(a) - 1000)（下限 0），
// 按 (4750 - 1000) 归一化后 ×0.14，量化到 1/75 步长
const computePulseScale = (smoothedLevels) => {
  let bass = 0;
  for (let i = 0; i < 3; i += 1) {
    const value = Number(smoothedLevels[i]) || 0;
    bass = Math.max(bass, Math.sqrt(value) - 1000);
  }
  return 1 + Math.round((bass / (4750 - 1000)) * 0.14 * 75) / 75;
};

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

  // 原版 onRender2D(EventRender2DCustom) 以 playing 门控整个 renderSpectrum：
  // 暂停时什么都不画（信息卡也随之消失），不做平滑塌缩
  if (!playing.value) {
    levels.fill(0);
    targets.fill(0);
    return;
  }

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

  // 低音脉冲：直接写元素 style，避免每帧触发 Vue 重渲染；
  // 枢轴 (60, h-55) 即封面自身中心再下移 5%（transform-origin: 50% 55%）
  const pulseEl = coverPulseRef.value;
  if (pulseEl) {
    const transform = `scale(${computePulseScale(levels).toFixed(4)})`;
    if (pulseEl.style.transform !== transform) pulseEl.style.transform = transform;
  }
};

const applyPayload = (data) => {
  if (!data) return;

  const nowPlaying = data.playing === true;
  const wasPlaying = playing.value;
  playing.value = nowPlaying;
  if (!nowPlaying) {
    levels.fill(0);
    targets.fill(0);
    if (coverPulseRef.value) coverPulseRef.value.style.transform = '';
  } else {
    if (!wasPlaying) pendingSnap = true;

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

// ===== 解锁态拖动：mousedown 起手，mousemove 算新 bounds，IPC 交给主进程 setBounds =====
let dragging = false;
let dragStartScreen = { x: 0, y: 0 };
let dragStartBounds = { x: 0, y: 0 };
let dragSentAt = 0;

const onDragStart = (event) => {
  if (locked.value || event.button !== 0) return;
  dragging = true;
  dragStartScreen = { x: event.screenX, y: event.screenY };
  dragStartBounds = { x: window.screenX, y: window.screenY };
};

const onDragMove = (event) => {
  if (!dragging) return;
  const now = performance.now();
  if (now - dragSentAt < 16) return;
  dragSentAt = now;
  window.jelloSpectrum?.sendBounds?.({
    x: Math.round(dragStartBounds.x + (event.screenX - dragStartScreen.x)),
    y: Math.round(dragStartBounds.y + (event.screenY - dragStartScreen.y))
  });
};

const onDragEnd = () => {
  dragging = false;
};

onMounted(() => {
  document.body.style.backgroundColor = 'transparent';
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('dblclick', handleDblClick);
  document.addEventListener('mousedown', onDragStart);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

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
  document.removeEventListener('mousedown', onDragStart);
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
});
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
/* 必须用 shorthand 覆盖：styles.css 的 body 是 radial-gradient（背景图），
   :root 在 html 上还有 #0e0c12 底色，只清 background-color 会留下深色底 */
html, body, #app { background: transparent !important; overflow: hidden; }

.spectrum-hud {
  position: fixed;
  inset: 0;
  user-select: none;
}

.spectrum-hud.hud-editing {
  border: 2px dashed rgba(255, 255, 255, 0.4);
  border-radius: 6px;
  cursor: move;
}

/* 拖动走渲染层 mousedown + IPC setBounds（-webkit-app-region 在高 DPI 缩放屏
   的 hit-test 不可靠），这里不再使用 app-region */
.spectrum-canvas {
  position: absolute;
  inset: 0;
  display: block;
}

.spectrum-info {
  position: absolute;
  left: calc(14px * var(--info-scale, 1.25));
  bottom: calc(12px * var(--info-scale, 1.25));
  display: flex;
  align-items: center;
  gap: calc(10px * var(--info-scale, 1.25));
  pointer-events: none;
}

/* 原版枢轴 (60, h-55)：封面中心再下移其高度的 5% */
.spectrum-info .cover-pulse {
  flex: none;
  transform-origin: 50% 55%;
  will-change: transform;
}

.spectrum-info .cover {
  display: block;
  width: calc(64px * var(--info-scale, 1.25));
  height: calc(64px * var(--info-scale, 1.25));
  object-fit: cover;
  /* 原版 drawRoundedRect(…, 14, 0.3)：LIGHT_GREYISH_BLUE(#fefefe) @0.3、
     向外延展 14px 的柔边阴影（RenderUtil.java:730），不是内部填充 */
  box-shadow: 0 0 calc(14px * var(--info-scale, 1.25)) rgba(254, 254, 254, 0.3);
}

.spectrum-info .meta {
  display: flex;
  flex-direction: column;
  gap: calc(5px * var(--info-scale, 1.25));
}

.spectrum-info .title,
.spectrum-info .author {
  position: relative;
  font-family: 'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace;
}

.spectrum-info .title .main,
.spectrum-info .title .underlay,
.spectrum-info .author .main,
.spectrum-info .author .underlay {
  display: block;
  max-width: 40vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 同位置叠两层：underlay 是原版同坐标的深色阴影遍，main 在其上 */
.spectrum-info .title .underlay,
.spectrum-info .author .underlay {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
}

.spectrum-info .title .main,
.spectrum-info .author .main {
  position: relative;
}

/* 有作者时：part[0] = JelloMediumFont20，LIGHT_GREYISH_BLUE@0.6 / DEEP_TEAL@0.4 */
.spectrum-info .title {
  font-size: calc(20px * var(--info-scale, 1.25));
  font-weight: 600;
}

.spectrum-info .title .main { color: rgba(254, 254, 254, 0.6); }
.spectrum-info .title .underlay { color: rgba(1, 1, 1, 0.4); }

/* 无作者（原版 split 不开）：JelloLightFont18，LIGHT_GREYISH_BLUE@0.7 / DEEP_TEAL@0.5 */
.spectrum-info .title.solo {
  font-size: calc(18px * var(--info-scale, 1.25));
  font-weight: 400;
}

.spectrum-info .title.solo .main { color: rgba(254, 254, 254, 0.7); }
.spectrum-info .title.solo .underlay { color: rgba(1, 1, 1, 0.5); }

/* part[1] = JelloLightFont18，LIGHT_GREYISH_BLUE@0.7 / DEEP_TEAL@0.5 */
.spectrum-info .author {
  font-size: calc(18px * var(--info-scale, 1.25));
  font-weight: 400;
}

.spectrum-info .author .main { color: rgba(254, 254, 254, 0.7); }
.spectrum-info .author .underlay { color: rgba(1, 1, 1, 0.5); }
</style>
