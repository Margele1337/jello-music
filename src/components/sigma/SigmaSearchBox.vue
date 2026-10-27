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
import { ref } from 'vue';
import artworkImg from '../../assets/sigma/music/artwork.png';
import SigmaTextField from './SigmaTextField.vue';
import SigmaScrollablePanel from './SigmaScrollablePanel.vue';
import SigmaThumbnailButton from './SigmaThumbnailButton.vue';

const props = defineProps({
  player: { type: Object, default: null }
});

const emit = defineEmits(['open-playlist', 'search']);

const keyword = ref('');
const cards = ref([]);
const resultsEl = ref(null);

const cardStyle = (index) => ({
  left: `${[10, 183, 356][index % 3]}px`,
  top: `${90 + Math.floor(index / 3) * 210}px`
});

const stripBrackets = (value) => String(value ?? '').replace(/\(.*\)/g, '').replace(/\[.*\]/g, '').trim();

const mockSongs = [
  { hash: 'demo-1', title: '海阔天空', artist: 'Beyond', timelen: 326000 },
  { hash: 'demo-2', title: '晴天', artist: '周杰伦', timelen: 269000 },
  { hash: 'demo-3', title: '夜空中最亮的星', artist: '逃跑计划', timelen: 252000 },
  { hash: 'demo-4', title: 'Yellow', artist: 'Coldplay', timelen: 269000 },
  { hash: 'demo-5', title: '起风了', artist: '买辣椒也用券', timelen: 325000 },
  { hash: 'demo-6', title: 'Numb', artist: 'Linkin Park', timelen: 185000 }
];

const mockPlaylists = [
  { id: 'demo-night', name: '夜车电台', title: '歌单 夜车电台 · 12首' },
  { id: 'demo-focus', name: '专注工作', title: '歌单 专注工作 · 20首' }
];

const toSongCard = (song) => ({
  type: 'song',
  key: 'sn-' + song.hash,
  hash: song.hash,
  title: stripBrackets(song.title),
  artist: stripBrackets(song.artist),
  cover: artworkImg,
  timelen: song.timelen
});

const toPlaylistCard = (playlist) => ({
  type: 'playlist',
  key: 'pl-' + playlist.id,
  id: playlist.id,
  name: playlist.name,
  title: playlist.title,
  artist: '',
  cover: artworkImg
});

const doSearch = () => {
  const text = keyword.value.trim();
  emit('search', text);
  if (!text) {
    cards.value = [];
    return;
  }
  const lower = text.toLowerCase();
  const songs = mockSongs
    .filter((song) => song.title.toLowerCase().includes(lower) || song.artist.toLowerCase().includes(lower))
    .map(toSongCard);
  const playlists = mockPlaylists
    .filter((playlist) => playlist.name.toLowerCase().includes(lower))
    .map(toPlaylistCard);
  cards.value = [...playlists, ...songs];
};

const loadPlaylist = () => {
  cards.value = mockSongs.map(toSongCard);
};

const showPlaylist = () => {
  loadPlaylist();
};

const loadDailyRecommend = () => {
  cards.value = mockSongs.map(toSongCard);
};

const clear = () => {
  cards.value = [];
};

defineExpose({
  showPlaylist,
  loadDailyRecommend,
  clear
});

const onCardClick = (card) => {
  if (!props.player) return;
  if (card.type === 'playlist') {
    emit('open-playlist', { id: card.id, name: card.name || card.title });
    loadPlaylist(card);
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
