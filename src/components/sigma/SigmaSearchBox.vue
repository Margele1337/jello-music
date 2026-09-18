<template>
  <div class="sigma-search-box">
    <SigmaTextField
      class="sigma-search-box-field"
      v-model="keyword"
      placeholder="Search..."
      @submit="doSearch"
    />
    <SigmaScrollablePanel class="sigma-search-box-results" ref="resultsEl">
      <SigmaThumbnailButton
        v-for="(card, index) in cards"
        :key="card.key"
        :type="card.type"
        :cover="card.cover"
        :title="card.title"
        :artist="card.artist"
        :style="cardStyle(index)"
        @click="onCardClick(card)"
      />
    </SigmaScrollablePanel>
  </div>
</template>

<script setup>
// 对应 sigmarebase: gui/impl/jello/ingame/clickgui/musicplayer/elements/SearchBox.java
// 顶部搜索框 (30,14,490x70) + 结果网格（卡片 183x220，x=10/183/356，y=90+row*210，歌单在前歌曲在后）
import { ref } from 'vue';
import { get } from '../../utils/request';
import artworkImg from '../../assets/sigma/music/artwork.png';
import SigmaTextField from './SigmaTextField.vue';
import SigmaScrollablePanel from './SigmaScrollablePanel.vue';
import SigmaThumbnailButton from './SigmaThumbnailButton.vue';

const props = defineProps({
  player: { type: Object, default: null }
});

const keyword = ref('');
const cards = ref([]);
const resultsEl = ref(null);

const cardStyle = (index) => ({
  left: `${[10, 183, 356][index % 3]}px`,
  top: `${90 + Math.floor(index / 3) * 210}px`
});

const stripBrackets = (value) => String(value ?? '').replace(/\(.*\)/g, '').replace(/\[.*\]/g, '').trim();

const doSearch = async () => {
  const text = keyword.value.trim();
  if (!text) {
    cards.value = [];
    return;
  }
  cards.value = [];
  try {
    const response = await get(`/search/complex?keywords=${encodeURIComponent(text)}`);
    const sections = Array.isArray(response?.data?.lists) ? response.data.lists : [];
    const collectSection = sections.find((item) => item?.type === 'collect');
    const songSection = sections.find((item) => item?.type === 'song');

    const playlists = (collectSection?.lists || []).map((item) => ({
      type: 'playlist',
      key: 'pl-' + (item.gid || item.specialid),
      // 搜索结果里 gid 才是 global_collection_id（Search.vue 同样用 gid）
      id: item.gid || item.global_collection_id || item.specialid,
      title: `歌单 ${stripBrackets(item.specialname || item.name)} · ${item.song_count ?? 0}首`,
      artist: '',
      cover: (item.img || artworkImg).replace('/150/', '/480/')
    }));

    const songs = (songSection?.lists || []).map((song) => ({
      type: 'song',
      key: 'sn-' + (song.HQFileHash || song.SQFileHash || song.FileHash),
      hash: song.HQFileHash || song.SQFileHash || song.FileHash,
      title: stripBrackets(song.OriSongName || song.SongName),
      artist: stripBrackets(song.SingerName),
      cover: (song.Image || '').replace('{size}', '480') || artworkImg,
      timelen: song.Duration || 0
    })).filter((item) => item.hash);

    cards.value = [...playlists, ...songs];
  } catch (error) {
    console.error('[SigmaSearchBox] 搜索失败:', error);
    cards.value = [];
  }
};

const loadPlaylist = async (card) => {
  cards.value = [];
  try {
    const list = await props.player?.getPlaylistAllSongs?.(card.id);
    if (!Array.isArray(list)) return;
    cards.value = list.map((song) => {
      // /playlist/track/all 的 name 为 "歌手 - 歌名"（无 author 字段），与 formatPlaylistTracks 相同拆法
      const rawName = String(song.name ?? song.OriSongName ?? '');
      const parts = rawName.split(' - ');
      const hasSplitName = parts.length > 1;
      const author = song.author || song.SingerName || (hasSplitName ? parts[0] : '');
      const title = (song.author || song.SingerName || !hasSplitName) ? rawName : parts.slice(1).join(' - ');
      return {
        type: 'song',
        key: 'sn-' + song.hash,
        hash: song.hash,
        title: stripBrackets(title),
        artist: stripBrackets(author),
        cover: (song.cover || song.Image || '').replace('{size}', '480') || artworkImg,
        timelen: song.timelen || song.Duration || 0
      };
    }).filter((item) => item.hash);
  } catch (error) {
    console.error('[SigmaSearchBox] 歌单加载失败:', error);
    cards.value = [];
  }
};

// 左栏歌单列表调用：按歌单 id 展示
const showPlaylist = (id) => loadPlaylist({ id });

// 左栏「每日推荐」：/everyday/recommend
const loadDailyRecommend = async () => {
  cards.value = [];
  try {
    const response = await get('/everyday/recommend');
    if (response?.status !== 1) return;
    const songs = Array.isArray(response.data?.song_list) ? response.data.song_list : [];
    cards.value = songs.map((song) => ({
      type: 'song',
      key: 'sn-' + song.hash,
      hash: song.hash,
      title: stripBrackets(song.ori_audio_name),
      artist: stripBrackets(song.author_name),
      cover: (song.sizable_cover || '').replace('{size}', '480') || artworkImg,
      timelen: song.time_length || 0
    })).filter((item) => item.hash);
  } catch (error) {
    console.error('[SigmaSearchBox] 每日推荐加载失败:', error);
    cards.value = [];
  }
};

// 左栏「猜你喜欢」等：清空右侧内容
const clear = () => {
  cards.value = [];
};

defineExpose({
  showPlaylist,
  loadDailyRecommend,
  clear
});

const onCardClick = async (card) => {
  if (!props.player) return;
  if (card.type === 'playlist') {
    await loadPlaylist(card);
    return;
  }

  const songs = cards.value
    .filter((item) => item.type === 'song')
    .map((item) => ({
      hash: item.hash,
      name: item.title,
      cover: item.cover,
      author: item.artist,
      timelen: item.timelen
    }));

  // 用当前列表（歌单/每日推荐/搜索结果）整体替换主窗口队列，再播放点击的这首；换歌跟随该列表
  props.player.playSongList?.(songs, card.hash);
};
</script>

<style scoped>
.sigma-search-box {
  position: absolute;
  left: 250px;
  top: 0;
  width: 550px;
  height: 506px;
  z-index: 2;
}

.sigma-search-box-field {
  left: 30px;
  top: 14px;
  width: 490px;
  height: 70px;
  z-index: 3;
}

.sigma-search-box-results {
  left: 0;
  top: 0;
  width: 550px;
  height: 506px;
}
</style>
