<template>
  <div class="app-root">
    <!-- 播放器常驻挂载（旧版结构：设置/登录/歌词是叠在上面的浮层，切页不卸载播放器）。
         桌面歌词/频谱 HUD 窗口走各自的独立路由，不挂播放器。 -->
    <SigmaView v-if="showPlayerBase" class="app-base" />
    <RouterView v-slot="{ Component }">
      <Transition name="view-fade">
        <component :is="Component" v-if="route.path !== '/'" :key="route.fullPath"
          :class="isOverlayRoute ? 'app-overlay' : null" />
      </Transition>
    </RouterView>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SigmaView from './views/SigmaView.vue';
import { collectSongToLiked } from './services/api/collect.js';
import { getKaraokeLyrics, getLyrics } from './services/api/library.js';
import { refreshSpectrum, startSpectrum, stopSpectrum } from './services/audio/spectrum.js';
import { useAuthStore } from './stores/auth.js';
import { usePlayerStore } from './stores/player.js';
import { useSettingsStore } from './stores/settings.js';

const settings = useSettingsStore();
const auth = useAuthStore();
const player = usePlayerStore();
const route = useRoute();
const router = useRouter();

// HUD 窗口（桌面歌词/频谱）走独立路由，不挂播放器基座
const isHudRoute = computed(() => ['/desktop-lyrics', '/spectrum'].includes(route.path));
const showPlayerBase = computed(() => !isHudRoute.value);
// 设置/登录/歌词是叠在播放器上的全窗口浮层
const isOverlayRoute = computed(() => ['/settings', '/login', '/lyrics'].includes(route.path));

// ===== 收起/弹出时的视图回切（1:1 对齐旧版 SigmaUI.onSigmaDockChanged）=====
// 收起：若停留在设置/登录页，300ms 后带 0.3s 淡出切回播放器（40px 条显示的是播放器右缘）；
// 弹出：若还有待切的收起计时，瞬时切回播放器（无过渡），看到的直接是面板自己的滑出动画
let dockSwitchTimer = null;
let unsubscribeDockForView = null;

const goPlayerView = (instant) => {
  if (route.path === '/') return;
  // 播放器常驻，浮层淡出即完成切换，无需跳过过渡
  void instant;
  router.push('/');
};

const onDockChangedForView = (docked) => {
  if (docked) {
    if (route.path === '/' || dockSwitchTimer) return;
    dockSwitchTimer = setTimeout(() => {
      dockSwitchTimer = null;
      goPlayerView(false);
    }, 300);
    return;
  }
  if (dockSwitchTimer) {
    clearTimeout(dockSwitchTimer);
    dockSwitchTimer = null;
    goPlayerView(true);
  }
};

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

watch(() => player.playing, () => {
  if (settings.desktopLyrics) sendDesktopLyricsProgress(true);
});

const sendSpectrum = (payload) => window.jello?.spectrum?.update?.(payload);

const showToast = (message) => {
  window.dispatchEvent(new CustomEvent('jello:toast', { detail: message }));
};

let lastVolumeBeforeMute = 0;

const handlePlayerCommand = (command) => {
  if (command === 'toggle') player.togglePlayPause();
  else if (command === 'pause') player.pause();
  else if (command === 'previous') player.playPrevious();
  else if (command === 'next') player.playNext();
  else if (command === 'volume-up') player.changeVolume(5);
  else if (command === 'volume-down') player.changeVolume(-5);
  else if (command === 'toggle-mute') {
    if (player.volume > 0) {
      lastVolumeBeforeMute = player.volume;
      player.setVolumePercent(0);
    } else {
      player.setVolumePercent(lastVolumeBeforeMute || 50);
    }
  } else if (command === 'like') {
    collectSongToLiked(player.currentSong)
      .then(() => showToast('已添加到「我喜欢」'))
      .catch((error) => showToast(error?.message || '收藏失败'));
  }
};

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
  unsubscribeDockForView = window.jello?.windowControl?.onDockChanged?.(onDockChangedForView) || null;
  unsubscribePlayer = window.jello?.player?.onCommand?.((command) => {
    handlePlayerCommand(command);
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
  unsubscribeDockForView?.();
  unsubscribeDockForView = null;
  if (dockSwitchTimer) {
    clearTimeout(dockSwitchTimer);
    dockSwitchTimer = null;
  }
});
</script>

<style>
/* 视图过渡（对齐旧版 sigma-view-fade）：浮层离开 0.3s 淡出，露出常驻播放器（进入无过渡） */
.view-fade-leave-active {
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.view-fade-leave-to {
  opacity: 0;
}
</style>

<style scoped>
.app-root {
  position: relative;
  width: 100%;
  height: 100%;
}

.app-base {
  position: absolute;
  inset: 0;
}

.app-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
}
</style>
