import test from 'node:test';
import assert from 'node:assert/strict';

let handler = async () => ({});
globalThis.window = {
  jello: {
    api: {
      request: (request) => handler(request)
    }
  }
};

const { getSongUrl, searchSongs } = await import('../src/services/api/library.js');

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

test('getSongUrl falls back through qualities and upgrades the URL', async () => {
  const qualities = [];
  handler = async (request) => {
    qualities.push(request.params.quality);
    if (qualities.length < 3) return { status: 2, error: '本次请求需要验证' };
    return { status: 1, url: ['http://fsandroid.kugou.com/song.mp3'] };
  };

  const result = await getSongUrl({ hash: 'ABC' }, 'flac');
  assert.deepEqual(qualities, ['flac', '320', '128']);
  assert.equal(result.quality, '128');
  assert.equal(result.url, 'https://fsandroid.kugou.com/song.mp3');
});

test('getSongUrl surfaces the last api error', async () => {
  handler = async () => ({ status: 2, error: '本次请求需要验证' });
  await assert.rejects(() => getSongUrl({ hash: 'ABC' }, '320'), /本次请求需要验证/);
});
