import { parseLrc } from '../lyrics/lrc.js';
import { apiRequest } from './client.js';
import {
  normalizePlaylistList,
  normalizeSongList,
  toHttps
} from './normalize.js';

const errorMessage = (payload, fallback) => {
  if (!payload || typeof payload !== 'object') return fallback;
  if (payload.error_code && payload.error_code !== 0) {
    return payload.error_msg || payload.error || `${fallback}（${payload.error_code}）`;
  }
  if (payload.status !== undefined && payload.status !== 1 && payload.status !== 200) {
    return payload.error || payload.error_msg || payload.msg || fallback;
  }
  return '';
};

const ensureOk = (payload, fallback) => {
  const message = errorMessage(payload, fallback);
  if (message) throw new Error(message);
  return payload;
};

export const searchSongs = async (keywords, { page = 1, pagesize = 30 } = {}) => {
  const payload = await apiRequest({
    method: 'GET',
    path: '/search',
    params: { keywords, type: 'song', page, pagesize }
  });
  ensureOk(payload, '搜索失败');
  return normalizeSongList(payload?.data?.lists);
};

export const searchPlaylists = async (keywords, { page = 1, pagesize = 3 } = {}) => {
  const payload = await apiRequest({
    method: 'GET',
    path: '/search',
    params: { keywords, type: 'special', page, pagesize }
  });
  ensureOk(payload, '歌单搜索失败');
  return normalizePlaylistList(payload?.data?.lists);
};

export const getPlaylistTracks = async (playlist, { page = 1, pagesize = 300 } = {}) => {
  if (!playlist?.id) return [];
  const isUserPlaylist = playlist.idType === 'user' && playlist.listId != null;
  const payload = isUserPlaylist
    ? await apiRequest({
      method: 'POST',
      path: '/playlist/track/all/new',
      data: { listid: playlist.listId, page, pagesize }
    })
    : await apiRequest({
      method: 'GET',
      path: '/playlist/track/all',
      params: { id: playlist.id, page, pagesize }
    });

  ensureOk(payload, '获取歌单歌曲失败');
  const list = payload?.data?.songs || payload?.data?.lists || payload?.data?.info;
  return normalizeSongList(list);
};

export const getDailyRecommend = async () => {
  const payload = await apiRequest({ method: 'POST', path: '/everyday/recommend' });
  ensureOk(payload, '获取每日推荐失败');
  return normalizeSongList(payload?.data?.song_list);
};

export const getUserPlaylists = async () => {
  const payload = await apiRequest({
    method: 'GET',
    path: '/user/playlist',
    params: { page: 1, pagesize: 100 }
  });
  ensureOk(payload, '获取用户歌单失败');
  const list = payload?.data?.info || payload?.data?.lists || payload?.data?.data?.info;
  return normalizePlaylistList(list);
};

export const getLyrics = async (song) => {
  if (!song?.hash) throw new Error('缺少歌曲信息');

  const searchParams = {
    hash: song.hash,
    duration: Math.max(0, Math.round(Number(song.timeLength) || 0))
  };
  if (song.albumAudioId) searchParams.album_audio_id = song.albumAudioId;
  const keywords = [song.name, song.author].filter(Boolean).join(' ');
  if (keywords) searchParams.keywords = keywords;

  const search = await apiRequest({ method: 'GET', path: '/search/lyric', params: searchParams });
  ensureOk(search, '搜索歌词失败');

  const candidates = Array.isArray(search?.candidates) ? search.candidates : [];
  const candidate = candidates.find((item) => item?.id && item?.accesskey);
  if (!candidate) throw new Error('没有找到歌词');

  const lyric = await apiRequest({
    method: 'GET',
    path: '/lyric',
    params: { id: candidate.id, accesskey: candidate.accesskey, decode: true, fmt: 'lrc' }
  });
  ensureOk(lyric, '获取歌词失败');

  const lines = parseLrc(lyric?.decodeContent || '');
  if (!lines.length) throw new Error('歌词内容为空');
  return { lines, candidate };
};

const pickUrl = (payload) => {
  const candidate = payload?.url?.[0] || payload?.data?.url?.[0] || payload?.data?.url;
  return typeof candidate === 'string' ? candidate : '';
};

export const getSongUrl = async (song, quality = '320') => {
  if (!song?.hash) throw new Error('缺少歌曲 hash');

  const qualities = [...new Set([quality, '320', '128'].filter(Boolean))];
  let message = '';

  for (const candidate of qualities) {
    const params = { hash: song.hash, quality: candidate };
    if (song.albumId) params.album_id = song.albumId;
    if (song.albumAudioId) params.album_audio_id = song.albumAudioId;

    try {
      const payload = await apiRequest({ method: 'GET', path: '/song/url', params });
      const url = pickUrl(payload);
      if (url) return { url: toHttps(url), quality: candidate };
      message = payload?.error || payload?.msg || payload?.data?.msg || message;
    } catch (error) {
      message = error?.message || message;
    }
  }

  throw new Error(message || '该歌曲暂时无法播放（可能需要登录或会员）');
};
