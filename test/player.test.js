import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { usePlayerStore } from '../src/stores/player.js';

test('exposes playback mode under the Sigma UI getter name and cycles it', () => {
  setActivePinia(createPinia());
  const player = usePlayerStore();

  assert.equal(player.currentPlaybackModeIndex, 1);
  player.togglePlaybackMode();
  assert.equal(player.currentPlaybackModeIndex, 2);
  player.togglePlaybackMode();
  assert.equal(player.currentPlaybackModeIndex, 0);
  player.togglePlaybackMode();
  assert.equal(player.currentPlaybackModeIndex, 1);
});

test('queue removal keeps the current index aligned', () => {
  setActivePinia(createPinia());
  const player = usePlayerStore();
  player.queue = [{ hash: 'a' }, { hash: 'b' }, { hash: 'c' }, { hash: 'd' }];

  // 移除当前之前的歌曲 → 索引前移
  player.index = 2;
  player.removeFromQueue(0);
  assert.equal(player.index, 1);
  assert.equal(player.queue.length, 3);

  // 移除当前之后的歌曲 → 索引不动
  player.removeFromQueue(2);
  assert.equal(player.index, 1);
  assert.equal(player.queue.length, 2);

  // 越界与清空
  player.removeFromQueue(9);
  player.clearQueue();
  assert.equal(player.queue.length, 0);
  assert.equal(player.index, -1);
});
