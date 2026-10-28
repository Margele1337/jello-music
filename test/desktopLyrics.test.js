import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeDesktopLyricLyrics,
  sanitizeDesktopLyricProgress
} from '../shared/desktopLyrics.js';

test('desktop lyric lyrics payload keeps bounded lines and characters', () => {
  const result = sanitizeDesktopLyricLyrics({
    hash: 'abc',
    title: '晴天',
    artist: '周杰伦',
    lines: [
      { characters: [['你', 100, 300], ['好', 300, 500]], translated: '你好', junk: true },
      { characters: [['x'.repeat(100), 1, 2]] }
    ],
    extra: 'drop'
  });

  assert.equal(result.hash, 'abc');
  assert.equal(result.title, '晴天');
  assert.equal(result.artist, '周杰伦');
  assert.deepEqual(result.lines[0], {
    characters: [['你', 100, 300], ['好', 300, 500]],
    translated: '你好'
  });
  assert.equal(result.lines[1].characters[0][0].length, 40);
  assert.equal(result.extra, undefined);
});

test('desktop lyric lyrics payload rejects malformed input', () => {
  assert.deepEqual(sanitizeDesktopLyricLyrics(null), { hash: '', title: '', artist: '', lines: [] });
  assert.deepEqual(sanitizeDesktopLyricLyrics([1]), { hash: '', title: '', artist: '', lines: [] });
  assert.deepEqual(sanitizeDesktopLyricLyrics({ lines: 'no' }).lines, []);
  assert.deepEqual(sanitizeDesktopLyricLyrics({ lines: [null] }).lines, [{ characters: [] }]);
  assert.deepEqual(sanitizeDesktopLyricLyrics({ lines: [{ characters: [42] }] }).lines[0].characters, [['']]);
});

test('desktop lyric progress payload clamps time and playing flag', () => {
  assert.deepEqual(sanitizeDesktopLyricProgress({ time: 12.5, playing: true }), { time: 12.5, playing: true });
  assert.deepEqual(sanitizeDesktopLyricProgress({ time: -5, playing: 'yes' }), { time: 0, playing: false });
  assert.deepEqual(sanitizeDesktopLyricProgress(null), { time: 0, playing: false });
  assert.deepEqual(sanitizeDesktopLyricProgress({ time: Number.NaN }), { time: 0, playing: false });
});
