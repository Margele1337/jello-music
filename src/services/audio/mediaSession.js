// MediaSession / Windows SMTC 集成：把播放器状态映射到系统媒体浮层，
// 并把系统媒体键动作回接到播放器 store。
// 本模块顶层不触碰任何浏览器全局（navigator/Image/MediaMetadata），
// 纯映射函数可在 node --test 下直接导入验证。

const hasMediaSession = () => (
  typeof navigator !== 'undefined'
  && 'mediaSession' in navigator
  && !!navigator.mediaSession
  && typeof MediaMetadata !== 'undefined'
);

// 歌曲 → MediaMetadata 字段映射（song: { name, author, img, ... }）
export const buildMediaMetadata = (song, artworkSrc) => {
  const artwork = artworkSrc ? [{ src: String(artworkSrc) }] : [];
  return {
    title: String(song?.name || ''),
    artist: String(song?.author || ''),
    album: String(song?.albumName || song?.album || ''),
    artwork
  };
};

// 播放进度 → setPositionState 参数映射；非法值返回 null（调用方跳过更新）
export const buildPositionState = (state) => {
  const duration = Number(state?.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const position = Number(state?.currentTime);
  if (!Number.isFinite(position) || position < 0 || position > duration) return null;
  const rate = Number(state?.playbackRate);
  return {
    duration,
    position,
    playbackRate: Number.isFinite(rate) && rate > 0 ? rate : 1
  };
};

// 系统媒体键动作 → 播放器回调。所有 handler 包一层 try/catch：
// 组件拆卸期系统仍可能派发媒体键，不能让异常冒出去
export const initMediaSession = (handlers = {}) => {
  if (!hasMediaSession()) return false;
  const safe = (fn) => (...args) => {
    try {
      fn?.(...args);
    } catch {
      /* 播放器可能已拆卸，忽略 */
    }
  };
  const seekBy = (sign) => safe((details) => {
    const offset = Number(details?.seekOffset) || 10;
    handlers.seekRelative?.(sign * offset);
  });

  const session = navigator.mediaSession;
  session.setActionHandler('play', safe(() => handlers.play?.()));
  session.setActionHandler('pause', safe(() => handlers.pause?.()));
  session.setActionHandler('previoustrack', safe(() => handlers.previous?.()));
  session.setActionHandler('nexttrack', safe(() => handlers.next?.()));
  session.setActionHandler('seekbackward', seekBy(-1));
  session.setActionHandler('seekforward', seekBy(1));
  session.setActionHandler('seekto', safe((details) => {
    if (details?.seekTime === undefined || details?.seekTime === null) return;
    handlers.seekTo?.(Number(details.seekTime));
  }));
  return true;
};

// 封面可达性探测：远端封面加载失败（防盗链/离线）时回退到内置图
export const probeArtwork = (src, fallbackSrc) => new Promise((resolve) => {
  if (!src) {
    resolve(fallbackSrc || '');
    return;
  }
  try {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(fallbackSrc || '');
    img.src = src;
  } catch {
    resolve(fallbackSrc || '');
  }
});

// 快速切歌时旧封面探测可能后返回：递增 token 丢弃过期结果，避免错封面覆盖新 metadata
let metadataToken = 0;

export const applyMediaMetadata = async (song, fallbackArtwork) => {
  if (!hasMediaSession()) return;
  const token = ++metadataToken;
  if (!song) {
    try {
      navigator.mediaSession.metadata = null;
    } catch {
      /* ignore */
    }
    return;
  }
  const artworkSrc = await probeArtwork(song.img, fallbackArtwork);
  if (token !== metadataToken || !hasMediaSession()) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata(buildMediaMetadata(song, artworkSrc));
  } catch {
    /* 平台不支持 MediaMetadata 时静默降级 */
  }
};

export const applyPlaybackState = (playing) => {
  if (!hasMediaSession()) return;
  try {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  } catch {
    /* ignore */
  }
};

export const applyPositionState = (state) => {
  if (!hasMediaSession()) return;
  const next = buildPositionState(state);
  if (!next) return;
  try {
    navigator.mediaSession.setPositionState(next);
  } catch {
    /* ignore */
  }
};

export const clearPositionState = () => {
  if (!hasMediaSession()) return;
  try {
    navigator.mediaSession.setPositionState(null);
  } catch {
    /* ignore */
  }
};

export const teardownMediaSession = () => {
  metadataToken += 1;
  if (!hasMediaSession()) return;
  for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto']) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      /* ignore */
    }
  }
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.setPositionState(null);
  } catch {
    /* ignore */
  }
};
