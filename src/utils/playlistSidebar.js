const LIKED_NAMES = new Set(['我的喜欢', '我喜欢', '我喜欢的音乐']);
const RESERVED_NAMES = new Set(['猜你喜欢', '每日推荐', '歌词', '设置']);

const displayName = (playlist) => String(playlist?.name || '').trim();

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
  items.push({ key: 'guess', type: 'guess', name: '猜你喜欢' });
  items.push({ key: 'daily', type: 'daily', name: '每日推荐' });

  const source = Array.isArray(playlists) ? playlists : [];
  // is_def=1 的空“默认收藏”不能当成喜欢；优先按真实名称选择
  const liked = source.find((playlist) => displayName(playlist) === '我喜欢')
    || source.find((playlist) => displayName(playlist) === '我喜欢的音乐')
    || source.find((playlist) => displayName(playlist) === '我的喜欢')
    || source.find((playlist) => playlist?.isDefault);
  const likedLabel = '我喜欢';

  const seenIds = new Set();
  const seenNames = new Set(RESERVED_NAMES);

  if (liked?.id) {
    seenIds.add(liked.id);
    seenNames.add(likedLabel);
    items.push(toPlaylistItem(liked, likedLabel));
  }

  for (const playlist of source) {
    if (!playlist?.id || seenIds.has(playlist.id)) continue;
    if (liked?.id && playlist.id === liked.id) continue;
    if (playlist.isDefault) continue;

    const name = String(playlist.name || '').trim() || '歌单';
    if (name === '默认收藏') continue;
    if (liked?.id && LIKED_NAMES.has(name)) continue;
    if (seenNames.has(name)) continue;

    seenIds.add(playlist.id);
    seenNames.add(name);
    items.push(toPlaylistItem(playlist, name));
  }

  // 歌词/设置入口已从侧栏移除：歌词功能暂无创新点仅保留接口（/lyrics 路由与
  // SigmaMusicPlayer 的 type 分支仍在），设置走托盘菜单
  return items;
};
