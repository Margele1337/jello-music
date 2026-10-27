import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_DESKTOP_LYRIC_STATE,
  sanitizeDesktopLyricState
} from '../shared/desktopLyrics.js';

test('desktop lyric state keeps only bounded text fields', () => {
  assert.deepEqual(sanitizeDesktopLyricState({
    title: '晴天',
    artist: '周杰伦',
    current: 'x'.repeat(300),
    next: '下一句',
    playing: true,
    extra: 'drop'
  }), {
    title: '晴天',
    artist: '周杰伦',
    current: 'x'.repeat(200),
    next: '下一句',
    playing: true
  });
});

test('desktop lyric state rejects malformed input', () => {
  assert.deepEqual(sanitizeDesktopLyricState(null), { ...EMPTY_DESKTOP_LYRIC_STATE });
  assert.deepEqual(sanitizeDesktopLyricState([1, 2]), { ...EMPTY_DESKTOP_LYRIC_STATE });
  assert.equal(sanitizeDesktopLyricState({ playing: 'yes' }).playing, false);
});
