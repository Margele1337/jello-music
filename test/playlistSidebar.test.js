import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlaylistOrder, buildPlaylistSidebarItems } from '../src/utils/playlistSidebar.js';

const names = (items) => items.map((item) => item.name);

test('collapses the liked aliases into one entry', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'custom', name: '我喜欢的音乐' },
    { id: 'liked', name: '我喜欢', isDefault: true },
    { id: 'daily', name: '每日推荐' }
  ], { authenticated: true });

  assert.deepEqual(names(items), ['猜你喜欢', '每日推荐', '我喜欢']);
  assert.equal(items[2].id, 'liked');
});

test('prefers the literal 我喜欢 playlist when no default flag is present', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'old-label', name: '我喜欢的音乐' },
    { id: 'liked', name: '我喜欢' }
  ], { authenticated: true });

  assert.deepEqual(names(items), ['猜你喜欢', '每日推荐', '我喜欢']);
  assert.equal(items[2].id, 'liked');
});

test('applyPlaylistOrder reorders playlist entries by saved keys and ignores unknown keys', () => {
  const entries = [
    { key: 'pl-liked', name: '我喜欢' },
    { key: 'pl-a', name: '歌单A' },
    { key: 'pl-b', name: '歌单B' }
  ];
  const ordered = applyPlaylistOrder(entries, ['pl-a', 'pl-liked', 'pl-b']);
  assert.deepEqual(ordered.map((item) => item.name), ['歌单A', '我喜欢', '歌单B']);
  // 未记录的 key 排在已记录之后、彼此保持原相对顺序
  const partial = applyPlaylistOrder(entries, ['pl-b']);
  assert.deepEqual(partial.map((item) => item.name), ['歌单B', '我喜欢', '歌单A']);
  // 空顺序 = 原顺序
  assert.deepEqual(applyPlaylistOrder(entries, []).map((item) => item.name), ['我喜欢', '歌单A', '歌单B']);
});

test('buildPlaylistSidebarItems applies the saved drag order to playlists only', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'liked', name: '我喜欢', isDefault: true },
    { id: 'a', name: '歌单A' },
    { id: 'b', name: '歌单B' }
  ], { authenticated: true, savedOrder: ['pl-a', 'pl-liked', 'pl-b'] });

  // 固定入口（猜你喜欢/每日推荐）不参与排序，歌单区按保存顺序
  assert.deepEqual(names(items), ['猜你喜欢', '每日推荐', '歌单A', '我喜欢', '歌单B']);
});

test('shows the real 默认歌单 playlist and prefers 我喜欢 for the liked slot', () => {
  const items = buildPlaylistSidebarItems([
    // 归一化后「默认收藏」已改显为「默认歌单」
    { id: 'default', name: '默认歌单', isDefault: true },
    { id: 'liked', name: '我喜欢', isDefault: true },
    { id: 'other', name: '今日有酒今朝醉' }
  ], { authenticated: true });

  // 「默认收藏」是真实自建歌单（收藏弹窗可选它），改显为「默认歌单」不再隐藏——
  // 否则收藏进去的歌在侧栏找不到
  assert.deepEqual(names(items), ['猜你喜欢', '每日推荐', '我喜欢', '默认歌单', '今日有酒今朝醉']);
  assert.equal(items[2].id, 'liked');
});

test('falls back to 我的喜欢 when it is the only liked-named playlist', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'mine', name: '我的喜欢' }
  ], { authenticated: true });

  assert.deepEqual(names(items), ['猜你喜欢', '每日推荐', '我喜欢']);
  assert.equal(items[2].id, 'mine');
});

test('deduplicates ids and names and reserves fixed entries', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'a', name: '夜车电台' },
    { id: 'a', name: '夜车电台' },
    { id: 'b', name: '夜车电台' },
    { id: 'c', name: '歌词' }
  ], { authenticated: true });

  assert.deepEqual(names(items), ['猜你喜欢', '每日推荐', '夜车电台']);
});

test('shows login for guests and preserves playlist metadata', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'collection_1', name: '收藏', idType: 'collection', listId: 7 }
  ], { authenticated: false, ready: true });

  assert.deepEqual(names(items), ['登录', '猜你喜欢', '每日推荐', '收藏']);
  assert.deepEqual(items[3], {
    key: 'pl-collection_1',
    type: 'playlist',
    id: 'collection_1',
    idType: 'collection',
    listId: 7,
    name: '收藏'
  });
});
