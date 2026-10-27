import { defineStore } from 'pinia';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    profile: null,
    ready: false
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
    },
    async clear() {
      if (window.jello?.auth?.clear) {
        await window.jello.auth.clear();
      }
      this.profile = null;
    },
    subscribe() {
      return window.jello?.auth?.onChange?.((profile) => {
        this.profile = profile || null;
      }) || null;
    }
  }
});
