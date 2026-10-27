<template>
  <div class="sigma-playlist-panel">
    <button
      v-for="item in displayItems"
      :key="item.key"
      type="button"
      class="sigma-playlist-item"
      :class="{ active: item.key === selectedKey }"
      :title="item.name"
      @click="onSelect(item)"
      @pointerenter="hoveredKey = item.key"
      @pointerleave="hoveredKey = ''"
    >
      <SigmaText
        :text="item.name"
        :size="13"
        fluid
        truncate
        align="center"
        :alpha="item.key === selectedKey || item.key === hoveredKey ? 1 : 0.55"
      />
    </button>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { getUserPlaylists } from '../../services/api/library.js';
import { useAuthStore } from '../../stores/auth.js';
import SigmaText from './SigmaText.vue';

const emit = defineEmits(['select']);

const props = defineProps({
  temporaryPlaylist: { type: Object, default: null }
});

const auth = useAuthStore();
const remotePlaylists = ref([]);
const selectedKey = ref('daily');
const hoveredKey = ref('');

const loadUserPlaylists = async () => {
  if (!auth.isAuthenticated) {
    remotePlaylists.value = [];
    return;
  }
  try {
    remotePlaylists.value = await getUserPlaylists();
  } catch (error) {
    remotePlaylists.value = [];
    console.warn('[SigmaPlaylistPanel] 用户歌单载入失败:', error?.message || error);
  }
};

onMounted(loadUserPlaylists);
watch(() => auth.isAuthenticated, loadUserPlaylists);

const items = computed(() => {
  const list = [];
  if (auth.ready && !auth.isAuthenticated) {
    list.push({ key: 'login', type: 'login', name: '登录' });
  }
  list.push({ key: 'daily', type: 'daily', name: '每日推荐' });

  const playlists = remotePlaylists.value || [];
  const liked = playlists.find((playlist) => playlist.isDefault);
  if (liked) {
    list.push({
      key: `pl-${liked.id}`,
      type: 'playlist',
      id: liked.id,
      idType: liked.idType,
      listId: liked.listId,
      name: '我喜欢的音乐'
    });
  }
  for (const playlist of playlists) {
    if (playlist === liked) continue;
    list.push({
      key: `pl-${playlist.id}`,
      type: 'playlist',
      id: playlist.id,
      idType: playlist.idType,
      listId: playlist.listId,
      name: playlist.name
    });
  }
  list.push({ key: 'lyrics', type: 'lyrics', name: '歌词' });
  list.push({ key: 'settings', type: 'settings', name: '设置' });
  return list;
});

const temporaryItem = computed(() => {
  const playlist = props.temporaryPlaylist;
  if (!playlist?.id) return null;
  return {
    key: 'temp-playlist',
    type: 'playlist',
    id: playlist.id,
    idType: playlist.idType,
    listId: playlist.listId,
    name: playlist.name || '歌单',
    temporary: true
  };
});

const displayItems = computed(() => (
  temporaryItem.value ? [temporaryItem.value, ...items.value] : items.value
));

watch(() => props.temporaryPlaylist, (value) => {
  if (value?.id) {
    selectedKey.value = 'temp-playlist';
  } else if (selectedKey.value === 'temp-playlist') {
    selectedKey.value = '';
  }
}, { immediate: true });

const onSelect = (item) => {
  selectedKey.value = item.key;
  emit('select', item);
};
</script>

<style scoped>
.sigma-playlist-panel {
  position: absolute;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 8px 150px;
}

.sigma-playlist-panel::-webkit-scrollbar {
  width: 3px;
}

.sigma-playlist-panel::-webkit-scrollbar-thumb {
  background: rgba(254, 254, 254, 0.18);
}

.sigma-playlist-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  margin-bottom: 2px;
  border: none;
  background: transparent;
  color: rgba(254, 254, 254, 0.55);
  font-family: 'SigmaLight', sans-serif;
  font-size: 13px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.15s ease;
}

.sigma-playlist-item:focus {
  outline: none;
}

.sigma-playlist-item:hover {
  background: transparent;
  color: #fefefe;
}

.sigma-playlist-item.active {
  background: transparent;
  color: #fefefe;
}
</style>
