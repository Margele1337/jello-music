import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMediaUrl } from '../shared/mediaScheme.js';

let handler = async () => ({});
globalThis.window = {
  // client.js 在登录失效等场景会派发 toast 事件，测试环境用空实现吸收
  dispatchEvent: () => true,
  jello: {
    api: {
      request: (request) => handler(request)
    }
  }
};

const {
  buildPlaybackCandidates,
  collectPrivilegeVariants,
  getLyrics,
  getQualityFallbackChain,
  getSongUrl,
  searchSongs
} = await import('../src/services/api/library.js');

test('searchSongs normalizes results and rejects api errors', async () => {
  handler = async () => ({
    status: 1,
    data: { lists: [{ FileHash: 'ABC', SongName: '晴天', SingerName: '周杰伦', Duration: 269 }] }
  });
  const songs = await searchSongs('周杰伦');
  assert.equal(songs.length, 1);
  assert.equal(songs[0].name, '晴天');

  handler = async () => ({ status: 0, error: '参数错误' });
  await assert.rejects(() => searchSongs('x'), /参数错误/);
});

test('fallback chain walks the quality ladder from the requested tier down to 128', () => {
  assert.deepEqual(getQualityFallbackChain('flac'), ['flac', '320', '128']);
  assert.deepEqual(getQualityFallbackChain('viper_tape'), [
    'viper_tape', 'viper_clear', 'viper_atmos', 'high', 'flac', '320', '128'
  ]);
  // 未知音质按默认 320 档处理
  assert.deepEqual(getQualityFallbackChain('bogus'), ['320', '128']);
});

test('privilege variants include relate_goods and drop level-0 tiers', () => {
  const variants = collectPrivilegeVariants({
    status: 1,
    data: [
      {
        hash: 'H_HIGH',
        quality: 'high',
        level: 2,
        relate_goods: [{ hash: 'H_TAPE', quality: 'viper_tape', level: 2 }]
      },
      { hash: 'H_128', quality: '128', level: 0 },
      { hash: 'H_BAD', quality: 'bogus', level: 2 }
    ]
  });
  assert.deepEqual(variants, [
    { hash: 'H_HIGH', quality: 'high' },
    { hash: 'H_TAPE', quality: 'viper_tape' }
  ]);
});

test('candidates follow the ladder and backfill a free 128 with the original hash', () => {
  const variants = [
    { hash: 'H_TAPE', quality: 'viper_tape' },
    { hash: 'H_HIGH', quality: 'high' }
  ];
  const candidates = buildPlaybackCandidates(variants, 'viper_tape', 'H_ORIG');
  assert.deepEqual(candidates, [
    { hash: 'H_TAPE', quality: 'viper_tape' },
    { hash: 'H_HIGH', quality: 'high' },
    { hash: 'H_ORIG', quality: '128' }
  ]);

  // 已含 128 档时不再追加兜底
  const with128 = buildPlaybackCandidates(
    [{ hash: 'H_320', quality: '320' }, { hash: 'H_128', quality: '128' }],
    '320',
    'H_ORIG'
  );
  assert.deepEqual(with128, [
    { hash: 'H_320', quality: '320' },
    { hash: 'H_128', quality: '128' }
  ]);
});

test('getSongUrl resolves per-quality hashes from /privilege/lite and degrades on failure', async () => {
  const urlRequests = [];
  handler = async (request) => {
    if (request.path === '/privilege/lite') {
      return {
        status: 1,
        data: [{
          hash: 'H_HIGH',
          quality: 'high',
          level: 2,
          relate_goods: [{ hash: 'H_TAPE', quality: 'viper_tape', level: 2 }]
        }]
      };
    }
    urlRequests.push({ hash: request.params.hash, quality: request.params.quality });
    if (request.params.hash === 'H_TAPE') return { status: 1, url: [] }; // 无权益 → 降档
    return { status: 1, url: ['http://fsandroid.kugou.com/high.flac'], extName: 'flac' };
  };

  const result = await getSongUrl({ hash: 'H_ORIG' }, 'viper_tape');
  assert.deepEqual(urlRequests, [
    { hash: 'H_TAPE', quality: 'viper_tape' },
    { hash: 'H_HIGH', quality: 'high' }
  ]);
  assert.equal(result.quality, 'high');
  assert.equal(result.playHash, 'H_HIGH');
  assert.equal(result.qualityLabel, 'Hi-Res');
  assert.equal(result.isTrial, false);
  // 媒体统一走 jello-media 协议；上游协议保留原样（HTTPS 升级由主进程代理决策）
  assert.equal(result.url, buildMediaUrl('http://fsandroid.kugou.com/high.flac'));
});

