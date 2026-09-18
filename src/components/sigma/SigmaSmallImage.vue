<template>
  <img class="sigma-small-image" :src="src" :alt="alt" @click="$emit('click')" />
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/image/types/SmallImage.java
// 图标按钮：恒 100% 不透明（原版按钮 alpha 来自颜色自身），悬停仅轻微变暗
defineProps({
  src: { type: String, required: true },
  alt: { type: String, default: '' }
});

defineEmits(['click']);
</script>

<style scoped>
.sigma-small-image {
  position: absolute;
  opacity: 1;
  cursor: pointer;
  transition: filter 0.12s ease;
  -webkit-user-drag: none;
}

.sigma-small-image:hover {
  filter: brightness(0.94);
}
</style>
