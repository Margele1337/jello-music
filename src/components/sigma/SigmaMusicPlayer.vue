<template>
  <div class="sigma-music-player" :class="{ translucent, revealing, docked }" @pointerdown="onPointerDown">
    <!-- 右侧面板 #262626 80% -->
    <div class="smp-right-panel"></div>
    <!-- 左侧面板 black 95% -->
    <div class="smp-left-panel"></div>

    <!-- 底部封面条（模糊封面裁切 20%） -->
    <canvas class="smp-strip" ref="stripCanvas" width="800" height="94"></canvas>
    <div class="smp-strip-overlay"></div>
    <div class="smp-strip-overlay-bottom"></div>

    <!-- 专辑封面 114x114 @ (68,430) -->
    <div class="smp-artwork" :style="artworkStyle"></div>

    <!-- 歌名 / 歌手（无歌手时为单行 Jello Music，位于 y=562）：Java2D 图集渲染 + 原版跑马灯 -->
    <SigmaText class="smp-title" :class="{ single: !titleLine2 }" :text="titleLine1" :size="14" :box-width="190" :box-height="16" align="center" scroll :phase="0" />
    <SigmaText class="smp-subtitle" v-if="titleLine2" :text="titleLine2" :size="14" :box-width="190" :box-height="16" align="center" scroll :phase="0" />

    <!-- 时长 -->
    <SigmaText class="smp-time-left" :text="elapsedText" :size="14" :box-height="16" />
    <SigmaText class="smp-time-right" :text="durationText" :size="14" :box-width="50" :box-height="16" align="right" />

    <!-- Logo：可变细字重，贴近旧 Jello 图标的字标 -->
    <span class="smp-logo">Jello</span>
    <span class="smp-logo-sub">music</span>

    <!-- 左栏歌单（每日推荐 / 我喜欢 / 我的歌单…），位于封面之下 -->
    <SigmaPlaylistPanel class="smp-playlist" :temporary-playlist="temporaryPlaylist" @select="onPlaylistSelect" />

    <!-- 控制按钮 -->
    <SigmaSmallImage class="smp-prev" :src="backwardsImg" @click="player?.playPrevious?.()" />
    <SigmaSmallImage class="smp-play" :src="playing ? pauseImg : playImg" @click="togglePlay" />
    <SigmaSmallImage class="smp-next" :src="forwardsImg" @click="player?.playNext?.()" />
    <SigmaChangingButton class="smp-repeat" :type="repeatType" @click="player?.togglePlaybackMode?.()" />

    <!-- 音量 4x40 @ (781,520) -->
    <SigmaVolumeSlider class="smp-volume" :value="volumePercent" @change="onVolumeChange" />

    <!-- 进度条 550x5 @ (250,595) -->
    <SigmaProgressBar class="smp-progress" :percent="progressPercent" @seek="onSeek" />

    <!-- 频谱按钮 40x40 @ (15,460) -->
    <SigmaSpectrumButton class="smp-spectrum" :active="spectrumEnabled" @click="$emit('toggle-spectrum')" />

    <!-- 播放队列按钮 + 队列弹窗 -->
    <button type="button" class="smp-queue-btn" title="播放列表" @click="queueListRef?.toggle?.()">
      <i></i><i></i><i></i>
    </button>
    <SigmaQueueList ref="queueListRef" :player="player" />

    <!-- 收藏到歌单按钮 + 弹窗 -->
    <button type="button" class="smp-collect-btn" title="收藏到歌单" @click="openCollect">
      <svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.9-9.7-9.2C.7 8.6 2.4 5 5.9 5c2 0 3.4 1.1 4.1 2.3h4c.7-1.2 2.1-2.3 4.1-2.3 3.5 0 5.2 3.6 3.6 6.8C19.5 16.1 12 21 12 21z" transform="scale(0.92) translate(1,0)" /></svg>
    </button>
    <SigmaCollectModal ref="collectModalRef" :player="player" />

    <!-- 搜索框 + 结果网格 -->
    <SigmaSearchBox
      ref="searchBoxRef"
      :player="player"
      @open-playlist="onOpenSearchPlaylist"
      @search="onSearchStarted"
    />

    <!-- 贴右边缘收起时：点击左侧 40px 滑出（原版 reShowView） -->
    <div v-if="docked" class="smp-dock-trigger" @click="restoreWindow"></div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useAuthStore } from '../../stores/auth.js';
