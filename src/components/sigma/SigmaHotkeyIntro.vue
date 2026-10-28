<template>
  <div class="shi-root">
    <div class="shi-title">{{ title }}</div>
    <div class="shi-sub">{{ subtitle }}</div>

    <div class="shi-plate">
      <div v-for="(row, rowIndex) in rows" :key="rowIndex" class="shi-row">
        <div
          v-for="key in row"
          :key="key.code + rowIndex"
          class="shi-key"
          :class="{ 'is-dim': key.dim, 'is-rshift': key.code === 'ShiftRight', 'is-active': activeKey === key.code }"
          :style="key.flex !== 1 ? { flex: key.flex } : undefined"
          @mousedown.prevent="pressKey(key)"
        >
          <span class="shi-cap"></span>
          <span v-if="key.label" class="shi-label">{{ key.label }}</span>

          <!-- 呼出键说明标签：紧贴在右 Shift 键帽正上方 -->
          <div v-if="key.code === 'ShiftRight'" class="shi-tag">
            <span>右 Shift · 呼出 / 收起面板</span>
            <i class="shi-tag-caret"></i>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
// 新手教程的快捷键展示页（V2 键盘聚焦方案）：
// 只画右半段键盘，非目标键压暗，右 Shift 粉色描边脉冲高亮，
// 说明标签直接贴在右 Shift 键帽上方。键帽配色沿用 sigmarebase 复刻
// （SigmaKeybindManager.vue，已不再被教程引用）：底 #D0D0D0、面 #F0F0F0。
import { onBeforeUnmount, onMounted, ref } from 'vue';

defineProps({
  title: { type: String, default: '快捷呼出' },
  subtitle: { type: String, default: '点击键盘任意键可以预览，右 Shift 是你的呼出键' }
});

const emit = defineEmits(['select']);

const makeKey = (label, code, flex = 1, dim = true) => ({ label, code, flex, dim });

// 右半段键盘（与确认稿一致），code 用 KeyboardEvent.code 便于物理按键联动
const rows = [
  [makeKey('7', 'Digit7'), makeKey('8', 'Digit8'), makeKey('9', 'Digit9'), makeKey('0', 'Digit0'),
    makeKey('-', 'Minus'), makeKey('=', 'Equal'), makeKey('Back', 'Backspace', 1.6)],
  [makeKey('U', 'KeyU'), makeKey('I', 'KeyI'), makeKey('O', 'KeyO'), makeKey('P', 'KeyP'),
    makeKey('[', 'BracketLeft'), makeKey(']', 'BracketRight'), makeKey('\\', 'Backslash', 1.3)],
  [makeKey('J', 'KeyJ'), makeKey('K', 'KeyK'), makeKey('L', 'KeyL'), makeKey(';', 'Semicolon'),
    makeKey("'", 'Quote'), makeKey('Enter', 'Enter', 2.2)],
  [makeKey('M', 'KeyM'), makeKey(',', 'Comma'), makeKey('.', 'Period'), makeKey('/', 'Slash'),
    makeKey('Shift', 'ShiftRight', 2.6, false)],
  [makeKey('', 'Space', 2.4), makeKey('Alt Gr', 'AltRight'), makeKey('Meta', 'MetaRight'),
    makeKey('Menu', 'ContextMenu'), makeKey('Ctrl', 'ControlRight')]
];

const allKeys = rows.flat();
const activeKey = ref(null);
let activeTimer = null;

const flashKey = (code) => {
  activeKey.value = code;
  clearTimeout(activeTimer);
  activeTimer = setTimeout(() => { activeKey.value = null; }, 150);
};

const pressKey = (key) => {
  flashKey(key.code);
  emit('select', { code: key.code, name: key.label });
};

const onKeyDown = (event) => {
  if (!allKeys.some((item) => item.code === event.code)) return;
  flashKey(event.code);
};

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  clearTimeout(activeTimer);
});
</script>

