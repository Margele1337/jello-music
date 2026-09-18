<template>
  <div class="sigma-text-field">
    <input
      class="sigma-text-field-input"
      type="text"
      :value="modelValue"
      :placeholder="placeholder"
      spellcheck="false"
      style="background: transparent !important; background-color: transparent !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;"
      @input="$emit('update:modelValue', $event.target.value)"
      @keydown.enter="$emit('submit')"
    />
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/impl/jello/buttons/TextField.java
// 透明底，仅底部 2px 下划线；文字左对齐（xA + 4）、垂直居中（SansSerif 25px）
// 颜色 alpha：未悬停 0.5 → 悬停/聚焦 1.0；文字：未聚焦 0.2 → 悬停 0.45 → 聚焦且有内容 0.9
defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' }
});

defineEmits(['update:modelValue', 'submit']);
</script>

<style scoped>
.sigma-text-field {
  position: absolute;
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
  width: 100%;
  height: 100%;
  padding: 0 0 0 4px;
  background: transparent;
  border: none;
  outline: none;
  color: rgba(254, 254, 254, 0.9);
  /* 与 sigmarebase 一致：Jello 原版字体 */
  font-family: 'JelloLight', sans-serif;
  font-size: 25px;
  text-align: left;
  caret-color: #fefefe;
}

.sigma-text-field-input::placeholder {
  color: rgba(254, 254, 254, 0.2);
  transition: color 0.15s linear;
}

.sigma-text-field:hover .sigma-text-field-input::placeholder {
  color: rgba(254, 254, 254, 0.45);
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
  color: rgba(254, 254, 254, 0.9) !important;
}
</style>
