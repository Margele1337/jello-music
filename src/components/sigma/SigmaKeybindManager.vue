<template>
  <div class="kbm-root" :style="rootStyle">
    <!-- 标题：原版 JelloMediumFont40 / LIGHT_GREYISH_BLUE，位置 (居中, 键盘上方 90px) -->
    <div class="kbm-title">{{ title }}</div>

    <!-- 键盘底板：原版 Keyboard.draw → 外板 (x-20, y-20, w+40, h+45) 圆角 14，#FEFEFE -->
    <div class="kbm-plate">
      <div class="kbm-shadow"></div>
      <div class="kbm-keys">
        <div
          v-for="key in keys"
          :key="key.code + '-' + key.row"
          class="kbm-key"
          :class="{ 'is-hover': hovered === key.code, 'is-active': selected === key.code, 'is-bound': boundSet.has(key.code), 'is-highlight': highlightSet.has(key.code) }"
          :style="keyStyle(key)"
          @mouseenter="hovered = key.code"
          @mouseleave="hovered = null"
          @mousedown.prevent="selectKey(key)"
        >
          <span class="kbm-cap"></span>

          <!-- 标签（Return / Back / Meta / Menu / Space 用图形代替） -->
          <span v-if="key.label === 'Meta'" class="kbm-glyph kbm-meta"></span>
          <span v-else-if="key.label === 'Menu'" class="kbm-glyph kbm-menu">
            <i v-for="n in 4" :key="n"></i>
          </span>
          <span v-else-if="key.label === 'Back'" class="kbm-glyph kbm-back">
            <i class="arrow"></i><i class="bar"></i>
          </span>
          <span v-else-if="key.label === 'Return'" class="kbm-glyph kbm-return">
            <i class="bar"></i><i class="hook"></i>
          </span>
          <span v-else-if="key.label === 'Space'" class="kbm-glyph"></span>
          <span v-else class="kbm-label">{{ key.label }}</span>

          <!-- Caps Lock 悬停时出现的小圆点（原版 DARK_SLATE_GREY #6DCE27 × hover） -->
          <span v-if="key.label === 'Caps Lock'" class="kbm-caps-dot"></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// 对应 sigmarebase：
//   gui/impl/jello/ingame/KeyboardScreen.java（标题/入场缩放/背景着色）
//   gui/base/elements/impl/Keyboard.java（1060x357 白色底板）
//   gui/impl/jello/ingame/buttons/keybind/Keys.java（键位表，GLFW 键码）
//   gui/base/elements/impl/Child.java（键帽：#D0D0D0 底 + #F0F0F0 面，悬停抬升 3px，标签 #010101 40%/60%）
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  title: { type: String, default: 'Keybind Manager' },
  // 已绑定的 GLFW 键码（原版 field20693：字体变 Regular、标签透明度 +0.2）
  boundKeys: { type: Array, default: () => [] },
  // 需要强调的键（红色字体 + 红色描边），例如教程里的 RSHIFT
  highlightKeys: { type: Array, default: () => [] }
});

const emit = defineEmits(['select']);

// 键位表：[x, 宽度, 标签, GLFW键码, 行号(1-5)]
const RAW_KEYS = [
  [0, 63, '`', 96, 1], [73, 63, '1', 49, 1], [145, 63, '2', 50, 1], [218, 63, '3', 51, 1],
  [290, 63, '4', 52, 1], [363, 63, '5', 53, 1], [436, 63, '6', 54, 1], [508, 63, '7', 55, 1],
  [580, 63, '8', 56, 1], [653, 63, '9', 57, 1], [726, 63, '0', 48, 1], [798, 63, '-', 45, 1],
  [870, 63, '=', 61, 1], [943, 117, 'Back', 259, 1],
  [0, 99, 'Tab', 258, 2], [108, 63, 'Q', 81, 2], [181, 63, 'W', 87, 2], [253, 63, 'E', 69, 2],
  [325, 63, 'R', 82, 2], [399, 63, 'T', 84, 2], [471, 63, 'Y', 89, 2], [543, 63, 'U', 85, 2],
  [615, 63, 'I', 73, 2], [689, 63, 'O', 79, 2], [761, 63, 'P', 80, 2], [833, 63, '[', 91, 2],
  [905, 63, ']', 93, 2], [978, 82, '\\', 92, 2],
  [0, 116, 'Caps Lock', 280, 3], [127, 63, 'A', 65, 3], [199, 63, 'S', 83, 3], [271, 63, 'D', 68, 3],
  [343, 63, 'F', 70, 3], [417, 63, 'G', 71, 3], [489, 63, 'H', 72, 3], [561, 63, 'J', 74, 3],
  [633, 63, 'K', 75, 3], [707, 63, 'L', 76, 3], [779, 63, ';', 59, 3], [851, 63, "'", 39, 3],
  [924, 136, 'Return', 257, 3],
  [0, 153, 'Shift', 340, 4], [164, 63, 'Z', 90, 4], [236, 63, 'X', 88, 4], [308, 63, 'C', 67, 4],
  [381, 63, 'V', 86, 4], [454, 63, 'B', 66, 4], [526, 63, 'N', 78, 4], [598, 63, 'M', 77, 4],
  [671, 63, ',', 44, 4], [744, 63, '.', 46, 4], [816, 63, '/', 47, 4], [888, 172, 'Shift', 344, 4],
  [0, 97, 'Ctrl', 341, 5], [106, 63, 'Meta', 343, 5], [178, 103, 'Alt', 342, 5], [290, 427, 'Space', 32, 5],
  [726, 97, 'Alt Gr', 346, 5], [833, 63, 'Meta', 347, 5], [905, 63, 'Menu', 348, 5], [978, 82, 'Ctrl', 345, 5]
];

