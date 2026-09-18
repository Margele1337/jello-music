<template>
  <div class="sigma-playlist-panel">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="sigma-playlist-item"
      :class="{ active: item.key === selectedKey }"
      @click="onSelect(item)"
    >
      {{ item.name }}
    </button>
  </div>
</template>

<script setup>
// 对应 sigmarebase 左栏歌单列表（原版 musicTabs 的内容）
// 从上到下：每日推荐、我喜欢、我的歌单…
import { onMounted, ref } from 'vue';
import { get } from '../../utils/request';
import { MoeAuthStore } from '../../stores/store';

const emit = defineEmits(['select']);

const items = ref([]);
const selectedKey = ref('');

const onSelect = (item) => {
  selectedKey.value = item.key;
  emit('select', item);
};

const load = async () => {
  const list = [
    // 猜你喜欢（主页「私人专属好歌推荐」）：点击直接播放，右侧保持为空
    { key: 'guess', type: 'guess', name: '猜你喜欢' },
    { key: 'daily', type: 'daily', name: '每日推荐' }
  ];
  try {
    const auth = MoeAuthStore();
    const response = await get('/user/playlist', { pagesize: 500, t: localStorage.getItem('t') });
    if (response?.status === 1) {
      const info = Array.isArray(response.data?.info) ? [...response.data.info] : [];
      const sorted = info.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      const mine = sorted.filter((playlist) => playlist.name === '我喜欢' || playlist.list_create_userid === auth.UserInfo?.userid);

      const like = mine.find((playlist) => playlist.name === '我喜欢');
      if (like) {
        localStorage.setItem('like', like.listid);
        const likeGid = like.list_create_gid || like.global_collection_id;
        if (likeGid) {
          list.push({ key: 'like', type: 'playlist', id: likeGid, name: '我喜欢' });
        }
      }

      for (const playlist of mine) {
        if (playlist.name === '我喜欢') continue;
        // /playlist/track/all 需要 global_collection_id（collection_3_…），不是 listid
        const gid = playlist.list_create_gid || playlist.global_collection_id;
        if (!gid) continue;
        list.push({ key: 'pl-' + playlist.listid, type: 'playlist', id: gid, name: playlist.name });
      }
    }
  } catch (error) {
    console.error('[SigmaPlaylistPanel] 获取歌单失败:', error);
  }
  items.value = list;
};

onMounted(load);
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
  font-family: 'JelloLight', sans-serif;
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
