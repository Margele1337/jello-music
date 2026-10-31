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

const finishDrag = async () => {
  const dragKey = dragCtx?.key || null;
  let preTops = null;
  if (dragCtx) {
    const keysSnapshot = dragCtx.keys;
    const fromIdx = dragCtx.fromIdx;
    const lastIdx = dragCtx.lastIdx;
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
    // 提交前抓取所有条目的当前视觉 top：让位动画（0.14s）可能进行到一半，
    // 只给被拖项预置残位移不够——邻居半途被「拍」到终点同样读作松手闪跳
    const els = panelRef.value ? Array.from(panelRef.value.querySelectorAll('.sigma-playlist-item')) : [];
    preTops = new Map(els.map((el) => [el, el.getBoundingClientRect().top]));
  }
  draggingKey.value = '';
  dragEndedAt = performance.now();
  dragCtx = null;
  const els = panelRef.value ? Array.from(panelRef.value.querySelectorAll('.sigma-playlist-item')) : [];
  els.forEach((el) => { el.style.transition = 'none'; });
  await nextTick();
  // 重排落地：先全部清到自然位（冻结态），再按「提交前视觉位 − 新自然位」
  // 预置残位移——画面像素级回到松手瞬间；强制 reflow 后解除冻结，有残差的
  // 条目以 0.14s 滑入自然位（与让位动画同速），无残差的无感
  els.forEach((el) => {
    el.style.transform = '';
    el.style.zIndex = '';
  });
  els.forEach((el) => {
    const preTop = preTops?.get(el);
    const delta = preTop == null ? 0 : preTop - el.getBoundingClientRect().top;
    el.style.transform = delta ? `translateY(${delta}px)` : '';
  });
  void panelRef.value?.offsetHeight;
  els.forEach((el) => {
    el.style.transition = el.style.transform ? 'transform 0.14s ease' : '';
    el.style.transform = '';
    el.style.zIndex = '';
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
  // 槽位按半程取整：换槽边界落在两个身位的中间而非槽位线上——对齐某个槽位
  // 后指针的小幅抖动不会翻转槽位（旧 60% 阈值的边界恰在对齐点 1.0 上），
  // 向上/向下阈值严格对称；提交永远采用最后一次移动的槽位，与让位视觉一致
  const curSlot = fromIdx + Math.round(clamped / itemH);
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
    // 长按触发：记录拖动上下文（键序/槽距/起点），条目浮起由 .dragging 样式呈现
    const keys = draggableKeys();
    // 槽距取相邻条目 offsetTop 差（含 2px margin）：只取元素高度会让位移、
    // 落位、吸附全程带每槽 2px 的系统误差
    const siblings = panelRef.value.querySelectorAll('.sigma-playlist-item');
    const elIdx = Array.prototype.indexOf.call(siblings, el);
    let pitch = el.getBoundingClientRect().height;
    if (elIdx > -1 && elIdx < siblings.length - 1) {
      pitch = siblings[elIdx + 1].offsetTop - el.offsetTop;
    } else if (elIdx > 0) {
      pitch = el.offsetTop - siblings[elIdx - 1].offsetTop;
    }
    dragCtx = {
      key: item.key,
      keys,
      fromIdx: keys.indexOf(item.key),
      itemH: pitch,
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
