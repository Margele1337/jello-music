<template>
  <div class="sigma-scrollable-panel">
    <slot />
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/impl/jello/buttons/ScrollableContentPanel.java
// 可滚动容器；原版滚动条默认淡出（field20794 -> 0），仅在悬停时显示
</script>

<style scoped>
.sigma-scrollable-panel {
  position: absolute;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

/* 隐藏滚动条：长列表时滑块在右上角只剩一小截黑块，视觉上像脏点 */
.sigma-scrollable-panel::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
</style>
