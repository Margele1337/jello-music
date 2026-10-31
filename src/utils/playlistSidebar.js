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

// 长按拖动的本地排序：按保存的 key 顺序排列歌单条目（未记录的保持原相对顺序）
export const applyPlaylistOrder = (entries, savedOrder = []) => {
  const order = Array.isArray(savedOrder) ? savedOrder.map(String) : [];
  const rank = new Map(order.map((key, index) => [key, index]));
  const fallback = order.length;
  return entries
    .map((entry, index) => ({
      entry,
      index,
      rank: rank.has(entry.key) ? rank.get(entry.key) : fallback
    }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map(({ entry }) => entry);
};

export const buildPlaylistSidebarItems = (playlists, { authenticated = false, ready = true, savedOrder = [] } = {}) => {
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

  const playlistEntries = [];
  if (liked?.id) {
    seenIds.add(liked.id);
    seenNames.add(likedLabel);
    playlistEntries.push(toPlaylistItem(liked, likedLabel));
  }

  for (const playlist of source) {
    if (!playlist?.id || seenIds.has(playlist.id)) continue;
    if (liked?.id && playlist.id === liked.id) continue;

    const name = String(playlist.name || '').trim() || '歌单';
    // 喜欢的别名歌单（我喜欢的音乐/我的喜欢）不重复显示；「默认收藏」是
    // 酷狗账号的真实自建歌单（收藏弹窗可选它），改显为「默认歌单」不再隐藏——
    // 否则收藏进去的歌在侧栏找不到
    if (liked?.id && LIKED_NAMES.has(name)) continue;
    if (seenNames.has(name)) continue;

    seenIds.add(playlist.id);
    seenNames.add(name);
    playlistEntries.push(toPlaylistItem(playlist, name));
  }

  // 歌单区（我喜欢/默认歌单/用户歌单）按长按拖动保存的顺序排列；
  // 猜你喜欢/每日推荐是固定入口，不参与排序
  items.push(...applyPlaylistOrder(playlistEntries, savedOrder));

  // 歌词/设置入口已从侧栏移除：歌词功能暂无创新点仅保留接口（/lyrics 路由与
  // SigmaMusicPlayer 的 type 分支仍在），设置走托盘菜单
  return items;
};
