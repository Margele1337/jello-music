<template>
  <div class="spectrum-hud" :class="{ 'hud-editing': !locked }">
    <canvas ref="canvasRef" class="spectrum-canvas"></canvas>
    <div class="spectrum-info" v-show="title || cover">
      <img v-if="cover" class="cover" :src="cover" alt="" />
      <div class="meta" v-if="title">
        <div class="title">{{ title }}</div>
        <div class="author" v-if="author">{{ author }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const BAR_COUNT = 114            // 与 sigmarebase renderSpectrum 的 maxWidth 一致
const SPECTRUM_SMOOTHING = 0.335 // sigmarebase 60fps 平滑系数（onRender2D 里更新 amplitudes）
// 与原版 1:1：原版条形像素高 = refH × (游戏窗口高 / 1080)。
// 实测游戏窗口 1920x1009（可按实际分辨率修改），所以 1.0x 时我们的条形绝对像素高度与原版一致，
// 与频谱窗自身高度无关（窗口只决定可见范围/余量）。
const GAME_FRAMEBUFFER_HEIGHT = 1009

const canvasRef = ref(null)
const cover = ref('')
const title = ref('')
const author = ref('')
const playing = ref(false)
const locked = ref(true)

// 非响应式频谱数据，避免高频 IPC 触发 Vue 响应式开销
const levels = new Float32Array(BAR_COUNT)
const targets = new Float32Array(BAR_COUNT)   // 生产者发来的原始幅度（Sigma 形态的平滑目标）
const heights = new Float32Array(BAR_COUNT)
const barStyles = new Array(BAR_COUNT)
for (let i = 0; i < BAR_COUNT; i++) {
  barStyles[i] = `rgba(153, 153, 153, ${(0.2 * (1 - (i + 1) / BAR_COUNT)).toFixed(4)})`
}
let lastDrawTime = 0
let raf = null
let spectrumScale = 1
// 原版 amplitudes 被清空后（换歌/恢复播放）下一帧直接复制目标（复刻 amplitudes.isEmpty() 分支）
let pendingSnap = false
// 平滑系数可调（默认即 sigmarebase 的 0.335）
let spectrumSmoothing = SPECTRUM_SMOOTHING

// 封面图（用于频谱条内叠加，模拟 sigmarebase 的模糊封面 + stencil 裁剪效果）
let coverImage = null
let blurredCover = null
// Sigma 形态专用：sigmarebase 把封面 applyBlur(15) 后裁出底部 20% 那条当叠加图
let blurredCoverStrip = null

let coverLoadToken = 0

const loadCover = (url) => {
  if (!url) {
    // 切到无封面的歌曲：清除旧模糊封面，避免旧封面残影留在频谱条上
    coverLoadToken++
    coverImage = null
    blurredCover = null
    blurredCoverStrip = null
    return
  }
  if (url === coverImage?.src) return
  const token = ++coverLoadToken
  // 切歌立即清除旧封面，避免旧模糊封面残留在频谱条上（背景残影）
  coverImage = null
  blurredCover = null
  blurredCoverStrip = null
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    if (token !== coverLoadToken) return // 竞态保护：已被更新的封面取代
    coverImage = img
    try {
      const c = document.createElement('canvas')
      const w = 400
      const h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth))
      c.width = w
      c.height = h
      const bctx = c.getContext('2d')
      // sigmarebase processVideoThumbnail: ImageUtil.applyBlur(buffImage, 15)
      bctx.filter = 'blur(15px)'
      bctx.drawImage(img, 0, 0, w, h)
      blurredCover = c
      // 再裁出底部 20% 作为频谱条叠加图（原版 getSubimage(0, 0.75h, w, 0.2h)）
      const stripHeight = Math.max(1, Math.round(h * 0.2))
      const strip = document.createElement('canvas')
      strip.width = w
      strip.height = stripHeight
      const sctx = strip.getContext('2d')
      sctx.drawImage(c, 0, Math.round(h * 0.75), w, stripHeight, 0, 0, w, stripHeight)
      blurredCoverStrip = strip
    } catch (e) {
      blurredCover = null
      blurredCoverStrip = null
    }
  }
  img.onerror = () => {
    if (token !== coverLoadToken) return
    coverImage = null
    blurredCover = null
    blurredCoverStrip = null
  }
  img.src = url
}

