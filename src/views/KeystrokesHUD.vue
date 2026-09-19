<template>
  <!-- 1:1 复刻 sigmarebase module/impl/gui/jello/KeyStrokes.java -->
  <div class="keystrokes-hud">
    <div
      v-for="key in keystrokes"
      :key="key.id"
      class="ks-key"
      :style="keyStyle(key)"
    >
      <!-- 1) 平铺矩形：未按下 DEEP_TEAL(#010101) 50%；按下 LIGHT_GREYISH_BLUE(#FEFEFE) 50% -->
      <span class="ks-fill" :class="{ 'is-down': key.down }"></span>

      <!-- 2) 白色柔光：8 片 shadow 精灵，size=10、alpha=0.75 -->
      <span class="ks-glow ks-glow-corner-1"></span>
      <span class="ks-glow ks-glow-corner-2"></span>
      <span class="ks-glow ks-glow-corner-3"></span>
      <span class="ks-glow ks-glow-corner-4"></span>
      <span class="ks-glow ks-glow-left"></span>
      <span class="ks-glow ks-glow-right"></span>
      <span class="ks-glow ks-glow-top"></span>
      <span class="ks-glow ks-glow-bottom"></span>

      <!-- 3) 标签：JelloLightFont18、#FEFEFE，水平居中、顶边 y+12 -->
      <span class="ks-label">{{ key.label }}</span>

      <!-- 4) 松开动画：扩散圆（裁剪在键矩形内） -->
      <span class="ks-clip">
        <span
          v-for="arc in arcsFor(key)"
          :key="arc.id"
          class="ks-arc"
          :style="arcStyle(key, arc)"
        ></span>
      </span>
    </div>
  </div>
</template>

<script setup>
// 对应 sigmarebase：module/impl/gui/jello/KeyStrokes.java
//
// 几何（xBase=10，yBase=EventRender2DOffset 初始 yOffset=99）：
//   Left(0,1) Right(2,1) Forward(1,0) Back(1,1)，Attack(0,2,宽74) UseItem(1.02,2,宽73)
//   尺寸 48x48、间距 3；左上 = (posX*(宽+3), posY*(48+3))
// 绘制顺序（原版）：平铺矩形 → 白色柔光(8片) → 标签 → 松开扩散圆
// 松开动画：Animation(300,0)；半径 (宽-4)*p+4 再 -1；颜色 #A9A9A9、alpha (1-p*(0.5+p*0.5))*0.8
import { onBeforeUnmount, onMounted, ref } from 'vue';
import jelloLightUrl from '@/assets/sigma/fonts/helvetica-neue-light.ttf';

