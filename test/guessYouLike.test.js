import test from 'node:test';
import assert from 'node:assert/strict';

// 与 dailyRecommend.test.js 相同的桥接 mock：拦截 window.jello.api.request
let handler = async () => ({});
const requests = [];
globalThis.window = {
  dispatchEvent: () => true,
  jello: {
    api: {
      request: (request) => {
        requests.push(request);
        return handler(request);
      }
    }
  }
};

const { getGuessYouLike } = await import('../src/services/api/library.js');

const cardSong = (n) => ({
  hash: `HASH${n}`,
  songname: `推荐歌曲${n}`,
  author_name: '歌手',
  time_length: 200,
  album_id: 1
});

test('getGuessYouLike passes the card song list through normalization', async () => {
  requests.length = 0;
  handler = async () => ({ status: 1, data: { song_list: [cardSong(1), cardSong(2)] } });

  const songs = await getGuessYouLike();
  assert.equal(songs.length, 2);
  assert.equal(songs[0].hash, 'HASH1');
  assert.equal(songs[0].name, '推荐歌曲1');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/top/card');
  assert.equal(requests[0].params.card_id, 1);
  assert.ok(Number.isFinite(requests[0].params.timestamp), 'timestamp busts the api cache');
});

test('getGuessYouLike surfaces a single-song radio response as-is', async () => {
  requests.length = 0;
  handler = async () => ({ status: 1, data: { song_list: [cardSong(9)] } });

  const songs = await getGuessYouLike();
  assert.equal(songs.length, 1);
  assert.equal(songs[0].hash, 'HASH9');
});

test('getGuessYouLike throws the localized error when the card fails', async () => {
  requests.length = 0;
  handler = async () => ({ status: 0, message: 'boom' });

  await assert.rejects(() => getGuessYouLike(), /获取猜你喜欢失败/);
});
