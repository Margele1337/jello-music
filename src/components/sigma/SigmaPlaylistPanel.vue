<template>
  <div class="sigma-playlist-panel">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="sigma-playlist-item"
      :class="{ active: item.key === selectedKey }"
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
// 对应 sigmarebase 左栏歌单列表（原版 musicTabs 的内容）
// 从上到下：每日推荐、我喜欢、我的歌单…
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { get } from '../../utils/request';
import { MoeAuthStore } from '../../stores/store';
import SigmaText from './SigmaText.vue';

const { t } = useI18n();

// 「我喜欢的音乐」识别：酷狗里该歌单的 global_collection_id 固定以 collection_3_ 开头，
// 这是与歌单名无关的稳定标识；用户可以给歌单改名，所以只靠中文字面量匹配会漏掉
// 「我喜欢的音乐」「我喜欢的歌曲」等变体，甚至改名后完全找不到。
const isLikePlaylist = (playlist) => {
  const gid = String(playlist?.list_create_gid || playlist?.global_collection_id || '');
  if (gid.startsWith('collection_3_')) return true;
  const name = String(playlist?.name || '').trim();
  return ['我喜欢', '我喜欢的音乐', '我喜欢的歌曲'].includes(name);
};

const emit = defineEmits(['select']);

const auth = MoeAuthStore();
const items = ref([]);
const selectedKey = ref('');
const hoveredKey = ref('');

const onSelect = (item) => {
  selectedKey.value = item.key;
  emit('select', item);
};

const load = async () => {
  const list = [
    // 猜你喜欢（主页「私人专属好歌推荐」）：点击直接播放，右侧保持为空
    { key: 'guess', type: 'guess', name: t('cai-ni-xi-huan') },
    { key: 'daily', type: 'daily', name: t('mei-ri-tui-jian') }
  ];
  try {
    const response = await get('/user/playlist', { pagesize: 500, t: localStorage.getItem('t') });
    if (response?.status === 1) {
      const info = Array.isArray(response.data?.info) ? [...response.data.info] : [];
      const sorted = info.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      const mine = sorted.filter((playlist) => playlist.list_create_userid === auth.UserInfo?.userid);

      // 先在自己创建的歌单里找，找不到再在全部歌单里兜底
      const like = mine.find(isLikePlaylist) || sorted.find(isLikePlaylist);
      if (like) {
        // 收藏快捷键用 listid（/playlist/tracks/add?listid=…）
        localStorage.setItem('like', like.listid);
        const likeGid = like.list_create_gid || like.global_collection_id;
        if (likeGid) {
          list.push({ key: 'like', type: 'playlist', id: likeGid, name: t('wo-xi-huan') });
        }
      }

      for (const playlist of mine) {
        if (isLikePlaylist(playlist)) continue;
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

// 面板随播放器常驻（v-show），登录前就已挂载：登录/切换账号后需重新拉取歌单
watch(() => auth.UserInfo?.userid, () => {
  load();
});

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
