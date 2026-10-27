const LIKED_NAMES = new Set(['我喜欢', '我喜欢的音乐']);
const RESERVED_NAMES = new Set(['每日推荐', '歌词', '设置']);

const toPlaylistItem = (playlist, name) => ({
  key: `pl-${playlist.id}`,
  type: 'playlist',
  id: playlist.id,
  idType: playlist.idType,
  listId: playlist.listId,
  name
});

export const buildPlaylistSidebarItems = (playlists, { authenticated = false, ready = true } = {}) => {
  const items = [];
  if (ready && !authenticated) {
    items.push({ key: 'login', type: 'login', name: '登录' });
  }
  items.push({ key: 'daily', type: 'daily', name: '每日推荐' });

  const source = Array.isArray(playlists) ? playlists : [];
  const liked = source.find((playlist) => playlist?.isDefault)
    || source.find((playlist) => LIKED_NAMES.has(String(playlist?.name || '').trim()));

  const seenIds = new Set();
  const seenNames = new Set(RESERVED_NAMES);

  if (liked?.id) {
    seenIds.add(liked.id);
    seenNames.add('我喜欢的音乐');
    items.push(toPlaylistItem(liked, '我喜欢的音乐'));
  }

  for (const playlist of source) {
    if (!playlist?.id || seenIds.has(playlist.id)) continue;
    if (liked?.id && playlist.id === liked.id) continue;

    const name = String(playlist.name || '').trim() || '歌单';
    if (liked?.id && LIKED_NAMES.has(name)) continue;
    if (seenNames.has(name)) continue;

    seenIds.add(playlist.id);
    seenNames.add(name);
    items.push(toPlaylistItem(playlist, name));
  }

  items.push({ key: 'lyrics', type: 'lyrics', name: '歌词' });
  items.push({ key: 'settings', type: 'settings', name: '设置' });
  return items;
};
