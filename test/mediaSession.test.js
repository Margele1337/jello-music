import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMediaMetadata,
  buildPositionState,
  initMediaSession,
  teardownMediaSession
} from '../src/services/audio/mediaSession.js';

test('maps a song to MediaMetadata fields', () => {
  const song = { name: '晴天', author: '周杰伦', img: 'https://cdn/cover.jpg' };
  assert.deepEqual(buildMediaMetadata(song, 'https://cdn/cover.jpg'), {
    title: '晴天',
    artist: '周杰伦',
    album: '',
    artwork: [{ src: 'https://cdn/cover.jpg' }]
  });

  // 封面探测失败回退内置图；专辑名可选
  assert.deepEqual(buildMediaMetadata({ name: 'a', author: 'b', albumName: 'c' }, 'logo.png'), {
    title: 'a',
    artist: 'b',
    album: 'c',
    artwork: [{ src: 'logo.png' }]
  });

  // 空歌曲/空封面不产生 artwork 项
  assert.deepEqual(buildMediaMetadata(null, ''), { title: '', artist: '', album: '', artwork: [] });
});

test('builds a valid position state and rejects unusable values', () => {
  assert.deepEqual(
    buildPositionState({ currentTime: 12.5, duration: 200, playbackRate: 1.25 }),
    { duration: 200, position: 12.5, playbackRate: 1.25 }
  );
  // 非法倍速回退 1
  assert.deepEqual(
    buildPositionState({ currentTime: 0, duration: 100, playbackRate: 0 }),
    { duration: 100, position: 0, playbackRate: 1 }
  );
  // 时长缺失/为 0（元数据未就绪）→ null，跳过上报
  assert.equal(buildPositionState({ currentTime: 1, duration: 0 }), null);
  assert.equal(buildPositionState({ currentTime: 1, duration: NaN }), null);
  // 进度越界 → null
  assert.equal(buildPositionState({ currentTime: 101, duration: 100 }), null);
  assert.equal(buildPositionState({ currentTime: -1, duration: 100 }), null);
  assert.equal(buildPositionState(null), null);
});

test('init/teardown are safe without a mediaSession implementation', () => {
  // node 环境没有 navigator.mediaSession：不得抛异常
  assert.equal(initMediaSession({ play() {} }), false);
  teardownMediaSession();
});
