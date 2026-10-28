<template>
  <RouterView />
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getLyrics } from './services/api/library.js';
import { refreshSpectrum, startSpectrum, stopSpectrum } from './services/audio/spectrum.js';
import { useAuthStore } from './stores/auth.js';
import { usePlayerStore } from './stores/player.js';
import { useSettingsStore } from './stores/settings.js';

const settings = useSettingsStore();
const auth = useAuthStore();
const player = usePlayerStore();
const desktopLyricLines = ref([]);
let desktopLyricToken = 0;
let desktopLyricTimer = null;
let lastDesktopState = '';
let unsubscribeSettings = null;
let unsubscribeAuth = null;
let unsubscribePlayer = null;
let unsubscribeSpectrumRequest = null;

watch(() => settings.quality, (next, previous) => {
  if (previous && next !== previous) player.reloadCurrent();
});

const buildDesktopState = () => {
  const song = player.currentSong;
  const audio = player.audio;
  const time = Number.isFinite(audio?.currentTime) ? audio.currentTime + 0.15 : 0;
  let index = -1;
  for (let i = 0; i < desktopLyricLines.value.length; i += 1) {
    if (desktopLyricLines.value[i].time > time) break;
    index = i;
  }
  return {
    title: song?.name || '',
    artist: song?.author || '',
    current: desktopLyricLines.value[index]?.text || '',
    next: desktopLyricLines.value[index + 1]?.text || '',
    playing: !!player.playing
  };
};

const pushDesktopState = (force = false) => {
  if (!settings.desktopLyrics) return;
  const state = buildDesktopState();
  const key = JSON.stringify(state);
  if (!force && key === lastDesktopState) return;
  lastDesktopState = key;
  window.jello?.desktopLyrics?.update?.(state);
};

const loadDesktopLyrics = async () => {
  const token = ++desktopLyricToken;
  desktopLyricLines.value = [];
  lastDesktopState = '';

  if (!player.currentSong || !settings.desktopLyrics) {
    pushDesktopState(true);
    return;
  }

  try {
    const result = await getLyrics(player.currentSong);
    if (token !== desktopLyricToken || !settings.desktopLyrics) return;
    desktopLyricLines.value = result.lines;
  } catch {
    if (token !== desktopLyricToken) return;
    desktopLyricLines.value = [];
  }
  pushDesktopState(true);
};

const startDesktopLyrics = () => {
  if (desktopLyricTimer) return;
  desktopLyricTimer = setInterval(() => pushDesktopState(), 250);
};

const stopDesktopLyrics = () => {
  if (desktopLyricTimer) clearInterval(desktopLyricTimer);
  desktopLyricTimer = null;
  lastDesktopState = '';
};

watch(() => settings.desktopLyrics, (enabled) => {
  if (enabled) {
    void loadDesktopLyrics();
    startDesktopLyrics();
  } else {
    desktopLyricToken += 1;
    desktopLyricLines.value = [];
    stopDesktopLyrics();
  }
});

watch(() => player.currentSong?.hash, () => {
  if (settings.desktopLyrics) void loadDesktopLyrics();
});

watch(() => player.playing, () => {
  if (settings.desktopLyrics) pushDesktopState(true);
});

const sendSpectrum = (payload) => window.jello?.spectrum?.update?.(payload);

const syncSpectrum = () => {
  if (settings.spectrum) {
    if (player.audio.crossOrigin !== 'anonymous') {
      player.audio.crossOrigin = 'anonymous';
      player.reloadCurrent();
    }
    void startSpectrum(player.audio, {
      getSong: () => player.currentSong,
      isPlaying: () => player.playing,
      getVolume: () => settings.volume,
      getMuted: () => false,
      send: sendSpectrum
    });
  } else {
    stopSpectrum(sendSpectrum);
  }
};

watch(() => settings.spectrum, syncSpectrum);
watch(() => player.currentSong?.hash, () => {
  if (settings.spectrum) refreshSpectrum();
});
watch(() => player.playing, () => {
  if (settings.spectrum) refreshSpectrum();
});

const isInteractive = (target) => (
  ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target?.tagName)
  || target?.isContentEditable
);

const onKeyDown = (event) => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  if (isInteractive(event.target)) return;

  switch (event.code) {
    case 'Space':
      event.preventDefault();
      player.togglePlayPause();
      break;
    case 'ArrowLeft':
      event.preventDefault();
      player.seekBy(-5);
      break;
    case 'ArrowRight':
      event.preventDefault();
      player.seekBy(5);
      break;
    case 'ArrowUp':
      event.preventDefault();
      player.changeVolume(5);
      break;
    case 'ArrowDown':
      event.preventDefault();
      player.changeVolume(-5);
      break;
    default:
      break;
  }
};

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown);
  await Promise.all([settings.load(), auth.load()]);
  unsubscribeSettings = window.jello?.settings?.onChange?.((next) => settings.apply(next)) || null;
  unsubscribeAuth = auth.subscribe();
  unsubscribePlayer = window.jello?.player?.onCommand?.((command) => {
    if (command === 'toggle') player.togglePlayPause();
    else if (command === 'previous') player.playPrevious();
    else if (command === 'next') player.playNext();
  }) || null;
  unsubscribeSpectrumRequest = window.jello?.spectrum?.onRequestCurrent?.(() => {
    if (settings.spectrum) refreshSpectrum();
  }) || null;
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  stopDesktopLyrics();
  stopSpectrum(sendSpectrum);
  unsubscribeSettings?.();
  unsubscribeAuth?.();
  unsubscribePlayer?.();
  unsubscribeSpectrumRequest?.();
});
</script>