const applyLock = () => {
  if (locked.value) {
    document.body.style.setProperty('background', 'transparent', 'important');
  } else {
    document.body.style.setProperty('background', 'rgba(0, 0, 0, 0.25)', 'important');
  }
  if (window.electron?.platform !== 'linux')
    window.electron.ipcRenderer.send('set-spectrum-ignore-mouse-events', locked.value)
}

const resizeCanvas = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const w = window.innerWidth
  const h = window.innerHeight
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
}

const draw = (now = performance.now()) => {
  raf = requestAnimationFrame(draw)
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)

  // 帧率补偿，保证不同刷新率下衰减速度一致
  const dt = lastDrawTime > 0 ? Math.min(now - lastDrawTime, 100) : 1000 / 60
  lastDrawTime = now

  // ===== 平滑：复刻 sigmarebase onRender2D =====
  // 原版每帧 alpha = min(0.335 * 60 / MinecraftFps, 1)。游戏跑在 300~1100FPS，
  // 实测等效时间常数 τ = -dt/ln(1-alpha) 稳定在 49.0ms（mean 49.02 / median 49.09）。
  // 这里按 τ 做指数步进，任何刷新率下曲线都与原版一致（系数 0.335 → τ = 16.67/0.335 ≈ 49.8ms）
  const tauMs = 1000 / (Math.max(0.001, spectrumSmoothing) * 60)
  const alpha = Math.min(1, 1 - Math.exp(-dt / tauMs))
  for (let i = 0; i < BAR_COUNT; i++) {
    const next = levels[i] + (targets[i] - levels[i]) * alpha
    levels[i] = Number.isFinite(next) ? Math.max(0, Math.min(2.256e7, next)) : 0
  }

  // ===== 1:1 复刻 sigmarebase renderSpectrum =====
  // 条宽 ceil(窗口宽 / 114)；条高按原版绝对像素高度（见 sigmaAmp），不随频谱窗高度缩放
  const sigmaBarWidth = Math.ceil(w / BAR_COUNT)

  // 与原版 1:1：原版像素高 = refH × (游戏窗口高/1080)；1.0x 时两者绝对像素高度一致
  const sigmaAmp = (GAME_FRAMEBUFFER_HEIGHT / 1080) * spectrumScale
  for (let i = 0; i < BAR_COUNT; i++) {
    const refHeight = Math.sqrt(levels[i]) / 12 - 5
    const height = Math.max(0, refHeight) * sigmaAmp
    heights[i] = Math.min(h, height)
  }

  // 1) 灰色底条 MID_GREY #999999，alpha = 0.2 × alphaValue（左→右渐隐）
  for (let i = 0; i < BAR_COUNT; i++) {
    const x = i * sigmaBarWidth
    if (x >= w) break
    ctx.fillStyle = barStyles[i]
    ctx.fillRect(x, h - heights[i], sigmaBarWidth, heights[i])
  }

  // 2) 主条：原版 initStencilBuffer() 里 glColorMask(false,false,false,false)，
  //    第二次画条只写 stencil、不写颜色；真正显示的是 configureStencilTest() 之后
  //    drawImage(0,0,W,H, songThumbnail, 0.4) —— 只在条形区域内的模糊封面（底部 20% 条拉伸）。
  //    所以这里没有白色实心条，只有封面条 0.4 叠在灰色底条上。
  const overlay = blurredCoverStrip || blurredCover
  if (overlay) {
    ctx.save()
    ctx.beginPath()
    for (let i = 0; i < BAR_COUNT; i++) {
      const x = i * sigmaBarWidth
      if (x >= w) break
      ctx.rect(x, h - heights[i], sigmaBarWidth, heights[i])
    }
    ctx.clip()
    ctx.globalAlpha = 0.4
    ctx.drawImage(overlay, 0, 0, w, h)
    ctx.globalAlpha = 1
    ctx.restore()
  }
}