const keys = RAW_KEYS.map(([x, width, label, code, row]) => ({ x, width, label, code, row }));

// 原版面板尺寸：1060x357，行间距 74，键高 63，底板外扩 (-20, -20, +40, +45)
const PLATE_W = 1060;
const PLATE_H = 357;
const SCALE_MARGIN = 60;
const scale = ref(1);

const updateScale = () => {
  const availW = (window.innerWidth || 800) - SCALE_MARGIN;
  const availH = (window.innerHeight || 600) - SCALE_MARGIN - 120; // 预留标题与底部按钮
  scale.value = Math.min(1, availW / (PLATE_W + 40), availH / (PLATE_H + 45));
};
updateScale();

const rootStyle = computed(() => ({ '--kbm-scale': scale.value }));

const hovered = ref(null);
const selected = ref(null);
const boundSet = computed(() => new Set(props.boundKeys));
const highlightSet = computed(() => new Set(props.highlightKeys));

const keyStyle = (key) => ({
  left: `${key.x}px`,
  top: `${(key.row - 1) * 74}px`,
  width: `${key.width}px`,
  height: '63px'
});

const selectKey = (key) => {
  selected.value = key.code;
  emit('select', { keycode: key.code, name: key.label });
};

// 浏览器 KeyboardEvent.code → GLFW 键码（原版 Keys 表用的就是 GLFW 键码）
const CODE_TO_GLFW = {
  Backquote: 96, Minus: 45, Equal: 61, Backspace: 259, Tab: 258, BracketLeft: 91,
  BracketRight: 93, Backslash: 92, CapsLock: 280, Semicolon: 59, Quote: 39, Enter: 257,
  ShiftLeft: 340, ShiftRight: 344, ControlLeft: 341, ControlRight: 345,
  AltLeft: 342, AltRight: 346, MetaLeft: 343, MetaRight: 347, ContextMenu: 348,
  Space: 32, Comma: 44, Period: 46, Slash: 47
};

const codeToGlfw = (code) => {
  if (CODE_TO_GLFW[code] !== undefined) return CODE_TO_GLFW[code];
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code)) return code.charCodeAt(5);
  return null;
};

const onKeyDown = (event) => {
  const code = codeToGlfw(event.code);
  if (code === null) return;
  const key = keys.find((item) => item.code === code);
  if (!key) return;
  selected.value = code;
  emit('select', { keycode: code, name: key.label });
};

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', updateScale);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', updateScale);
});
</script>

