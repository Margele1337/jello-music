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
// 普通账号服务端默认给 30 首（会员 60）：先按 pagesize=60 + 翻页请求（需要 API 侧补丁透传参数），
// 若服务端仍不给，再用「猜你喜欢」按 hash 去重补足
const DAILY_TARGET_COUNT = 60;

const toDailyCard = (song) => ({
  type: 'song',
  key: 'sn-' + song.hash,
  hash: song.hash,
  // 每日推荐是 ori_audio_name，猜你喜欢卡片是 songname
  title: stripBrackets(song.ori_audio_name || song.songname || song.name),
  artist: stripBrackets(song.author_name || song.author),
  cover: (song.sizable_cover || song.cover || '').replace('{size}', '480') || artworkImg,
  timelen: song.time_length || song.timelen || 0
});

const loadDailyRecommend = async () => {
  cards.value = [];
  try {
    const collected = [];
    const seen = new Set();

    // 1) 原生每日推荐（param 透传由 tools/patch-api.cjs 打补丁）
    for (const page of [1, 2]) {
      let list = [];
      try {
        const response = await get('/everyday/recommend', { pagesize: DAILY_TARGET_COUNT, page });
        if (response?.status !== 1) break;
        list = Array.isArray(response.data?.song_list) ? response.data.song_list : [];
      } catch (error) {
        console.warn('[SigmaSearchBox] 每日推荐请求失败:', error);
        break;
      }
      if (!list.length) break;
      const before = collected.length;
      for (const song of list) {
        if (!song?.hash || seen.has(song.hash)) continue;
        seen.add(song.hash);
        collected.push(song);
      }
      if (collected.length >= DAILY_TARGET_COUNT) break;
      if (collected.length === before) break; // 没有新增，说明服务端不支持翻页
    }
    console.log(`[SigmaSearchBox] 每日推荐原生返回: ${collected.length} 首`);

    // 2) 仍不足则用「猜你喜欢」补足
    if (collected.length < DAILY_TARGET_COUNT) {
      try {
        const extra = await get(`/top/card?card_id=1&timestamp=${Date.now()}`);
        const extraList = Array.isArray(extra?.data?.song_list) ? extra.data.song_list : [];
        for (const song of extraList) {
          if (collected.length >= DAILY_TARGET_COUNT) break;
          if (!song?.hash || seen.has(song.hash)) continue;
          seen.add(song.hash);
          collected.push(song);
        }
        console.log(`[SigmaSearchBox] 补足后共: ${collected.length} 首`);
      } catch (error) {
        console.warn('[SigmaSearchBox] 补足每日推荐失败:', error);
      }
    }

    cards.value = collected.map(toDailyCard).filter((item) => item.hash);
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
