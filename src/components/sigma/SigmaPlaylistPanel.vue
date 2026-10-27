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
import { computed, ref, watch } from 'vue';
import SigmaText from './SigmaText.vue';

const emit = defineEmits(['select']);

const props = defineProps({
  temporaryPlaylist: { type: Object, default: null }
});

const items = ref([
  { key: 'daily', type: 'daily', name: '每日推荐' },
  { key: 'like', type: 'playlist', id: 'demo-like', name: '我喜欢的音乐' },
  { key: 'pl-night', type: 'playlist', id: 'demo-night', name: '夜车电台' },
  { key: 'pl-focus', type: 'playlist', id: 'demo-focus', name: '专注工作' }
]);

const selectedKey = ref('daily');
const hoveredKey = ref('');

const temporaryItem = computed(() => {
  const playlist = props.temporaryPlaylist;
  if (!playlist?.id) return null;
  return {
    key: 'temp-playlist',
    type: 'playlist',
    id: playlist.id,
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
