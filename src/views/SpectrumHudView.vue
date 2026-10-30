<template>
  <div class="spectrum-hud" :class="{ 'hud-editing': !locked }" :style="{ '--info-scale': infoScale }">
    <canvas ref="canvasRef" class="spectrum-canvas"></canvas>
    <!-- 原版信息卡画在 renderSpectrum 内部，暂停时整体不绘制，这里用 playing 同步隐藏 -->
    <div class="spectrum-info" v-show="infoVisible && playing && (title || cover)">
      <div class="cover-pulse" v-if="cover" ref="coverPulseRef">
        <img class="cover" :src="cover" alt="" />
      </div>
      <div class="meta" v-if="title" :class="author ? 'split' : 'solo'">
        <!-- 原版把歌名同位置画两遍：深色底（阴影）+ 浅色主体 -->
        <div class="title">
          <span class="underlay" aria-hidden="true">{{ title }}</span>
          <span class="main">{{ title }}</span>
        </div>
        <div class="author" v-if="author">
          <span class="underlay" aria-hidden="true">{{ author }}</span>
          <span class="main">{{ author }}</span>
        </div>
      </div>
    </div>
    <!-- 整屏 HUD 不能再给 body 铺半透明底色（会把整个桌面压暗），
         解锁态只画一条不拦截鼠标的边框 + 一个可点的锁定按钮 -->
    <div class="hud-edit-band" v-if="!locked">
      <span class="hud-edit-hint" aria-hidden="true">拖动调整位置 · 双击任意处锁定</span>
      <button type="button" class="hud-edit-lock" aria-label="重新锁定频谱窗口" @click.stop="setLocked(true)">锁定</button>
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
import {
  DEFAULT_SMOOTHING_COEFFICIENT,
  INFO_BASE,
  clampInfoScale,
  infoLayout,
  smoothingAlpha,
  stepAmplitude,
  tintPixelAlpha
} from '../../shared/spectrumHud.js';

const BAR_COUNT = 114;
const SPECTRUM_SMOOTHING = DEFAULT_SMOOTHING_COEFFICIENT;
const REFERENCE_DISPLAY_HEIGHT = 1080;
const REFERENCE_GAME_HEIGHT = 1009;
const REFERENCE_BAR_RATIO = REFERENCE_GAME_HEIGHT / REFERENCE_DISPLAY_HEIGHT;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const detectDisplayScale = () => {
  const pixelHeight = (window.screen?.height || 0) * (window.devicePixelRatio || 1);
  return pixelHeight ? clamp(pixelHeight / REFERENCE_DISPLAY_HEIGHT, 0.5, 4) : 1;
};

let displayScale = detectDisplayScale();
// 原版信息卡是固定像素，spectrumInfoScale 只是纯倍率 → 默认 1.0 即与原版一致
const infoScale = ref(1);
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
// 目标电平刷新间隔：节流 IPC 电平→缓动目标的更新率（500ms ≈ 一秒两变的慢节奏）
let spectrumUpdateMs = 500;
let lastTargetTime = 0;
let canvasStyleWidth = 0;
let canvasStyleHeight = 0;
let pixelRatio = 1;

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
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const nextWidth = Math.round(width * ratio);
  const nextHeight = Math.round(height * ratio);
  // 只在尺寸真的变了才改画布：改 width/height 会重置 backing store，
  // 整屏 HUD 下每帧重置会造成显存重分配 + 闪烁
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  if (canvasStyleWidth !== width || canvasStyleHeight !== height) {
    canvasStyleWidth = width;
    canvasStyleHeight = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  pixelRatio = ratio;
  tintLayerToken = '';
};

// 柔边层（T4）：RenderUtil.java:730 是「四条边贴图 + 四个角贴图」的外扩柔边，
// 这里用同一衰减函数逐像素烘到离屏画布，尺寸/倍率不变时整层复用，不做每帧重分配。
let tintLayer = null;
let tintLayerToken = '';

const ensureTintLayer = () => {
  const unit = infoScale.value * pixelRatio;
  const extent = INFO_BASE.tintExtent * unit;
  const coverPx = INFO_BASE.coverSize * unit;
  const size = Math.max(1, Math.round(coverPx + extent * 2));
  const token = `${size}|${unit.toFixed(4)}`;
  if (tintLayer && tintLayerToken === token) return tintLayer;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      // 层内 (extent, extent) 起是封面矩形；取整余量留在外侧（那里 alpha≈0）
      const alpha = tintPixelAlpha(px - extent, py - extent, coverPx, extent);
      if (alpha <= 0) continue;
      const index = (py * size + px) * 4;
      // 原素材是黑色 RGB 遮罩，着色 #fefefe 只是把 alpha 乘进去 → 落地是变暗的柔边
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = Math.max(0, Math.min(255, Math.round(alpha * 255)));
    }
  }
  ctx.putImageData(image, 0, 0);
  tintLayer = canvas;
  tintLayerToken = token;
  return tintLayer;
};

