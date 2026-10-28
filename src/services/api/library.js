import { parseKrc } from '../lyrics/krc.js';
import { parseLrc } from '../lyrics/lrc.js';
import { QUALITY_VALUES, qualityLabel } from '../../../shared/settings.js';
import { apiRequest } from './client.js';
import {
  coverUrl,
  normalizePlaylistList,
  normalizeSongList
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

// 猜你喜欢（主页「私人专属好歌推荐」/top/card?card_id=1）。
// timestamp 绕过 KuGouMusicApi 的同 URL 缓存，保证每次都重新推荐。
export const getGuessYouLike = async () => {
  const payload = await apiRequest({
    method: 'GET',
    path: '/top/card',
    params: { card_id: 1, timestamp: Date.now() }
  });
  ensureOk(payload, '获取猜你喜欢失败');
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

// 逐字 KRC 歌词（桌面歌词卡拉OK效果用），失败返回空数组
export const getKaraokeLyrics = async (song) => {
  if (!song?.hash) return [];

  const searchParams = {
    hash: song.hash,
    duration: Math.max(0, Math.round(Number(song.timeLength) || 0))
  };
  if (song.albumAudioId) searchParams.album_audio_id = song.albumAudioId;

  const search = await apiRequest({ method: 'GET', path: '/search/lyric', params: searchParams });
  const candidate = (Array.isArray(search?.candidates) ? search.candidates : [])
    .find((item) => item?.id && item?.accesskey);
  if (!candidate) return [];

  const lyric = await apiRequest({
    method: 'GET',
    path: '/lyric',
    params: { id: candidate.id, accesskey: candidate.accesskey, fmt: 'krc', decode: true }
  });
  return parseKrc(lyric?.decodeContent || '');
};

// 概念版部分 CDN（youthandroid2）HTTPS 证书不匹配，保留接口返回的协议原样播放
const pickUrl = (payload) => {
  const candidate = payload?.url?.[0] || payload?.data?.url?.[0] || payload?.data?.url;
  return typeof candidate === 'string' ? candidate : '';
};

const pickExtName = (payload) => String(payload?.extName || payload?.data?.extName || '').toLowerCase();

// 响度元数据（volume/volume_gain/volume_peak）供频谱页的响度规格化使用，
// 字段名与 services/audio/spectrum.js#applyLoudnessData 约定一致，不能改动
const pickLoudness = (payload) => {
  const data = (payload?.data && typeof payload.data === 'object') ? payload.data : payload;
  if (!data || (data.volume === undefined && data.volume_gain === undefined)) return null;
  return {
    volume: data.volume,
    volumeGain: data.volume_gain,
    volumePeak: data.volume_peak
  };
};

// 目标音质的降级阶梯（高 → 低）；未知音质按默认 320 处理
export const getQualityFallbackChain = (quality) => {
  const index = QUALITY_VALUES.indexOf(quality);
  const ladder = index >= 0 ? QUALITY_VALUES.slice(0, index + 1) : QUALITY_VALUES.slice(0, 2);
  return [...ladder].reverse();
};

// /privilege/lite 返回各音质档位的专属 hash；relate_goods 里可能藏着蝰蛇档位，
// level === 0 表示该档位对当前账号不可用，直接丢弃
export const collectPrivilegeVariants = (payload) => {
  const variants = [];
  const items = Array.isArray(payload?.data) ? payload.data : [];
  for (const item of items) {
    const related = Array.isArray(item?.relate_goods) ? item.relate_goods : [];
    for (const variant of [item, ...related]) {
      if (!variant?.hash || variant.level === 0) continue;
      if (!QUALITY_VALUES.includes(variant.quality)) continue;
      variants.push({ hash: String(variant.hash), quality: variant.quality });
    }
  }
  return variants;
};

export const buildQualityOptions = (variants) => {
  const options = new Map();
  for (const variant of variants) {
    if (options.has(variant.quality)) continue;
    options.set(variant.quality, {
      value: variant.quality,
      hash: variant.hash,
      label: qualityLabel(variant.quality)
    });
  }
  return [...options.values()].sort((a, b) => QUALITY_VALUES.indexOf(b.value) - QUALITY_VALUES.indexOf(a.value));
};

// 按阶梯把权益档位映射成候选请求；权益数据缺 128 档时用原始 hash 兜底，
// 避免无 VIP 账号被直接判定为不可播
export const buildPlaybackCandidates = (variants, quality, fallbackHash) => {
  const hashByQuality = new Map();
  for (const variant of variants) {
    if (!hashByQuality.has(variant.quality)) hashByQuality.set(variant.quality, variant.hash);
  }

  const candidates = [];
  for (const tier of getQualityFallbackChain(quality)) {
    const hash = hashByQuality.get(tier);
    if (hash) candidates.push({ hash, quality: tier });
  }
  if (!candidates.some((candidate) => candidate.quality === '128')) {
    candidates.push({ hash: fallbackHash, quality: '128' });
  }
  return candidates;
};

// jello:// 深链只带 hash，借 /privilege/lite 的曲目元数据补全歌名/歌手/封面再入队
export const getSongInfoByHash = async (hash) => {
  if (!hash) throw new Error('缺少歌曲 hash');
  const payload = await apiRequest({
    method: 'GET',
    path: '/privilege/lite',
    params: { hash }
  });
  ensureOk(payload, '获取歌曲信息失败');

  const info = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!info?.hash) throw new Error('歌曲信息不可用');
  return {
    hash: String(info.hash),
    name: info.songname || info.filename || '未知歌曲',
    author: info.singername || '未知歌手',
    img: coverUrl(info.info?.image || info.sizable_cover || info.cover),
    timeLength: (Number(info.timelength || info.time_length) || 0) * 1000,
    albumId: info.album_id ? String(info.album_id) : '',
    albumAudioId: info.album_audio_id ? String(info.album_audio_id) : ''
  };
};

const requestSongUrl = async (song, hash, quality, extra) => {
  const params = { hash, quality, ...extra };
  if (song.albumId) params.album_id = song.albumId;
  if (song.albumAudioId) params.album_audio_id = song.albumAudioId;
  return apiRequest({ method: 'GET', path: '/song/url', params });
};

const buildStreamResult = (url, candidate, payload, isTrial, qualityOptions) => {
  const result = {
    url,
    quality: candidate.quality,
    playHash: candidate.hash,
    qualityLabel: qualityLabel(candidate.quality),
    isTrial,
    qualityOptions
  };
  const loudness = pickLoudness(payload);
  if (loudness) result.loudness = loudness;
  return result;
};

export const getSongUrl = async (song, quality = '320') => {
  if (!song?.hash) throw new Error('缺少歌曲 hash');

  // 先查 /privilege/lite 拿各档位专属 hash；查询失败或数据为空时
  // 退回用原始 hash 沿阶梯逐档尝试
  let candidates;
  let qualityOptions = [];
  try {
    const privilege = await apiRequest({
      method: 'GET',
      path: '/privilege/lite',
      params: { hash: song.hash }
    });
    const variants = collectPrivilegeVariants(privilege);
    qualityOptions = buildQualityOptions(variants);
    candidates = variants.length
      ? buildPlaybackCandidates(variants, quality, song.hash)
      : getQualityFallbackChain(quality).map((tier) => ({ hash: song.hash, quality: tier }));
  } catch {
    candidates = getQualityFallbackChain(quality).map((tier) => ({ hash: song.hash, quality: tier }));
  }

  let message = '';
  let noCopyright = false;

  for (const candidate of candidates) {
    try {
      const payload = await requestSongUrl(song, candidate.hash, candidate.quality);
      const url = pickUrl(payload);
      // MP4 源 <audio> 无法直接播放，跳过继续降档
      if (url && pickExtName(payload) !== 'mp4') {
        return buildStreamResult(url, candidate, payload, false, qualityOptions);
      }
      if (Number(payload?.status) === 3) noCopyright = true;
      message = errorMessage(payload, '') || message;
    } catch (error) {
      message = error?.message || message;
    }
  }

  // 未登录或权益不足：free_part=1 取试听片段（仅部分歌曲支持），避免直接失败
  try {
    const payload = await requestSongUrl(song, song.hash, '128', { free_part: 1 });
    const url = pickUrl(payload);
    if (url && pickExtName(payload) !== 'mp4') {
      return buildStreamResult(url, { hash: song.hash, quality: '128' }, payload, true, qualityOptions);
    }
    message = errorMessage(payload, '') || message;
  } catch (error) {
    message = error?.message || message;
  }

  if (noCopyright) throw new Error('该歌曲暂无版权');
  throw new Error(message || '该歌曲暂时无法播放（可能需要登录或会员）');
};
