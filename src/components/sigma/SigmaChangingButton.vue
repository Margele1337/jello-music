<template>
  <div class="sigma-changing-button" :style="spriteStyle" @click="$emit('click')"></div>
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/button/types/ChangingButton.java
// repeat.png 为三态横向雪碧图：0=NO_REPEAT / 1=REPEAT / 2=LOOP_CURRENT，透明度 0.35
// type=3 为魔改版新增的「随机播放」图标（原版没有随机模式），用内联 SVG
import { computed } from 'vue';
import repeatImg from '../../assets/sigma/music/repeat.png';

const props = defineProps({
  type: { type: Number, default: 1 }
});

defineEmits(['click']);

const RANDOM_ICON = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#fff"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>'
)}")`;

const spriteStyle = computed(() => {
  if (props.type === 3) {
    return {
      backgroundImage: RANDOM_ICON,
      backgroundPosition: 'center',
      backgroundSize: 'contain',
      backgroundRepeat: 'no-repeat'
    };
  }
  return {
    backgroundImage: `url('${repeatImg}')`,
    backgroundPositionX: ['0%', '50%', '100%'][props.type] || '50%',
    backgroundSize: '300% 100%',
    backgroundRepeat: 'no-repeat'
  };
});
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