onMounted(() => {
  document.body.style.backgroundColor = 'transparent'
  document.body.style.margin = '0'
  document.body.style.overflow = 'hidden'

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)

  window.electron.ipcRenderer.on('spectrum-data', (_event, data) => {
    if (!data) return
    if (data.levels && data.levels.length) {
      const incoming = data.levels
      const count = Math.min(BAR_COUNT, incoming.length)
      for (let i = 0; i < count; i++) targets[i] = incoming[i] || 0
      // 原版 amplitudes 被清空后（换歌/恢复播放）下一帧直接复制目标，没有渐变
      if (data.reset || pendingSnap) {
        levels.set(targets)
        pendingSnap = false
      }
    }
    if (data.cover != null && data.cover !== cover.value) {
      cover.value = data.cover
      loadCover(data.cover)
    }
    if (data.title != null) title.value = data.title
    if (data.author != null) author.value = data.author
  })

  window.electron.ipcRenderer.on('playing-status', (_event, p) => {
    const wasPlaying = playing.value
    playing.value = !!p
    if (!playing.value) {
      // 原版暂停时 onTick 清空 amplitudes 且 renderSpectrum 不再执行：条形立即消失
      levels.fill(0)
      targets.fill(0)
    } else if (!wasPlaying) {
      // 恢复播放：amplitudes 为空 → 下一帧直接复制目标
      pendingSnap = true
    }
  })

  window.electron.ipcRenderer.on('spectrum-setting-changed', (_e, { key, value }) => {
    if (key === 'spectrumLocked') {
      locked.value = value !== 'off'
      applyLock()
    } else if (key === 'spectrumScale') {
      spectrumScale = parseFloat(value) || 1
    } else if (key === 'spectrumSigmaSmoothing') {
      const v = Number.parseFloat(value)
      if (Number.isFinite(v)) spectrumSmoothing = Math.min(1, Math.max(0.001, v))
    }
  })

  const settings = JSON.parse(localStorage.getItem('settings') || '{}')
  locked.value = settings?.spectrumLocked !== 'off'
  spectrumScale = parseFloat(settings?.spectrumScale || '1.0') || 1
  const savedSmoothing = Number.parseFloat(settings?.spectrumSigmaSmoothing ?? '')
  if (Number.isFinite(savedSmoothing)) spectrumSmoothing = Math.min(1, Math.max(0.001, savedSmoothing))

  applyLock()
  draw()

  // 就绪后请求主窗口重发当前频谱/封面信息
  window.electron.ipcRenderer.send('spectrum-hud-ready')

  document.addEventListener('dblclick', (e) => {
    if (!e.target.closest('.spectrum-info')) { locked.value = !locked.value; applyLock() }
  })
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
  window.removeEventListener('resize', resizeCanvas)
})
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: transparent; overflow: hidden; }

.spectrum-hud {
  position: fixed; inset: 0;
  user-select: none;
  -webkit-app-region: no-drag;
}
.spectrum-hud.hud-editing {
  -webkit-app-region: drag;
  border: 2px dashed rgba(255, 255, 255, 0.4);
  border-radius: 6px;
}

.spectrum-canvas {
  position: absolute; inset: 0;
  display: block;
}

.spectrum-info {
  position: absolute;
  left: 14px; bottom: 12px;
  display: flex; align-items: center; gap: 10px;
  -webkit-app-region: no-drag;
  pointer-events: none;
}
.spectrum-info .cover {
  width: 64px; height: 64px;
  border-radius: 10px;
  object-fit: cover;
  box-shadow: 0 2px 10px rgba(0,0,0,0.5);
}
.spectrum-info .meta {
  display: flex; flex-direction: column; gap: 2px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.7);
}
.spectrum-info .title {
  color: #fff; font-size: 15px; font-weight: 600;
  white-space: nowrap; max-width: 40vw; overflow: hidden; text-overflow: ellipsis;
}
.spectrum-info .author {
  color: rgba(255,255,255,0.75); font-size: 12px;
  white-space: nowrap; max-width: 40vw; overflow: hidden; text-overflow: ellipsis;
}
</style>
