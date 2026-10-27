<template>
  <div class="sigma-changing-button" :style="containerStyle" @click="$emit('click')"></div>
</template>

<script setup>
// 播放模式图标（用户选定 V2 · Material 实心，仅三态，顺序播放已移除）：
// 1=列表循环 repeat / 2=单曲循环 repeat_one / 3=随机 shuffle（均为 Material 矢量图标）。
// 白色 @0.35 由容器 opacity 实现（原版 ChangingButton 的着色方式）；矢量任意 DPI 干净锐利。
import { computed } from 'vue';

const props = defineProps({
  type: { type: Number, default: 1 }
});

defineEmits(['click']);

const svgIcon = (path) => `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="${path}"/></svg>`
)}")`;

const ICONS = {
  1: svgIcon('M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z'),
  2: svgIcon('M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z'),
  3: svgIcon('M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z')
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
