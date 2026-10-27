import { defineStore } from 'pinia';

export const usePlayerStore = defineStore('player', {
  state: () => ({
    currentSong: null,
    playing: false,
    progress: 0
  }),
  actions: {
    setSong(song) {
      this.currentSong = song || null;
      this.progress = 0;
    },
    setPlaying(playing) {
      this.playing = !!playing;
    },
    setProgress(progress) {
      this.progress = Number(progress) || 0;
    }
  }
});