test('getSongUrl skips MP4-only candidates and keeps degrading', async () => {
  const qualities = [];
  handler = async (request) => {
    if (request.path === '/privilege/lite') return { status: 0 };
    qualities.push(request.params.quality);
    if (request.params.quality === 'flac') {
      return { status: 1, extName: 'mp4', url: ['http://cdn/song.mp4'] };
    }
    return { status: 1, extName: 'mp3', url: ['https://cdn/song.mp3'] };
  };

  const result = await getSongUrl({ hash: 'ABC' }, 'flac');
  assert.deepEqual(qualities, ['flac', '320']);
  assert.equal(result.quality, '320');
  assert.equal(result.url, buildMediaUrl('https://cdn/song.mp3'));
});

test('getSongUrl falls back to a free_part trial when no tier has privilege', async () => {
  const requests = [];
  handler = async (request) => {
    if (request.path === '/privilege/lite') {
      return { status: 1, data: [{ hash: 'H320', quality: '320', level: 2 }] };
    }
    requests.push(request.params);
    if (request.params.free_part === 1) {
      return { status: 1, url: ['https://cdn/trial.mp3'], extName: 'mp3' };
    }
    return { status: 1, url: [] };
  };

  const result = await getSongUrl({ hash: 'ABC' }, '320');
  assert.equal(result.isTrial, true);
  assert.equal(result.quality, '128');
  assert.equal(result.url, buildMediaUrl('https://cdn/trial.mp3'));
  // 最后一次请求是试听兜底
  assert.equal(requests.at(-1).free_part, 1);
  assert.equal(requests.at(-1).hash, 'ABC');
});

test('getSongUrl uses the original hash along the ladder when privilege data is empty', async () => {
  const qualities = [];
  handler = async (request) => {
    if (request.path === '/privilege/lite') return { status: 1, data: [] };
    qualities.push(request.params.quality);
    if (request.params.quality !== '128') return { status: 1, url: [] };
    return { status: 1, url: ['https://cdn/song.mp3'], extName: 'mp3' };
  };

  const result = await getSongUrl({ hash: 'ABC' }, 'high');
  assert.deepEqual(qualities, ['high', 'flac', '320', '128']);
  assert.deepEqual(result.playHash, 'ABC');
  assert.equal(result.quality, '128');
  assert.equal(result.isTrial, false);
});

test('getSongUrl preserves loudness metadata for spectrum normalization', async () => {
  handler = async (request) => {
    if (request.path === '/privilege/lite') return { status: 0 };
    return {
      status: 1,
      url: ['https://cdn/song.mp3'],
      extName: 'mp3',
      volume: -8.2,
      volume_gain: 1.5,
      volume_peak: 0.9
    };
  };

  const result = await getSongUrl({ hash: 'ABC' }, '320');
  assert.deepEqual(result.loudness, { volume: -8.2, volumeGain: 1.5, volumePeak: 0.9 });
});

test('getSongUrl surfaces the last api error and reports missing copyright', async () => {
  handler = async () => ({ status: 2, error: '本次请求需要验证' });
  await assert.rejects(() => getSongUrl({ hash: 'ABC' }, '320'), /本次请求需要验证/);

  handler = async (request) => (request.path === '/privilege/lite'
    ? { status: 1, data: [] }
    : { status: 3 });
  await assert.rejects(() => getSongUrl({ hash: 'ABC' }, '320'), /暂无版权/);
});

test('getLyrics resolves a candidate and parses the decoded LRC', async () => {
  handler = async ({ path }) => {
    if (path === '/search/lyric') {
      return { status: 200, candidates: [{ id: '1', accesskey: 'key', song: '晴天' }] };
    }
    return { status: 200, decodeContent: '[00:01.00]第一句\n[00:02.50]第二句' };
  };

  const result = await getLyrics({ hash: 'ABC', name: '晴天', author: '周杰伦', timeLength: 269000 });
  assert.deepEqual(result.lines, [
    { time: 1, text: '第一句' },
    { time: 2.5, text: '第二句' }
  ]);
  assert.equal(result.candidate.id, '1');
});

test('getLyrics reports missing candidates', async () => {
  handler = async () => ({ status: 200, candidates: [] });
  await assert.rejects(() => getLyrics({ hash: 'ABC' }), /没有找到歌词/);
});
