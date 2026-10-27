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
