import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaylistSidebarItems } from '../src/utils/playlistSidebar.js';

const names = (items) => items.map((item) => item.name);

test('collapses the liked aliases into one entry', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'custom', name: '我喜欢的音乐' },
    { id: 'liked', name: '我喜欢', isDefault: true },
    { id: 'daily', name: '每日推荐' }
  ], { authenticated: true });

  assert.deepEqual(names(items), ['每日推荐', '我喜欢', '歌词', '设置']);
  assert.equal(items[1].id, 'liked');
});

test('prefers the literal 我喜欢 playlist when no default flag is present', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'old-label', name: '我喜欢的音乐' },
    { id: 'liked', name: '我喜欢' }
  ], { authenticated: true });

  assert.deepEqual(names(items), ['每日推荐', '我喜欢', '歌词', '设置']);
  assert.equal(items[1].id, 'liked');
});

test('prefers the real 我喜欢 playlist over an empty default collection', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'default', name: '默认收藏', isDefault: true },
    { id: 'liked', name: '我喜欢', isDefault: true },
    { id: 'other', name: '今日有酒今朝醉' }
  ], { authenticated: true });

  assert.deepEqual(names(items), ['每日推荐', '我喜欢', '今日有酒今朝醉', '歌词', '设置']);
  assert.equal(items[1].id, 'liked');
});

test('falls back to 我的喜欢 when it is the only liked-named playlist', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'mine', name: '我的喜欢' }
  ], { authenticated: true });

  assert.deepEqual(names(items), ['每日推荐', '我喜欢', '歌词', '设置']);
  assert.equal(items[1].id, 'mine');
});

test('deduplicates ids and names and reserves fixed entries', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'a', name: '夜车电台' },
    { id: 'a', name: '夜车电台' },
    { id: 'b', name: '夜车电台' },
    { id: 'c', name: '歌词' }
  ], { authenticated: true });

  assert.deepEqual(names(items), ['每日推荐', '夜车电台', '歌词', '设置']);
});

test('shows login for guests and preserves playlist metadata', () => {
  const items = buildPlaylistSidebarItems([
    { id: 'collection_1', name: '收藏', idType: 'collection', listId: 7 }
  ], { authenticated: false, ready: true });

  assert.deepEqual(names(items), ['登录', '每日推荐', '收藏', '歌词', '设置']);
  assert.deepEqual(items[2], {
    key: 'pl-collection_1',
    type: 'playlist',
    id: 'collection_1',
    idType: 'collection',
    listId: 7,
    name: '收藏'
  });
});
