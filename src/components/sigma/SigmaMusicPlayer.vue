<template>
  <div class="sigma-music-player" :class="{ docked }" @pointerdown="onPointerDown">
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
    <SigmaText class="smp-subtitle" v-if="titleLine2" :text="titleLine2" :size="14" :box-width="190" :box-height="16" align="center" scroll :phase="-1000" />

    <!-- 时长 -->
    <SigmaText class="smp-time-left" :text="elapsedText" :size="14" :box-height="16" />
    <SigmaText class="smp-time-right" :text="durationText" :size="14" :box-width="50" :box-height="16" align="right" />

    <!-- Logo -->
    <SigmaText class="smp-logo" text="Jello" :size="40" :box-height="44" />
    <SigmaText class="smp-logo-sub" text="music" :size="20" :box-height="22" />

    <!-- 左栏歌单（每日推荐 / 我喜欢 / 我的歌单…），位于封面之下 -->
    <SigmaPlaylistPanel class="smp-playlist" @select="onPlaylistSelect" />

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
    <SigmaSpectrumButton class="smp-spectrum" :active="spectrumOn" @click="toggleSpectrum" />

    <!-- 搜索框 + 结果网格 -->
    <SigmaSearchBox ref="searchBoxRef" :player="player" />

    <!-- 贴右边缘收起时：点击左侧 40px 滑出（原版 reShowView） -->
    <div v-if="docked" class="smp-dock-trigger" @click="restoreWindow"></div>
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/impl/jello/ingame/clickgui/musicplayer/MusicPlayer.java
// 800x600：左 250x506 黑 95% / 右 550x506 #262626 80%，底部 94px 封面条，
// 封面 114x114，控制按钮/循环/音量/进度/频谱全部按原版坐标
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import playImg from '../../assets/sigma/music/play.png';
import pauseImg from '../../assets/sigma/music/pause.png';
import forwardsImg from '../../assets/sigma/music/forwards.png';
import backwardsImg from '../../assets/sigma/music/backwards.png';
import bgImg from '../../assets/sigma/music/bg.png';
import artworkImg from '../../assets/sigma/music/artwork.png';
import jelloLightUrl from '../../assets/sigma/fonts/helvetica-neue-light.ttf';
import jelloMediumUrl from '../../assets/sigma/fonts/helvetica-neue-medium.ttf';
import SigmaSmallImage from './SigmaSmallImage.vue';
import SigmaChangingButton from './SigmaChangingButton.vue';
import SigmaVolumeSlider from './SigmaVolumeSlider.vue';
import SigmaProgressBar from './SigmaProgressBar.vue';
import SigmaSpectrumButton from './SigmaSpectrumButton.vue';
import SigmaSearchBox from './SigmaSearchBox.vue';
import SigmaPlaylistPanel from './SigmaPlaylistPanel.vue';
import SigmaText from './SigmaText.vue';
import { get } from '../../utils/request';

const props = defineProps({
  player: { type: Object, default: null }
});

