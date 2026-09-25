<template>
  <div class="sigma-text-field">
    <canvas ref="canvasRef" class="sigma-text-field-canvas"></canvas>
    <input
      ref="inputRef"
      class="sigma-text-field-input"
      :class="{ 'is-composing': composing }"
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      spellcheck="false"
      style="background: transparent !important; background-color: transparent !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;"
      @input="onInput"
      @scroll="render"
      @keydown.enter="$emit('submit')"
      @focus="onFocus"
      @blur="onBlur"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
    />
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/impl/jello/buttons/TextField.java
// 透明底，仅底部 2px 下划线；文字左对齐（xA + 4）。
// 文字用 Java2D 图集渲染（getChineseFont(25) -> 逻辑字体），原生 input 只负责
// 输入/光标/选区/输入法：文字设为透明，输入法组字期间切回原生显示。
// 透明度同原版：(field20744/2 + 0.4) * (聚焦且有内容 ? 1 : 0.5)
//   聚焦且有内容 0.9 / 聚焦空 0.45 / 未聚焦 0.2
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { loadSigmaAtlas, drawSigmaText } from '../../utils/sigmaFontAtlas';

const FIELD_FONT = 'Arial, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const FIELD_SIZE = 25;
const FIELD_PAD_LEFT = 4;

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' }
});

const emit = defineEmits(['update:modelValue', 'submit']);

const canvasRef = ref(null);
const inputRef = ref(null);
const atlas = ref(null);
const focused = ref(false);
const composing = ref(false);

const measureCtx = document.createElement('canvas').getContext('2d');
let resizeObserver = null;

const onInput = (event) => {
  emit('update:modelValue', event.target.value);
};

const onFocus = () => {
  focused.value = true;
};

const onBlur = () => {
  focused.value = false;
};

const onCompositionStart = () => {
  composing.value = true;
};

const onCompositionEnd = (event) => {
  composing.value = false;
  emit('update:modelValue', event.target.value);
};

const render = () => {
  const canvas = canvasRef.value;
  const input = inputRef.value;
  const atlasValue = atlas.value;
  if (!canvas || !input) return;
  const width = Math.round(canvas.clientWidth || 0);
  const height = Math.round(canvas.clientHeight || 0);
  if (width <= 0 || height <= 0) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  // 组字期间由原生输入框显示（含输入法候选框），图集不绘制
  if (!atlasValue || composing.value) return;

  const hasValue = !!props.modelValue;
  const text = hasValue ? props.modelValue : (props.placeholder || '');
  const alpha = focused.value ? (hasValue ? 0.9 : 0.45) : 0.2;

  // 与原生 input 的基线对齐：用浏览器度量算出 line box 内的基线
  measureCtx.font = FIELD_SIZE + 'px ' + FIELD_FONT;
  const metrics = measureCtx.measureText('Hg');
  const ascent = metrics.fontBoundingBoxAscent ?? FIELD_SIZE * 0.9;
  const descent = metrics.fontBoundingBoxDescent ?? FIELD_SIZE * 0.25;
  const baseline = Math.round((height - (ascent + descent)) / 2 + ascent);
  const y = baseline - atlasValue.ascent;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  drawSigmaText(ctx, atlasValue, text, FIELD_PAD_LEFT - (input.scrollLeft || 0), y, alpha, '#fefefe');
  ctx.restore();
};

onMounted(async () => {
  try {
    atlas.value = await loadSigmaAtlas(FIELD_SIZE, 'sans');
  } catch (error) {
    console.error('[SigmaTextField] 字体图集加载失败:', error);
  }
  if (typeof ResizeObserver !== 'undefined' && canvasRef.value) {
    resizeObserver = new ResizeObserver(render);
    resizeObserver.observe(canvasRef.value);
  }
  render();
});

watch(() => [props.modelValue, props.placeholder, focused.value, composing.value], render);
watch(atlas, render);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.sigma-text-field {
  position: absolute;
}

.sigma-text-field-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.sigma-text-field::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: rgba(254, 254, 254, 0.5);
  transition: background 0.15s linear;
}

.sigma-text-field:hover::after,
.sigma-text-field:focus-within::after {
  background: rgba(254, 254, 254, 1);
}

.sigma-text-field-input {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 0 0 0 4px;
  background: transparent;
  border: none;
  outline: none;
  /* 文字由 canvas 图集绘制：透明文字保留光标与选区 */
  color: transparent;
  /* 与图集 advance 对齐（无字距调整/连字） */
  font-family: Arial, 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
  font-size: 25px;
  font-kerning: none;
  font-variant-ligatures: none;
  text-align: left;
  caret-color: #fefefe;
}

.sigma-text-field-input::placeholder {
  color: transparent;
}
</style>

<style>
/* 覆盖 App 全局的玻璃输入框样式（#app.rise-active input[type="text"] !important），
   还原 sigmarebase 的透明输入框：无底色、无边框、无圆角 */
#app.rise-active .sigma-text-field-input,
#app.rise-active .sigma-text-field-input:focus {
  background-color: transparent !important;
  border: none !important;
  border-radius: 0 !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  color: transparent !important;
}

/* 输入法组字期间由原生输入框显示文字（含候选框定位），需覆盖上面的透明色 */
#app.rise-active .sigma-text-field-input.is-composing {
  color: rgba(254, 254, 254, 0.9) !important;
}
</style>
