<template>
  <div ref="panelRef" class="sigma-playlist-panel" :class="{ 'is-dragging': !!draggingKey }" @click.capture="onClickCapture">
    <button
      v-for="item in displayItems"
      :key="item.key"
      type="button"
      class="sigma-playlist-item"
      :class="{ active: item.key === selectedKey, dragging: draggingKey === item.key }"
      :data-key="item.key"
      :title="item.name"
      @click="onSelect(item)"
      @pointerenter="hoveredKey = item.key"
      @pointerleave="hoveredKey = ''"
      @pointerdown="onItemPointerDown(item, $event)"
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getUserPlaylists } from '../../services/api/library.js';
import { useAuthStore } from '../../stores/auth.js';
import { buildPlaylistSidebarItems } from '../../utils/playlistSidebar.js';
import SigmaText from './SigmaText.vue';

const emit = defineEmits(['select']);

const props = defineProps({
  temporaryPlaylist: { type: Object, default: null }
});

const auth = useAuthStore();
const remotePlaylists = ref([]);
const selectedKey = ref('daily');
const hoveredKey = ref('');

// ===== 长按拖动排序（仅歌单条目；猜你喜欢/每日推荐固定；顺序存 localStorage）=====
const ORDER_STORAGE_KEY = 'sigmaPlaylistOrder';
const LONG_PRESS_MS = 320;
const DRAG_CLICK_SUPPRESS_MS = 250;
const panelRef = ref(null);
const draggingKey = ref('');
let dragEndedAt = 0;
let dragCleanup = null;

const loadSavedOrder = () => {
  try {
    const value = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
};

const persistOrder = () => {
  try {
    localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(savedOrder.value));
  } catch {
    /* ignore */
  }
};

const savedOrder = ref(loadSavedOrder());

const draggableKeys = () => displayItems.value
  .filter((item) => item.type === 'playlist' && item.id && !item.temporary)
  .map((item) => item.key);

// 拖动上下文（长按触发时建）：起点/键序/项高，供逐帧 transform 计算
let dragCtx = null;

const clearDragStyles = () => {
  panelRef.value?.querySelectorAll('.sigma-playlist-item').forEach((el) => {
    el.style.transform = '';
    el.style.zIndex = '';
    el.style.transition = '';
  });
};

const finishDrag = async () => {
  const dragKey = dragCtx?.key || null;
  let keysSnapshot = null;
  let fromIdx = 0;
  let lastIdx = 0;
  let residualPx = 0;
  if (dragCtx) {
    keysSnapshot = dragCtx.keys;
    fromIdx = dragCtx.fromIdx;
    lastIdx = dragCtx.lastIdx;
    const nextKeys = [...keysSnapshot];
    nextKeys.splice(fromIdx, 1);
    // lastIdx（curSlot）就是移除被拖项后的最终数组槽位——向下交换不做 -1
    // 修正（多减一位会把向下交换永远打回原位，表现为相邻拖动「弹回复位」）
    const insertAt = Math.max(0, Math.min(nextKeys.length, lastIdx));
    nextKeys.splice(insertAt, 0, dragKey);
    if (nextKeys.join('|') !== keysSnapshot.join('|')) {
      savedOrder.value = nextKeys;
      persistOrder();
    }
    // 被拖项的残位移：拖动位移 − 槽位差×身位。重排会把节点搬到新槽位，
    // 预置这个残位移后节点搬移前后视觉位置严格连续（否则重排帧多出
    // 「槽位差×身位」的错位 = 松手闪跳）
    residualPx = dragCtx.offset - (lastIdx - fromIdx) * dragCtx.itemH;
  }
  draggingKey.value = '';
  dragEndedAt = performance.now();
  dragCtx = null;
  // 提交帧分三步，杜绝闪跳：
  // 1) 冻结全部过渡（.dragging 移除会恢复 0.16s 过渡，不清冻结就会把
  //    残余位移动画出来）；2) 非拖拽项清位移——它们重排后的自然位置 =
  //    让位时的视觉位置，清除无视觉变化；3) 重排完成后清被拖项残位移。
  const els = panelRef.value ? Array.from(panelRef.value.querySelectorAll('.sigma-playlist-item')) : [];
  els.forEach((el) => { el.style.transition = 'none'; });
  els.forEach((el) => {
    if (dragKey && el.dataset.key === dragKey) {
      el.style.transform = `translateY(${residualPx}px) scale(1.05)`;
      return;
    }
    el.style.transform = '';
    el.style.zIndex = '';
  });
  await nextTick();
  els.forEach((el) => {
    el.style.transform = '';
    el.style.zIndex = '';
    el.style.transition = '';
  });
};

