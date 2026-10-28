import { defineStore } from 'pinia';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    profile: null,
    ready: false,
    // 服务端判定登录态失效（error_code 20017 / 歌曲接口 status==2）：
    // 视图层（SigmaView）监听该标记跳转登录页
    expired: false
  }),
  getters: {
    isAuthenticated: (state) => !!state.profile
  },
  actions: {
    async load() {
      try {
        if (window.jello?.auth?.get) {
          this.profile = await window.jello.auth.get();
        }
      } finally {
        this.ready = true;
      }
    },
    setProfile(profile) {
      this.profile = profile || null;
      this.expired = false;
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
        if (profile) this.expired = false;
      }) || null;
    }
  }
});
