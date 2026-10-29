import { defineStore } from 'pinia';
import { nextLowerQuality, qualityLabel as qualityLabelText } from '../../shared/settings.js';
import { useSettingsStore } from './settings.js';
import { getSongUrl } from '../services/api/library.js';
import {
  applyLoudnessData,
  applyOutputVolume,
  ensureAudioGraph,
  prepareSelfDecode,
  setAudioOutputDevice,
  setLoudnessEnabled,
  startDecodeAnalysis,
  stopDecodeAnalysis,
  syncLookahead
} from '../services/audio/spectrum.js';

let audio = null;
let boundStore = null;
let loadToken = 0;
let persistTimer = null;
let autoAdvanceTimer = null;
// 降级重取期间屏蔽旧的 audio error 事件，避免降级循环自我触发
let recovering = false;
// 播放状态持久化：播放中每 5 秒落盘一次 + 暂停/换歌/退出时立即落盘
let playbackPersistTimer = null;
let unloadHooksBound = false;
// 启动恢复用的一次性定位（hash 匹配才生效，消费后即清空）
let pendingRestoreSeek = null;

const MAX_QUALITY_RETRIES = 2;
const MAX_CONSECUTIVE_FAILURES = 5;
const PLAYBACK_PERSIST_INTERVAL_MS = 5000;

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

// 只送播放所需的最小字段集，主进程还会再消毒/截断一次
const slimSong = (song) => ({
  hash: song?.hash || '',
  name: song?.name || '',
  author: song?.author || '',
  img: song?.img || '',
  timeLength: song?.timeLength || 0,
  albumId: song?.albumId || '',
  albumAudioId: song?.albumAudioId || ''
});

const persistPlaybackState = (store) => {
  if (!store) return;
  try {
    // loading 中换歌尚未完成，元素进度还是上一首的：此时按 0 记录
    const position = store.loading ? 0 : Number(audio?.currentTime) || 0;
    window.jello?.playbackState?.save?.({
      queue: store.queue.map(slimSong),
      index: store.index,
      mode: store.mode,
      progress: Math.max(0, position)
    });
  } catch {
    /* 持久化失败不影响播放 */
  }
};

const stopPlaybackPersistLoop = () => {
  if (playbackPersistTimer) {
    clearInterval(playbackPersistTimer);
    playbackPersistTimer = null;
  }
};

const startPlaybackPersistLoop = () => {
  stopPlaybackPersistLoop();
  playbackPersistTimer = setInterval(() => {
    if (boundStore?.playing) persistPlaybackState(boundStore);
  }, PLAYBACK_PERSIST_INTERVAL_MS);
  // node --test 环境下不挂住进程退出
  playbackPersistTimer?.unref?.();
};

const bindUnloadPersistHooks = () => {
  if (unloadHooksBound) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  unloadHooksBound = true;
  window.addEventListener('beforeunload', () => persistPlaybackState(boundStore));
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    // 最小化到托盘/切后台不一定触发 beforeunload，隐藏时也补一次
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persistPlaybackState(boundStore);
    });
  }
};

// 恢复的定位只在「加载的正是保存那首」时生效；无论是否命中都只消费一次
const consumeRestoreSeek = (song) => {
  if (!pendingRestoreSeek) return 0;
  const seconds = pendingRestoreSeek.hash === song?.hash ? pendingRestoreSeek.seconds : 0;
  pendingRestoreSeek = null;
  return seconds > 0 ? seconds : 0;
};

const playbackErrorText = (error) => {
  if (error?.name === 'NotSupportedError') return '该音源格式不受支持';
  if (error?.name === 'NotAllowedError') return '系统阻止了自动播放';
  if (error?.name === 'AbortError') return '播放已取消';
  return error?.message || '播放失败，请稍后重试';
};

// 复用 SigmaView 已有的 jello:toast 全局事件通道向用户提示
const notifyUser = (message) => {
  if (!message || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent('jello:toast', { detail: message }));
  } catch {
    /* toast 不可用时静默 */
  }
};

