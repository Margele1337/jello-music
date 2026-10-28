import { apiRequest } from './client.js';
import { getUserPlaylists } from './library.js';

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