import playImg from '../../assets/sigma/music/play.png';
import pauseImg from '../../assets/sigma/music/pause.png';
import forwardsImg from '../../assets/sigma/music/forwards.png';
import backwardsImg from '../../assets/sigma/music/backwards.png';
import bgImg from '../../assets/sigma/music/bg.png';
import artworkImg from '../../assets/sigma/music/artwork.png';
import sigmaFontUrl from '../../assets/sigma/fonts/Roboto-Variable.ttf';
import SigmaSmallImage from './SigmaSmallImage.vue';
import SigmaChangingButton from './SigmaChangingButton.vue';
import SigmaVolumeSlider from './SigmaVolumeSlider.vue';
import SigmaProgressBar from './SigmaProgressBar.vue';
import SigmaSpectrumButton from './SigmaSpectrumButton.vue';
import SigmaSearchBox from './SigmaSearchBox.vue';
import SigmaPlaylistPanel from './SigmaPlaylistPanel.vue';
import SigmaQueueList from './SigmaQueueList.vue';
import SigmaCollectModal from './SigmaCollectModal.vue';
import SigmaText from './SigmaText.vue';

const props = defineProps({
  player: { type: Object, default: null },
  spectrumEnabled: { type: Boolean, default: false }
});

const auth = useAuthStore();

const emit = defineEmits(['request-login', 'request-settings', 'request-lyrics', 'toggle-spectrum']);

const FONT_STYLE_ID = 'sigma-ui-fonts';
if (typeof document !== 'undefined') {
  let style = document.getElementById(FONT_STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = FONT_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `
    @font-face { font-family: 'SigmaLight'; src: url('${sigmaFontUrl}') format('truetype'); font-weight: 400; font-style: normal; }
    @font-face { font-family: 'SigmaMedium'; src: url('${sigmaFontUrl}') format('truetype'); font-weight: 400; font-style: normal; }
    @font-face { font-family: 'SigmaVariable'; src: url('${sigmaFontUrl}') format('truetype'); font-weight: 100 900; font-style: normal; }
  `;
}

const currentSong = computed(() => props.player?.currentSong || null);
const playing = computed(() => !!props.player?.playing);

const currentTime = ref(0);
const duration = ref(0);
const volumePercent = ref(1);
let tickTimer = null;

const progressPercent = computed(() => {
  if (!duration.value) return 0;
  return Math.max(0, Math.min(currentTime.value / duration.value, 1));
});

const formatTime = (seconds) => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60).toString().padStart(2, '0');
  const rest = (safe % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
};

const elapsedText = computed(() => formatTime(currentTime.value));
const durationText = computed(() => formatTime(duration.value));

const syncPlaybackState = () => {
  const audio = props.player?.audio;
  if (audio) {
    currentTime.value = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    duration.value = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : (currentSong.value?.timeLength ? currentSong.value.timeLength / 1000 : 0);
  } else {
    currentTime.value = 0;
    duration.value = currentSong.value?.timeLength ? currentSong.value.timeLength / 1000 : 0;
  }

  const percent = Number(props.player?.volume);
  if (Number.isFinite(percent)) {
    volumePercent.value = Math.max(0, Math.min(percent / 100, 1));
  }
};

const togglePlay = () => {
  if (!props.player) return;
  if (playing.value) {
    props.player.pause?.();
  } else {
    props.player.togglePlayPause?.();
  }
};

const onSeek = (ratio) => {
  const audio = props.player?.audio;
  if (!audio || !duration.value) return;
  audio.currentTime = ratio * duration.value;
  currentTime.value = audio.currentTime;
};

const onVolumeChange = (ratio) => {
  volumePercent.value = ratio;
  props.player?.setVolumePercent?.(Math.round(ratio * 100));
};

const stripCanvas = ref(null);
let stripToken = 0;

const drawStripFallback = (ctx) => {
  const image = new Image();
  image.onload = () => ctx.drawImage(image, 0, 0, 800, 94);
  image.src = bgImg;
};

