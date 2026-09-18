<template>
  <div class="sigma-changing-button" :style="spriteStyle" @click="$emit('click')"></div>
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/button/types/ChangingButton.java
// repeat.png 为三态横向雪碧图：0=NO_REPEAT / 1=REPEAT / 2=LOOP_CURRENT，透明度 0.35
import { computed } from 'vue';
import repeatImg from '../../assets/sigma/music/repeat.png';

const props = defineProps({
  type: { type: Number, default: 1 }
});

defineEmits(['click']);

const spriteStyle = computed(() => ({
  backgroundImage: `url('${repeatImg}')`,
  backgroundPositionX: ['0%', '50%', '100%'][props.type] || '50%',
  backgroundSize: '300% 100%',
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
