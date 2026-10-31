<template>
  <div class="sigma-music-player" :class="{ translucent, revealing: !shellDocked, docked: shellDocked }" @pointerdown="onPointerDown">
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

    <!-- 试听片段标识（图集绘制，中文走 sans 字族）：未登录时点击可去登录 -->
    <SigmaText
      v-if="trialBadge.visible"
      class="smp-trial"
      :text="trialBadge.label"
      :size="12"
      family="sans"
      :box-width="64"
      :box-height="16"
      align="center"
      :color="trialBadge.color"
      :alpha="0.95"
    />
    <button
      v-if="trialBadge.nudgesLogin"
      type="button"
      class="smp-trial-hit"
      title="登录后可听完整歌曲"
      @click="emit('request-login')"
    ></button>

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
    <button type="button" class="smp-collect-btn" :title="songLiked ? '已在我喜欢' : '收藏到「我喜欢」'" @click="collectToLiked">
      <svg viewBox="0 0 24 24" :class="{ 'is-liked': songLiked }"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    </button>
    <button type="button" class="smp-add-btn" title="添加到歌单" @click="openCollect">
      <svg viewBox="0 0 14 14"><rect x="6" y="0" width="2" height="14"/><rect x="0" y="6" width="14" height="2"/></svg>
    </button>
    <SigmaCollectModal ref="collectModalRef" :player="player" @collected="refreshLikedState" />

    <!-- 搜索框 + 结果网格 -->
    <SigmaSearchBox
      ref="searchBoxRef"
      :player="player"
      :live-songs="radioView ? player?.queue : null"
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
import { computeTrialBadge } from '../../services/api/auth.js';
import { getGuessYouLike } from '../../services/api/library.js';
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
import {
  collectSongToLiked,
  ensureLikedHashSet,
  isSongLiked,
  markSongLiked
} from '../../services/api/collect.js';
import SigmaText from './SigmaText.vue';
import { useSigmaWindowDrag } from '../../composables/useSigmaWindowDrag.js';

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

// 试听标识：仅当实际解析到 free_part 试听片段时显示；未登录时高亮为「去登录」提示
const trialBadge = computed(() => computeTrialBadge({
  trial: !!props.player?.trial,
  authenticated: auth.isAuthenticated
}));

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

// 心形状态：当前歌是否已在「我喜欢」。切歌先置灰再异步刷新（收藏成功后
// SigmaCollectModal 会 emit collected 触发重算）；未登录保持灰。
const songLiked = ref(false);
const refreshLikedState = async () => {
  const song = props.player?.currentSong;
  if (!auth.isAuthenticated || !song?.hash) {
    songLiked.value = false;
    return;
  }
  await ensureLikedHashSet().catch(() => {});
  songLiked.value = isSongLiked(song);
};
watch(() => props.player?.currentSong?.hash, () => {
  songLiked.value = false;
  refreshLikedState();
});
watch(() => auth.isAuthenticated, refreshLikedState);
onMounted(refreshLikedState);

// 心形：一键收藏当前歌到「我喜欢」（已收藏时只提示，不重复请求）
const collecting = ref(false);
const collectToLiked = async () => {
  const song = props.player?.currentSong;
  if (!song?.hash) {
    window.dispatchEvent(new CustomEvent('jello:toast', { detail: '没有正在播放的歌曲' }));
    return;
  }
  if (!auth.isAuthenticated) {
    emit('request-login');
    return;
  }
  if (songLiked.value) {
    window.dispatchEvent(new CustomEvent('jello:toast', { detail: '这首歌已在我喜欢' }));
    return;
  }
  if (collecting.value) return;
  collecting.value = true;
  try {
    await collectSongToLiked(song);
    markSongLiked(song);
    songLiked.value = true;
    window.dispatchEvent(new CustomEvent('jello:toast', { detail: '已收藏到「我喜欢」' }));
  } catch (error) {
    window.dispatchEvent(new CustomEvent('jello:toast', { detail: error?.message || '收藏失败' }));
  } finally {
    collecting.value = false;
  }
};

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

// 电台视图：右栏卡片区实时镜像播放队列（每播/每追加一首都出现并保留，
// 第一首 1 个、第二首 2 个……）。搜歌/开歌单/每日推荐时让位回各自视图
const radioView = ref(false);

const onOpenSearchPlaylist = (playlist = {}) => {
  if (!playlist.id) return;
  radioView.value = false;
  temporaryPlaylist.value = { ...playlist, name: playlist.name || '歌单' };
};

