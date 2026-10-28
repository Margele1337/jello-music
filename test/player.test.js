import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';

// player.js 依赖浏览器 Audio 与 toast 事件通道，这里给出最小纯逻辑替身
class FakeAudio {
  constructor() {
    this.listeners = {};
    this.src = '';
    this.preload = '';
    this.crossOrigin = '';
    this.currentTime = 0;
    this.volume = 1;
    this.playbackRate = 1;
    this.paused = true;
    this.error = null;
    this.playImpl = null;
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  removeEventListener() {}

  dispatch(type) {
    for (const fn of this.listeners[type] || []) fn();
  }

  play() {
    if (this.playImpl) return this.playImpl();
    this.paused = false;
    this.dispatch('play');
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
    this.dispatch('pause');
  }
}

globalThis.Audio = FakeAudio;

let handler = async () => ({});
const toasts = [];
globalThis.window = {
  dispatchEvent: (event) => {
    toasts.push(String(event?.detail || ''));
    return true;
  },
  jello: {
    api: {
      request: (request) => handler(request)
    }
  }
};

const { usePlayerStore } = await import('../src/stores/player.js');
const { useSettingsStore } = await import('../src/stores/settings.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 常用桩：privilege 返回空数据，song/url 按 quality 决定是否可播
const stubApi = ({ playable = () => true, onUrl = null } = {}) => {
  handler = async (request) => {
    if (request.path === '/privilege/lite') return { status: 1, data: [] };
    if (onUrl) onUrl(request.params);
    if (!playable(request.params)) return { status: 1, url: [] };
    return { status: 1, url: [`https://cdn/${request.params.hash}-${request.params.quality}.mp3`], extName: 'mp3' };
  };
};

const setupPlayer = ({ queueSize = 2, quality = '320' } = {}) => {
  setActivePinia(createPinia());
  const settings = useSettingsStore();
  settings.quality = quality;
  const player = usePlayerStore();
  player.queue = Array.from({ length: queueSize }, (_, i) => ({ hash: `h${i}`, name: `歌曲${i}` }));
  player.index = 0;
  player.autoAdvanceDelayMs = 10;
  toasts.length = 0;
  return player;
};

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

test('loadCurrent exposes resolved quality and trial flag from the api result', async () => {
  // 所有正式档位都无权益 → 试听兜底
  handler = async (request) => {
    if (request.path === '/privilege/lite') return { status: 1, data: [] };
    if (request.params.free_part === 1) {
      return { status: 1, url: ['https://cdn/trial.mp3'], extName: 'mp3' };
    }
    return { status: 1, url: [] };
  };
  const player = setupPlayer();
  await player.loadCurrent();

  assert.equal(player.trial, true);
  assert.equal(player.resolvedQuality, '128');
  assert.equal(player.qualityLabel, '标准');
  assert.equal(player.error, '');
  assert.equal(player.playing, true);
});

test('source error downgrades at most twice then schedules an auto advance', async () => {
  const requested = [];
  stubApi({ onUrl: (params) => requested.push(params.quality) });
  const player = setupPlayer({ quality: 'flac' });
  await player.loadCurrent();

  assert.equal(player.resolvedQuality, 'flac');
  const element = player.audio;

  // 第一次音源错误：flac → 320
  element.error = { code: 4 };
  player.handleSourceError();
  await sleep(20);
  assert.equal(player.qualityRetries, 1);
  assert.equal(player.resolvedQuality, '320');

  // 第二次：320 → 128
  element.error = { code: 4 };
  player.handleSourceError();
  await sleep(20);
  assert.equal(player.qualityRetries, 2);
  assert.equal(player.resolvedQuality, '128');

  // 第三次：已到 128，且降级次数用尽 → 排定自动跳歌
  element.error = { code: 4 };
  player.handleSourceError();
  assert.equal(player.failStreak, 1);
  assert.match(player.error, /自动切换下一首/);
  assert.ok(toasts.some((text) => text.includes('自动切换下一首')));

  await sleep(40);
  assert.equal(player.index, 1);
});

test('successful playback resets failure counters', async () => {
  stubApi();
  const player = setupPlayer();
  player.failStreak = 4;
  player.qualityRetries = 2;
  player.qualityRetryHash = 'other';

  await player.loadCurrent();
  assert.equal(player.failStreak, 0);
  assert.equal(player.qualityRetries, 0);
  assert.equal(player.qualityRetryHash, 'h0');
});

test('auto advance stops after five consecutive failures', async () => {
  // 所有歌曲都无法取到地址
  handler = async (request) => (request.path === '/privilege/lite'
    ? { status: 1, data: [] }
    : { status: 2, error: '无法播放' });
  const player = setupPlayer({ queueSize: 7 });

  await player.loadCurrent(); // 失败 1
  for (let i = 0; i < 6; i += 1) {
    await sleep(60); // 等自动跳歌定时器触发并让下一首加载失败
    if (player.error.includes('已停止自动切歌')) break;
  }

  assert.match(player.error, /已停止自动切歌/);
  assert.equal(player.failStreak, 0);
  // 5 次跳歌上限 + 初始曲目：最多推进到索引 5，不会绕圈刷屏
  assert.ok(player.index <= 5);
});

test('unplayable single track never spins the auto advance loop', async () => {
  handler = async (request) => (request.path === '/privilege/lite'
    ? { status: 1, data: [] }
    : { status: 2, error: '无法播放' });
  const player = setupPlayer({ queueSize: 1 });

  await player.loadCurrent();
  await sleep(30);

  assert.equal(player.failStreak, 0);
  assert.equal(player.index, 0);
  assert.equal(player.queue.length, 1);
  assert.ok(player.error);
});