const clearAutoAdvance = () => {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
};

const ensureAudio = (store) => {
  // 始终重绑到最新 store：audio 元素是单例，但 store 可能重建（测试/热更新）
  boundStore = store;
  if (audio) return audio;

  audio = new Audio();
  audio.preload = 'auto';
  // Spectrum sampling needs CORS-enabled media; Kugou CDNs return ACAO: *
  audio.crossOrigin = 'anonymous';
  audio.volume = clampPercent(store?.volume ?? 100) / 100;

  audio.addEventListener('play', () => {
    if (boundStore) boundStore.playing = true;
    startPlaybackPersistLoop();
  });
  audio.addEventListener('pause', () => {
    if (boundStore) boundStore.playing = false;
    stopPlaybackPersistLoop();
    persistPlaybackState(boundStore);
  });
  audio.addEventListener('ended', () => {
    boundStore?.handleEnded();
  });
  audio.addEventListener('error', () => {
    if (!boundStore || !audio?.src) return;
    boundStore.playing = false;
    boundStore.handleSourceError();
  });

  return audio;
};

export const usePlayerStore = defineStore('player', {
  state: () => ({
    queue: [],
    index: -1,
    playing: false,
    loading: false,
    volume: 100,
    mode: 1,
    error: '',
    loudness: null,
    initialized: false,
    // 当前曲目实际解析出的音质信息（isTrial=true 表示只有试听片段）
    trial: false,
    resolvedQuality: '',
    qualityLabel: '',
    qualityOptions: [],
    // 失败恢复计数：连续失败自动跳歌 / 同曲音质降级
    failStreak: 0,
    qualityRetries: 0,
    qualityRetryHash: '',
    autoAdvanceDelayMs: 3000,
    // 随机模式历史栈：按实际播放顺序记录队列索引，
    // shuffleCursor 指向当前曲目在栈中的位置（回溯后 next 可沿栈前进）
    shuffleHistory: [],
    shuffleCursor: -1,
    // 本轮已播集合：整轮播完前随机选歌不重复，播完开新一轮
    shuffleCycle: []
  }),

  getters: {
    currentSong: (state) => state.queue[state.index] || null,
    currentPlaybackModeIndex: (state) => state.mode,
    audio() {
      return ensureAudio(this);
    }
  },

  actions: {
    initialize() {
      if (this.initialized) return;
      this.initialized = true;
      const settings = useSettingsStore();
      const volume = Number(settings.volume);
      this.volume = clampPercent((Number.isFinite(volume) ? volume : 1) * 100);
      ensureAudio(this).volume = this.volume / 100;
      bindUnloadPersistHooks();
      void this.restorePersistedState();
    },

    // 启动恢复：拉取主进程持久化的队列/索引/模式/进度。
    // 不自动播放：只填充状态；进度通过一次性 pendingRestoreSeek
    // 在用户首次加载该曲目（hash 匹配）时随 loadedmetadata 定位。
    // 任何缺失/损坏都静默按空启动。
    async restorePersistedState() {
      if (typeof window === 'undefined' || !window.jello?.playbackState?.get) return;
      let state = null;
      try {
        state = await window.jello.playbackState.get();
      } catch {
        return;
      }
      const queue = Array.isArray(state?.queue) ? state.queue.filter((song) => song?.hash) : [];
      if (!queue.length) return;
      const index = Number.isInteger(state.index) && state.index >= 0 && state.index < queue.length
        ? state.index
        : 0;
      const mode = [0, 1, 2].includes(state.mode) ? state.mode : 1;
      const progress = Number(state.progress);

      // 与手动换列表同等待遇：复位失败计数，避免恢复触发自动跳歌连锁
      clearAutoAdvance();
      this.failStreak = 0;
      this.qualityRetries = 0;
      this.qualityRetryHash = '';

      this.queue = queue;
      this.index = index;
      this.mode = mode;
      this.resetShuffleTracking(index);

      if (Number.isFinite(progress) && progress > 0) {
        pendingRestoreSeek = { hash: queue[index].hash, seconds: progress };
      }
      // 不在启动时取址加载：离线场景会触发失败降级/自动跳歌连锁，违背「恢复不自动播」。
      // 用户首次播放该曲目时 loadCurrent 消费 pendingRestoreSeek，随 loadedmetadata 定位。
    },

    applyPersistedVolume(fraction) {
      const value = Number(fraction);
      if (!Number.isFinite(value)) return;
      const next = clampPercent(value * 100);
      if (next === this.volume) return;
      this.volume = next;
      ensureAudio(this).volume = next / 100;
    },

    async loadCurrent({ keepTime = false, resume = true, qualityOverride = '' } = {}) {
      const song = this.currentSong;
      if (!song?.hash) return;

      const element = ensureAudio(this);
      const token = ++loadToken;
      // 启动恢复的定位在这里消费：仅 hash 与保存曲目一致时生效
      const resumeAt = keepTime ? element.currentTime : consumeRestoreSeek(song);

      // 新的加载取代排队中的自动跳歌
      clearAutoAdvance();
      element.pause();
      this.playing = false;
      this.loading = true;
      this.error = '';
      this.trial = false;
      this.resolvedQuality = '';
      this.qualityLabel = '';

      try {
        const settings = useSettingsStore();
        const result = await getSongUrl(song, qualityOverride || settings.quality || '320');
        if (token !== loadToken) return;

        this.trial = !!result.isTrial;
        this.resolvedQuality = result.quality || '';
        this.qualityLabel = result.qualityLabel || '';
        this.qualityOptions = Array.isArray(result.qualityOptions) ? result.qualityOptions : [];

        // 响度规格化/自定义输出设备需要 Web Audio 音频图（MediaElementSource 只能绑定一次）
        if (settings.loudnessNormalization || settings.audioOutputDevice !== 'default') {
          void ensureAudioGraph(element);
        }

        // ===== mp3 自解码频谱链路：整首字节 fetch 一次，可听路径改用 blob URL，
        // 分析路径由 WebCodecs Worker 解码（services/audio/spectrum.js）。
        // 准入失败/取字节失败/帧头或解码配置无效 → media.decode 为 null，
        // 静默回退：远程 URL 直接播放 + 原 tap+预读频谱链路，用户无感知。=====
        stopDecodeAnalysis();   // 先停上一首的解码 Worker（旧 blob 在 src 切换后回收）
        const media = await prepareSelfDecode({ url: result.url, extName: result.extName });
        if (token !== loadToken) {
          // 已被更新的加载取代：直接回收刚创建的 blob，避免泄漏
          if (media.decode?.blobUrl) {
            try { URL.revokeObjectURL(media.decode.blobUrl); } catch { /* ignore */ }
          }
          return;
        }

        element.src = media.src;
        element.volume = this.volume / 100;
        element.playbackRate = Number(settings.playbackRate) || 1;
        this.loudness = result.loudness || null;
        setLoudnessEnabled(!!settings.loudnessNormalization);
        applyLoudnessData(this.loudness);
        void setAudioOutputDevice(element, settings.audioOutputDevice || 'default');
        // 分析链路在 play 之前挂好：play/seeked 事件会触发重锚，门控时间轴始终
        // 由 element.currentTime 派生；回退曲目则清理上一会话并回收旧 blob
        if (media.decode) startDecodeAnalysis(element, media.decode);
        else stopDecodeAnalysis();
        if (resumeAt > 0) {
          element.addEventListener('loadedmetadata', () => {
            try {
              element.currentTime = resumeAt;
            } catch {
              /* ignore seek failures */
            }
          }, { once: true });
        }
        if (resume) await element.play();

        // 播放成功即视为恢复：复位连续失败计数；
        // 降级计数按「同一首歌累计」，仅在换歌成功后归零（同曲最多降级 2 次）
        if (token === loadToken) {
          this.failStreak = 0;
          if (this.qualityRetryHash !== song.hash) {
            this.qualityRetryHash = song.hash;
            this.qualityRetries = 0;
          }
          // 换歌完成即落盘一次（loading 中 progress 按 0 记录）
          persistPlaybackState(this);
        }
      } catch (error) {
        if (token === loadToken) {
          this.playing = false;
          this.error = playbackErrorText(error);
          this.handleLoadFailure(error);
        }
      } finally {
        recovering = false;
        if (token === loadToken) this.loading = false;
      }
    },

    // 取址/play 失败：格式不支持先降级重试，其余直接排定自动跳歌
    handleLoadFailure(error) {
      if (error?.name === 'NotSupportedError' && this.requestQualityRetry('音源格式不受支持')) return;
      this.scheduleAutoAdvance();
    },

    // 音源 error 事件：MEDIA_ERR_SRC_NOT_SUPPORTED(4) 走降级，其余仅提示
    handleSourceError() {
      if (recovering) return;
      const code = audio?.error?.code;
      if (code && code !== 4) {
        this.error = '音频加载失败';
        notifyUser(this.error);
        return;
      }
      if (this.requestQualityRetry('音源不可用')) return;
      this.error = this.qualityRetries > 0
        ? `无法播放「${this.currentSong?.name || '当前歌曲'}」，已尝试降低音质仍失败`
        : `无法播放「${this.currentSong?.name || '当前歌曲'}」`;
      this.scheduleAutoAdvance();
    },

    // 同一首歌最多降级 MAX_QUALITY_RETRIES 次；换歌后计数自动复位
    requestQualityRetry(reason) {
      const song = this.currentSong;
      if (!song?.hash || recovering) return false;
      if (this.qualityRetryHash !== song.hash) {
        this.qualityRetryHash = song.hash;
        this.qualityRetries = 0;
      }
      if (this.qualityRetries >= MAX_QUALITY_RETRIES) return false;
      // 从实际解析出的档位往下退；尚未解析出档位时直接退到 128
      const next = this.resolvedQuality ? nextLowerQuality(this.resolvedQuality) : '128';
      if (!next) return false;

      this.qualityRetries += 1;
      recovering = true;
      notifyUser(`${reason}，改用${qualityLabelText(next) || next}音质重试（${this.qualityRetries}/${MAX_QUALITY_RETRIES}）`);
      void this.loadCurrent({ qualityOverride: next });
      return true;
    },

    // 连续失败自动跳歌：3 秒后切下一首，连续 5 次仍失败则停止并提示
    scheduleAutoAdvance() {
      if (this.queue.length < 2) {
        // 单曲/空队列无处可跳，只提示，避免定时循环
        if (this.error) notifyUser(this.error);
        return;
      }
      if (this.failStreak >= MAX_CONSECUTIVE_FAILURES) {
        this.failStreak = 0;
        this.error = '连续多首歌曲无法播放，已停止自动切歌，请手动选择歌曲';
        notifyUser(this.error);
        return;
      }
      this.failStreak += 1;
      this.error = `${this.error || '当前歌曲无法播放'}，3 秒后自动切换下一首`;
      notifyUser(this.error);
      clearAutoAdvance();
      autoAdvanceTimer = setTimeout(() => {
        autoAdvanceTimer = null;
        this.playNext();
      }, this.autoAdvanceDelayMs);
    },

    reloadCurrent() {
      if (!this.currentSong) return;
      const element = ensureAudio(this);
      if (!element.src) return;
      void this.loadCurrent({ keepTime: true, resume: !element.paused });
    },

    playSongList(songs, hash) {
      const list = Array.isArray(songs) ? songs.filter((song) => song?.hash) : [];
      if (!list.length) return;

      // 用户手动换列表：复位连续失败计数并取消排队中的自动跳歌
      clearAutoAdvance();
      this.failStreak = 0;
      this.queue = list;
      const index = hash ? list.findIndex((song) => song.hash === hash) : -1;
      this.index = index >= 0 ? index : 0;
      // 整份列表被替换：随机历史全部失效，以当前曲目重新起栈
      this.resetShuffleTracking(this.index);
      void this.loadCurrent();
    },

    playIndex(index) {
      if (index < 0 || index >= this.queue.length) return;
      this.failStreak = 0;
      this.index = index;
      // 随机模式下的手选曲目也是「实际播放过」：入历史栈供上一首回溯
      if (this.mode === 0) this.noteShufflePlay(index);
      void this.loadCurrent();
    },

    removeFromQueue(index) {
      if (index < 0 || index >= this.queue.length) return;
      this.queue.splice(index, 1);
      if (index < this.index) this.index -= 1;
      else if (this.index >= this.queue.length) {
        this.index = this.queue.length - 1;
      }
      this.pruneShuffleHistory(index);
      persistPlaybackState(this);
    },

    clearQueue() {
      clearAutoAdvance();
      this.queue = [];
      this.index = -1;
      this.resetShuffleTracking();
      persistPlaybackState(this);
    },

    // ===== 随机模式历史栈 =====

    // 清空历史（换列表/清队列/切模式），seedIndex >= 0 时以当前曲目起栈
    resetShuffleTracking(seedIndex = -1) {
      this.shuffleHistory = [];
      this.shuffleCursor = -1;
      this.shuffleCycle = [];
      if (seedIndex >= 0 && seedIndex < this.queue.length) this.noteShufflePlay(seedIndex);
    },

    // 记录一次实际播放：截掉回溯后未再前进的「未来」分支再入栈
    noteShufflePlay(index) {
      if (!Number.isInteger(index) || index < 0 || index >= this.queue.length) return;
      if (this.shuffleCursor < this.shuffleHistory.length - 1) {
        this.shuffleHistory = this.shuffleHistory.slice(0, this.shuffleCursor + 1);
      }
      this.shuffleHistory.push(index);
      this.shuffleCursor = this.shuffleHistory.length - 1;
      this.markShuffleCyclePlayed(index);
    },

    markShuffleCyclePlayed(index) {
      if (!this.shuffleCycle.includes(index)) this.shuffleCycle.push(index);
      // 整队播完 → 开新一轮（下一首起允许重复）
      if (this.shuffleCycle.length >= this.queue.length) this.shuffleCycle = [];
    },

    // 本轮未播的索引里等概率挑一个；本轮播完则自动开新轮（始终避开当前曲）
    pickShuffleIndex() {
      const total = this.queue.length;
      if (total <= 1) return Math.max(0, this.index);
      let candidates = [];
      for (let i = 0; i < total; i += 1) {
        if (i !== this.index && !this.shuffleCycle.includes(i)) candidates.push(i);
      }
      if (!candidates.length) {
        this.shuffleCycle = [];
        for (let i = 0; i < total; i += 1) {
          if (i !== this.index) candidates.push(i);
        }
      }
      return candidates[Math.floor(Math.random() * candidates.length)];
    },

    // 队列删歌后修正历史栈：剔除被删索引、其后索引整体前移，游标跟随当前曲目
    pruneShuffleHistory(removedIndex) {
      const remap = (entry) => (entry === removedIndex ? null : (entry > removedIndex ? entry - 1 : entry));
      const cursorEntry = this.shuffleHistory[this.shuffleCursor];
      this.shuffleHistory = this.shuffleHistory.map(remap).filter((entry) => entry !== null);
      this.shuffleCycle = this.shuffleCycle.map(remap).filter((entry) => entry !== null);
      const relocated = cursorEntry === undefined || cursorEntry === removedIndex
        ? -1
        : this.shuffleHistory.indexOf(remap(cursorEntry));
      this.shuffleCursor = relocated >= 0
        ? relocated
        : Math.min(this.shuffleCursor, this.shuffleHistory.length - 1);
    },

    togglePlayPause() {
      const element = ensureAudio(this);
      if (!element.src || element.error || !this.currentSong) {
        void this.loadCurrent();
        return;
      }
      if (element.paused) {
        void element.play().catch((error) => {
          this.playing = false;
          this.error = playbackErrorText(error);
        });
      } else {
        element.pause();
      }
    },

    pause() {
      ensureAudio(this).pause();
    },

    playNext() {
      if (!this.queue.length) return;
      if (this.queue.length === 1) {
        void this.loadCurrent();
        return;
      }
      if (this.mode === 0) {
        // 回溯过历史（上一首）时先沿栈前进重放，栈尾才随机挑新歌
        const forward = this.shuffleHistory[this.shuffleCursor + 1];
        if (this.shuffleCursor >= 0 && Number.isInteger(forward) && forward < this.queue.length) {
          this.shuffleCursor += 1;
          this.index = forward;
        } else {
          this.index = this.pickShuffleIndex();
          this.noteShufflePlay(this.index);
        }
      } else {
        this.index = (this.index + 1) % this.queue.length;
      }
      void this.loadCurrent();
    },

    playPrevious() {
      if (!this.queue.length) return;
      if (this.queue.length === 1) {
        void this.loadCurrent();
        return;
      }
      if (this.mode === 0) {
        // 沿历史栈回退到上一首实际播放过的歌
        const backward = this.shuffleHistory[this.shuffleCursor - 1];
        if (this.shuffleCursor > 0 && Number.isInteger(backward) && backward < this.queue.length) {
          this.shuffleCursor -= 1;
          this.index = backward;
        } else {
          // 栈头无更早历史：随机挑一首插到栈首（游标指向新歌，next 可原路返回）
          const picked = this.pickShuffleIndex();
          this.shuffleHistory.unshift(picked);
          this.shuffleCursor = 0;
          this.markShuffleCyclePlayed(picked);
          this.index = picked;
        }
      } else {
        this.index = (this.index - 1 + this.queue.length) % this.queue.length;
      }
      void this.loadCurrent();
    },

    handleEnded() {
      const element = ensureAudio(this);
      if (this.mode === 2) {
        element.currentTime = 0;
        void element.play().catch(() => {});
        return;
      }
      this.playNext();
    },

    togglePlaybackMode() {
      this.mode = (this.mode + 1) % 3;
      // 切模式即清随机历史（旧版同款），以当前曲目重新起栈
      this.resetShuffleTracking(this.index);
      persistPlaybackState(this);
    },

    seekBy(delta) {
      const element = ensureAudio(this);
      if (!element.src || !Number.isFinite(element.duration)) return;
      element.currentTime = Math.max(0, Math.min(element.duration, element.currentTime + delta));
    },

    changeVolume(delta) {
      this.setVolumePercent(this.volume + delta);
    },

    setPlaybackRate(rate) {
      const next = Number(rate) || 1;
      const element = ensureAudio(this);
      // 倍速只作用于可听元素：tap 回退链路的预读元素跟随倍速；
      // mp3 自解码链路恒 1x（原版无倍速功能，syncLookahead 内部对其无操作）
      element.playbackRate = next;
      syncLookahead(element.currentTime, this.playing, next, true);
    },

    // 响度开关变化时重算增益（保留当前歌曲的响度数据）
    applyLoudnessSetting(enabled) {
      setLoudnessEnabled(enabled === true);
      if (enabled) void ensureAudioGraph(ensureAudio(this));
      applyLoudnessData(this.loudness);
    },

    applyOutputDevice(deviceId) {
      void setAudioOutputDevice(ensureAudio(this), deviceId || 'default');
    },

    setVolumePercent(value) {
      const next = clampPercent(value);
      this.volume = next;
      // Web Audio gain 优先（频谱启用时音频走音频图）；否则直接设元素音量
      if (!applyOutputVolume(next / 100, false)) {
        ensureAudio(this).volume = next / 100;
      }

      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        const settings = useSettingsStore();
        void settings.update({ volume: next / 100 }).catch(() => {});
      }, 500);
    }
  }
});
