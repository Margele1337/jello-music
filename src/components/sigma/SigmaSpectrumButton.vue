<template>
  <div class="sigma-spectrum-button" :class="{ active }" @click="$emit('click')">
    <div class="sigma-spectrum-bar bar-1"></div>
    <div class="sigma-spectrum-bar bar-2"></div>
    <div class="sigma-spectrum-bar bar-3"></div>
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/button/types/SpectrumButton.java
// 三根白条：(10,16,5x14) / (17,10,5x20) / (24,20,5x10)
// 透明度：关闭 0.29（悬停 0.54）；开启 0.09（悬停 0.34）
defineProps({
  active: { type: Boolean, default: false }
});

defineEmits(['click']);
</script>

<style scoped>
.sigma-spectrum-button {
  position: absolute;
  cursor: pointer;
}

.sigma-spectrum-bar {
  position: absolute;
  width: 5px;
  background: #fefefe;
  opacity: 0.09; /* 关闭：暗 */
  transition: opacity 0.1s linear;
}

.bar-1 {
  left: 10px;
  top: 16px;
  height: 14px;
}

.bar-2 {
  left: 17px;
  top: 10px;
  height: 20px;
}

.bar-3 {
  left: 24px;
  top: 20px;
  height: 10px;
}

.sigma-spectrum-button.active .sigma-spectrum-bar {
  opacity: 0.29; /* 开启：亮 */
}

.sigma-spectrum-button:hover .sigma-spectrum-bar {
  opacity: 0.34;
}

.sigma-spectrum-button.active:hover .sigma-spectrum-bar {
  opacity: 0.54;
}
</style>
