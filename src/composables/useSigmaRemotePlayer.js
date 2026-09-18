import { reactive } from 'vue';
import { get } from '../utils/request';

/**
 * Sigma 独立窗口用的「远程播放器」适配器：
 * 接口形状与主窗口播放引擎暴露的对象一致，实际通过 IPC 与主窗口通信。
 */
export function useSigmaRemotePlayer() {
  const state = reactive({
    song: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 66,
    modeIndex: 1
  });

  const send = (payload) => {
    if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.send('sigma-command', payload);
    }
  };

  // 伪造 audio 对象：读状态来自主窗口广播，写 currentTime 变成 seek 指令
  const audio = {
    get currentTime() {
      return state.currentTime;
    },
    set currentTime(value) {
      const next = Number(value);
      if (!Number.isFinite(next)) return;
      state.currentTime = next;
      send({ type: 'seek', value: next });
    },
    get duration() {
      return state.duration;
    }
  };

  if (window.electron?.ipcRenderer) {
    window.electron.ipcRenderer.on('sigma-state', (_event, next) => {
      if (!next) return;
      state.song = next.song || null;
      state.playing = !!next.playing;
      state.currentTime = Number(next.currentTime) || 0;
      state.duration = Number(next.duration) || 0;
      if (Number.isFinite(Number(next.volume))) state.volume = Number(next.volume);
      if (Number.isFinite(Number(next.modeIndex))) state.modeIndex = Number(next.modeIndex);
    });
    window.electron.ipcRenderer.send('sigma-request-state');
  }

  return {
    get currentSong() {
      return state.song;
    },
    get playing() {
      return state.playing;
    },
    get volume() {
      return state.volume;
    },
    get currentPlaybackModeIndex() {
      return state.modeIndex;
    },
    get currentPlaybackMode() {
      return { title: '播放模式' };
    },
    audio,
    togglePlayPause: () => send({ type: 'toggle-play' }),
    pause: () => send({ type: 'pause' }),
    playNext: () => send({ type: 'next' }),
    playPrevious: () => send({ type: 'prev' }),
    togglePlaybackMode: () => send({ type: 'mode' }),
    setVolumePercent: (percent) => send({ type: 'volume', value: percent }),
    addSongToQueue: (hash, name, img, author) => send({ type: 'play-song', hash, name, img, author }),
    // 用当前列表整体替换主窗口队列，并从指定歌曲开始播放（换歌跟随该列表）
    playSongList: (songs, hash) => send({ type: 'play-list', songs, hash }),
    addPlaylistToQueue: async () => [],
    getPlaylistAllSongs: async (id) => {
      const all = [];
      // id 为 global_collection_id（collection_3_…）；与主应用一致，最多翻 4 页
      for (let page = 1; page <= 4; page++) {
        const response = await get(`/playlist/track/all?id=${id}&pagesize=300&page=${page}`);
        if (response?.status !== 1) return all;
        // /playlist/track/all 的歌曲数组是 data.songs（PlaylistDetail 同样读 songs）
        const songs = Array.isArray(response.data)
          ? response.data
          : (response.data?.songs || response.data?.info || response.data?.lists || []);
        if (!songs.length) break;
        all.push(...songs);
        if (songs.length < 300) break;
      }
      return all;
    }
  };
}
