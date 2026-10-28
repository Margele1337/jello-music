<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  player: { type: Object, default: null }
});

const visible = ref(false);
const listRef = ref(null);

const queue = computed(() => props.player?.queue || []);
const currentIndex = computed(() => Number(props.player?.index ?? -1));

const formatDuration = (timeLength) => {
  const totalSeconds = Math.max(0, Math.round((Number(timeLength) || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const isCurrent = (index) => index === currentIndex.value;

const playItem = (index) => {
  if (isCurrent(index)) return;
  props.player?.playIndex?.(index);
  visible.value = false;
};

const removeItem = (index) => {
  props.player?.removeFromQueue?.(index);
};

const clearAll = () => {
  props.player?.clearQueue?.();
};

const toggle = () => {
  visible.value = !visible.value;
  if (visible.value) {
    nextTick(() => {
      setTimeout(() => {
        const target = listRef.value?.querySelector('.queue-item.is-playing');
        target?.scrollIntoView({ block: 'center' });
      }, 60);
    });
  }
};

const handleClickOutside = (event) => {
  if (!visible.value) return;
  const popup = listRef.value?.closest('.queue-popup');
  if (popup && !popup.contains(event.target) && !event.target.closest('.smp-queue-btn')) {
    visible.value = false;
  }
};

onMounted(() => document.addEventListener('click', handleClickOutside));
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside));

defineExpose({ toggle });
</script>

<template>
  <transition name="queue-fade">
    <div v-if="visible" ref="listRef" class="queue-popup">
      <div class="queue-header">
        <h3>播放列表 ({{ queue.length }})</h3>
        <button type="button" class="clear-btn" title="清空列表" @click="clearAll">清空</button>
      </div>
      <p v-if="!queue.length" class="queue-empty">队列是空的，去搜索或歌单里添加歌曲吧</p>
      <ul v-else class="queue-list">
        <li v-for="(song, index) in queue" :key="`${song.hash}-${index}`" class="queue-item"
          :class="{ 'is-playing': isCurrent(index) }">
          <div class="queue-song-info">
            <span class="queue-song-title">{{ song.name }}</span>
            <span class="queue-song-artist">{{ song.author || '' }} · {{ formatDuration(song.timeLength) }}</span>
          </div>
          <div class="queue-actions">
            <template v-if="isCurrent(index)">
              <span class="queue-playing-icon"></span>
            </template>
            <template v-else>
              <button type="button" class="play-btn" title="播放" @click="playItem(index)">▶</button>
              <button type="button" class="remove-btn" title="移除" @click="removeItem(index)">×</button>
            </template>
          </div>
        </li>
      </ul>
    </div>
  </transition>
</template>

<style scoped>
.queue-popup {
  position: fixed;
  right: 14px;
  bottom: 110px;
  width: 300px;
  max-height: 380px;
  display: flex;
  flex-direction: column;
  padding: 10px;
  border: 1px solid rgba(254, 254, 254, 0.12);
  border-radius: 10px;
  background: rgba(24, 24, 24, 0.92);
  backdrop-filter: blur(14px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
  z-index: 40;
  font-family: 'SigmaLight', 'Segoe UI', 'Microsoft YaHei', sans-serif;
}

.queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 8px;
  border-bottom: 1px solid rgba(254, 254, 254, 0.1);
}

.queue-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #fefefe;
}

.clear-btn {
  padding: 2px 8px;
  border: 1px solid rgba(254, 254, 254, 0.16);
  border-radius: 999px;
  background: transparent;
  color: #b9b1c6;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}

.clear-btn:hover {
  border-color: #ff69b4;
  color: #ff69b4;
}

.queue-empty {
  margin: 0;
  padding: 18px 6px;
  color: #776f83;
  font-size: 12px;
  text-align: center;
}

.queue-list {
  flex: 1;
  margin: 4px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  scroll-behavior: smooth;
}

.queue-list::-webkit-scrollbar {
  width: 4px;
}

.queue-list::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: rgba(254, 254, 254, 0.18);
}

.queue-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 4px;
  border-radius: 6px;
  transition: background 0.15s;
}

.queue-item:hover {
  background: rgba(254, 254, 254, 0.06);
}

.queue-item.is-playing {
  background: rgba(255, 105, 180, 0.1);
}

.queue-song-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.queue-song-title {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: #fefefe;
}

.queue-item.is-playing .queue-song-title {
  color: #ff69b4;
}

.queue-song-artist {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #8d8499;
}

.queue-item.is-playing .queue-song-artist {
  color: rgba(255, 105, 180, 0.75);
}

.queue-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.play-btn,
.remove-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #8d8499;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.play-btn {
  color: #b9b1c6;
}

.play-btn:hover {
  background: rgba(255, 105, 180, 0.16);
  color: #ff69b4;
}

.remove-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

/* 正在播放：三根跳动的粉色小竖条 */
.queue-playing-icon {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
  padding-right: 12px;
}

.queue-playing-icon::before,
.queue-playing-icon::after {
  content: '';
  width: 2px;
  height: 14px;
  border-radius: 1px;
  background: #ff69b4;
  animation: queue-bar 0.9s ease-in-out infinite;
}

.queue-playing-icon::before {
  animation-delay: 0.2s;
}

.queue-playing-icon::after {
  animation-delay: 0.45s;
}

@keyframes queue-bar {
  0%, 100% { transform: scaleY(0.35); }
  50% { transform: scaleY(1); }
}

.queue-fade-enter-active,
.queue-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.queue-fade-enter-from,
.queue-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
