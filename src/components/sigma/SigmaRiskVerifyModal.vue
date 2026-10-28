<script setup>
// 酷狗风控（20028）安全验证弹窗：由 risk store 驱动，挂在 SigmaView 上。
// v_type 32（短信验证码）可完整走通；v_type 23（腾讯滑块）需要加载远程脚本，
// 与 CSP script-src 'self' 冲突，这里只做明确提示（见 store 的 slider-blocked 分支）。
import { ref, watch } from 'vue';
import { useRiskStore } from '../../stores/risk.js';
import SigmaText from './SigmaText.vue';
import SigmaTextField from './SigmaTextField.vue';

const risk = useRiskStore();
const smsCode = ref('');

watch(() => risk.visible, (visible) => {
  if (visible) smsCode.value = '';
});

const onSubmitSms = () => {
  void risk.submitSms(smsCode.value);
};
</script>

<template>
  <teleport to="body">
    <transition name="risk-fade">
      <div v-if="risk.visible" class="risk-modal" @click.self="risk.cancel()">
        <div class="risk-card">
          <SigmaText class="risk-title" text="安全验证" :size="16" :box-width="292" :box-height="22" align="center" />

          <p v-if="risk.statusText" class="risk-status">{{ risk.statusText }}</p>

          <div v-if="risk.phase === 'sms'" class="risk-field">
            <SigmaTextField
              v-model="smsCode"
              placeholder="短信验证码"
              @submit="onSubmitSms"
            />
          </div>

          <p v-if="risk.errorText" class="risk-error">{{ risk.errorText }}</p>

          <div class="risk-actions">
            <button
              v-if="risk.phase === 'sms'"
              type="button"
              class="risk-btn primary"
              :disabled="risk.submitting || !smsCode.trim()"
              @click="onSubmitSms"
            >
              {{ risk.submitting ? '提交中…' : '提交验证码' }}
            </button>
            <button
              v-if="risk.phase === 'error' || risk.phase === 'slider-blocked'"
              type="button"
              class="risk-btn primary"
              @click="risk.retry()"
            >
              重试
            </button>
            <button type="button" class="risk-btn" :disabled="risk.submitting" @click="risk.cancel()">取消</button>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.risk-modal {
  position: fixed;
  inset: 0;
  z-index: 120;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.risk-card {
  width: min(340px, calc(100vw - 48px));
  display: flex;
  flex-direction: column;
  padding: 18px 24px 20px;
  border: 1px solid rgba(254, 254, 254, 0.14);
  border-radius: 14px;
  background: #17121d;
  font-family: 'SigmaLight', 'Segoe UI', 'Microsoft YaHei', sans-serif;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
}

.risk-title {
  margin: 0 auto 10px;
}

.risk-status {
  margin: 4px 0 12px;
  color: #b9b1c6;
  font-size: 13px;
  line-height: 1.6;
  text-align: center;
}

/* SigmaTextField 自身绝对定位：给它一个固定高度的定位容器 */
.risk-field {
  position: relative;
  height: 46px;
  margin: 0 0 12px;
}

.risk-error {
  margin: 0 0 12px;
  color: #ff8f9f;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}

.risk-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.risk-btn {
  height: 38px;
  border: 1px solid rgba(254, 254, 254, 0.16);
  border-radius: 999px;
  background: transparent;
  color: #b9b1c6;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.risk-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.risk-btn.primary {
  border: none;
  background: #ff69b4;
  color: #fff;
  font-weight: 600;
}

.risk-btn.primary:hover:not(:disabled) {
  background: #ff8fc7;
}

.risk-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.risk-fade-enter-active,
.risk-fade-leave-active {
  transition: opacity 0.18s ease;
}

.risk-fade-enter-from,
.risk-fade-leave-to {
  opacity: 0;
}
</style>
