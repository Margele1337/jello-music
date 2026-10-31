<script setup>
import { ref } from 'vue';
import { addSongToPlaylist, markSongLiked } from '../../services/api/collect.js';
import { getUserPlaylists } from '../../services/api/library.js';
import { useAuthStore } from '../../stores/auth.js';

const emit = defineEmits(['collected']);

const props = defineProps({
  player: { type: Object, default: null }
});

const auth = useAuthStore();

const isOpen = ref(false);
const loading = ref(false);
const playlists = ref([]);
const message = ref('');
const messageError = ref(false);
const addingId = ref(null);

const LIKED_NAMES = ['我喜欢', '我喜欢的音乐', '我的喜欢'];

const isLiked = (playlist) => (
  LIKED_NAMES.includes(String(playlist.name).trim())
  || (playlist.isDefault && String(playlist.name).trim() !== '默认收藏')
);

const open = async () => {
  if (!auth.isAuthenticated) {
    message.value = '请先登录';
    messageError.value = true;
    isOpen.value = true;
    return;
  }
  isOpen.value = true;
  message.value = '';
  messageError.value = false;
  loading.value = true;
  try {
    playlists.value = await getUserPlaylists();
  } catch {
    playlists.value = [];
    message.value = '获取歌单失败';
    messageError.value = true;
  } finally {
    loading.value = false;
  }
};

const addTo = async (playlist) => {
  const song = props.player?.currentSong;
  if (!song?.hash) {
    message.value = '没有正在播放的歌曲';
    messageError.value = true;
    return;
  }
  addingId.value = playlist.id;
  message.value = '';
  messageError.value = false;
  try {
    await addSongToPlaylist(playlist, song);
    if (isLiked(playlist)) markSongLiked(song);
    emit('collected', { playlist, song });
    message.value = `已收藏到「${playlist.name}」`;
    setTimeout(() => {
      isOpen.value = false;
    }, 900);
  } catch (error) {
    message.value = error?.message || '收藏失败';
    messageError.value = true;
  } finally {
    addingId.value = null;
  }
};

defineExpose({ open });
</script>

<template>
  <teleport to="body">
    <transition name="collect-fade">
      <div v-if="isOpen" class="collect-modal" @click.self="isOpen = false">
        <div class="collect-content">
          <h3>收藏到歌单</h3>
          <p v-if="message" class="collect-message" :class="{ 'is-error': messageError }">{{ message }}</p>
          <p v-if="loading" class="collect-loading">正在获取歌单…</p>
          <p v-else-if="!playlists.length && !message" class="collect-loading">没有可用的歌单</p>
          <ul v-else class="collect-list">
            <li v-for="playlist in playlists" :key="playlist.id"
              :class="{ 'is-liked': isLiked(playlist) }" @click="addTo(playlist)">
              <span class="collect-name">{{ playlist.name }}</span>
              <span v-if="addingId === playlist.id" class="collect-busy">添加中…</span>
            </li>
          </ul>
          <button type="button" class="collect-close" @click="isOpen = false">关闭</button>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.collect-modal {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.collect-content {
  width: min(340px, calc(100vw - 48px));
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  padding: 18px;
  border: 1px solid rgba(254, 254, 254, 0.14);
  border-radius: 14px;
  background: #17121d;
  font-family: 'SigmaLight', 'Segoe UI', 'Microsoft YaHei', sans-serif;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
}

.collect-content h3 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
  color: #fefefe;
}

.collect-list {
  flex: 1;
  margin: 6px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.collect-list::-webkit-scrollbar {
  width: 4px;
}

.collect-list::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: rgba(254, 254, 254, 0.18);
}

.collect-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 8px;
  color: #b9b1c6;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.collect-list li:hover {
  background: rgba(255, 105, 180, 0.12);
  color: #fff;
}

.collect-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.collect-busy {
  flex: 0 0 auto;
  font-size: 11px;
  color: #8d8499;
}

.collect-loading {
  margin: 10px 0;
  color: #776f83;
  font-size: 12px;
  text-align: center;
}

.collect-message {
  margin: 0 0 8px;
  color: #9fe6c8;
  font-size: 12px;
}

.collect-message.is-error {
  color: #ff8f9f;
}

.collect-close {
  margin-top: 12px;
  padding: 8px 0;
  border: 1px solid rgba(254, 254, 254, 0.16);
  border-radius: 8px;
  background: transparent;
  color: #b9b1c6;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.collect-close:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}

.collect-fade-enter-active,
.collect-fade-leave-active {
  transition: opacity 0.18s ease;
}

.collect-fade-enter-from,
.collect-fade-leave-to {
  opacity: 0;
}
</style>
