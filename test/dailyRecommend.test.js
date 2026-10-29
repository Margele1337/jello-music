import test from 'node:test';
import assert from 'node:assert/strict';

// 与 library.test.js 相同的桥接 mock：拦截 window.jello.api.request
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

const { getDailyRecommend } = await import('../src/services/api/library.js');

const makeSongs = (prefix, count, offset = 0) => Array.from({ length: count }, (_, i) => ({
  hash: `${prefix}${offset + i}`,
  songname: `歌曲${offset + i}`,
  author_name: '歌手',
  time_length: 200
}));

const dailyPayload = (songs) => ({ status: 1, data: { song_list: songs } });

test('getDailyRecommend pages to 60 unique songs when the server honors paging', async () => {
  requests.length = 0;
  handler = async (request) => {
    const page = request?.data?.page;
    if (page === 1) return dailyPayload(makeSongs('A', 40));
    if (page === 2) return dailyPayload([...makeSongs('B', 20), ...makeSongs('A', 5)]);
    return dailyPayload(makeSongs('C', 20));
  };

  const songs = await getDailyRecommend();
  assert.equal(songs.length, 60);
  assert.equal(new Set(songs.map((song) => song.hash)).size, 60);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.data), [
    { pagesize: 60, page: 1 },
    { pagesize: 60, page: 2 }
  ]);
});

test('getDailyRecommend stops when the server ignores paging (no new hashes)', async () => {
  requests.length = 0;
  const fixed = makeSongs('S', 30);
  handler = async () => dailyPayload(fixed);

  const songs = await getDailyRecommend();
  assert.equal(songs.length, 30);
  assert.equal(requests.length, 2); // 第 2 页无新增即停
});

test('getDailyRecommend respects the 4-page hard cap and truncates to 60', async () => {
  requests.length = 0;
  handler = async (request) => dailyPayload(makeSongs('P', 16, (request.data.page - 1) * 16));

  const songs = await getDailyRecommend();
  assert.equal(requests.length, 4);
  assert.equal(songs.length, 60);
});

test('getDailyRecommend stops on empty page and keeps earlier results', async () => {
  requests.length = 0;
  handler = async (request) => (
    request?.data?.page === 1 ? dailyPayload(makeSongs('A', 20)) : dailyPayload([])
  );

  const songs = await getDailyRecommend();
  assert.equal(songs.length, 20);
  assert.equal(requests.length, 2);
});

test('getDailyRecommend falls back to the single plain request when all pages fail', async () => {
  requests.length = 0;
  handler = async (request) => {
    if (request?.data) throw new Error('boom');
    return dailyPayload(makeSongs('F', 10));
  };

  const songs = await getDailyRecommend();
  assert.equal(songs.length, 10);
  assert.equal(requests.length, 2); // 分页 1 次失败 + 兜底 1 次
  assert.equal(requests[1].data, undefined);
  assert.equal(requests[1].path, '/everyday/recommend');
});
