import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYBACK_QUEUE_LIMIT,
  emptyPlaybackState,
  sanitizePlaybackSong,
  sanitizePlaybackState
} from '../shared/ipc.js';

const song = (hash, extra = {}) => ({
  hash,
  name: `歌曲${hash}`,
  author: `歌手${hash}`,
  img: `https://img/${hash}.jpg`,
  timeLength: 120000,
  albumId: 'al1',
  albumAudioId: 'aa1',
  ...extra
});

test('song sanitize keeps only the fields playback needs', () => {
  const clean = sanitizePlaybackSong(song('h1', { url: 'https://cdn/x.mp3', lyrics: 'big blob', level: 3 }));
  assert.deepEqual(Object.keys(clean).sort(), [
    'albumAudioId', 'albumId', 'author', 'hash', 'img', 'name', 'timeLength'
  ]);
  assert.equal(clean.hash, 'h1');
  assert.equal(clean.timeLength, 120000);
});

test('song sanitize rejects entries without a usable hash', () => {
  assert.equal(sanitizePlaybackSong(null), null);
  assert.equal(sanitizePlaybackSong('nope'), null);
  assert.equal(sanitizePlaybackSong({ name: '无 hash' }), null);
  assert.equal(sanitizePlaybackSong({ hash: '   ' }), null);
  // 数字型字段容错：转字符串/归零
  const clean = sanitizePlaybackSong({ hash: 123, timeLength: -5, albumId: 9 });
  assert.equal(clean.hash, '123');
  assert.equal(clean.timeLength, 0);
  assert.equal(clean.albumId, '9');
});

test('queue is filtered and capped at the limit', () => {
  const queue = Array.from({ length: PLAYBACK_QUEUE_LIMIT + 50 }, (_, i) => song(`h${i}`));
  queue.push(null, { name: '无 hash' });
  const clean = sanitizePlaybackState({ queue, index: 0, mode: 1, progress: 0 });
  assert.equal(clean.queue.length, PLAYBACK_QUEUE_LIMIT);
  assert.ok(clean.queue.every((entry) => entry.hash));
});

test('index, mode and progress are clamped into range', () => {
  const base = { queue: [song('a'), song('b', { timeLength: 60000 })], progress: 0 };

  assert.equal(sanitizePlaybackState({ ...base, index: 99, mode: 1 }).index, 1);
  assert.equal(sanitizePlaybackState({ ...base, index: -3, mode: 1 }).index, 0);
  assert.equal(sanitizePlaybackState({ ...base, index: 'x', mode: 1 }).index, 0);

  assert.equal(sanitizePlaybackState({ ...base, index: 0, mode: 5 }).mode, 1);
  assert.equal(sanitizePlaybackState({ ...base, index: 0, mode: null }).mode, 1);
  assert.equal(sanitizePlaybackState({ ...base, index: 0, mode: '2' }).mode, 2);
  assert.equal(sanitizePlaybackState({ ...base, index: 0, mode: 0 }).mode, 0);

  // progress 是秒，钳到当前曲 timeLength（毫秒）换算出的上界
  assert.equal(sanitizePlaybackState({ ...base, index: 1, mode: 1, progress: 42 }).progress, 42);
  assert.equal(sanitizePlaybackState({ ...base, index: 1, mode: 1, progress: 1e9 }).progress, 60);
  assert.equal(sanitizePlaybackState({ ...base, index: 1, mode: 1, progress: -5 }).progress, 0);
  assert.equal(sanitizePlaybackState({ ...base, index: 1, mode: 1, progress: 'NaN' }).progress, 0);
});

test('missing or corrupt payloads fall back to a silent empty state', () => {
  for (const bad of [null, undefined, 'str', 42, {}, { queue: 'nope' }, { queue: [null, 1] }]) {
    const clean = sanitizePlaybackState(bad);
    assert.deepEqual(clean.queue, []);
    assert.equal(clean.index, -1);
    assert.equal(clean.mode, 1);
    assert.equal(clean.progress, 0);
  }
  assert.deepEqual(emptyPlaybackState(0), { queue: [], index: -1, mode: 0, progress: 0 });
});
