<template>
  <RouterView />
</template>

<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { getKaraokeLyrics, getLyrics } from './services/api/library.js';
import { refreshSpectrum, startSpectrum, stopSpectrum } from './services/audio/spectrum.js';
import { useAuthStore } from './stores/auth.js';
import { usePlayerStore } from './stores/player.js';
import { useSettingsStore } from './stores/settings.js';

const settings = useSettingsStore();
const auth = useAuthStore();
const player = usePlayerStore();
let desktopLyricToken = 0;
let desktopLyricTimer = null;

const sendDesktopLyricsLyrics = (payload) => {
  window.jello?.desktopLyrics?.update?.(payload);
};

const sendDesktopLyricsProgress = (force = false) => {
  if (!settings.desktopLyrics) return;
  const audio = player.audio;
  const time = Number.isFinite(audio?.currentTime) ? audio.currentTime + 0.15 : 0;
  window.jello?.desktopLyrics?.progress?.({ time, playing: !!player.playing, force });
};

const loadDesktopLyrics = async () => {
  const token = ++desktopLyricToken;

  if (!player.currentSong || !settings.desktopLyrics) {
    sendDesktopLyricsLyrics({ hash: '', title: '', artist: '', lines: [] });
    return;
  }

  const song = player.currentSong;
  try {
    const krcLines = await getKaraokeLyrics(song);
    if (token !== desktopLyricToken || !settings.desktopLyrics) return;
    sendDesktopLyricsLyrics({
      hash: song.hash || '',
      title: song.name || '',
      artist: song.author || '',
      lines: krcLines.map((line) => ({
        characters: line.characters.map((char) => [char.c, char.s, char.e]),
        translated: line.translated || ''
      }))
    });
  } catch {
    if (token !== desktopLyricToken || !settings.desktopLyrics) return;
    // 没有逐字歌词时退回逐行 LRC，桌面歌词仍可显示
    try {
      const { lines } = await getLyrics(song);
      if (token !== desktopLyricToken || !settings.desktopLyrics) return;
      sendDesktopLyricsLyrics({
        hash: song.hash || '',
        title: song.name || '',
        artist: song.author || '',
        lines: lines.map((line) => ({
          characters: [[line.text, line.time * 1000, (line.time + 4) * 1000]],
          translated: ''
        }))
      });
    } catch {
      if (token !== desktopLyricToken) return;
      sendDesktopLyricsLyrics({ hash: song.hash || '', title: song.name || '', artist: song.author || '', lines: [] });
    }
  }
  sendDesktopLyricsProgress(true);
};

const startDesktopLyrics = () => {
  if (desktopLyricTimer) return;
  desktopLyricTimer = setInterval(() => sendDesktopLyricsProgress(), 250);
};

const stopDesktopLyrics = () => {
  if (desktopLyricTimer) clearInterval(desktopLyricTimer);
  desktopLyricTimer = null;
};

watch(() => settings.desktopLyrics, (enabled) => {
  if (enabled) {
    void loadDesktopLyrics();
    startDesktopLyrics();
  } else {
    desktopLyricToken += 1;
    stopDesktopLyrics();
  }
});
let unsubscribeSettings = null;
let unsubscribeAuth = null;
let unsubscribePlayer = null;
let unsubscribeSpectrumRequest = null;

watch(() => settings.quality, (next, previous) => {
  if (previous && next !== previous) player.reloadCurrent();
});

watch(() => player.currentSong?.hash, () => {
  if (settings.desktopLyrics) void loadDesktopLyrics();
});

watch(() => player.playing, (playing) => {
  window.jello?.player?.setPlaying?.(playing === true);
  if (settings.desktopLyrics) sendDesktopLyricsProgress(true);
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

watch(() => settings.playbackRate, (rate) => {
  player.setPlaybackRate(Number(rate) || 1);
});
watch(() => settings.loudnessNormalization, (enabled) => {
  player.applyLoudnessSetting(enabled);
});
watch(() => settings.audioOutputDevice, (deviceId) => {
  player.applyOutputDevice(deviceId);
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
  if (settings.desktopLyrics) {
    void loadDesktopLyrics();
    startDesktopLyrics();
  }
  if (Number.isFinite(Number(settings.playbackRate)) && Number(settings.playbackRate) !== 1) {
    player.setPlaybackRate(Number(settings.playbackRate));
  }
  if (settings.audioOutputDevice && settings.audioOutputDevice !== 'default') {
    player.applyOutputDevice(settings.audioOutputDevice);
  }
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
