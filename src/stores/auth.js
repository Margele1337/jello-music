import { defineStore } from 'pinia';
import {
  clearGuestChoice,
  readGuestChoice,
  writeGuestChoice
} from '../services/api/auth.js';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    profile: null,
    ready: false,
    // 服务端判定登录态失效（error_code 20017 / 歌曲接口 status==2）：
    // 视图层（SigmaView）监听该标记跳转登录页
    expired: false,
    // 游客模式：记住用户「跳过登录」的选择，下次启动不再打扰（localStorage 单标记）
    guestRemembered: readGuestChoice()
  }),
  getters: {
    isAuthenticated: (state) => !!state.profile,
    // 当前是否处于「已记住的游客态」（未登录且记住了跳过）
    isGuest: (state) => !state.profile && state.guestRemembered
  },
  actions: {
    async load() {
      try {
        if (window.jello?.auth?.get) {
          this.profile = await window.jello.auth.get();
        }
      } finally {
        // 已有登录态时清掉游客标记，避免残留导致下次启动误判
        if (this.profile) this.clearGuestRemember();
        this.ready = true;
      }
    },
    setProfile(profile) {
      this.profile = profile || null;
      this.expired = false;
      // 登录成功即清除游客记忆：下次启动应走正常登录态
      if (profile) this.clearGuestRemember();
    },
    rememberGuest() {
      this.guestRemembered = true;
      writeGuestChoice();
    },
    clearGuestRemember() {
      this.guestRemembered = false;
      clearGuestChoice();
    },
    markExpired() {
      if (!this.profile) return;
      this.expired = true;
    },
    clearExpired() {
      this.expired = false;
    },
    async clear() {
      if (window.jello?.auth?.clear) {
        await window.jello.auth.clear();
      }
      this.profile = null;
      this.expired = false;
    },
    subscribe() {
      return window.jello?.auth?.onChange?.((profile) => {
        this.profile = profile || null;
        if (profile) {
          this.expired = false;
          this.clearGuestRemember();
        }
      }) || null;
    }
  }
});