const renderStrip = (cover) => {
  const canvas = stripCanvas.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const token = ++stripToken;
  const raster = Math.max(1, canvas.width / 800);
  ctx.setTransform(raster, 0, 0, raster, 0, 0);
  ctx.clearRect(0, 0, 800, 94);

  if (!cover) {
    drawStripFallback(ctx);
    return;
  }

  const image = new Image();
  image.referrerPolicy = 'no-referrer';
  image.onload = () => {
    if (token !== stripToken) return;
    try {
      const off = document.createElement('canvas');
      off.width = image.naturalWidth;
      off.height = image.naturalHeight;
      const octx = off.getContext('2d');
      octx.filter = 'blur(15px)';
      octx.drawImage(image, 0, 0);
      const cropY = Math.floor(off.height * 0.75);
      const cropH = Math.max(1, Math.floor(off.height * 0.2));
      ctx.drawImage(off, 0, cropY, off.width, cropH, 0, 0, 800, 94);
    } catch {
      drawStripFallback(ctx);
    }
  };
  image.onerror = () => {
    if (token !== stripToken) return;
    drawStripFallback(ctx);
  };
  image.src = cover;
};

const artworkStyle = computed(() => ({
  backgroundImage: `url('${currentSong.value?.img || artworkImg}')`
}));

const hasArtist = computed(() => !!currentSong.value?.author);

const titleLine1 = computed(() => {
  const name = currentSong.value?.name || '';
  if (hasArtist.value) return name;
  return name || 'Jello Music';
});

const titleLine2 = computed(() => (hasArtist.value ? (currentSong.value?.author || '') : ''));

const repeatType = computed(() => {
  const index = Number(props.player?.currentPlaybackModeIndex);
  if (index === 0) return 3;
  if (index === 2) return 2;
  return 1;
});

const searchBoxRef = ref(null);
const temporaryPlaylist = ref(null);
const queueListRef = ref(null);
const collectModalRef = ref(null);

const openCollect = () => {
  if (!props.player?.currentSong) {
    window.dispatchEvent(new CustomEvent('jello:toast', { detail: '没有正在播放的歌曲' }));
    return;
  }
  if (!auth.isAuthenticated) {
    emit('request-login');
    return;
  }
  collectModalRef.value?.open?.();
};

const onOpenSearchPlaylist = (playlist = {}) => {
  if (!playlist.id) return;
  temporaryPlaylist.value = { ...playlist, name: playlist.name || '歌单' };
};

const onSearchStarted = () => {
  temporaryPlaylist.value = null;
};

const onPlaylistSelect = (item) => {
  if (!item) return;
  if (item.key !== 'temp-playlist') temporaryPlaylist.value = null;
  if (item.type === 'login') {
    emit('request-login');
    return;
  }
  if (item.type === 'settings') {
    emit('request-settings');
    return;
  }
  if (item.type === 'lyrics') {
    emit('request-lyrics');
    return;
  }
  if (item.type === 'daily') {
    searchBoxRef.value?.loadDailyRecommend?.();
    return;
  }
  if (item.id) {
    searchBoxRef.value?.showPlaylist?.(item);
  }
};

const docked = ref(false);
const undockRequested = ref(false);
const revealing = ref(false);
const translucent = computed(() => docked.value && !undockRequested.value);
let unsubscribeDock = null;
let revealTimer = null;


const restoreWindow = () => {
  undockRequested.value = true;
  window.jello?.windowControl?.restore?.();
};

const onPointerDown = () => {};

const setupStripCanvas = () => {
  const canvas = stripCanvas.value;
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(800 * dpr);
  const height = Math.round(94 * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  renderStrip(currentSong.value?.img || '');
};

watch(() => currentSong.value?.img, (cover) => renderStrip(cover));
watch(() => currentSong.value?.hash, () => {
  nextTick(syncPlaybackState);
});

onMounted(() => {
  syncPlaybackState();
  setupStripCanvas();
  tickTimer = setInterval(syncPlaybackState, 250);
  unsubscribeDock = window.jello?.windowControl?.onDockChanged?.((value) => {
    const wasDocked = docked.value;
    docked.value = !!value;
    undockRequested.value = !value;
    // 呼出（dock → undock）时播 elastic reveal
    if (wasDocked && !value) {
      revealing.value = true;
      if (revealTimer) clearTimeout(revealTimer);
      revealTimer = setTimeout(() => { revealing.value = false; }, 500);
    }
  }) || null;
  const getDocked = window.jello?.windowControl?.getDocked;
  if (getDocked) {
    getDocked().then((value) => {
      docked.value = !!value;
      undockRequested.value = !value;
    }).catch(() => {});
  }
});

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if (revealTimer) clearTimeout(revealTimer);
  revealTimer = null;
  unsubscribeDock?.();
  unsubscribeDock = null;
});
</script>

