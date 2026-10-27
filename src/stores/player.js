import { defineStore } from 'pinia';
import { useSettingsStore } from './settings.js';
import { getSongUrl } from '../services/api/library.js';

let audio = null;
let boundStore = null;
let loadToken = 0;
let persistTimer = null;

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

const ensureAudio = (store) => {
  if (audio) return audio;

  audio = new Audio();
  audio.preload = 'auto';
  audio.volume = clampPercent(store?.volume ?? 100) / 100;

  audio.addEventListener('play', () => {
    if (boundStore) boundStore.playing = true;
  });
  audio.addEventListener('pause', () => {
    if (boundStore) boundStore.playing = false;
  });
  audio.addEventListener('ended', () => {
    boundStore?.handleEnded();
  });
  audio.addEventListener('error', () => {
    if (!boundStore || !audio?.src) return;
    boundStore.playing = false;
    boundStore.error = '播放失败，可能是网络或音源不可用';
  });

  boundStore = store;
  return audio;
};

export const usePlayerStore = defineStore('player', {
  state: () => ({
    queue: [],
    index: -1,
    playing: false,
    loading: false,
    volume: 100,
    mode: 1,
    error: '',
    initialized: false
  }),

  getters: {
    currentSong: (state) => state.queue[state.index] || null,
    audio() {
      return ensureAudio(this);
    }
  },

  actions: {
    initialize() {
      if (this.initialized) return;
      this.initialized = true;
      const settings = useSettingsStore();
      const volume = Number(settings.volume);
      this.volume = clampPercent((Number.isFinite(volume) ? volume : 1) * 100);
      ensureAudio(this).volume = this.volume / 100;
    },

    applyPersistedVolume(fraction) {
      const value = Number(fraction);
      if (!Number.isFinite(value)) return;
      const next = clampPercent(value * 100);
      if (next === this.volume) return;
      this.volume = next;
      ensureAudio(this).volume = next / 100;
    },

    async loadCurrent({ keepTime = false, resume = true } = {}) {
      const song = this.currentSong;
      if (!song?.hash) return;

      const element = ensureAudio(this);
      const token = ++loadToken;
      const resumeAt = keepTime ? element.currentTime : 0;

      element.pause();
      this.playing = false;
      this.loading = true;
      this.error = '';

      try {
        const settings = useSettingsStore();
        const result = await getSongUrl(song, settings.quality || '320');
        if (token !== loadToken) return;

        element.src = result.url;
        element.volume = this.volume / 100;
        if (resumeAt > 0) {
          element.addEventListener('loadedmetadata', () => {
            try {
              element.currentTime = resumeAt;
            } catch {
              /* ignore seek failures */
            }
          }, { once: true });
        }
        if (resume) await element.play();
      } catch (error) {
        if (token === loadToken) {
          this.playing = false;
          this.error = error?.message || '播放失败';
        }
      } finally {
        if (token === loadToken) this.loading = false;
      }
    },

    reloadCurrent() {
      if (!this.currentSong) return;
      const element = ensureAudio(this);
      if (!element.src) return;
      void this.loadCurrent({ keepTime: true, resume: !element.paused });
    },

    playSongList(songs, hash) {
      const list = Array.isArray(songs) ? songs.filter((song) => song?.hash) : [];
      if (!list.length) return;

      this.queue = list;
      const index = hash ? list.findIndex((song) => song.hash === hash) : -1;
      this.index = index >= 0 ? index : 0;
      void this.loadCurrent();
    },

    togglePlayPause() {
      const element = ensureAudio(this);
      if (!element.src || element.error || !this.currentSong) {
        void this.loadCurrent();
        return;
      }
      if (element.paused) {
        void element.play().catch((error) => {
          this.playing = false;
          this.error = error?.message || '播放失败';
        });
      } else {
        element.pause();
      }
    },

    pause() {
      ensureAudio(this).pause();
    },

    playNext() {
      if (!this.queue.length) return;
      if (this.queue.length === 1) {
        void this.loadCurrent();
        return;
      }
      if (this.mode === 0) {
        let next = this.index;
        while (next === this.index) next = Math.floor(Math.random() * this.queue.length);
        this.index = next;
      } else {
        this.index = (this.index + 1) % this.queue.length;
      }
      void this.loadCurrent();
    },

    playPrevious() {
      if (!this.queue.length) return;
      if (this.queue.length === 1) {
        void this.loadCurrent();
        return;
      }
      if (this.mode === 0) {
        let previous = this.index;
        while (previous === this.index) previous = Math.floor(Math.random() * this.queue.length);
        this.index = previous;
      } else {
        this.index = (this.index - 1 + this.queue.length) % this.queue.length;
      }
      void this.loadCurrent();
    },

    handleEnded() {
      const element = ensureAudio(this);
      if (this.mode === 2) {
        element.currentTime = 0;
        void element.play().catch(() => {});
        return;
      }
      this.playNext();
    },

    togglePlaybackMode() {
      this.mode = (this.mode + 1) % 3;
    },

    seekBy(delta) {
      const element = ensureAudio(this);
      if (!element.src || !Number.isFinite(element.duration)) return;
      element.currentTime = Math.max(0, Math.min(element.duration, element.currentTime + delta));
    },

    changeVolume(delta) {
      this.setVolumePercent(this.volume + delta);
    },

    setVolumePercent(value) {
      const next = clampPercent(value);
      this.volume = next;
      ensureAudio(this).volume = next / 100;

      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        const settings = useSettingsStore();
        void settings.update({ volume: next / 100 }).catch(() => {});
      }, 500);
    }
  }
});