const onSearchStarted = () => {
  radioView.value = false;
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
    radioView.value = false;
    searchBoxRef.value?.loadDailyRecommend?.();
    return;
  }
  if (item.type === 'guess') {
    void playGuessYouLike();
    return;
  }
  if (item.id) {
    radioView.value = false;
    searchBoxRef.value?.showPlaylist?.(item);
  }
};

// 猜你喜欢电台：每次点击拉一首新推荐立即播放并追加进队列；右栏在电台
// 视图下实时镜像队列——第一首 1 个、第二首 2 个（第一首+第二首）……逐首
// 累积保留，歌曲播完按队列自动接续，点任意卡片就在这份列表内播放
const playGuessYouLike = async () => {
  temporaryPlaylist.value = null;
  try {
    const songs = await getGuessYouLike();
    const song = songs[0];
    if (!song) return;
    props.player?.playRadioSong?.(song);
    radioView.value = true;
  } catch (error) {
    window.dispatchEvent(new CustomEvent('jello:toast', {
      detail: error?.message || '猜你喜欢加载失败'
    }));
  }
};
const docked = ref(false);
const shellDocked = ref(false);
const undockRequested = ref(false);
const translucent = computed(() => docked.value && !undockRequested.value);
let unsubscribeDock = null;
let unsubscribeOverhang = null;
let dockedTimer = null;

/* ================= 自绘拖拽（原版面板拖动） ================= */
const NO_DRAG_SELECTOR = 'button, input, .sigma-search-box, .sigma-scrollable-panel, .sigma-text-field, .sigma-progress-bar, .sigma-volume-slider, .sigma-small-image, .sigma-changing-button, .sigma-spectrum-button, .smp-dock-trigger';

const { onPointerDown, endDrag } = useSigmaWindowDrag({
  noDragSelector: NO_DRAG_SELECTOR,
  capturePointer: true,
  // 拖动优先：取消进行中的窗口动画
  onBeforeDrag: () => stopWindowAnimation(true)
});

/* ================= 贴边收起（原版 dock / reShowView 行为） =================
   docked = 几何越界（收起条的显示条件）；shellDocked = 主进程吸附态
   （elastic reveal 类的翻转依据）；undockRequested = 「已请求滑出」
   （半透明判据的否定项，滑出瞬时变亮 —— 原版 field20874）。 */
let ipcOverhang = null;

const readDockedByPosition = () => {
  const screenRef = window.screen || {};
  const areaLeft = Number.isFinite(screenRef.availLeft) ? screenRef.availLeft : 0;
  const areaWidth = Number.isFinite(screenRef.availWidth) ? screenRef.availWidth : Number(screenRef.width) || 0;
  const areaRight = areaLeft + areaWidth;
  const windowRight = window.screenX + (window.outerWidth || 0);
  // 1:1 对齐原版 MusicPlayer.draw 的判据 getXA() + getWidthA() > parent.getWidthA()
  return areaWidth > 0 && windowRight > areaRight;
};

const updateDockedState = () => {
  const byPosition = ipcOverhang !== null ? ipcOverhang : readDockedByPosition();
  // 重新回到屏幕内即视为滑出结束，清掉请求标志（原版 field20874 在滑出结束时置回 false）
  if (!byPosition) undockRequested.value = false;
  docked.value = byPosition;
};

/* ================= 窗口进出动画（rAF 与显示器垂直同步；主进程 150ms 收不到帧则接管）
   原版 updatePanelDimensions：var7 = dt / 18.10361ms，x 每帧 0.25 × var7、y 0.2 × var7，
   按方向夹到目标。收起期间窗口离屏 rAF 会被节流，主进程用同一公式接管推进。 */
let animateRaf = null;
let animateActive = false;
let unsubscribeAnimateTo = null;
let unsubscribeAnimateStop = null;

const stopWindowAnimation = (notifyMain = false) => {
  animateActive = false;
  if (animateRaf !== null) {
    cancelAnimationFrame(animateRaf);
    animateRaf = null;
  }
  if (notifyMain) {
    window.jello?.windowControl?.sendAnimateDone?.();
  }
};