<style scoped>
.sigma-music-player {
  position: relative;
  width: 800px;
  height: 600px;
  overflow: hidden;
  /* 透明底：让 Sigma 覆盖层的「半透明 + 背景模糊」透出来（原版浮在虚化画面上） */
  background: transparent;
  font-family: 'SigmaLight', sans-serif;
  user-select: none;
  /* 原版 field20873：收起 80ms 淡到 50%，滑出 150ms 淡回 100% */
  opacity: 1;
  transition: opacity 150ms linear;
}

/* 原版 field20873 = new Animation(80, 150, BACKWARDS)：淡到 50% 用 80ms，
   淡回 100% 用 150ms，两者都是线性、都在方向翻转时重新计时（不跳变）。 */
.sigma-music-player.translucent {
  opacity: 0.5;
  transition-duration: 80ms;
}

/* 呼出（dock → undock）时播 elastic reveal 动画（原版 ClickGuiScreen.draw 1:1 复刻）：
   elastic(p,period) = 2^(-10p) × sin((p - period/4) × 2π / period) + 1
   打开：a = elastic(p, 0.8) × 0.5 + 0.5
   scale = 1.5 - a × 0.5（以自身中心为原点），26 点离线采样。 */
.sigma-music-player.revealing {
  animation: sigma-reveal 450ms linear both;
}

/* 收起态：不给缩放动画（原版 sigma-shell--docked 行为） */
.sigma-music-player.docked {
  animation: none;
}

@keyframes sigma-reveal {
  0% { transform: scale(1.25); opacity: 0.5; }
  3.85% { transform: scale(1.1828); opacity: 0.6343; }
  7.69% { transform: scale(1.1207); opacity: 0.7586; }
  11.54% { transform: scale(1.0693); opacity: 0.8614; }
  15.38% { transform: scale(1.0305); opacity: 0.939; }
  19.23% { transform: scale(1.004); opacity: 0.992; }
  23.08% { transform: scale(0.9879); opacity: 1; }
  26.92% { transform: scale(0.98); opacity: 1; }
  30.77% { transform: scale(0.9778); opacity: 1; }
  34.62% { transform: scale(0.9793); opacity: 1; }
  38.46% { transform: scale(0.9827); opacity: 1; }
  42.31% { transform: scale(0.9869); opacity: 1; }
  46.15% { transform: scale(0.991); opacity: 1; }
  50% { transform: scale(0.9945); opacity: 1; }
  53.85% { transform: scale(0.9972); opacity: 1; }
  57.69% { transform: scale(0.9992); opacity: 1; }
  61.54% { transform: scale(1.0004); opacity: 0.9992; }
  65.38% { transform: scale(1.0011); opacity: 0.9978; }
  69.23% { transform: scale(1.0014); opacity: 0.9973; }
  73.08% { transform: scale(1.0014); opacity: 0.9973; }
  76.92% { transform: scale(1.0012); opacity: 0.9977; }
  80.77% { transform: scale(1.0009); opacity: 0.9982; }
  84.62% { transform: scale(1.0007); opacity: 0.9987; }
  88.46% { transform: scale(1.0004); opacity: 0.9991; }
  92.31% { transform: scale(1.0002); opacity: 0.9995; }
  96.15% { transform: scale(1.0001); opacity: 0.9998; }
  100% { transform: scale(1); opacity: 1; }
}

/* ===== 面板 ===== */
.smp-right-panel {
  position: absolute;
  left: 250px;
  top: 0;
  width: 550px;
  height: 506px;
  background: rgba(38, 38, 38, 0.8);
}

.smp-left-panel {
  position: absolute;
  left: 0;
  top: 0;
  width: 250px;
  height: 506px;
  background: rgba(0, 0, 0, 0.95);
}

/* ===== 底部封面条 ===== */
.smp-strip {
  position: absolute;
  left: 0;
  top: 506px;
  width: 800px;
  height: 94px;
  display: block;
}

.smp-strip-overlay {
  position: absolute;
  left: 0;
  top: 506px;
  width: 800px;
  height: 89px;
  background: rgba(1, 1, 1, 0.43);
}