const drawTint = (ctx, height, pulse) => {
  if (!infoVisible.value || !cover.value) return;
  const layer = ensureTintLayer();
  if (!layer) return;
  const layout = infoLayout(infoScale.value, height, pixelRatio);
  ctx.save();
  // 原版整张信息卡（封面 + 柔边）都在同一个 glScalef 里（MusicManager.java:213-219）
  ctx.translate(layout.pulsePivot.x, layout.pulsePivot.y);
  ctx.scale(pulse, pulse);
  ctx.translate(-layout.pulsePivot.x, -layout.pulsePivot.y);
  ctx.drawImage(layer, layout.tint.x, layout.tint.y, layout.tint.size, layout.tint.size);
  ctx.restore();
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

  // Java 原式（MusicManager.java:144-149）：alpha = min(0.335 × 60/实测帧率, 1)。
  // 原版跑在 300-1100fps 的游戏渲染循环里，所以每帧只挪一点点、肉眼看着「很跟手」；
  // 我们是 60/120/144Hz 的 rAF，同一公式在 60fps 下即 alpha≈系数本身。
  const alpha = smoothingAlpha(spectrumSmoothing, dt);
  for (let i = 0; i < BAR_COUNT; i += 1) {
    levels[i] = stepAmplitude(levels[i], targets[i], alpha);
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
    // 整屏表面下只在实际有条的区域合成，避免每帧把整屏拉伸一遍
    let minTop = height;
    for (let i = 0; i < BAR_COUNT; i += 1) {
      if (heights[i] > 0) minTop = Math.min(minTop, height - heights[i]);
    }
    if (minTop < height) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < BAR_COUNT; i += 1) {
        const x = i * barWidth;
        if (x >= width) break;
        ctx.rect(x, height - heights[i], barWidth, heights[i]);
      }
      ctx.clip();
      ctx.globalAlpha = 0.4;
      const destHeight = height - minTop;
      const sourceHeight = Math.max(1, (overlay.height * destHeight) / height);
      ctx.drawImage(
        overlay,
        0,
        Math.max(0, Math.min(overlay.height - sourceHeight, (overlay.height * minTop) / height)),
        overlay.width,
        sourceHeight,
        0,
        minTop,
        width,
        destHeight
      );
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  // 低音脉冲：直接写元素 style，避免每帧触发 Vue 重渲染；
  // 枢轴 (60, h-55) 即封面自身中心再下移 5%（transform-origin: 50% 55%）
  const pulse = computePulseScale(levels);
  const pulseEl = coverPulseRef.value;
  if (pulseEl) {
    const transform = `scale(${pulse.toFixed(4)})`;
    if (pulseEl.style.transform !== transform) pulseEl.style.transform = transform;
  }

  drawTint(ctx, height, pulse);
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
      // 目标刷新节流：缓动目标只按 spectrumUpdateMs 速率更新，
      // 条形之间由缓动滑过去——复现「一秒变一两次」的慢节奏观感
      const now = performance.now();
      if (now - lastTargetTime >= spectrumUpdateMs) {
        lastTargetTime = now;
        const count = Math.min(BAR_COUNT, data.levels.length);
        for (let i = 0; i < count; i += 1) targets[i] = Number(data.levels[i]) || 0;
      }
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
  if (Number.isFinite(settings.spectrumUpdateMs)) spectrumUpdateMs = settings.spectrumUpdateMs;
  if (Number.isFinite(settings.spectrumInfoScale)) infoScale.value = clampInfoScale(settings.spectrumInfoScale);
  if (settings.spectrumInfoVisible != null) infoVisible.value = settings.spectrumInfoVisible === true;
  if (settings.spectrumLocked != null) locked.value = settings.spectrumLocked === true;
};

// 解锁态不再给 body 铺半透明底（整屏会把桌面压暗），改成边框 + 徽标提示，纯 CSS 完成。
const setLocked = (value) => {
  const next = value === true;
  lastLockToggleAt = performance.now();
  locked.value = next;
  window.jelloSpectrum?.setLocked?.(next);
};

const handleDblClick = (event) => {
  if (event.target.closest('.hud-edit-band')) return;
  // 徽标按钮刚点过，紧随其后的 dblclick 不能再翻转一次
  if (performance.now() - lastLockToggleAt < 500) return;
  setLocked(!locked.value);
};

