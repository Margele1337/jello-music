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

const cardPayload = (songs) => ({ status: 1, data: { song_list: songs } });
const cardSong = (n) => ({
  hash: `HASH${n}`,
  songname: `推荐歌曲${n}`,
  author_name: '歌手',
  time_length: 200,
  album_id: 1
});

test('getGuessYouLike stops after one pull when the card returns a full list', async () => {
  requests.length = 0;
  handler = async () => cardPayload(Array.from({ length: 15 }, (_, i) => cardSong(i)));

  const songs = await getGuessYouLike();
  assert.equal(songs.length, 15);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/top/card');
  assert.equal(requests[0].params.card_id, 1);
});

test('getGuessYouLike accumulates one-song radio pulls into a deduped queue', async () => {
  requests.length = 0;
  let pull = 0;
  handler = async () => cardPayload([cardSong(pull++)]);   // 每次一首、逐次不同

  const songs = await getGuessYouLike();
  assert.equal(songs.length, 10);                          // 凑满目标数
  assert.equal(new Set(songs.map((song) => song.hash)).size, 10);
  assert.equal(requests.length, 10);
});

test('getGuessYouLike dedupes repeats and stops when recommendations repeat', async () => {
  requests.length = 0;
  handler = async () => cardPayload([cardSong(7)]);        // 永远同一首

  const songs = await getGuessYouLike();
  assert.equal(songs.length, 1);
  assert.equal(requests.length, 2);                        // 第二次无新增即停
});

test('getGuessYouLike keeps partial results when a later pull fails', async () => {
  requests.length = 0;
  let pull = 0;
  handler = async () => {
    const n = pull++;
    if (n < 3) return cardPayload([cardSong(n)]);
    return { status: 0, message: 'boom' };                  // ensureOk 会抛
  };

  const songs = await getGuessYouLike();
  assert.equal(songs.length, 3);
});

test('getGuessYouLike throws when the very first pull fails', async () => {
  requests.length = 0;
  handler = async () => ({ status: 0, message: 'boom' });

  await assert.rejects(() => getGuessYouLike(), /获取猜你喜欢失败/);
});
