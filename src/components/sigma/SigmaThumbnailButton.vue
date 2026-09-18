<template>
  <button
    class="sigma-thumbnail-button"
    :class="{ playlist: type === 'playlist' }"
    type="button"
    @click="$emit('click')"
  >
    <img class="sigma-thumbnail-cover" :src="cover" loading="lazy" alt="" />
    <img class="sigma-thumbnail-cover-blur" :src="cover" loading="lazy" alt="" />
    <img class="sigma-thumbnail-play" :src="playIcon" alt="" />
    <div v-if="type === 'playlist'" class="sigma-thumbnail-title single">{{ title }}</div>
    <template v-else>
      <div class="sigma-thumbnail-title">{{ title }}</div>
      <div class="sigma-thumbnail-artist">{{ artist }}</div>
    </template>
  </button>
</template>

<script setup>
// 对应 sigmarebase: gui/base/elements/impl/button/types/ThumbnailButton.java
// 卡片 183x220：封面 153x153 @(15,15)；歌曲卡 #010101、歌单卡 #037C8C；
// 悬停封面放大 1.0654 + 模糊封面(14px)交叉淡入 + 播放图标 25→50
import playIcon from '../../assets/sigma/notifications/play-icon.png';

defineProps({
  type: { type: String, default: 'song' },
  cover: { type: String, default: '' },
  title: { type: String, default: '' },
  artist: { type: String, default: '' }
});

defineEmits(['click']);
</script>

<style scoped>
.sigma-thumbnail-button {
  position: absolute;
  width: 183px;
  height: 220px;
  border: none;
  padding: 0;
  background: #010101;
  cursor: pointer;
  overflow: hidden;
}

.sigma-thumbnail-button.playlist {
  background: #037c8c;
}

.sigma-thumbnail-cover,
.sigma-thumbnail-cover-blur {
  position: absolute;
  left: 15px;
  top: 15px;
  width: 153px;
  height: 153px;
  object-fit: cover;
  transition: transform 0.125s ease;
}

.sigma-thumbnail-cover-blur {
  filter: blur(14px);
  opacity: 0;
  transition: opacity 0.125s ease, transform 0.125s ease;
}

.sigma-thumbnail-button:hover .sigma-thumbnail-cover,
.sigma-thumbnail-button:hover .sigma-thumbnail-cover-blur {
  transform: scale(1.0654);
}

.sigma-thumbnail-button:hover .sigma-thumbnail-cover-blur {
  opacity: 1;
}

.sigma-thumbnail-play {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 50px;
  height: 50px;
  transform: translate(-50%, -50%) scale(0.5);
  opacity: 0;
  transition: opacity 0.125s ease, transform 0.125s ease;
  pointer-events: none;
}

.sigma-thumbnail-button:hover .sigma-thumbnail-play {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}

.sigma-thumbnail-title,
.sigma-thumbnail-artist {
  position: absolute;
  left: 0;
  right: 0;
  /* 与 sigmarebase 一致：Jello 原版字体 */
  font-family: 'JelloLight', sans-serif;
  font-size: 12px;
  line-height: 13px;
  color: #fefefe;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
}

.sigma-thumbnail-title {
  top: 181px;
}

.sigma-thumbnail-title.single {
  top: 187px;
}

.sigma-thumbnail-artist {
  top: 194px;
}
</style>
