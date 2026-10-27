<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { getLyrics } from '../services/api/library.js';
import { usePlayerStore } from '../stores/player.js';

const router = useRouter();
const player = usePlayerStore();

const lines = ref([]);
const activeIndex = ref(-1);
const status = ref('');
const scrollRef = ref(null);

let loadToken = 0;
let tickTimer = null;

const song = computed(() => player.currentSong);
const title = computed(() => song.value?.name || '还没有播放歌曲');
const artist = computed(() => song.value?.author || '');

const currentTime = () => {
  const audio = player.audio;
  return Number.isFinite(audio?.currentTime) ? audio.currentTime : 0;
};

const updateActive = () => {
  if (!lines.value.length) return;
  const time = currentTime() + 0.15;
  let index = -1;
  for (let i = 0; i < lines.value.length; i += 1) {
    if (lines.value[i].time > time) break;
    index = i;
  }
  if (index === activeIndex.value) return;
  activeIndex.value = index;
  nextTick(() => {
    scrollRef.value?.querySelector('.lyric-line.active')?.scrollIntoView({
      block: 'center',
      behavior: 'smooth'
    });
  });
};

const loadLyrics = async () => {
  const current = song.value;
  const token = ++loadToken;
  lines.value = [];
  activeIndex.value = -1;

  if (!current) {
    status.value = '还没有播放歌曲';
    return;
  }

  status.value = '正在加载歌词…';
  try {
    const result = await getLyrics(current);
    if (token !== loadToken) return;
    lines.value = result.lines;
    status.value = '';
    updateActive();
  } catch (error) {
    if (token !== loadToken) return;
    status.value = error?.message || '歌词加载失败';
  }
};

const seekTo = (line) => {
  const audio = player.audio;
  if (!audio || !line) return;
  audio.currentTime = line.time;
  updateActive();
};

const goBack = () => router.push('/');

const onKeyDown = (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  goBack();
};

watch(() => song.value?.hash, loadLyrics);

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
  void loadLyrics();
  tickTimer = setInterval(updateActive, 250);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown);
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
});
</script>

<template>
  <main class="lyrics-page">
    <header class="lyrics-header">
      <button type="button" class="back-button" aria-label="返回" @click="goBack">←</button>
      <div class="song-info">
        <p class="song-title">{{ title }}</p>
        <p v-if="artist" class="song-artist">{{ artist }}</p>
      </div>
    </header>

    <div v-if="lines.length" ref="scrollRef" class="lyrics-scroll">
      <button
        v-for="(line, index) in lines"
        :key="`${line.time}-${index}`"
        type="button"
        class="lyric-line"
        :class="{ active: index === activeIndex }"
        @click="seekTo(line)"
      >
        {{ line.text }}
      </button>
    </div>
    <p v-else class="lyrics-status">{{ status }}</p>
  </main>
</template>

<style scoped>
.lyrics-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 26px 40px 30px;
  overflow: hidden;
}

.lyrics-header {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 0 0 auto;
}

.back-button {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: 1px solid #2a2434;
  border-radius: 50%;
  background: transparent;
  color: #b9b1c6;
  font: inherit;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

.back-button:hover {
  border-color: #ff69b4;
  color: #fff;
}

.song-info {
  min-width: 0;
}

.song-title {
  margin: 0;
  color: #f2eef6;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-artist {
  margin: 2px 0 0;
  color: #837b8f;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lyrics-scroll {
  flex: 1 1 auto;
  margin-top: 14px;
  padding: 120px 6px;
  overflow-y: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(to bottom, transparent 0, #000 90px, #000 calc(100% - 90px), transparent 100%);
}

.lyrics-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.lyric-line {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  color: rgba(242, 238, 246, 0.34);
  font: inherit;
  font-size: 15px;
  line-height: 1.5;
  text-align: center;
  cursor: pointer;
  transition: color 0.18s ease, font-size 0.18s ease;
}

.lyric-line:hover {
  color: rgba(242, 238, 246, 0.7);
}

.lyric-line.active {
  color: #ffd1e8;
  font-size: 17px;
  font-weight: 600;
}

.lyrics-status {
  flex: 1 1 auto;
  display: grid;
  place-items: center;
  margin: 0;
  color: #776f83;
  font-size: 13px;
}
</style>
