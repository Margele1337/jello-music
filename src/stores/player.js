import { defineStore } from 'pinia';
import { nextLowerQuality, qualityLabel as qualityLabelText } from '../../shared/settings.js';
import { useSettingsStore } from './settings.js';
import { getSongUrl } from '../services/api/library.js';
import {
  applyLoudnessData,
  applyOutputVolume,
  ensureAudioGraph,
  setAudioOutputDevice,
  setLoudnessEnabled,
  syncLookahead
} from '../services/audio/spectrum.js';

let audio = null;
let boundStore = null;
let loadToken = 0;
let persistTimer = null;
let autoAdvanceTimer = null;
// 降级重取期间屏蔽旧的 audio error 事件，避免降级循环自我触发
let recovering = false;

const MAX_QUALITY_RETRIES = 2;
const MAX_CONSECUTIVE_FAILURES = 5;

const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

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
  });
  audio.addEventListener('pause', () => {
    if (boundStore) boundStore.playing = false;
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
    autoAdvanceDelayMs: 3000
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
      const resumeAt = keepTime ? element.currentTime : 0;

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

        element.src = result.url;
        element.volume = this.volume / 100;
        element.playbackRate = Number(settings.playbackRate) || 1;
        this.loudness = result.loudness || null;
        setLoudnessEnabled(!!settings.loudnessNormalization);
        applyLoudnessData(this.loudness);
        void setAudioOutputDevice(element, settings.audioOutputDevice || 'default');
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
      void this.loadCurrent();
    },

    playIndex(index) {
      if (index < 0 || index >= this.queue.length) return;
      this.failStreak = 0;
      this.index = index;
      void this.loadCurrent();
    },

    removeFromQueue(index) {
      if (index < 0 || index >= this.queue.length) return;
      this.queue.splice(index, 1);
      if (index < this.index) this.index -= 1;
      else if (this.index >= this.queue.length) {
        this.index = this.queue.length - 1;
      }
    },

    clearQueue() {
      clearAutoAdvance();
      this.queue = [];
      this.index = -1;
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
        let next = this.index;
        while (next === this.index) next = Math.floor(Math.random() * this.queue.length);
        this.index = next;
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
        let previous = this.index;
        while (previous === this.index) previous = Math.floor(Math.random() * this.queue.length);
        this.index = previous;
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