<style scoped>
.kbm-root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 34px;
  /* 原版入场：0.8 → 1.0 的 easeOutBack 缩放 */
  animation: kbm-intro 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes kbm-intro {
  from { transform: scale(0.8); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

/* 标题：JelloMediumFont40 / #FEFEFE（与键盘同比例缩放，带中文回退字体） */
.kbm-title {
  font-family: 'JelloMedium', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
  font-size: 40px;
  line-height: 44px;
  color: #fefefe;
  letter-spacing: 2px;
  transform: scale(var(--kbm-scale, 1));
  transform-origin: center center;
}

/* 底板（含 -20/-20/+40/+45 外扩）+ 缩放适配 800x600 窗口 */
.kbm-plate {
  position: relative;
  width: 1100px;
  height: 402px;
  background: #fefefe;
  border-radius: 14px;
  transform: scale(var(--kbm-scale, 1));
  transform-origin: center center;
}

/* 原版 inner 圆角阴影层（alpha 0.5，向内收 7px，圆角 20） */
.kbm-shadow {
  position: absolute;
  inset: 7px;
  border-radius: 20px;
  background: rgba(254, 254, 254, 0.5);
  pointer-events: none;
}

/* 键位层：位于底板内部 (20, 20)，尺寸 1060x357 */
.kbm-keys {
  position: absolute;
  left: 20px;
  top: 20px;
  width: 1060px;
  height: 357px;
}

.kbm-key {
  position: absolute;
  cursor: pointer;
  user-select: none;
}

/* 底：shiftTowardsOther(#D0D0D0, #DEDEDE, hover)，位置 y+5 */
.kbm-key::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 5px;
  bottom: 0;
  border-radius: 8px;
  background: #d0d0d0;
  transition: background 0.1s linear;
}

.kbm-key.is-hover::before,
.kbm-key.is-active::before {
  background: #dedede;
}

/* 面：#F0F0F0，y + 3*hover（悬停/按下时整块抬起） */
.kbm-cap {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  border-radius: 8px;
  background: #f0f0f0;
  transition: transform 0.1s linear;
}

.kbm-key.is-hover .kbm-cap,
.kbm-key.is-active .kbm-cap {
  transform: translateY(-3px);
}

/* 标签：#010101，常态 40%，已绑定 60% */
.kbm-label {
  position: absolute;
  left: 0;
  right: 0;
  top: 19px;
  text-align: center;
  font-family: 'JelloLight', sans-serif;
  font-size: 20px;
  line-height: 22px;
  color: rgba(1, 1, 1, 0.4);
  pointer-events: none;
  transition: transform 0.1s linear, color 0.1s linear;
}

.kbm-key.is-bound .kbm-label {
  font-family: 'JelloMedium', sans-serif;
  color: rgba(1, 1, 1, 0.6);
}

.kbm-key.is-hover .kbm-label,
.kbm-key.is-active .kbm-label {
  transform: translateY(-3px);
}

/* 强调键（如 RSHIFT）：红色字体 + 红色描边 */
.kbm-key.is-highlight {
  z-index: 2;
}

.kbm-key.is-highlight::after {
  content: '';
  position: absolute;
  inset: -2px;
  border: 2px solid #ff4d4f;
  border-radius: 10px;
  box-shadow: 0 0 0 3px rgba(255, 77, 79, 0.18);
  pointer-events: none;
  transition: transform 0.1s linear;
}

.kbm-key.is-highlight.is-hover::after,
.kbm-key.is-highlight.is-active::after {
  transform: translateY(-3px);
}

.kbm-key.is-highlight .kbm-label {
  color: #ff4d4f;
}

.kbm-key.is-highlight.is-bound .kbm-label {
  color: #ff4d4f;
}

/* 图形键帽（Meta / Menu / Back / Return）：#010101，30%，已绑定 50% */
.kbm-glyph {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition: transform 0.1s linear;
}

.kbm-key.is-hover .kbm-glyph,
.kbm-key.is-active .kbm-glyph {
  transform: translateY(-3px);
}

/* Meta：实心圆，中心 (32, 32)，半径 14 */
.kbm-meta::before {
  content: '';
  position: absolute;
  left: 18px;
  top: 18px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(1, 1, 1, 0.3);
}

.kbm-key.is-bound .kbm-meta::before {
  background: rgba(1, 1, 1, 0.5);
}

/* Menu：四条横线 @ (25, 25)，宽 14、高 3、间隔 4 */
.kbm-menu i {
  position: absolute;
  left: 25px;
  width: 14px;
  height: 3px;
  border-radius: 2px;
  background: rgba(1, 1, 1, 0.3);
}

.kbm-menu i:nth-child(1) { top: 25px; }
.kbm-menu i:nth-child(2) { top: 29px; }
.kbm-menu i:nth-child(3) { top: 33px; }
.kbm-menu i:nth-child(4) { top: 37px; }

.kbm-key.is-bound .kbm-menu i {
  background: rgba(1, 1, 1, 0.5);
}

/* Back：左箭头 + 横杆 @ (43, 33) */
.kbm-back .arrow {
  position: absolute;
  left: 43px;
  top: 30px;
  width: 0;
  height: 0;
  border-top: 3px solid transparent;
  border-bottom: 3px solid transparent;
  border-right: 6px solid rgba(1, 1, 1, 0.3);
}

.kbm-back .bar {
  position: absolute;
  left: 49px;
  top: 32px;
  width: 21px;
  height: 2px;
  background: rgba(1, 1, 1, 0.3);
}

.kbm-key.is-bound .kbm-back .arrow { border-right-color: rgba(1, 1, 1, 0.5); }
.kbm-key.is-bound .kbm-back .bar { background: rgba(1, 1, 1, 0.5); }

/* Return：横杆 + 右侧上折钩 @ (50, 33) */
.kbm-return .bar {
  position: absolute;
  left: 56px;
  top: 32px;
  width: 21px;
  height: 2px;
  background: rgba(1, 1, 1, 0.3);
}

.kbm-return .hook {
  position: absolute;
  left: 75px;
  top: 25px;
  width: 2px;
  height: 8px;
  background: rgba(1, 1, 1, 0.3);
}

.kbm-key.is-bound .kbm-return .bar { background: rgba(1, 1, 1, 0.5); }
.kbm-key.is-bound .kbm-return .hook { background: rgba(1, 1, 1, 0.5); }

/* Caps Lock 悬停圆点：中心 (14, 11) + 3px 抬升，半径 10 */
.kbm-caps-dot {
  position: absolute;
  left: 4px;
  top: 1px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(112, 128, 144, 0);
  pointer-events: none;
  transition: background 0.1s linear, transform 0.1s linear;
}

.kbm-key.is-hover .kbm-caps-dot,
.kbm-key.is-active .kbm-caps-dot {
  background: rgba(109, 206, 39, 1);
  transform: translateY(-3px);
}
</style>