.smp-strip-overlay-bottom {
  position: absolute;
  left: 0;
  top: 595px;
  width: 250px;
  height: 5px;
  background: rgba(1, 1, 1, 0.43);
}

/* ===== 封面 ===== */
.smp-artwork {
  position: absolute;
  left: 68px;
  top: 430px;
  width: 114px;
  height: 114px;
  background-color: #14161a;
  background-size: cover;
  background-position: center;
  box-shadow: inset 0 0 0 1px rgba(1, 1, 1, 0.35);
}

/* ===== 歌名 / 歌手 / 时长 ===== */
.smp-title,
.smp-subtitle,
.smp-time-left,
.smp-time-right {
  position: absolute;
  font-family: 'SigmaLight', sans-serif;
  font-size: 14px;
  line-height: 16px;
  color: #fefefe;
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
}

.smp-title {
  left: 30px;
  top: 550px;
  width: 190px;
  text-align: center;
}

.smp-title.single {
  top: 562px;
}

.smp-subtitle {
  left: 30px;
  top: 570px;
  width: 190px;
  text-align: center;
}

.smp-time-left {
  left: 264px;
  top: 568px;
}

.smp-time-right {
  left: 736px;
  top: 568px;
  width: 50px;
  text-align: right;
}

/* ===== Logo ===== */
.smp-logo {
  position: absolute;
  left: 55px;
  top: 14px;
  font-family: 'SigmaVariable', 'SigmaLight', sans-serif;
  font-weight: 200;
  font-size: 40px;
  line-height: 44px;
  color: #fefefe;
  pointer-events: none;
}

.smp-logo-sub {
  position: absolute;
  left: 135px;
  top: 42px;
  font-family: 'SigmaVariable', 'SigmaLight', sans-serif;
  font-weight: 300;
  font-size: 20px;
  line-height: 22px;
  color: #fefefe;
  pointer-events: none;
}

/* ===== 控制按钮坐标 ===== */
.smp-prev {
  left: 392px;
  top: 529px;
  width: 46px;
  height: 46px;
}

.smp-play {
  left: 506px;
  top: 533px;
  width: 38px;
  height: 38px;
}

.smp-next {
  left: 620px;
  top: 529px;
  width: 46px;
  height: 46px;
}

.smp-repeat {
  left: 264px;
  top: 540px;
}

/* ===== 音量 / 进度 / 频谱 坐标 ===== */
.smp-volume {
  left: 781px;
  top: 520px;
  width: 4px;
  height: 40px;
}

.smp-progress {
  left: 250px;
  top: 595px;
  width: 550px;
  height: 5px;
}

.smp-spectrum {
  left: 15px;
  top: 460px;
  width: 40px;
  height: 40px;
}

/* 播放队列按钮（进度条右上方） */
.smp-queue-btn {
  position: absolute;
  left: 706px;
  top: 534px;
  width: 26px;
  height: 26px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: background 0.2s;
}

.smp-queue-btn:hover {
  background: rgba(254, 254, 254, 0.12);
}

.smp-queue-btn i {
  display: block;
  width: 14px;
  height: 2px;
  border-radius: 1px;
  background: rgba(254, 254, 254, 0.7);
}

/* 收藏到歌单按钮（队列按钮左侧） */
.smp-collect-btn {
  position: absolute;
  left: 674px;
  top: 534px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: background 0.2s;
}

.smp-collect-btn:hover {
  background: rgba(254, 254, 254, 0.12);
}

.smp-collect-btn svg {
  width: 15px;
  height: 15px;
  fill: rgba(255, 105, 180, 0.75);
}

/* 左栏歌单列表（原版 tabs 区域，位于封面之下） */
.smp-playlist {
  left: 0;
  top: 78px;
  width: 250px;
  height: 442px;
}

/* 收起后左侧 40px 的滑出触发区（原版 reShowView，宽 41px） */
.smp-dock-trigger {
  position: absolute;
  left: 0;
  top: 0;
  /* 原版 field20865.setWidthA(... ? 0 : 41)：点击热区刻意比 40px 可见边条宽 1px，
     盖住最外侧那个像素，否则屏幕右缘最后 1px 点不中 */
  width: 41px;
  height: 100%;
  z-index: 50;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
</style>
