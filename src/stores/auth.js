import { defineStore } from 'pinia';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    profile: null
  }),
  getters: {
    isAuthenticated: (state) => !!state.profile
  },
  actions: {
    setProfile(profile) {
      this.profile = profile || null;
    },
    clear() {
      this.profile = null;
    }
  }
});