// ===== 解锁态拖动：mousedown 起手，mousemove 算新 bounds，IPC 交给主进程 setBounds =====
let dragging = false;
let dragStartScreen = { x: 0, y: 0 };
let dragStartBounds = { x: 0, y: 0 };
let dragSentAt = 0;
let lastLockToggleAt = 0;

const onDragStart = (event) => {
  if (locked.value || event.button !== 0) return;
  if (event.target.closest('.hud-edit-lock')) return;
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

/* 整屏窗口不能铺压暗底色，解锁态只留光标形状 */
.spectrum-hud.hud-editing {
  cursor: move;
}

/* 解锁态可视带：1px 强调描边 + 徽标，pointer-events 关掉以免挡住穿透路径 */
.hud-edit-band {
  position: absolute;
  left: 1px;
  right: 1px;
  bottom: 1px;
  height: 280px;
  border: 1px solid rgba(254, 254, 254, 0.35);
  border-radius: 4px;
  pointer-events: none;
}

.hud-edit-band .hud-edit-hint {
  position: absolute;
  top: 8px;
  left: 12px;
  font-family: 'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace;
  font-size: 12px;
  color: rgba(254, 254, 254, 0.75);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

.hud-edit-band .hud-edit-lock {
  position: absolute;
  top: 6px;
  right: 12px;
  pointer-events: auto;
  cursor: pointer;
  padding: 3px 10px;
  font-family: 'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace;
  font-size: 12px;
  color: #fefefe;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(254, 254, 254, 0.45);
  border-radius: 4px;
}

/* 拖动走渲染层 mousedown + IPC setBounds（-webkit-app-region 在高 DPI 缩放屏
   的 hit-test 不可靠），这里不再使用 app-region */
.spectrum-canvas {
  position: absolute;
  inset: 0;
  display: block;
}

/* 信息卡基准几何全部来自 MusicManager.renderSpectrum :217-264 的固定像素常量，
   spectrumInfoScale 只是纯倍率（1.0 = 与原版一致），不叠加分辨率缩放 */
.spectrum-info {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 封面：drawImage(10, h-110, 100, 100) */
.spectrum-info .cover-pulse {
  position: absolute;
  left: calc(10px * var(--info-scale, 1));
  bottom: calc(10px * var(--info-scale, 1));
  width: calc(100px * var(--info-scale, 1));
  height: calc(100px * var(--info-scale, 1));
  /* 原版枢轴 (60, h-55)：封面中心再下移其高度的 5% */
  transform-origin: 50% 55%;
  will-change: transform;
}

.spectrum-info .cover {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* 原版 drawRoundedRect(…, 14, 0.3) 的外扩柔边改由画布按素材衰减逐像素绘制（T4） */
}

/* 文字：x=130（封面右侧 20px），单行顶边 h-70，拆分时上行 h-81、下行 h-56，
   line-height:1 让 CSS 文本盒顶边即 drawString 的 y */
.spectrum-info .meta {
  position: absolute;
  left: calc(130px * var(--info-scale, 1));
  line-height: 1;
  font-family: 'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace;
}

.spectrum-info .meta.solo {
  top: calc(100% - 70px * var(--info-scale, 1));
  font-size: calc(18px * var(--info-scale, 1));
  font-weight: 400;
}

.spectrum-info .meta.split {
  top: calc(100% - 81px * var(--info-scale, 1));
}

.spectrum-info .title,
.spectrum-info .author {
  position: relative;
  line-height: 1;
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
  line-height: 1;
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

/* 拆分：part[0] = JelloMediumFont20 @0.6 / DEEP_TEAL@0.4，
   part[1] = JelloLightFont18 @0.7 / DEEP_TEAL@0.5，两行间隔 = 81-(20+56) = 5px */
.spectrum-info .meta.split .title {
  font-size: calc(20px * var(--info-scale, 1));
  font-weight: 600;
}

.spectrum-info .meta.split .title .main { color: rgba(254, 254, 254, 0.6); }
.spectrum-info .meta.split .title .underlay { color: rgba(1, 1, 1, 0.4); }

.spectrum-info .meta.split .author {
  margin-top: calc(5px * var(--info-scale, 1));
  font-size: calc(18px * var(--info-scale, 1));
  font-weight: 400;
}

.spectrum-info .meta.split .author .main { color: rgba(254, 254, 254, 0.7); }
.spectrum-info .meta.split .author .underlay { color: rgba(1, 1, 1, 0.5); }

/* 单行（原版 split 不开）：JelloLightFont18，LIGHT_GREYISH_BLUE@0.7 / DEEP_TEAL@0.5 */
.spectrum-info .meta.solo .main { color: rgba(254, 254, 254, 0.7); }
.spectrum-info .meta.solo .underlay { color: rgba(1, 1, 1, 0.5); }
</style>