<style scoped>
.shi-root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  /* 与原 KeyboardScreen 相同的入场：0.8 → 1.0 easeOutBack */
  animation: shi-intro 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes shi-intro {
  from { transform: scale(0.8); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.shi-title {
  font-family: 'SigmaVariable', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
  font-size: 36px;
  line-height: 42px;
  color: #fefefe;
  letter-spacing: 3px;
}

.shi-sub {
  font-family: 'SigmaLight', 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 15px;
  color: rgba(254, 254, 254, 0.55);
  margin-top: -8px;
}

/* 键盘底板：复刻白色外板（圆角 14）配色 */
.shi-plate {
  width: 640px;
  max-width: calc(100% - 48px);
  padding: 16px;
  background: #fefefe;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 10px;
}

.shi-row {
  display: flex;
  gap: 7px;
}

.shi-key {
  position: relative;
  flex: 1;
  height: 40px;
  cursor: pointer;
  user-select: none;
}

/* 底：#D0D0D0，向下露出 4px */
.shi-key::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 4px;
  bottom: 0;
  border-radius: 7px;
  background: #d0d0d0;
}

/* 面：#F0F0F0，悬停/按下整块抬起 3px */
.shi-cap {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 4px;
  border-radius: 7px;
  background: #f0f0f0;
  transition: transform 0.1s linear;
}

.shi-key:hover .shi-cap,
.shi-key.is-active .shi-cap {
  transform: translateY(-3px);
}

.shi-label {
  position: absolute;
  left: 0;
  right: 0;
  top: 10px;
  text-align: center;
  font-family: 'SigmaLight', 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 15px;
  line-height: 18px;
  color: rgba(1, 1, 1, 0.4);
  pointer-events: none;
  transition: transform 0.1s linear;
}

.shi-key:hover .shi-label,
.shi-key.is-active .shi-label {
  transform: translateY(-3px);
}

/* 非目标键整体压暗 */
.shi-key.is-dim {
  opacity: 0.45;
}

/* 右 Shift：全亮 + 粉色描边脉冲 */
.shi-key.is-rshift {
  z-index: 2;
}

.shi-key.is-rshift .shi-cap {
  background: #ffffff;
}

.shi-key.is-rshift .shi-label {
  font-family: 'SigmaVariable', 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 16px;
  color: rgba(1, 1, 1, 0.78);
}

.shi-key.is-rshift::after {
  content: '';
  position: absolute;
  inset: -3px;
  border: 2px solid #ff69b4;
  border-radius: 10px;
  pointer-events: none;
  transition: transform 0.1s linear;
  animation: shi-pulse 2.2s ease-in-out infinite;
}

.shi-key.is-rshift:hover::after,
.shi-key.is-rshift.is-active::after {
  transform: translateY(-3px);
}

@keyframes shi-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(255, 105, 180, 0.18), 0 0 8px rgba(255, 105, 180, 0.35); }
  50% { box-shadow: 0 0 0 3px rgba(255, 105, 180, 0.28), 0 0 20px rgba(255, 105, 180, 0.8); }
}

/* 说明标签：紧贴右 Shift 键帽正上方（右对齐键帽右缘），小三角指向键帽 */
.shi-tag {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  display: flex;
  align-items: center;
  background: #ff69b4;
  color: #fff;
  font-family: 'SigmaLight', 'Microsoft YaHei', 'PingFang SC', sans-serif;
  font-size: 13px;
  line-height: 1;
  padding: 7px 12px;
  border-radius: 8px;
  white-space: nowrap;
  box-shadow: 0 4px 14px rgba(255, 105, 180, 0.4);
  pointer-events: none;
}

.shi-tag-caret {
  position: absolute;
  top: 100%;
  right: 16px;
  width: 0;
  height: 0;
  border: 5px solid transparent;
  border-top-color: #ff69b4;
  border-bottom: none;
}
</style>
