<template>
  <div class="sigma-progress-bar" ref="root" @mousedown="onDown">
    <div class="sigma-progress-track"></div>
    <div class="sigma-progress-remaining" :style="{ left: (percent * 100) + '%' }"></div>
    <!-- 高潮段标记：叠在「未播」层之上、「已播」层之下，播过即被白色进度盖住 -->
    <div
      v-for="(mark, index) in climaxMarks"
      :key="'climax-' + index"
      class="sigma-progress-climax"
      :style="{ left: mark.left + '%', width: mark.width + '%' }"
    ></div>
    <div class="sigma-progress-played" :style="{ width: (percent * 100) + '%' }"></div>
    <img
      v-if="percent > 0"
      class="sigma-progress-knob"
      :src="shadowRightImg"
      :style="{ left: (percent * 100) + '%' }"
      alt=""
    />
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/impl/jello/ingame/clickgui/musicplayer/elements/ProgressBar.java
// 底 #999999 @0.075；未播 #010101 @0.43；已播 #fefefe；末端 shadow_right.png 5x5
// 高潮段用同色系 #fefefe 低透明度叠加，不引入 Sigma 配色之外的颜色
import { computed, ref, watch } from 'vue';
import shadowRightImg from '../../assets/sigma/jello/shadow_right.png';
import { getSongClimax } from '../../services/api/library.js';
import { usePlayerStore } from '../../stores/player.js';

defineProps({
  percent: { type: Number, default: 0 }
});

const emit = defineEmits(['seek']);

const root = ref(null);
let dragging = false;

// 高潮点数据源：当前播放曲目的 hash（进度条只有 percent，歌曲信息从 store 取）
let player = null;
try {
  player = usePlayerStore();
} catch {
  player = null;
}

const segments = ref([]);
let climaxToken = 0;

const songHash = computed(() => player?.currentSong?.hash || '');

// 总时长优先用曲目元数据（毫秒），元数据缺失时退回 <audio> 的实际时长
const durationSeconds = computed(() => {
  const fromSong = Number(player?.currentSong?.timeLength) || 0;
  if (fromSong > 0) return fromSong / 1000;
  const fromAudio = Number(player?.audio?.duration);
  return Number.isFinite(fromAudio) && fromAudio > 0 ? fromAudio : 0;
});

watch(songHash, async (hash) => {
  const token = ++climaxToken; // 快速切歌时丢弃过期响应
  segments.value = [];
  if (!hash) return;
  const list = await getSongClimax(hash); // 内部已静默兜底为 []
  if (token === climaxToken) segments.value = list;
}, { immediate: true });

const climaxMarks = computed(() => {
  const total = durationSeconds.value;
  if (!total || !segments.value.length) return [];
  const marks = [];
  for (const segment of segments.value) {
    const left = Math.max(0, Math.min(segment.start / total, 1));
    const right = Math.max(left, Math.min(segment.end / total, 1));
    if (right - left <= 0) continue;
    marks.push({ left: left * 100, width: (right - left) * 100 });
  }
  return marks;
});

const emitSeek = (clientX) => {
  const el = root.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1));
  emit('seek', ratio);
};

const onMove = (event) => {
  if (dragging) emitSeek(event.clientX);
};

const onUp = () => {
  dragging = false;
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', onUp);
};

const onDown = (event) => {
  dragging = true;
  emitSeek(event.clientX);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
};
</script>

<style scoped>
.sigma-progress-bar {
  position: absolute;
  cursor: pointer;
}

.sigma-progress-track {
  position: absolute;
  inset: 0;
  background: rgba(153, 153, 153, 0.075);
}

.sigma-progress-remaining {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  background: rgba(1, 1, 1, 0.43);
}

.sigma-progress-climax {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(254, 254, 254, 0.35);
  pointer-events: none;
}

.sigma-progress-played {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: #fefefe;
}

.sigma-progress-knob {
  position: absolute;
  top: 0;
  width: 5px;
  height: 5px;
  margin-left: -5px;
  pointer-events: none;
}
</style>
