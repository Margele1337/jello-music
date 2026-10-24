<template>
  <div class="sigma-changing-button" :style="containerStyle" @click="$emit('click')"></div>
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/button/types/ChangingButton.java
// 0=顺序播放（repeat+斜杠）/ 1=列表循环（repeat）/ 2=单曲循环（repeat+1）/ 3=随机（shuffle）
// 原 repeat.png 雪碧图帧 1/2 是实心白色药丸（小尺寸糊成白杠）、帧 0 是像素风空心箭头，
// 与其它图标风格割裂；统一改为 Feather 风格 2px 圆头描边矢量图标——20px 显示尺寸下
// 线条清晰、四种模式一眼可辨，矢量描边在任意 DPI 缩放都锐利
import { computed } from 'vue';

const props = defineProps({
  type: { type: Number, default: 1 }
});

defineEmits(['click']);

const svgIcon = (body) => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
)}")`;

// Feather repeat 的两条循环弧 + 箭头
const REPEAT_BODY = '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>';

const ICONS = {
  0: svgIcon(`${REPEAT_BODY}<line x1="4" y1="4" x2="20" y2="20"/>`),       // 顺序播放：循环+斜杠
  1: svgIcon(REPEAT_BODY),                                                   // 列表循环
  2: svgIcon(`${REPEAT_BODY}<path d="M11 10l1 1 3-3v6"/>`),                  // 单曲循环：循环+1
  3: svgIcon('<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>') // 随机
};

const containerStyle = computed(() => ({
  backgroundImage: ICONS[props.type] || ICONS[1],
  backgroundPosition: 'center',
  backgroundSize: 'contain',
  backgroundRepeat: 'no-repeat'
}));
</script>

<style scoped>
.sigma-changing-button {
  position: absolute;
  width: 27px;
  height: 20px;
  opacity: 0.35;
  cursor: pointer;
}
</style>