/* ================= 字体（原版 helvetica-neue，JelloLight/JelloMedium） ================= */
const FONT_STYLE_ID = 'sigma-ui-fonts';
if (typeof document !== 'undefined' && !document.getElementById(FONT_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = FONT_STYLE_ID;
  style.textContent = `
    @font-face { font-family: 'JelloLight'; src: url('${jelloLightUrl}') format('truetype'); font-weight: 400; font-style: normal; }
    @font-face { font-family: 'JelloMedium'; src: url('${jelloMediumUrl}') format('truetype'); font-weight: 400; font-style: normal; }
  `;
  document.head.appendChild(style);
}

/* ================= 播放状态（适配 MusicManager） ================= */
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

/* ================= 底部封面条（blur 15 + 底部 20% 裁切） ================= */
const stripCanvas = ref(null);
let stripToken = 0;

const drawStripFallback = (ctx) => {
  const img = new Image();
  img.onload = () => ctx.drawImage(img, 0, 0, 800, 94);
  img.src = bgImg;
};

const renderStrip = (cover) => {
  const canvas = stripCanvas.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const token = ++stripToken;
  // canvas 后备分辨率随缩放提高，避免放大后发糊
  const raster = Math.max(1, canvas.width / 800);
  ctx.setTransform(raster, 0, 0, raster, 0, 0);
  ctx.clearRect(0, 0, 800, 94);

  if (!cover) {
    drawStripFallback(ctx);
    return;
  }

  const image = new Image();
  image.crossOrigin = 'anonymous';
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
    } catch (error) {
      console.error('[SigmaMusicPlayer] 生成封面条失败:', error);
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

/* ================= 歌名 / 歌手 ================= */
const hasArtist = computed(() => !!currentSong.value?.author);

const titleLine1 = computed(() => {
  const name = currentSong.value?.name || '';
  if (hasArtist.value) return name;
  return name || 'Jello Music';
});

const titleLine2 = computed(() => (hasArtist.value ? (currentSong.value?.author || '') : ''));

/* ================= 循环模式（repeat.png 三态：0=NO_REPEAT / 1=REPEAT / 2=LOOP_CURRENT；3=随机） ================= */
const repeatType = computed(() => {
  const index = Number(props.player?.currentPlaybackModeIndex);
  if (index === 0) return 3;   // 随机播放（魔改版新增图标）
  if (index === 2) return 2;   // 单曲循环
  if (index === 3) return 0;   // 顺序播放
  return 1;                    // 列表循环
});

/* ================= 频谱开关 ================= */
const spectrumOn = ref(false);

const syncSpectrumState = () => {
  try {
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    spectrumOn.value = settings?.desktopSpectrum === 'on';
  } catch {
    spectrumOn.value = false;
  }
};

const toggleSpectrum = () => {
  spectrumOn.value = !spectrumOn.value;
  try {
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    settings.desktopSpectrum = spectrumOn.value ? 'on' : 'off';
    localStorage.setItem('settings', JSON.stringify(settings));
    // 通知主窗口同步（频谱数据生产者需要立即开关）
    window.electron?.ipcRenderer?.send('settings-changed', settings);
  } catch (error) {
    console.error('[SigmaMusicPlayer] 保存频谱设置失败:', error);
  }
  if (window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.send('desktop-spectrum-action', spectrumOn.value ? 'display-spectrum' : 'close-spectrum');
  }
};

// 设置页改动（含「重置界面」）后同步频谱按钮状态
const onSettingsChange = (event) => {
  const settings = event.detail?.settings;
  if (settings) {
    spectrumOn.value = settings.desktopSpectrum === 'on';
  } else {
    syncSpectrumState();
  }
};

/* ================= 窗口进出动画（rAF 与显示器垂直同步；主进程 150ms 收不到帧则接管） ================= */
let animateRaf = null;
let animateActive = false;

const stopWindowAnimation = (notifyMain = false) => {
  animateActive = false;
  if (animateRaf !== null) {
    cancelAnimationFrame(animateRaf);
    animateRaf = null;
  }
  if (notifyMain) {
    window.electron?.ipcRenderer.send('sigma-window-animate-done');
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
  let lastTime = performance.now();

  const step = (now) => {
    if (!animateActive) return;
    // dt 上限 40ms：偶发迟到不产生大跳（真正卡住超过 150ms 由主进程接管）
    const dt = Math.min(40, Math.max(1, now - lastTime));
    lastTime = now;
    // 原版：var7 = dt / 18.10361ms；x 用 0.25、y 用 0.2，按方向夹到目标
    const frameFactor = dt / 18.10361;
    currentX = target.x > currentX
      ? Math.min(currentX + (target.x - currentX) * 0.25 * frameFactor, target.x)
      : Math.max(currentX + (target.x - currentX) * 0.25 * frameFactor, target.x);
    currentY = target.y > currentY
      ? Math.min(currentY + (target.y - currentY) * 0.2 * frameFactor, target.y)
      : Math.max(currentY + (target.y - currentY) * 0.2 * frameFactor, target.y);

    if (Math.abs(target.x - currentX) < 0.5 && Math.abs(target.y - currentY) < 0.5) {
      window.electron?.ipcRenderer.send('sigma-window-animate-position', { x: target.x, y: target.y });
      window.electron?.ipcRenderer.send('sigma-window-animate-done');
      animateActive = false;
      animateRaf = null;
      return;
    }

    window.electron?.ipcRenderer.send('sigma-window-animate-position', { x: currentX, y: currentY });
    animateRaf = requestAnimationFrame(step);
  };

  animateRaf = requestAnimationFrame(step);
};

if (window.electron?.ipcRenderer) {
  window.electron.ipcRenderer.on('sigma-animate-to', (_event, target) => {
    startWindowAnimation(target);
  });
  window.electron.ipcRenderer.on('sigma-animate-stop', () => {
    stopWindowAnimation();
  });
}

/* ================= 自绘拖拽（原版面板拖动） ================= */
const NO_DRAG_SELECTOR = 'button, input, .sigma-search-box, .sigma-scrollable-panel, .sigma-text-field, .sigma-progress-bar, .sigma-volume-slider, .sigma-small-image, .sigma-changing-button, .sigma-spectrum-button, .sigma-thumbnail-button, .smp-dock-trigger';

let dragState = null;
let pendingDrag = null;
let dragFrame = null;
let pendingPosition = null;

const flushDragPosition = () => {
  dragFrame = null;
  if (!pendingPosition) return;
  window.electron?.ipcRenderer.send('sigma-window-move', pendingPosition);
  pendingPosition = null;
};

const onDragPointerMove = (event) => {
  // 窗口位置还没取回来时，只更新最新指针位置（取回后再以此为基准，避免起手跳变）
  if (pendingDrag && event.pointerId === pendingDrag.pointerId) {
    pendingDrag.lastX = event.screenX;
    pendingDrag.lastY = event.screenY;
    return;
  }
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  pendingPosition = {
    x: dragState.winX + (event.screenX - dragState.mouseX),
    y: dragState.winY + (event.screenY - dragState.mouseY),
    // 相对起手点向右移动的距离（原版 newHeight - mouseX > 70 判定用）
    movedX: event.screenX - dragState.startX
  };
  if (dragFrame === null) {
    dragFrame = requestAnimationFrame(flushDragPosition);
  }
};

const endDrag = (event) => {
  if (event) {
    if (pendingDrag && event.pointerId !== pendingDrag.pointerId) return;
    if (dragState && event.pointerId !== dragState.pointerId) return;
  }
  if (dragFrame !== null) {
    cancelAnimationFrame(dragFrame);
    dragFrame = null;
  }
  flushDragPosition();
  window.electron?.ipcRenderer.send('sigma-window-drag-end');

  const capture = dragState?.captureEl || pendingDrag?.captureEl;
  const pointerId = dragState?.pointerId ?? pendingDrag?.pointerId;
  if (capture && pointerId !== undefined && capture.hasPointerCapture?.(pointerId)) {
    try {
      capture.releasePointerCapture(pointerId);
    } catch {
      // 忽略
    }
  }

  dragState = null;
  pendingDrag = null;
  window.removeEventListener('pointermove', onDragPointerMove);
  window.removeEventListener('pointerup', endDrag);
  window.removeEventListener('pointercancel', endDrag);
};

const onPointerDown = (event) => {
  if (event.button !== 0 || !window.electron?.ipcRenderer) return;
  const target = event.target;
  if (target instanceof Element && target.closest(NO_DRAG_SELECTOR)) return;
  // 拖动优先：取消进行中的窗口动画
  stopWindowAnimation(true);
  pendingDrag = {
    pointerId: event.pointerId,
    lastX: event.screenX,
    lastY: event.screenY,
    startX: event.screenX,
    captureEl: event.currentTarget
  };
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // 忽略不支持指针捕获的情况
  }
  window.addEventListener('pointermove', onDragPointerMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  event.preventDefault();

  window.electron.ipcRenderer.invoke('sigma-window-get-bounds').then((bounds) => {
    if (!bounds || !pendingDrag || pendingDrag.pointerId !== event.pointerId) return;
    dragState = {
      pointerId: pendingDrag.pointerId,
      mouseX: pendingDrag.lastX,
      mouseY: pendingDrag.lastY,
      startX: pendingDrag.startX,
      winX: bounds.x,
      winY: bounds.y,
      captureEl: pendingDrag.captureEl
    };
    pendingDrag = null;
  }).catch(() => {
    endDrag();
  });
};

/* ================= 左栏歌单联动 ================= */
const searchBoxRef = ref(null);

const onPlaylistSelect = (item) => {
  if (!item) return;
  if (item.type === 'daily') {
    searchBoxRef.value?.loadDailyRecommend?.();
    return;
  }
  if (item.type === 'guess') {
    playGuessYouLike();
    return;
  }
  if (item.id) {
    searchBoxRef.value?.showPlaylist?.(item.id);
  }
};

// 猜你喜欢（主页「私人专属好歌推荐」/top/card?card_id=1）：点击直接播放，右侧保持为空
const playGuessYouLike = async () => {
  searchBoxRef.value?.clear?.();
  try {
    // timestamp 绕过 KuGouMusicApi 的 2 分钟同 URL 缓存，保证每次都重新推荐
    const response = await get(`/top/card?card_id=1&timestamp=${Date.now()}`);
    if (response?.status !== 1) return;
    const songs = (response.data?.song_list || [])
      .map((song) => ({
        hash: song.hash,
        name: song.songname,
        cover: (song.sizable_cover || '').replace('{size}', '480'),
        author: song.author_name,
        timelen: song.time_length
      }))
      .filter((song) => song.hash);
    if (!songs.length) return;
    // 推荐列表顺序稳定，打乱后从随机一首开始，每次点击都有变化
    for (let i = songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [songs[i], songs[j]] = [songs[j], songs[i]];
    }
    props.player?.playSongList?.(songs, songs[0].hash);
  } catch (error) {
    console.error('[SigmaMusicPlayer] 猜你喜欢加载失败:', error);
  }
};

/* ================= 贴边收起（原版 dock / reShowView 行为） ================= */
const docked = ref(false);
let dockedTimer = null;
let ipcDockState = null;

const restoreWindow = () => {
  if (window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.send('sigma-window-restore');
  }
};

const readDockedByPosition = () => {
  const screenRef = window.screen || {};
  const areaLeft = Number.isFinite(screenRef.availLeft) ? screenRef.availLeft : 0;
  const areaWidth = Number(screenRef.availWidth) || Number(screenRef.width) || 0;
  const areaRight = areaLeft + areaWidth;
  const windowRight = window.screenX + (window.outerWidth || 0);
  return areaWidth > 0 && windowRight > areaRight + 1;
};

// 透明度的 dock 状态以主进程为准：滑出开始就立即变亮（原版 field20873 方向切换行为）；
// IPC 状态未知时才用窗口位置兜底
const updateDockedState = () => {
  if (ipcDockState !== null) {
    if (docked.value !== ipcDockState) {
      docked.value = ipcDockState;
      if (ipcDockState) endDrag();
    }
    return;
  }
  const byPosition = readDockedByPosition();
  if (byPosition && !docked.value) {
    endDrag();
  }
  docked.value = byPosition;
};

if (window.electron?.ipcRenderer) {
  window.electron.ipcRenderer.on('sigma-dock-changed', (_event, value) => {
    ipcDockState = !!value;
    docked.value = ipcDockState;
    if (ipcDockState) endDrag();
  });
}

/* ================= 生命周期 ================= */
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
  syncSpectrumState();
  setupStripCanvas();
  updateDockedState();
  window.addEventListener('settings-change', onSettingsChange);
  tickTimer = setInterval(syncPlaybackState, 250);
  dockedTimer = setInterval(updateDockedState, 200);
});

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  if (dockedTimer) clearInterval(dockedTimer);
  dockedTimer = null;
  window.removeEventListener('settings-change', onSettingsChange);
  stopWindowAnimation();
  endDrag();
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
  font-family: 'JelloLight', sans-serif;
  user-select: none;
  /* 原版 field20873：收起 80ms 淡到 50%，滑出 150ms 淡回 100% */
  opacity: 1;
  transition: opacity 150ms linear;
}

.sigma-music-player.docked {
  opacity: 0.5;
  transition-duration: 80ms;
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
  font-family: 'JelloLight', sans-serif;
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
  font-family: 'JelloLight', sans-serif;
  font-size: 40px;
  line-height: 44px;
  color: #fefefe;
  pointer-events: none;
}

.smp-logo-sub {
  position: absolute;
  left: 135px;
  top: 42px;
  font-family: 'JelloLight', sans-serif;
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
  width: 40px;
  height: 100%;
  z-index: 50;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
</style>

<style>
/* 原版像素图标按最近邻渲染，避免放大后发糊 */
.sigma-music-player .sigma-small-image,
.sigma-music-player .sigma-changing-button {
  image-rendering: pixelated;
}
</style>
