const toText = (value) => (typeof value === 'string' ? value.trim() : '');

const toHttps = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('//')) return `https:${text}`;
  return text.replace(/^http:\/\//i, 'https://');
};

export const coverUrl = (value, size = 400) => {
  const url = toHttps(value);
  return url ? url.replace('{size}', String(size)) : '';
};

const artistNames = (raw) => {
  if (!Array.isArray(raw?.singerinfo)) return [];
  return raw.singerinfo.map((item) => toText(item?.name)).filter(Boolean);
};

const uniqueArtists = (names) => [...new Set(names.filter(Boolean))].join('、');

export const normalizeSong = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  if ('FileHash' in raw || 'SongName' in raw || 'SingerName' in raw) {
    const hash = toText(raw.FileHash);
    if (!hash) return null;
    return {
      hash,
      name: toText(raw.SongName) || toText(raw.OriSongName) || '未知歌曲',
      author: toText(raw.SingerName) || '未知歌手',
      img: coverUrl(raw.trans_param?.union_cover || raw.cover),
      timeLength: Math.max(0, Number(raw.Duration) || 0) * 1000,
      albumId: raw.AlbumID ? String(raw.AlbumID) : '',
      albumAudioId: raw.MixSongID ? String(raw.MixSongID) : (raw.Audioid ? String(raw.Audioid) : '')
    };
  }

  const hash = toText(raw.hash);
  if (!hash) return null;

  if ('timelen' in raw || 'singerinfo' in raw) {
    const artists = uniqueArtists(artistNames(raw));
    let artist = artists || toText(raw.author_name);
    let name = toText(raw.name) || toText(raw.songname) || toText(raw.filename);
    if (artist && name.startsWith(`${artist} - `)) name = name.slice(artist.length + 3);
    return {
      hash,
      name: name || '未知歌曲',
      author: artist || '未知歌手',
      img: coverUrl(raw.trans_param?.union_cover || raw.cover || raw.img),
      timeLength: Number(raw.timelen) || (Number(raw.time_length) || 0) * 1000,
      albumId: raw.album_id ? String(raw.album_id) : (raw.albuminfo?.id ? String(raw.albuminfo.id) : ''),
      albumAudioId: raw.mixsongid ? String(raw.mixsongid) : (raw.audio_id ? String(raw.audio_id) : '')
    };
  }

  return {
    hash,
    name: toText(raw.songname) || toText(raw.filename) || '未知歌曲',
    author: toText(raw.author_name) || uniqueArtists(artistNames(raw)) || '未知歌手',
    img: coverUrl(raw.trans_param?.union_cover || raw.cover || raw.sizable_cover),
    timeLength: (Number(raw.time_length) || 0) * 1000,
    albumId: raw.album_id ? String(raw.album_id) : '',
    albumAudioId: raw.album_audio_id ? String(raw.album_audio_id) : (raw.mixsongid ? String(raw.mixsongid) : '')
  };
};

export const normalizePlaylist = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const collectionId = toText(raw.global_collection_id) || toText(raw.gid);
  const listId = raw.listid ?? raw.list_id ?? null;
  const id = collectionId || (listId != null ? String(listId) : '');
  if (!id) return null;

  let name = toText(raw.specialname) || toText(raw.name) || toText(raw.listname) || '歌单';
  // 酷狗自建默认歌单的名称「默认收藏」极易与「我喜欢」（红心收藏）混淆，
  // 归一化层统一改显为「默认歌单」（识别逻辑用的是 isDefault 标记，不受影响）
  if (name === '默认收藏') name = '默认歌单';

  return {
    id,
    listId,
    idType: collectionId ? 'collection' : 'user',
    name,
    cover: coverUrl(raw.img || raw.pic || raw.cover),
    songCount: Number(raw.song_count ?? raw.count ?? raw.songcount) || 0,
    creator: toText(raw.nickname) || toText(raw.list_create_username),
    isDefault: raw.is_def === 1 || raw.is_def === '1' || raw.is_def === true
      || raw.is_default === 1 || raw.is_default === '1' || raw.is_default === true
  };
};

export const normalizeSongList = (list) => (
  Array.isArray(list) ? list.map(normalizeSong).filter(Boolean) : []
);

export const normalizePlaylistList = (list) => (
  Array.isArray(list) ? list.map(normalizePlaylist).filter(Boolean) : []
);

export { toHttps };
