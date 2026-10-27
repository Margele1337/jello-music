<script setup>
import { onBeforeUnmount, reactive } from 'vue';
import SigmaMusicPlayer from '../components/sigma/SigmaMusicPlayer.vue';

const demoSongs = [
  { hash: 'demo-1', title: '海阔天空', artist: 'Beyond', timelen: 326000 },
  { hash: 'demo-2', title: '晴天', artist: '周杰伦', timelen: 269000 },
  { hash: 'demo-3', title: 'Yellow', artist: 'Coldplay', timelen: 269000 },
  { hash: 'demo-4', title: '夜空中最亮的星', artist: '逃跑计划', timelen: 252000 }
];

const state = reactive({
  index: 0,
  playing: false,
  volume: 80,
  mode: 1,
  audio: {
    currentTime: 0,
    duration: demoSongs[0].timelen / 1000
  }
});

const current = () => demoSongs[state.index] || demoSongs[0];

const applySong = (song) => {
  const index = demoSongs.findIndex((item) => item.hash === song.hash);
  if (index >= 0) {
    state.index = index;
  } else {
    demoSongs.push(song);
    state.index = demoSongs.length - 1;
  }
  state.audio.currentTime = 0;
  state.audio.duration = Math.max(1, (song.timelen || 326000) / 1000);
  state.playing = true;
};

const player = {
  get currentSong() {
    const song = current();
    return {
      hash: song.hash,
      name: song.title,
      author: song.artist,
      img: '',
      timeLength: song.timelen
    };
  },
  get playing() {
    return state.playing;
  },
  get volume() {
    return state.volume;
  },
  get currentPlaybackModeIndex() {
    return state.mode;
  },
  get audio() {
    return state.audio;
  },
  togglePlayPause() {
    state.playing = !state.playing;
  },
  pause() {
    state.playing = false;
  },
  playNext() {
    if (state.mode === 0) {
      state.index = Math.floor(Math.random() * demoSongs.length);
    } else {
      state.index = (state.index + 1) % demoSongs.length;
    }
    applySong(current());
  },
  playPrevious() {
    state.index = (state.index - 1 + demoSongs.length) % demoSongs.length;
    applySong(current());
  },
  togglePlaybackMode() {
    state.mode = (state.mode + 1) % 3;
  },
  setVolumePercent(value) {
    const next = Number(value);
    if (Number.isFinite(next)) state.volume = Math.max(0, Math.min(100, next));
  },
  playSongList(songs, hash) {
    if (!Array.isArray(songs) || songs.length === 0) return;
    const picked = songs.find((song) => song.hash === hash) || songs[0];
    applySong({
      hash: picked.hash,
      title: picked.name || picked.title || '未知歌曲',
      artist: picked.author || picked.artist || '',
      timelen: picked.timelen || 326000
    });
  }
};

const timer = setInterval(() => {
  if (!state.playing) return;
  state.audio.currentTime = Math.min(state.audio.currentTime + 0.25, state.audio.duration);
  if (state.audio.currentTime >= state.audio.duration) {
    if (state.mode === 2) {
      state.audio.currentTime = 0;
    } else {
      player.playNext();
    }
  }
}, 250);

onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <main class="sigma-page">
    <div class="sigma-stage">
      <SigmaMusicPlayer :player="player" />
    </div>
  </main>
</template>

<style scoped>
.sigma-page {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: radial-gradient(120% 120% at 25% 0%, #2a2233 0%, #17121d 55%, #0e0c12 100%);
}

.sigma-stage {
  width: 800px;
  height: 600px;
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
}
</style>
