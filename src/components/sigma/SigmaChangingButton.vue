<template>
  <div class="sigma-changing-button" :style="containerStyle" @click="$emit('click')"></div>
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/button/types/ChangingButton.java
// 0=顺序播放 / 1=列表循环 / 2=单曲循环：原版 repeat.png 三帧的矢量复刻
// （tools/gen-repeat-svg.cjs 把每个像素转成 SVG 矩形——位图在 150% 这类分数 DPI
// 下放大必然糊或锯齿，矢量边缘任意缩放都干净；造型与原版逐像素一致）。
// 原版 draw() 用 LIGHT_GREYISH_BLUE(0xFFFEFEFE，即白) @0.35 着色，由容器
// opacity 0.35 等价实现。
// 3=随机播放（魔改版新增，原版无此模式）：Material shuffle 矢量图标。
import { computed } from 'vue';
import repeat0 from '../../assets/sigma/music/repeat-0.svg';
import repeat1 from '../../assets/sigma/music/repeat-1.svg';
import repeat2 from '../../assets/sigma/music/repeat-2.svg';

const props = defineProps({
  type: { type: Number, default: 1 }
});

defineEmits(['click']);

const SHUFFLE_ICON = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>'
)}")`;

const ICONS = {
  0: `url('${repeat0}')`,
  1: `url('${repeat1}')`,
  2: `url('${repeat2}')`,
  3: SHUFFLE_ICON
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
