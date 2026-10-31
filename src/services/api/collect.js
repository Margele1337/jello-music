import { apiRequest } from './client.js';
import { getUserPlaylists, getPlaylistTracks } from './library.js';

const LIKED_NAMES = ['我喜欢', '我喜欢的音乐', '我的喜欢'];

export const findLikedPlaylist = async () => {
  const playlists = await getUserPlaylists();
  return playlists.find((playlist) => LIKED_NAMES.includes(String(playlist.name).trim()))
    || playlists.find((playlist) => playlist.isDefault && String(playlist.name).trim() !== '默认收藏')
    || null;
};

// 收藏到歌单：接口格式为 name|hash（名字去掉逗号后转义）
export const addSongToPlaylist = async (playlist, song) => {
  if (!playlist?.listId) throw new Error('该歌单不支持添加歌曲');
  if (!song?.hash || !song?.name) throw new Error('没有正在播放的歌曲');
  const data = `${encodeURIComponent(String(song.name).replace(/,/g, ''))}|${song.hash}`;
  const payload = await apiRequest({
    method: 'GET',
    path: '/playlist/tracks/add',
    params: { listid: playlist.listId, data }
  });
  if (payload?.error_code && payload.error_code !== 0) {
    throw new Error(payload.error_msg || payload.error || '收藏失败');
  }
  return payload;
};

export const collectSongToLiked = async (song) => {
  const liked = await findLikedPlaylist();
  if (!liked) throw new Error('没有找到"我喜欢"歌单');
  return addSongToPlaylist(liked, song);
};

// 「我喜欢」歌曲 hash 集合：心形图标状态判断用。缓存 60s（分页拉满），
// 收藏成功后用 markSongLiked 即时标记，不等下次拉取。
let likedHashSet = null;
let likedHashSetAt = 0;
let likedHashSetLoading = null;
const LIKED_HASH_TTL_MS = 60000;

export const ensureLikedHashSet = async ({ force = false } = {}) => {
  if (likedHashSet && !force && Date.now() - likedHashSetAt < LIKED_HASH_TTL_MS) return likedHashSet;
  if (likedHashSetLoading) return likedHashSetLoading;
  likedHashSetLoading = (async () => {
    try {
      const liked = await findLikedPlaylist();
      const hashes = new Set();
      if (liked) {
        // 分页拉满：我喜欢歌单可能超过单页 300 首
        for (let page = 1; page <= 5; page += 1) {
          const tracks = await getPlaylistTracks(liked, { page, pagesize: 300 });
          for (const track of tracks) if (track?.hash) hashes.add(track.hash);
          if (tracks.length < 300) break;
        }
      }
      likedHashSet = hashes;
      likedHashSetAt = Date.now();
    } catch {
      // 失败不落缓存：下次切歌重试（心形保持灰）
    } finally {
      likedHashSetLoading = null;
    }
    return likedHashSet;
  })();
  return likedHashSetLoading;
};

export const isSongLiked = (song) => !!(song?.hash && likedHashSet?.has(song.hash));

export const markSongLiked = (song) => {
  if (!song?.hash) return;
  if (!likedHashSet) likedHashSet = new Set();
  likedHashSet.add(song.hash);
  likedHashSetAt = Date.now();
};