const startWindowAnimation = (target) => {
  if (!target) return;
  stopWindowAnimation();
  animateActive = true;

  let currentX = Number(target.fromX);
  let currentY = Number(target.fromY);
  if (!Number.isFinite(currentX)) currentX = window.screenX;
  if (!Number.isFinite(currentY)) currentY = window.screenY;
  // 不预设 lastTime：收起期间窗口离屏 rAF 被节流，重新显示后第一帧 dt 会很大
  // （钳到 40ms → frameFactor 2.2，一步走出 45% 路程），表现为「弹出时猛跳一下」。
  // 第一帧用最小步长。
  let lastTime = 0;

  const step = (now) => {
    if (!animateActive) return;
    let dt;
    if (!lastTime) {
      lastTime = now;
      dt = 1;
    } else {
      dt = Math.min(40, Math.max(1, now - lastTime));
      lastTime = now;
    }
    const frameFactor = dt / 18.10361;
    currentX = target.x > currentX
      ? Math.min(currentX + (target.x - currentX) * 0.25 * frameFactor, target.x)
      : Math.max(currentX + (target.x - currentX) * 0.25 * frameFactor, target.x);
    currentY = target.y > currentY
      ? Math.min(currentY + (target.y - currentY) * 0.2 * frameFactor, target.y)
      : Math.max(currentY + (target.y - currentY) * 0.2 * frameFactor, target.y);

    if (Math.abs(target.x - currentX) < 0.5 && Math.abs(target.y - currentY) < 0.5) {
      window.jello?.windowControl?.sendAnimatePosition?.({ x: target.x, y: target.y });
      window.jello?.windowControl?.sendAnimateDone?.();
      animateActive = false;
      animateRaf = null;
      return;
    }

    window.jello?.windowControl?.sendAnimatePosition?.({ x: currentX, y: currentY });
    animateRaf = requestAnimationFrame(step);
  };

  animateRaf = requestAnimationFrame(step);
};

if (window.jello?.windowControl) {
  unsubscribeAnimateTo = window.jello.windowControl.onAnimateTo?.(startWindowAnimation) || null;
  unsubscribeAnimateStop = window.jello.windowControl.onAnimateStop?.(() => stopWindowAnimation()) || null;
}


const restoreWindow = () => {
  window.jello?.windowControl?.restore?.();
};

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
  updateDockedState();
  dockedTimer = setInterval(updateDockedState, 200);
  unsubscribeDock = window.jello?.windowControl?.onDockChanged?.((value) => {
    // value=true → 吸附收起，undockRequested=false；value=false → 主进程开始滑出，
    // undockRequested 置 true —— 点击瞬间就开始 150ms 变亮（原版「醒来」效果）。
    // shellDocked 翻转驱动 elastic reveal 重放（主进程状态不变时 early-return，
    // 收到的 dock 事件必然是真·状态切换，CSS animation 每次都会重放）。
    undockRequested.value = !value;
    shellDocked.value = !!value;
    ipcOverhang = value ? true : null;
    updateDockedState();
  }) || null;
  unsubscribeOverhang = window.jello?.windowControl?.onOverhangChanged?.((value) => {
    // 拖拽越界的权威信号：右缘越过屏幕右缘时半透明（原版 MusicPlayer.draw）
    ipcOverhang = !!value;
    updateDockedState();
  }) || null;
});

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if (dockedTimer) clearInterval(dockedTimer);
  dockedTimer = null;
  stopWindowAnimation();
  endDrag();
  unsubscribeDock?.();
  unsubscribeOverhang?.();
  unsubscribeAnimateTo?.();
  unsubscribeAnimateStop?.();
  unsubscribeDock = null;
  unsubscribeOverhang = null;
  unsubscribeAnimateTo = null;
  unsubscribeAnimateStop = null;
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

/* 试听标识：位于封面右侧、歌行之上的空隙（x186..250 / y524..540），不与封面/歌行/左栏歌单重叠 */
.smp-trial {
  position: absolute;
  left: 186px;
  top: 524px;
  width: 64px;
  height: 16px;
  font-family: 'SigmaLight', sans-serif;
  pointer-events: none;
}

.smp-trial-hit {
  position: absolute;
  left: 186px;
  top: 524px;
  width: 64px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.smp-trial-hit:hover {
  background: rgba(255, 105, 180, 0.14);
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
  background: rgba(254, 254, 254, 0.7);
}

/* 添加到歌单按钮（十字，队列按钮右侧） */
.smp-add-btn {
  position: absolute;
  left: 738px;
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

.smp-add-btn:hover {
  background: rgba(254, 254, 254, 0.12);
}

.smp-add-btn svg {
  /* 十字 1:1 对齐队列图标：14px 渲染 = 横线同宽、2px 同粗、方角 */
  width: 14px;
  height: 14px;
  fill: rgba(254, 254, 254, 0.7);
}

/* 心形按钮（队列按钮左侧，一键收藏到我喜欢） */
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
  fill: rgba(254, 254, 254, 0.4);
}

.smp-collect-btn svg.is-liked {
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
