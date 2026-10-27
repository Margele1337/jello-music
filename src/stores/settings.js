import { defineStore } from 'pinia';
import { SETTING_DEFAULTS } from '../../shared/settings.js';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    ...SETTING_DEFAULTS,
    ready: false
  }),
  actions: {
    apply(next) {
      if (next && typeof next === 'object') this.$patch(next);
    },
    async load() {
      if (window.jello?.settings?.get) {
        this.apply(await window.jello.settings.get());
      }
      this.ready = true;
    },
    async update(patch) {
      if (window.jello?.settings?.set) {
        this.apply(await window.jello.settings.set(patch));
      } else {
        this.$patch(patch);
      }
    }
  }
});