// 手机桌面式拖动：被拖条目浮起跟手；其余条目按「被拖条目当前掠过的槽位」
// 实时平移让位——位移由 curSlot 连续计算（round(dy/itemH)），不依赖 CSS
// transition 追赶，条目随指针平滑推开/回弹，无跳变无振荡
const onDragMove = (event) => {
  if (!dragCtx || !panelRef.value) return;
  const { keys, fromIdx, itemH, startY } = dragCtx;
  const n = keys.length;
  const dy = event.clientY - startY;
  const clamped = Math.max(-fromIdx * itemH, Math.min((n - 1 - fromIdx) * itemH, dy));
  // 滞后阈值：位移超过身位的 60% 才换槽（让位动画的触发点）。50% 中线附近
  // 的微小回退不再翻转槽位——否则松手时常见"让位已发生、顺序却按原位提交"
  // 的反弹复位
  const slots = clamped / itemH;
  const offset = Math.trunc(slots);
  const frac = slots - offset;
  let slotOffset = offset;
  if (frac >= 0.6) slotOffset = offset + 1;
  else if (frac <= -0.6) slotOffset = offset - 1;
  const curSlot = fromIdx + slotOffset;
  dragCtx.lastIdx = curSlot;
  dragCtx.offset = clamped;
  for (let i = 0; i < n; i += 1) {
    const el = panelRef.value.querySelector(`[data-key="${CSS.escape(keys[i])}"]`);
    if (!el) continue;
    if (i === fromIdx) {
      // 被拖条目：完全跟手（不经 transition），浮起放大
      el.style.transition = 'none';
      el.style.transform = `translateY(${clamped}px) scale(1.05)`;
      el.style.zIndex = '2';
    } else {
      // 让位条目：处于原槽位与被拖条目原槽位之间 → 平移一个身位让开
      let shift = 0;
      if (fromIdx < curSlot && i > fromIdx && i <= curSlot) shift = -itemH;
      else if (fromIdx > curSlot && i < fromIdx && i >= curSlot) shift = itemH;
      el.style.transition = 'transform 0.14s ease';
      el.style.transform = shift ? `translateY(${shift}px)` : '';
      el.style.zIndex = '';
    }
  }
};

const onItemPointerDown = (item, event) => {
  // 固定入口（猜你喜欢/每日推荐/登录）与临时歌单不参与长按拖动
  if (item.type !== 'playlist' || !item.id || item.temporary) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  let phase = 'press'; // press（长按计时）→ drag（拖动中）→ done
  const stop = () => {
    phase = 'done';
    clearTimeout(timer);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  const timer = setTimeout(() => {
    if (phase !== 'press') return;
    phase = 'drag';
    const el = panelRef.value?.querySelector(`[data-key="${CSS.escape(item.key)}"]`);
    if (!el) {
      phase = 'done';
      stop();
      return;
    }
    // 长按触发：记录拖动上下文（键序/项高/起点），条目浮起由 .dragging 样式呈现
    const keys = draggableKeys();
    dragCtx = {
      key: item.key,
      keys,
      fromIdx: keys.indexOf(item.key),
      itemH: el.getBoundingClientRect().height,
      startY: event.clientY,
      curIdx: keys.indexOf(item.key)
    };
    draggingKey.value = item.key;
  }, LONG_PRESS_MS);
  const onMove = (e) => {
    // 长按计时到点前忽略移动（快速点击不受影响）；到点后无条件进入拖动——
    // 不能因「按住期间手在动」取消，否则永远进不了拖动态
    if (phase !== 'drag') return;
    onDragMove(e);
  };
  const onUp = () => {
    if (phase === 'drag') finishDrag();
    stop();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  dragCleanup = stop;
};

// 拖动结束后的 click 会误选中拖过的歌单：短暂抑制
const onClickCapture = (event) => {
  if (draggingKey.value || performance.now() - dragEndedAt < DRAG_CLICK_SUPPRESS_MS) {
    event.stopPropagation();
    event.preventDefault();
  }
};

onBeforeUnmount(() => {
  if (dragCleanup) dragCleanup();
});

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

const items = computed(() => buildPlaylistSidebarItems(remotePlaylists.value, {
  authenticated: auth.isAuthenticated,
  ready: auth.ready,
  savedOrder: savedOrder.value
}));

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
  if (performance.now() - dragEndedAt < DRAG_CLICK_SUPPRESS_MS) return;
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
  transition: color 0.15s ease, transform 0.16s ease, box-shadow 0.16s ease;
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

.sigma-playlist-item.dragging {
  /* 手机图标拖动式的浮起态：近不透明 + 阴影 + 轻微放大，transform 跟手不经 transition */
  opacity: 0.95;
  background: rgba(42, 36, 52, 0.92);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
  border-radius: 6px;
  cursor: grabbing;
  z-index: 2;
  transition: none;
}

.sigma-playlist-panel.is-dragging {
  user-select: none;
  cursor: grabbing;
}
</style>