// 字体（与 Sigma UI 一致：JelloLight = helvetica-neue-light）
const FONT_STYLE_ID = 'sigma-ui-fonts';
if (typeof document !== 'undefined' && !document.getElementById(FONT_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = FONT_STYLE_ID;
  style.textContent = `@font-face { font-family: 'JelloLight'; src: url('${jelloLightUrl}') format('truetype'); font-weight: 400; font-style: normal; }`;
  document.head.appendChild(style);
}

const BASE_X = 10;
const BASE_Y = 99;
const KEY_HEIGHT = 48;
const KEY_PADDING = 3;
const ARC_DURATION = 300;

const KEY_DEFS = [
  { id: 'left', label: 'A', posX: 0, posY: 1, width: 48 },
  { id: 'right', label: 'D', posX: 2, posY: 1, width: 48 },
  { id: 'forward', label: 'W', posX: 1, posY: 0, width: 48 },
  { id: 'back', label: 'S', posX: 1, posY: 1, width: 48 },
  { id: 'attack', label: 'L', posX: 0, posY: 2, width: 74 },
  { id: 'use', label: 'R', posX: 1.02, posY: 2, width: 73 }
];

const keystrokes = ref(KEY_DEFS.map((def) => ({ ...def, down: false })));
const arcs = ref([]);
let arcId = 0;
let rafId = null;

const keyStyle = (key) => ({
  left: `${BASE_X + Math.trunc(key.posX * (key.width + KEY_PADDING))}px`,
  top: `${BASE_Y + Math.trunc(key.posY * (KEY_HEIGHT + KEY_PADDING))}px`,
  width: `${key.width}px`,
  height: `${KEY_HEIGHT}px`
});

const arcsFor = (key) => arcs.value.filter((arc) => arc.keyId === key.id);

const arcPercent = (arc) => Math.min(1, (performance.now() - arc.start) / ARC_DURATION);

const arcStyle = (key, arc) => {
  const p = arcPercent(arc);
  const alpha = (1 - p * (0.5 + p * 0.5)) * 0.8;
  // 原版 drawFilledArc(x, y, radius, color) → 实际半径 = radius - 1 = (宽-4)*p+3
  const radius = (key.width - 4) * p + 4 - 1;
  return {
    left: '50%',
    top: '50%',
    width: `${radius * 2}px`,
    height: `${radius * 2}px`,
    marginLeft: `${-radius}px`,
    marginTop: `${-radius}px`,
    background: `rgba(169, 169, 169, ${alpha})`
  };
};

const findKey = (id) => keystrokes.value.find((key) => key.id === id);

const spawnArc = (key) => {
  arcs.value.push({ id: ++arcId, keyId: key.id, start: performance.now() });
};

const handleInput = (payload) => {
  if (!payload || !payload.id) return;
  const key = findKey(payload.id);
  if (!key) return;
  if (payload.down) {
    key.down = true;
    return;
  }
  key.down = false;
  spawnArc(key);
};

const onKeyState = (_event, payload) => handleInput(payload);

// 原版：键仍按住、动画已达 70% 且同键动画不足 2 个时，把进度固定在 70%
const tick = () => {
  const now = performance.now();
  const next = [];
  for (const arc of arcs.value) {
    const key = findKey(arc.keyId);
    const p = Math.min(1, (now - arc.start) / ARC_DURATION);
    const sameKeyCount = arcs.value.filter((item) => item.keyId === arc.keyId).length;
    if (key?.down && p >= 0.7 && sameKeyCount < 2) {
      arc.start = now - ARC_DURATION * 0.7;
      next.push(arc);
      continue;
    }
    if (p < 1) next.push(arc);
  }
  arcs.value = next;
  rafId = requestAnimationFrame(tick);
};

onMounted(() => {
  window.electron?.ipcRenderer?.on('keystrokes-input', onKeyState);
  rafId = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  window.electron?.ipcRenderer?.removeListener('keystrokes-input', onKeyState);
  if (rafId !== null) cancelAnimationFrame(rafId);
});
</script>

<style scoped>
.keystrokes-hud {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: transparent;
  user-select: none;
  pointer-events: none;
}

/* 键容器：不裁剪，方便柔光画在矩形外 */
.ks-key {
  position: absolute;
}

/* 1) 平铺矩形（原版无圆角） */
.ks-fill {
  position: absolute;
  inset: 0;
  background: rgba(1, 1, 1, 0.5);
}

.ks-fill.is-down {
  background: rgba(254, 254, 254, 0.5);
}

/* ===== 2) 白色柔光（8 片原版 shadow 精灵 × #FEFEFE × 0.75） ===== */
.ks-glow {
  position: absolute;
  background: #fefefe;
  opacity: 0.75;
  pointer-events: none;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
}

.ks-glow-corner-1 {
  left: -10px;
  top: -10px;
  width: 10px;
  height: 10px;
  -webkit-mask-image: url('@/assets/sigma/jello/shadow_corner.png');
  mask-image: url('@/assets/sigma/jello/shadow_corner.png');
}

.ks-glow-corner-2 {
  right: -10px;
  top: -10px;
  width: 10px;
  height: 10px;
  -webkit-mask-image: url('@/assets/sigma/jello/shadow_corner_2.png');
  mask-image: url('@/assets/sigma/jello/shadow_corner_2.png');
}

.ks-glow-corner-3 {
  left: -10px;
  bottom: -10px;
  width: 10px;
  height: 10px;
  -webkit-mask-image: url('@/assets/sigma/jello/shadow_corner_3.png');
  mask-image: url('@/assets/sigma/jello/shadow_corner_3.png');
}

.ks-glow-corner-4 {
  right: -10px;
  bottom: -10px;
  width: 10px;
  height: 10px;
  -webkit-mask-image: url('@/assets/sigma/jello/shadow_corner_4.png');
  mask-image: url('@/assets/sigma/jello/shadow_corner_4.png');
}

.ks-glow-left {
  left: -10px;
  top: 0;
  width: 10px;
  height: 100%;
  -webkit-mask-image: url('@/assets/sigma/jello/shadow_left.png');
  mask-image: url('@/assets/sigma/jello/shadow_left.png');
}

.ks-glow-right {
  right: -10px;
  top: 0;
  width: 10px;
  height: 100%;
  -webkit-mask-image: url('@/assets/sigma/jello/shadow_right.png');
  mask-image: url('@/assets/sigma/jello/shadow_right.png');
}

.ks-glow-top {
  left: 0;
  top: -10px;
  width: 100%;
  height: 10px;
  -webkit-mask-image: url('@/assets/sigma/jello/shadow_top.png');
  mask-image: url('@/assets/sigma/jello/shadow_top.png');
}

.ks-glow-bottom {
  left: 0;
  bottom: -10px;
  width: 100%;
  height: 10px;
  -webkit-mask-image: url('@/assets/sigma/jello/shadow_bottom.png');
  mask-image: url('@/assets/sigma/jello/shadow_bottom.png');
}

/* 3) 标签（JelloLightFont18、#FEFEFE，顶边 y+12） */
.ks-label {
  position: absolute;
  left: 0;
  right: 0;
  top: 12px;
  text-align: center;
  font-family: 'JelloLight', sans-serif;
  font-size: 18px;
  line-height: 18px;
  color: #fefefe;
}

/* 4) 松开扩散圆（裁剪在键矩形内） */
.ks-clip {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.ks-arc {
  position: absolute;
  border-radius: 50%;
}
</style>
