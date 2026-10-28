import { defineStore } from 'pinia';
import {
  fetchVerifyInfo,
  parseVerifyInfo,
  runManualVerify,
  submitVerifyCode,
  isVerifySubmitSuccess,
  verifySubmitMessage
} from '../services/api/riskVerify.js';

// openVerify 的 Promise resolver 不放 state（函数不适合响应式序列化）
let pendingResolve = null;

export const useRiskStore = defineStore('risk', {
  state: () => ({
    visible: false,
    eventId: '',
    // loading | sms | slider-blocked | error
    phase: 'loading',
    statusText: '',
    errorText: '',
    vType: 0,
    txAppId: '',
    submitting: false,
    manualBusy: false,
    manualResult: null
  }),
  actions: {
    // 由 riskVerify.js 的验证调度器调用：弹窗并返回用户是否通过验证
    openVerify(eventId) {
      this.settle(false);
      this.eventId = String(eventId || '');
      this.visible = true;
      this.errorText = '';
      this.submitting = false;
      this.vType = 0;
      this.txAppId = '';
      return new Promise((resolve) => {
        pendingResolve = resolve;
        void this.loadVerifyInfo();
      });
    },

    async loadVerifyInfo() {
      this.phase = 'loading';
      this.statusText = '正在获取验证信息…';
      this.errorText = '';
      try {
        const response = await fetchVerifyInfo(this.eventId);
        const info = parseVerifyInfo(response);
        if (!info.ok) throw new Error(info.message);

        this.vType = info.vType;
        this.txAppId = info.txAppId;

        if (info.vType === 32) {
          this.phase = 'sms';
          this.statusText = '请输入收到的短信验证码';
          return;
        }
        if (info.vType === 23) {
          // 腾讯滑块需要加载 turing.captcha.qcloud.com 的远程脚本，
          // 与 CSP（script-src 'self'）冲突，不能在内嵌弹窗里完成——明确告知用户
          this.phase = 'slider-blocked';
          this.statusText = '酷狗要求完成滑块验证';
          this.errorText = '当前安全策略不允许内嵌腾讯滑块验证码，请稍后重试或更换网络环境';
          return;
        }
        throw new Error(`暂不支持该验证类型：${info.vType}`);
      } catch (error) {
        this.phase = 'error';
        this.statusText = '';
        this.errorText = error?.message || '安全验证失败';
      }
    },

    async submitSms(code) {
      const value = String(code || '').trim();
      if (!value || this.submitting) return;
      this.submitting = true;
      this.errorText = '';
      try {
        const response = await submitVerifyCode({ eventId: this.eventId, vType: this.vType, code: value });
        if (!isVerifySubmitSuccess(response)) {
          throw new Error(verifySubmitMessage(response));
        }
        this.settle(true);
      } catch (error) {
        this.errorText = error?.message || '提交失败';
      } finally {
        this.submitting = false;
      }
    },

    retry() {
      void this.loadVerifyInfo();
    },

    cancel() {
      this.settle(false);
    },

    // 验证超时等外部原因强制关闭弹窗
    abortVerify() {
      if (this.visible) this.settle(false);
    },

    settle(verified) {
      this.visible = false;
      this.submitting = false;
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve?.(!!verified);
    },

    // 设置页「安全验证」入口：探针请求 → 弹验证 → 复查。
    // 返回 { needed, verified, stillBlocked?, reason? } 供调用方提示
    async openManualVerify() {
      if (this.manualBusy) return this.manualResult;
      this.manualBusy = true;
      try {
        const result = await runManualVerify();
        this.manualResult = result;
        return result;
      } finally {
        this.manualBusy = false;
      }
    }
  }
});
