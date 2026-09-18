<template>
    <!-- 隐藏播放引擎：不渲染播放器界面，仅保留播放逻辑与必要子组件（供托盘/快捷键/媒体键调用） -->
    <div class="player-engine" aria-hidden="true">
        <QueueList :current-song="currentSong" @add-song-to-queue="onQueueSongAdd"
            @add-cloud-music-to-queue="onQueueCloudSongAdd" @add-local-music-to-queue="onQueueLocalSongAdd" ref="queueList" />
        <PlaylistSelectModal ref="playlistSelect" />
    </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useMusicQueueStore } from '../../stores/musicQueue';
import { useI18n } from 'vue-i18n';
import PlaylistSelectModal from '../PlaylistSelectModal.vue';
import QueueList from '../QueueList.vue';
import { getCover, getAudioOutputDeviceSignature, share } from '../../utils/utils';
import { get } from '../../utils/request';
import { useSigmaUI } from '@/composables/useSigmaUI';
import { MoeAuthStore } from '../../stores/store';

// 从统一入口导入所有模块
import {
    useAudioController,
    useLyricsHandler,
    useProgressBar,
    usePlaybackMode,
    useMediaSession,
    useSongQueue,
    useHelpers
} from './index.js';

// 基础设置
const queueList = ref(null);
const playlistSelect = ref(null);
const qualityMenuOpen = ref(false);
const { t } = useI18n();
const musicQueueStore = useMusicQueueStore();
const playlists = ref([]);
const currentTime = ref(0);
const sliderElement = ref(null);
const coverMode = ref(localStorage.getItem('lyrics-cover-mode') || 'square');

const isDragging = ref(false);
const lyricsFlag = ref(false);

// 辅助函数
const { isElectron, throttle, getVip, desktopLyrics } = useHelpers(t);

const canSwitchQuality = computed(() => {
    return !!currentSong.value?.hash && !currentSong.value?.isLocal && !currentSong.value?.isCloud;
});
const isCurrentQualityOption = (option) => {
    return currentSong.value?.resolvedQuality === option.value && currentSong.value?.playHash === option.hash;
};
const toggleQualityMenu = () => {
    if (!canSwitchQuality.value) return;

    qualityMenuOpen.value = !qualityMenuOpen.value;
};
const switchQuality = async (option) => {
    if (!canSwitchQuality.value || isCurrentQualityOption(option)) {
        qualityMenuOpen.value = false;
        return;
    }

    const previousTime = audio.currentTime || 0;
    const wasPlaying = playing.value;

    qualityMenuOpen.value = false;
    clearAutoSwitchTimer();
    audio.pause();
    playing.value = false;

    const result = await addSongToQueue(
        currentSong.value.hash,
        currentSong.value.name,
        currentSong.value.img,
        currentSong.value.author,
        false,
        option.value,
        currentSong.value.qualityOptions
    );

    if (result && result.song) {
        await playSong(result.song);
        if (audio.duration) {
            audio.currentTime = Math.min(previousTime, audio.duration || previousTime);
        } else {
            audio.addEventListener('loadedmetadata', () => {
                audio.currentTime = Math.min(previousTime, audio.duration || previousTime);
            }, { once: true });
        }

        if (!wasPlaying) {
            pausePlayback();
        }
    } else if (result && result.shouldPlayNext) {
        handleAutoSwitch();
    }
};

// 初始化事件回调
const onSongEnd = () => {
    if (currentPlaybackModeIndex.value == 2) return; // 单曲循环
    // 顺序播放：最后一首播放完毕后停止
    if (currentPlaybackModeIndex.value == 3) {
        const currentIndex = musicQueueStore.queue.findIndex(song => song.hash === currentSong.value.hash);
        if (currentIndex === musicQueueStore.queue.length - 1) {
            playing.value = false;
            return;
        }
    }
    playSongFromQueue('next');
};

// 用于记录上次发送的歌词，避免重复发送
let lastSentLyric = '';
let lastSentTime = 0;

// 节流处理的时间更新函数
const updateCurrentTime = throttle(() => {
    currentTime.value = audio.currentTime;
    if (!isProgressDragging.value) {
        progressWidth.value = (currentTime.value / audio.duration) * 100;
    }

    // 更新SMTC位置状态
    if (audio.duration && currentSong.value?.hash) {
        mediaSession.updatePositionState(audio.currentTime, audio.duration, currentSpeed.value);
    }

    const savedConfig = JSON.parse(localStorage.getItem('settings') || '{}');
    const hasLyricsData = Array.isArray(lyricsData.value) && lyricsData.value.length > 0;
    
    const statusBarLyricsEnabled = savedConfig?.statusBarLyrics === 'on';
    const desktopLyricsEnabled = savedConfig?.desktopLyrics === 'on';

    if (audio) {
        if (hasLyricsData) {
            highlightCurrentChar(audio.currentTime, !lyricsFlag.value);
        }

        // 只在有歌曲且正在播放时才发送 IPC
        if (isElectron() && audio.src && playing.value && (desktopLyricsEnabled || statusBarLyricsEnabled)) {
            const currentLine = hasLyricsData ? getCurrentLineText(audio.currentTime) : '';
            
            // 只有歌词真正变化时才发送（防抖）
            const currentTimeMs = Date.now();
            if (currentLine !== lastSentLyric || currentTimeMs - lastSentTime > 1000) {
                lastSentLyric = currentLine;
                lastSentTime = currentTimeMs;
                
                // 使用 JSON 序列化确保对象可以被克隆
                try {
                    const lyricsPayload = hasLyricsData ? JSON.parse(JSON.stringify(lyricsData.value)) : [];
                    window.electron.ipcRenderer.send('lyrics-data', {
                        currentTime: audio.currentTime,
                        playing: playing.value,
                        lyricsData: lyricsPayload,
                        currentSongHash: currentSong.value?.hash || '',
                        currentLyric: currentLine
                    });
                } catch (e) {
                    // 如果序列化失败，只发送必要的数据
                    window.electron.ipcRenderer.send('lyrics-data', {
                        currentTime: audio.currentTime,
                        playing: playing.value,
                        lyricsData: [],
                        currentSongHash: currentSong.value?.hash || '',
                        currentLyric: currentLine
                    });
                }
            }
        }
        
        if (isElectron() && audio.src && playing.value && savedConfig?.apiMode === 'on') {
            try {
                const serverLyricsPayload = hasLyricsData && originalLyrics.value ? JSON.parse(JSON.stringify(originalLyrics.value)) : [];
                const currentSongPayload = currentSong.value ? JSON.parse(JSON.stringify(currentSong.value)) : null;
                window.electron.ipcRenderer.send('server-lyrics', {
                    currentTime: audio.currentTime,
                    lyricsData: serverLyricsPayload,
                    currentSong: currentSongPayload,
                    duration: audio.duration
                });
            } catch (e) {
                // 序列化失败时跳过
            }
        }
        
        if (isElectron() && audio.src && playing.value && window.electron.platform == 'darwin' && savedConfig?.touchBar == 'on') {
            const currentLine = hasLyricsData ? getCurrentLineText(audio.currentTime) : '';
            window.electron.ipcRenderer.send("update-current-lyrics", currentLine);
        }
    }

    if (!hasLyricsData && isElectron() && (desktopLyricsEnabled || statusBarLyricsEnabled || savedConfig?.apiMode === 'on')) {
        retryMissingLyrics();
    }

    localStorage.setItem('player_progress', audio.currentTime);

    // 向 Sigma 独立窗口广播播放状态
    if (sigmaUI.value && isElectron()) {
        broadcastSigmaState();
    }
}, 200);

// 初始化各个模块
const audioController = useAudioController({ onSongEnd, updateCurrentTime });
const { playing, isMuted, volume, changeVolume, audio, playbackRate, setPlaybackRate, applyLoudnessNormalization, ensureAudioContextRunning, toggleLoudnessNormalization, loudnessNormalizationEnabled, currentLoudnessGain, webAudioInitialized, analyserNode, ensureAnalyser } = audioController;

const lyricsHandler = useLyricsHandler(t);
const { lyricsData, originalLyrics, showLyrics, scrollAmount, SongTips, lyricsMode, toggleLyrics, getLyrics, highlightCurrentChar, resetLyricsHighlight, getCurrentLineText, scrollToCurrentLine, toggleLyricsMode } = lyricsHandler;

const currentLyricsLineIndex = computed(() => {
    if (!lyricsData.value || lyricsData.value.length === 0) return -1;

    const currentTimeMs = currentTime.value * 1000;
    for (let index = 0; index < lyricsData.value.length; index++) {
        const firstChar = lyricsData.value[index]?.characters?.[0];
        const nextFirstChar = lyricsData.value[index + 1]?.characters?.[0];

        if (firstChar && currentTimeMs >= firstChar.startTime && (!nextFirstChar || currentTimeMs < nextFirstChar.startTime)) {
            return index;
        }
    }

    return -1;
});

// 获取当前播放时间的歌词行索引
const getCurrentLineIndex = (currentTime) => {
    if (!lyricsData.value || lyricsData.value.length === 0) return -1;
    for (let i = 0; i < lyricsData.value.length; i++) {
        const line = lyricsData.value[i];
        if (line.characters && line.characters.length > 0) {
            const startTime = line.characters[0].startTime / 1000;
            if (startTime > currentTime) {
                return Math.max(0, i - 1);
            }
        }
    }
    return lyricsData.value.length - 1;
};

const progressBar = useProgressBar(audio, resetLyricsHighlight);
const { progressWidth, isProgressDragging, showTimeTooltip, tooltipPosition, tooltipTime, climaxPoints, formatTime, getMusicHighlights, onProgressDragStart, updateProgressFromEvent, updateTimeTooltip, hideTimeTooltip } = progressBar;

const playbackMode = usePlaybackMode(t, audio);
const { playbackModes, currentPlaybackModeIndex, currentPlaybackMode, playedSongsStack, currentStackIndex, togglePlaybackMode, setPlaybackMode } = playbackMode;

const mediaSession = useMediaSession();

const songQueue = useSongQueue(t, musicQueueStore, queueList);
const { currentSong, NextSong, addSongToQueue, addCloudMusicToQueue, addLocalMusicToQueue, addLocalPlaylistToQueue, addToNext, getPlaylistAllSongs, addPlaylistToQueue, addCloudPlaylistToQueue, restoreLocalSongCover } = songQueue;

// ── Sigma 独立窗口通信（状态广播 + 播放指令）──
const { sigmaUI } = useSigmaUI();

// 打开设置页：Sigma 模式下主界面是隐藏的，交给主进程把请求转进 Sigma 窗口
const openSettingsPage = () => {
    // 设置页在 Sigma 窗口内：交给主进程转交（主窗口自身已无界面）
    window.electron?.ipcRenderer?.send('sigma-request-settings');
};

const broadcastSigmaState = () => {
    if (!isElectron()) return;
    window.electron.ipcRenderer.send('sigma-state', {
        song: currentSong.value ? {
            hash: currentSong.value.hash || '',
            name: currentSong.value.name || '',
            author: currentSong.value.author || '',
            img: currentSong.value.img || '',
            timeLength: currentSong.value.timeLength || 0
        } : null,
        playing: playing.value,
        currentTime: Number.isFinite(audio?.currentTime) ? audio.currentTime : 0,
        duration: Number.isFinite(audio?.duration) ? audio.duration : 0,
        volume: volume.value,
        modeIndex: currentPlaybackModeIndex.value
    });
};

const playSigmaSong = async (payload) => {
    if (!payload?.hash) return;
    clearAutoSwitchTimer();
    audio.pause();
    playing.value = false;
    const result = await addSongToQueue(payload.hash, payload.name, payload.img, payload.author);
    if (result && result.song) {
        await playSong(result.song);
    } else if (result && result.shouldPlayNext) {
        handleAutoSwitch();
    }
};

// Sigma 窗口点歌：用当前列表（歌单/每日推荐/搜索结果）整体替换队列，再从点击的那首开始播放
const playSigmaList = async (payload) => {
    const info = Array.isArray(payload?.songs)
        ? payload.songs.filter(item => item?.hash).map(item => ({
            hash: item.hash,
            name: item.name || '',
            cover: item.cover || '',
            author: item.author || '',
            timelen: item.timelen || 0
        }))
        : [];
    if (info.length === 0) return;

    clearAutoSwitchTimer();
    audio.pause();
    playing.value = false;

    const queue = await addPlaylistToQueue(info, false);
    if (!Array.isArray(queue) || queue.length === 0) return;

    const target = queue.find(item => item.hash === payload.hash) || queue[0];
    const result = await addSongToQueue(target.hash, target.name, target.img, target.author);
    if (result && result.song) {
        await playSong(result.song);
    } else if (result && result.shouldPlayNext) {
        handleAutoSwitch();
    }
};

const handleSigmaCommand = async (_event, command) => {
    if (!command || !command.type) return;
    switch (command.type) {
        case 'toggle-play':
            if (playing.value) {
                pausePlayback();
            } else {
                await togglePlayPause();
            }
            break;
        case 'pause':
            pausePlayback();
            break;
        case 'next':
            playSongFromQueue('next');
            break;
        case 'prev':
            playSongFromQueue('previous');
            break;
        case 'seek':
            if (Number.isFinite(Number(command.value))) {
                audio.currentTime = Number(command.value);
            }
            break;
        case 'volume':
            volume.value = Math.max(0, Math.min(100, Number(command.value) || 0));
            changeVolume();
            break;
        case 'mode':
            togglePlaybackMode();
            break;
        case 'play-song':
            await playSigmaSong(command);
            break;
        case 'play-list':
            await playSigmaList(command);
            break;
        default:
            break;
    }
    broadcastSigmaState();
};

// ── 桌面频谱可视化（移植 sigmarebase MusicManager + JavaFFT）──
const SPECTRUM_BAR_COUNT = 114;          // sigmarebase renderSpectrum 的 maxWidth
const SPECTRUM_FFT_SIZE = 1024;          // JavaFFT numberOfSamples
const SPECTRUM_MAX_AMPLITUDE = 2.256e7;  // sigmarebase amplitudes 上限
const SPECTRUM_SMOOTHING = 0.335;        // sigmarebase 60fps 平滑系数

// 迭代式基 2 FFT（JavaFFT 移植），realIn 只读，结果写入 realOut / imagOut
const createSpectrumFft = (size) => {
    const bits = Math.round(Math.log2(size));
    const reverseIndices = new Uint16Array(size);
    for (let i = 0; i < size; i++) {
        let rev = 0;
        for (let bit = 0; bit < bits; bit++) rev = (rev << 1) | ((i >> bit) & 1);
        reverseIndices[i] = rev;
    }
    return (realIn, realOut, imagOut) => {
        for (let i = 0; i < size; i++) realOut[reverseIndices[i]] = realIn[i];
        imagOut.fill(0);

        let blockEnd = 1;
        for (let blockSize = 2; blockSize <= size; blockSize <<= 1) {
            const deltaAngle = (2 * Math.PI) / blockSize;
            const sm2 = -Math.sin(-2 * deltaAngle);
            const sm1 = -Math.sin(-deltaAngle);
            const cm2 = Math.cos(-2 * deltaAngle);
            const cm1 = Math.cos(-deltaAngle);
            const w = 2 * cm1;

            for (let i = 0; i < size; i += blockSize) {
                let ar2 = cm2, ar1 = cm1, ai2 = sm2, ai1 = sm1;
                for (let j = i, n = 0; n < blockEnd; j++, n++) {
                    const ar0 = w * ar1 - ar2;
                    ar2 = ar1;
                    ar1 = ar0;
                    const ai0 = w * ai1 - ai2;
                    ai2 = ai1;
                    ai1 = ai0;
                    const k = j + blockEnd;
                    const tr = ar0 * realOut[k] - ai0 * imagOut[k];
                    const ti = ar0 * imagOut[k] + ai0 * realOut[k];
                    realOut[k] = realOut[j] - tr;
                    imagOut[k] = imagOut[j] - ti;
                    realOut[j] += tr;
                    imagOut[j] += ti;
                }
            }
            blockEnd = blockSize;
        }
    };
};

const spectrumLevels = new Float32Array(SPECTRUM_BAR_COUNT);
const spectrumSamples = new Float32Array(SPECTRUM_FFT_SIZE);
const spectrumReal = new Float32Array(SPECTRUM_FFT_SIZE);
const spectrumImag = new Float32Array(SPECTRUM_FFT_SIZE);
const spectrumFft = createSpectrumFft(SPECTRUM_FFT_SIZE);
let spectrumTimer = null;
let spectrumLastFrame = 0;
let spectrumMetaKey = '';
let spectrumEnabled = false;

const syncSpectrumSetting = (settings) => {
    const config = settings || JSON.parse(localStorage.getItem('settings') || '{}');
    spectrumEnabled = config?.desktopSpectrum === 'on';
};
syncSpectrumSetting();

const startSpectrumProducer = () => {
    if (spectrumTimer || !isElectron()) return;
    // 用定时器而非 requestAnimationFrame：主窗口最小化后不再产生渲染帧，rAF 会停止导致频谱冻结
    const loop = () => {
        const now = performance.now();

        // 与 sigmarebase 一致：仅在播放且开启时更新幅度，暂停时由频谱窗口自行衰减
        if (!spectrumEnabled || !playing.value) {
            spectrumLastFrame = now;
            return;
        }

        const analyser = analyserNode.value;
        if (!analyser) { ensureAnalyser(); return; }

        // 复刻 JavaFFT + MathHelper.calculateAmplitudes：直接对原始 PCM 采样做 FFT（换算回 16bit 量纲）
        analyser.getFloatTimeDomainData(spectrumSamples);
        const elementVolume = audio.muted || audio.volume <= 0 ? 1 : audio.volume;
        const sampleScale = 32768 / elementVolume;
        for (let i = 0; i < SPECTRUM_FFT_SIZE; i++) spectrumSamples[i] *= sampleScale;
        spectrumFft(spectrumSamples, spectrumReal, spectrumImag);

        // 检测切歌：重置频谱数据，避免旧歌幅度残影
        const song = currentSong.value;
        const metaKey = `${song?.hash || ''}|${song?.img || ''}`;
        const songChanged = metaKey !== spectrumMetaKey;
        if (songChanged) {
            spectrumMetaKey = metaKey;
            spectrumLevels.fill(0);
        }

        // sigmarebase 帧率补偿平滑：alpha = min(0.335 * (60 / fps), 1)
        const dt = spectrumLastFrame > 0 ? Math.min((now - spectrumLastFrame) / 1000, 0.1) : 1 / 60;
        spectrumLastFrame = now;
        const alpha = Math.min(SPECTRUM_SMOOTHING * 60 * dt, 1);

        for (let i = 0; i < SPECTRUM_BAR_COUNT; i++) {
            const re = spectrumReal[i];
            const im = spectrumImag[i];
            const target = Math.sqrt(re * re + im * im);
            spectrumLevels[i] = Math.min(SPECTRUM_MAX_AMPLITUDE, Math.max(0, spectrumLevels[i] + (target - spectrumLevels[i]) * alpha));
        }

        const payload = { levels: spectrumLevels };
        if (songChanged) {
            payload.cover = song?.img || '';
            payload.title = song?.name || '';
            payload.author = song?.author || '';
        }
        window.electron.ipcRenderer.send('spectrum-data', payload);
    };
    spectrumTimer = setInterval(loop, 16);
};
startSpectrumProducer();

// 频谱窗口就绪时，强制重发一次完整数据（含封面/歌名），避免 meta 去重导致后开的窗口拿不到信息
if (isElectron()) {
    window.electron.ipcRenderer.on('request-current-spectrum', () => {
        spectrumMetaKey = '';
        spectrumLastFrame = 0;
    });
}

// 添加自动切换定时器引用
let autoSwitchTimer = null;
// 恢复歌词正常滚动计时器
let lyricScrollTimer = null;
// 自动切换计数器和最大重试次数
let autoSwitchCount = 0;
const maxAutoSwitchRetries = 5;

// 处理自动切换逻辑的函数
const handleAutoSwitch = () => {
    console.log('[PlayerEngine] 检查自动切换重试次数:', autoSwitchCount, '/', maxAutoSwitchRetries);
    if (autoSwitchCount < maxAutoSwitchRetries) {
        autoSwitchCount++;
        console.log(`[PlayerEngine] 自动切换尝试 ${autoSwitchCount}/${maxAutoSwitchRetries}`);
        autoSwitchTimer = setTimeout(() => {
            playSongFromQueue('next');
        }, 3000);
        return true;
    } else {
        console.log('[PlayerEngine] 已达到最大重试次数，停止自动切换');
        window.$modal.alert('已达到最大重试次数，请手动选择歌曲');
        autoSwitchCount = 0;
        return false;
    }
};

// 清除自动切换定时器的函数
const clearAutoSwitchTimer = () => {
    if (autoSwitchTimer) {
        console.log('[PlayerEngine] 取消自动切换到下一首');
        clearTimeout(autoSwitchTimer);
        autoSwitchTimer = null;
    }
};

// 恢复歌词正常滚动的节流函数
const restoreLyricsScroll = throttle(() => {
    if (lyricScrollTimer) clearTimeout(lyricScrollTimer);
    lyricScrollTimer = setTimeout(() => {
        console.log('[PlayerEngine] 恢复歌词正常滚动');
        lyricScrollTimer = null;
        lyricsFlag.value = false;
        const currentLine = getCurrentLineText(audio.currentTime);
        scrollToCurrentLine(currentLine);
    }, 5000);
}, 1000);

// 获取歌词的节流函数
let isLyrics;
let pendingLyricsHash = '';
let pendingLyricsPromise = null;
let lastLyricsRetryAt = 0;
const getCurrentLyrics = async () => {
    const hash = currentSong.value.hash;
    if (!hash) return false;
    if (String(hash).startsWith('local_')) {
        SongTips.value = t('zan-wu-ge-ci');
        return false;
    }

    if (pendingLyricsHash === hash && pendingLyricsPromise) {
        return pendingLyricsPromise;
    }

    pendingLyricsHash = hash;
    pendingLyricsPromise = (async () => {
        isLyrics = await getLyrics(hash);
        return isLyrics;
    })();

    try {
        return await pendingLyricsPromise;
    } finally {
        if (pendingLyricsHash === hash) {
            pendingLyricsHash = '';
            pendingLyricsPromise = null;
        }
    }
};
const retryMissingLyrics = () => {
    if (isLyrics === false || pendingLyricsPromise) return;

    const now = Date.now();
    if (now - lastLyricsRetryAt < 1000) return;

    lastLyricsRetryAt = now;
    getCurrentLyrics();
};

// 计算属性
const formattedCurrentTime = computed(() => formatTime(currentTime.value));
const formattedDuration = computed(() => formatTime(currentSong.value?.timeLength || 0));

// 判断是否有多种歌词模式（同时有翻译和音译）
const hasMultiLyricsMode = computed(() => {
    if (!lyricsData.value || lyricsData.value.length === 0) return false;
    
    // 检查是否至少有一行同时包含翻译和音译
    return lyricsData.value.some(line => line.translated && line.romanized);
});

// 切换歌词显示模式（翻译/音译）
const switchLyricsMode = () => {
    toggleLyricsMode();
};

// 切换封面模式（正方形/唱片）
const toggleCoverMode = () => {
    coverMode.value = coverMode.value === 'square' ? 'vinyl' : 'square';
    localStorage.setItem('lyrics-cover-mode', coverMode.value);
};

const isBlobUrl = (url) => typeof url === 'string' && url.startsWith('blob:');

const isLocalSong = (song) => !!song?.isLocal || String(song?.hash || '').startsWith('local_');

const toPlayerSong = (song) => {
    if (!isLocalSong(song)) return song;
    const { file, handle, ...playerSong } = song;
    return playerSong;
};

// 播放歌曲
const playSong = async (song) => {
    clearAutoSwitchTimer();

    try {
        console.log('[PlayerEngine] 开始播放歌曲:', song.name);

        // 检查歌曲对象和URL是否有效
        if (!song || !song.url) {
            console.error('[PlayerEngine] 无效的歌曲或URL:', song);
            window.$modal.alert(t('bo-fang-shi-bai-qu-mu-wei-kong'));
            playing.value = false;
            return;
        }

        currentSong.value = structuredClone(toPlayerSong(song));

        // 应用响度规格化（如果已启用 Web Audio）
        if (song.loudnessNormalization) {
            console.log('[PlayerEngine] 应用响度规格化:', song.loudnessNormalization);
            applyLoudnessNormalization(song.loudnessNormalization);
        } else {
            console.log('[PlayerEngine] 歌曲无响度规格化数据');
            applyLoudnessNormalization(null);
        }

        audio.src = song.url;

        // 确保 AudioContext 处于运行状态（如果已启用）
        await ensureAudioContextRunning();

        setPlaybackRate(currentSpeed.value);
        console.log('[PlayerEngine] 设置音频源:', song.url);

        try {
            mediaSession.changeMediaSession(currentSong.value);
            // 更新SMTC位置状态
            if (audio.duration) {
                mediaSession.updatePositionState(audio.currentTime, audio.duration, currentSpeed.value);
            }
            const playPromise = audio.play();

            if (playPromise !== undefined) {
                await playPromise;
                console.log('[PlayerEngine] 成功开始播放歌曲');
                playing.value = true;
            }
        } catch (playError) {
            if(playError.name.includes('NotSupportedError')) {
                console.error('[PlayerEngine] 播放失败，浏览器不支持该音频格式,正在降低音质重试:', playError);
                return;
            }
            console.warn('[PlayerEngine] 播放被中断，尝试重新播放:', playError);
            // 等待一小段时间后重试
            await new Promise(resolve => setTimeout(resolve, 100));

            try {
                await audio.play();
                playing.value = true;
            } catch (retryError) {
                console.error('[PlayerEngine] 重试播放失败:', retryError);
                window.$modal.alert(t('bo-fang-shi-bai'));
                playing.value = false;
            }
        }

        // 设置标题
        if (song.name && song.author) {
            document.title = song.name + " - " + song.author;
        } else if (song.name) {
            document.title = song.name;
        }

        // 清空歌词数据
        lyricsData.value = [];
        originalLyrics.value = '';
        isLyrics = undefined;
        lastLyricsRetryAt = 0;
        if(isLocalSong(song)) {
            const { file, handle, ...savedLocalSong } = currentSong.value;
            localStorage.setItem('current_song', JSON.stringify({
                ...savedLocalSong,
                url: ''
            }));
            return;
        }
        // 保存当前歌曲到本地存储
        localStorage.setItem('current_song', JSON.stringify(currentSong.value));

        getVip();
        // 获取歌词
        getCurrentLyrics();
        getMusicHighlights(currentSong.value.hash);
    } catch (error) {
        console.error('[PlayerEngine] 播放音乐时发生错误:', error);
        playing.value = false;
        window.$modal.alert(t('bo-fang-chu-cuo'));
    }
};

// 切换播放/暂停
const togglePlayPause = async () => {
    if (!currentSong.value.hash) {
        console.log('[PlayerEngine] 没有当前歌曲，尝试播放队列中的下一首');
        playSongFromQueue('next');
        return;
    } else if (!audio.src) {
        console.log('[PlayerEngine] 音频源为空，尝试重新设置');
        if (currentSong.value.url && !isLocalSong(currentSong.value)) {
            console.log('[PlayerEngine] 从当前歌曲获取URL:', currentSong.value.url);
            audio.src = currentSong.value.url;
        } else {
            console.log('[PlayerEngine] 重新从队列获取歌曲');
            const songIndex = musicQueueStore.queue.findIndex(song => song.hash === currentSong.value.hash);
            if (songIndex !== -1) {
                const song = musicQueueStore.queue[songIndex];
                if (isLocalSong(song)) {
                    console.log('[PlayerEngine] 本地音乐重新获取播放地址');
                    const result = await addLocalMusicToQueue({
                        ...song,
                        isLocal: true
                    });
                    if (result && result.song) {
                        await playSong(result.song);
                    }
                    return;
                } else if (song.url) {
                    console.log('[PlayerEngine] 从队列中的歌曲获取URL:', song.url);
                    currentSong.value.url = song.url;
                    audio.src = song.url;
                } else if (song.isCloud) {
                    console.log('[PlayerEngine] 云音乐没有URL，重新获取');
                    addCloudMusicToQueue(song.hash, song.name, song.author, song.timeLength, song.img);
                    return;
                } else {
                    console.log('[PlayerEngine] 歌曲没有URL，重新获取');
                    const result = await addSongToQueue(song.hash, song.name, song.img, song.author);
                    if (result && result.song) {
                        playSong(result.song);
                    }
                    return;
                }
            } else {
                console.log('[PlayerEngine] 歌曲不在队列中，播放下一首');
                playSongFromQueue('next');
                return;
            }
        }
    }

    if (playing.value) {
        console.log('[PlayerEngine] 暂停播放');
        audio.pause();
        playing.value = false;
    } else {
        console.log('[PlayerEngine] 开始播放');

        try {
            mediaSession.changeMediaSession(currentSong.value);
            // 更新SMTC位置状态
            if (audio.duration) {
                mediaSession.updatePositionState(audio.currentTime, audio.duration, currentSpeed.value);
            }
        } catch(smtcErr) {
            console.warn('[PlayerEngine] 更新 SMTC 信息失败:', smtcErr);
        }

        try {
            await audio.play();
            playing.value = true;
        } catch (retryError) {
            console.error('[PlayerEngine] 播放失败:', retryError);
            window.$modal.alert(t('bo-fang-shi-bai'));
        }
    }
};

// 从队列中播放歌曲
const playSongFromQueue = async (direction) => {
    clearAutoSwitchTimer();

    if (musicQueueStore.queue.length === 0) {
        console.log('[PlayerEngine] 队列为空');
        window.$modal.alert(t('ni-huan-mei-you-tian-jia-ge-quo-kuai-qu-tian-jia-ba'));
        return;
    }

    console.log(`[PlayerEngine] 从队列播放${direction === 'next' ? '下' : '上'}一首`);
    audio.pause();
    playing.value = false;
    if (direction == 'next' && NextSong.value.length > 0) {
        // 添加下一首播放
        console.log('[PlayerEngine] 播放预定的下一首:', NextSong.value[0].name);
        const songData = NextSong.value[0];
        NextSong.value.shift();

        try {
            const result = await addSongToQueue(songData.hash, songData.name, songData.img, songData.author);
            // 如果返回了歌曲对象，直接播放
            if (result && result.song) {
                console.log('[PlayerEngine] 获取到下一首歌曲，开始播放:', result.song.name);
                await playSong(result.song);
            } else if (result && result.shouldPlayNext) {
                console.log('[PlayerEngine] 预定的下一首无法播放');
                handleAutoSwitch();
            } else {
                console.error('[PlayerEngine] 无法获取下一首歌曲信息');
            }
        } catch (error) {
            console.error('[PlayerEngine] 获取下一首歌曲时出错:', error);
        }
        return;
    }

    const currentIndex = musicQueueStore.queue.findIndex(song => song.hash === currentSong.value.hash);
    console.log('[PlayerEngine] 当前歌曲索引:', currentIndex);
    let targetIndex;

    // 处理不同播放模式
    if (currentIndex === -1) {
        targetIndex = 0;
    } else if (currentPlaybackModeIndex.value === 0) {
        // 随机播放
        targetIndex = handleRandomPlayback(direction, currentIndex);
    } else if (currentPlaybackModeIndex.value === 3) {
        // 顺序播放
        if (direction === 'previous') {
            targetIndex = currentIndex === 0 ? musicQueueStore.queue.length - 1 : currentIndex - 1;
        } else {
            targetIndex = currentIndex + 1;
            if (targetIndex >= musicQueueStore.queue.length) {
                playing.value = false;
                return;
            }
        }
    } else {
        // 列表循环或单曲循环
        targetIndex = direction === 'previous'
            ? (currentIndex === 0 ? musicQueueStore.queue.length - 1 : currentIndex - 1)
            : (currentIndex + 1) % musicQueueStore.queue.length;
    }

    console.log('[PlayerEngine] 目标歌曲索引:', targetIndex);

    // 播放目标索引的歌曲
    const targetSong = musicQueueStore.queue[targetIndex];
    console.log('[PlayerEngine] 开始播放目标歌曲:', targetSong.name);

    try {
        let result;
        if (targetSong.isCloud) {
            result = await addCloudMusicToQueue(
                targetSong.hash,
                targetSong.name,
                targetSong.author,
                targetSong.timeLength,
                targetSong.img,
                false // 不重置播放位置，只获取URL
            );
        } else if (isLocalSong(targetSong)) {
            result = await addLocalMusicToQueue({
                ...targetSong,
                isLocal: true
            }, false);
        } else {
            result = await addSongToQueue(
                targetSong.hash,
                targetSong.name,
                targetSong.img,
                targetSong.author,
                false // 不重置播放位置，只获取URL
            );
        }

        // 检查返回结果并播放
        if (result && result.song) {
            console.log('[PlayerEngine] 成功获取歌曲URL，开始播放:', result.song.name);
            await playSong(result.song);
        } else if (result && result.shouldPlayNext) {
            console.log('[PlayerEngine] 歌曲无法播放');
            handleAutoSwitch();
        } else {
            console.error('[PlayerEngine] 无法获取歌曲URL');
        }
    } catch (error) {
        console.error('[PlayerEngine] 切换歌曲时发生错误:', error);
        // 如果出错，尝试播放下一首
        if (direction === 'next') {
            console.log('[PlayerEngine] 发生错误，3秒后尝试播放下一首');
            handleAutoSwitch();
        }
    }
};

// 处理随机播放逻辑
const handleRandomPlayback = (direction, currentIndex) => {
    if (direction === 'previous' && currentStackIndex.value > 0) {
        // 返回上一首随机歌曲
        currentStackIndex.value--;
        return playedSongsStack.value[currentStackIndex.value];
    } else if (direction === 'previous') {
        // 向前随机一首新歌曲
        let newIndex;
        let attempts = 0;
        const maxAttempts = musicQueueStore.queue.length * 2; // 防止死循环
        
        do {
            newIndex = Math.floor(Math.random() * musicQueueStore.queue.length);
            attempts++;
            
            // 如果尝试次数过多，直接返回
            if (attempts >= maxAttempts) {
                break;
            }
        } while (playedSongsStack.value.length > 0 && 
                 (newIndex === playedSongsStack.value[currentStackIndex.value] ||
                  (musicQueueStore.queue.length >= 10 && playedSongsStack.value.length > 0 && 
                   playedSongsStack.value.slice(-Math.min(10, playedSongsStack.value.length)).includes(newIndex))));

        playedSongsStack.value.unshift(newIndex);
        return newIndex;
    } else if (direction === 'next' && currentStackIndex.value < playedSongsStack.value.length - 1) {
        // 前进到下一首已随机过的歌曲
        currentStackIndex.value++;
        return playedSongsStack.value[currentStackIndex.value];
    } else if (direction === 'next') {
        // 随机一首新歌曲
        let newIndex;
        let attempts = 0;
        const maxAttempts = musicQueueStore.queue.length * 2; // 防止死循环
        
        do {
            newIndex = Math.floor(Math.random() * musicQueueStore.queue.length);
            attempts++;
            
            // 如果尝试次数过多，直接返回
            if (attempts >= maxAttempts) {
                break;
            }
        } while (playedSongsStack.value.length > 0 && 
                 (newIndex === playedSongsStack.value[currentStackIndex.value] ||
                  (musicQueueStore.queue.length >= 10 && playedSongsStack.value.length > 0 && 
                   playedSongsStack.value.slice(-Math.min(10, playedSongsStack.value.length)).includes(newIndex))));

        // 截断未来的历史记录
        if (currentStackIndex.value < playedSongsStack.value.length - 1) {
            playedSongsStack.value = playedSongsStack.value.slice(0, currentStackIndex.value + 1);
        }

        // 添加新歌曲到历史记录
        playedSongsStack.value.push(newIndex);
        currentStackIndex.value = playedSongsStack.value.length - 1;
        return newIndex;
    }
};

// 音量拖动相关函数
const setVolumeOnClick = (event) => {
    const slider = event.target.closest('.volume-slider');
    if (slider) {
        const sliderWidth = slider.offsetWidth;
        const offsetX = event.offsetX;
        volume.value = Math.round((offsetX / sliderWidth) * 100);
        changeVolume();
        console.log('[PlayerEngine] 点击设置音量:', volume.value, '实际audio.volume:', audio.volume);
    }
};

const onDragStart = (event) => {
    sliderElement.value = event.target.closest('.volume-slider');
    if (sliderElement.value) {
        isDragging.value = true;
        setVolumeOnClick(event);
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', onDragEnd);
    }
};
const onDrag = (event) => {
    if (isDragging.value && sliderElement.value) {
        const sliderWidth = sliderElement.value.offsetWidth;
        const rect = sliderElement.value.getBoundingClientRect();
        const offsetX = event.clientX - rect.left;
        const newVolume = Math.max(0, Math.min(100, Math.round((offsetX / sliderWidth) * 100)));
        volume.value = newVolume;
        changeVolume();
        console.log('[PlayerEngine] 拖动设置音量:', volume.value, '实际audio.volume:', audio.volume);
    }
};
const onDragEnd = () => {
    isDragging.value = false;
    sliderElement.value = null;
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', onDragEnd);
};

// 音量滚轮事件
const handleVolumeScroll = (event) => {
    event.preventDefault();
    const delta = Math.sign(event.deltaY) * -1;
    volume.value = Math.min(Math.max(volume.value + delta * 10, 0), 100);
    changeVolume();
    console.log('[PlayerEngine] 滚轮设置音量:', volume.value, '实际audio.volume:', audio.volume);
};

// 歌词滚轮控制播放进度
const handleLyricsWheel = (event) => {
    if (!audio.duration || !currentSong.value?.hash) return;
    
    event.preventDefault();
    const lyricsContainer = document.getElementById('lyrics-container');
    if (!lyricsContainer) return;
    const lineGroups = document.querySelectorAll('.line-group');
    const firstLineElement = lineGroups[0];
    const lastLineElement = lineGroups[lineGroups.length - 1];
    if (!firstLineElement || (firstLineElement == lastLineElement)) return;
    const lineHeight = lastLineElement.offsetHeight;
    const containerHeight = lyricsContainer.offsetHeight;
    // 计算滚动的距离
    const scrollNumber = scrollAmount.value - (event.deltaY * 1.5);
    const maxScrollNumber = ((containerHeight - firstLineElement.offsetHeight) / 2);
    const miniScrollNumber = -lastLineElement.offsetTop + (containerHeight / 2) - (lineHeight / 2);
    if (scrollNumber > maxScrollNumber) scrollAmount.value = maxScrollNumber;
    else if (scrollNumber < miniScrollNumber) scrollAmount.value = miniScrollNumber;
    else scrollAmount.value = scrollNumber;
    lyricsFlag.value = true;
    restoreLyricsScroll();
};

const handleLyricsClick = (lineIndex) => {
    // if (!lyricsFlag.value) return;
    console.log('[PlayerEngine] 点击歌词:', lineIndex);
    const lineStartTime = lyricsData.value[lineIndex].characters[0].startTime;
    audio.currentTime = lineStartTime / 1000;
    resetLyricsHighlight(audio.currentTime);
    scrollToCurrentLine(lineIndex);
    lyricsFlag.value = false;
    if (lyricScrollTimer) clearTimeout(lyricScrollTimer);
    lyricScrollTimer = null;
    // 如果音乐暂停了，自动开始播放
    if (!playing.value) {
        audio.play();
    }
}

// 复制全部歌词到剪贴板
const copyLyricsToClipboard = async () => {
    if (!showLyrics.value || !lyricsData.value || lyricsData.value.length === 0) {
        return;
    }
    try {
        let lyricsText = '';
        lyricsData.value.forEach((lineData) => {
            const originalLine = lineData.characters.map(char => char.char).join('');
            lyricsText += originalLine + '\n';
            if (lineData.translated) {
                lyricsText += lineData.translated + '\n';
            }
            if (lineData.romanized) {
                lyricsText += lineData.romanized + '\n';
            }
            if (lineData.translated || lineData.romanized) {
                lyricsText += '\n';
            }
        });
        await navigator.clipboard.writeText(lyricsText.trim());
        $message.success('歌词已复制到剪贴板');
    } catch (error) {
        $message.error('复制歌词失败');
    }
};

// 键盘快捷键
const handleKeyDown = (event) => {
    const isInputFocused = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (isInputFocused) return;

    switch (event.code) {
        case 'Space':
            event.preventDefault();
            togglePlayPause();
            break;
        case 'ArrowLeft':
            playSongFromQueue('previous');
            break;
        case 'ArrowRight':
            playSongFromQueue('next');
            break;
        case 'Escape':
            if (showLyrics.value) toggleLyrics(currentSong.value.hash, audio.currentTime);
            break;
        case 'KeyC':
            // Ctrl+C 或 Cmd+C 复制歌词（仅在全屏歌词界面）
            if ((event.ctrlKey || event.metaKey) && showLyrics.value) {
                event.preventDefault();
                copyLyricsToClipboard();
            }
            break;
    }
};

// 初始化系统媒体快捷键
const setupMediaShortcuts = () => {
    if (!isElectron()) return;

    window.electron.ipcRenderer.on('play-previous-track', () => playSongFromQueue('previous'));
    window.electron.ipcRenderer.on('play-next-track', () => playSongFromQueue('next'));
    window.electron.ipcRenderer.on('volume-up', () => {
        volume.value = Math.min(volume.value + 10, 100);
        changeVolume();
    });
    window.electron.ipcRenderer.on('volume-down', () => {
        volume.value = Math.max(volume.value - 10, 0);
        changeVolume();
    });
    window.electron.ipcRenderer.on('toggle-play-pause', togglePlayPause);
    window.electron.ipcRenderer.on('toggle-mute', toggleMute);
    window.electron.ipcRenderer.on('toggle-like', () => playlistSelect.value.toLike());
    window.electron.ipcRenderer.on('toggle-mode', togglePlaybackMode);
    window.electron.ipcRenderer.on('sigma-command', handleSigmaCommand);
    window.electron.ipcRenderer.on('sigma-request-state', broadcastSigmaState);
    // 托盘右键「设置」：切到设置页
    window.electron.ipcRenderer.on('open-settings', () => {
        openSettingsPage();
    });
    // Sigma 窗口内登录/退出：同步本窗口的登录态
    window.electron.ipcRenderer.on('auth-changed', () => {
        try {
            const saved = JSON.parse(localStorage.getItem('MoeData') || '{}');
            MoeAuthStore().$patch({
                UserInfo: saved.UserInfo || null,
                Config: saved.Config || null,
                Device: saved.Device || null
            });
            getVip();
        } catch (error) {
            console.error('[PlayerEngine] 同步登录态失败:', error);
        }
    });
    // 设置页在 Sigma 窗口：同步设置变更（频谱开关/桌面歌词字体等即时生效）
    window.electron.ipcRenderer.on('settings-changed', (_event, settings) => {
        if (!settings) return;
        try {
            localStorage.setItem('settings', JSON.stringify(settings));
        } catch (error) {
            console.error('[PlayerEngine] 写入设置失败:', error);
        }
        window.dispatchEvent(new CustomEvent('settings-change', { detail: { settings } }));
    });
    window.electron.ipcRenderer.on('url-params', (_event, data) => {
        console.log('[PlayerEngine] 接收到URL参数:', data);

        // 处理歌曲哈希参数
        if (data.hash) {
            console.log('[PlayerEngine] 从URL启动播放歌曲:', data.hash);
            songQueue.privilegeSong(data.hash).then(res => {
                if (res.status == 1) {
                    const songInfo = res.data[0];
                    addSongToQueue(songInfo.hash, songInfo.albumname, getCover(songInfo.info.image, 480), songInfo.singername)
                }
            })
        }else if (data.listid) {
            // 主界面已移除：歌单深链不再跳转页面，仅记录日志
            console.log('[PlayerEngine] 收到歌单深链（界面已移除，忽略）:', data.listid);
        }
    });
};

// 切换静音
const toggleMute = () => {
    isMuted.value = !isMuted.value;
    audio.muted = isMuted.value;
    if (isMuted.value) volume.value = 0;
    else volume.value = audio.volume * 100;
    localStorage.setItem('player_volume', volume.value);
    console.log('[PlayerEngine] 切换静音:', isMuted.value, '音量:', volume.value, '实际audio.volume:', audio.volume);
};

const pausePlayback = (reason) => {
    clearAutoSwitchTimer();
    if (!audio.paused) audio.pause();
    playing.value = false;
    mediaSession.clearPositionState?.();
    if (reason) console.log('[PlayerEngine] 暂停播放:', reason);
};

const showSpeedMenu = ref(false);
const currentSpeed = ref(1.0);
const playbackSpeeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

// 监听音频输出设备变化（例如插拔耳机/切换声卡），变化时暂停播放
let cleanupAudioOutputDeviceWatcher = null;
let lastAudioOutputDeviceSignature = null;
let audioOutputDeviceChangeHandler = null;

const setupAudioOutputDeviceWatcher = () => {
    if (cleanupAudioOutputDeviceWatcher) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;

    void getAudioOutputDeviceSignature().then(signature => {
        lastAudioOutputDeviceSignature = signature;
    }).catch(() => {
        lastAudioOutputDeviceSignature = null;
    });

    const handler = throttle(() => {
        void (async () => {
            try {
                const signature = await getAudioOutputDeviceSignature();
                if (signature === null) return;
                if (lastAudioOutputDeviceSignature === null) {
                    lastAudioOutputDeviceSignature = signature;
                    return;
                }
                if (signature !== lastAudioOutputDeviceSignature) {
                    lastAudioOutputDeviceSignature = signature;
                    if (!audio.paused) pausePlayback('检测到音频输出设备变化');
                }
            } catch (error) {
                console.warn('[PlayerEngine] 获取音频输出设备信息失败:', error);
            }
        })();
    }, 800);

    if (navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', handler);
        cleanupAudioOutputDeviceWatcher = () => {
            navigator.mediaDevices.removeEventListener('devicechange', handler);
        };
    } else if ('ondevicechange' in navigator.mediaDevices) {
        const previous = navigator.mediaDevices.ondevicechange;
        navigator.mediaDevices.ondevicechange = handler;
        cleanupAudioOutputDeviceWatcher = () => {
            navigator.mediaDevices.ondevicechange = previous;
        };
    }
};

const setAudioOutputDeviceWatcherEnabled = (enabled) => {
    if (enabled) {
        setupAudioOutputDeviceWatcher();
        return;
    }
    cleanupAudioOutputDeviceWatcher?.();
    cleanupAudioOutputDeviceWatcher = null;
    lastAudioOutputDeviceSignature = null;
};

let audioOutputDeviceWatchChangeHandler = null;

const applyAudioOutputDevice = async (deviceId) => {
    if (typeof audio?.setSinkId !== 'function') {
        console.warn('[PlayerEngine] 当前环境不支持切换音频输出设备（setSinkId不可用）');
        return false;
    }

    const sinkId = deviceId || 'default';
    try {
        await audio.setSinkId(sinkId);
        console.log('[PlayerEngine] 已切换音频输出设备:', sinkId);
        return true;
    } catch (error) {
        console.warn('[PlayerEngine] 切换音频输出设备失败:', error);
        window.$modal.alert('切换音频输出设备失败,请刷新页面后重试');
        return false;
    }
};

// 切换速度菜单
const toggleSpeedMenu = () => {
    showSpeedMenu.value = !showSpeedMenu.value;
};

// 改变播放速度
const changePlaybackSpeed = (speed) => {
    currentSpeed.value = speed;
    setPlaybackRate(speed);
    showSpeedMenu.value = false;
    
    // 更新SMTC位置状态以反映新的播放速率
    if (audio.duration && currentSong.value?.hash) {
        mediaSession.updatePositionState(audio.currentTime, audio.duration, speed);
    }
};

const handleDocumentClick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    
    if (!target.closest('.quality-menu-wrapper')) {
        qualityMenuOpen.value = false;
    }
    if (!target.closest('.playback-speed')) {
        showSpeedMenu.value = false;
    }
};

const handleSettingsChange = (event) => {
    syncSpectrumSetting(event.detail?.settings);
};

// 搜索歌曲（主界面已移除，仅保留关闭全屏歌词的行为）
const searchSong = (songName) => {
    // 关闭全屏歌词
    if (showLyrics.value) {
        toggleLyrics(currentSong.value.hash, audio.currentTime);
    }
    if (!songName) return;
};

// 组件挂载
onMounted(() => {
    console.log('[PlayerEngine] 组件挂载');

    // 应用版本：供设置页/扩展兼容显示读取
    if (isElectron()) {
        window.electron.ipcRenderer.invoke('get-app-version')
            .then((version) => { if (version) localStorage.setItem('version', version); })
            .catch(() => {});
    }

    // 初始化音频控制器
    audioController.initAudio();

    const savedSettings = JSON.parse(localStorage.getItem('settings') || '{}');
    setAudioOutputDeviceWatcherEnabled(savedSettings.pauseOnAudioOutputChange === 'on');
    void applyAudioOutputDevice(savedSettings.audioOutputDevice);

    audioOutputDeviceWatchChangeHandler = (event) => {
        const enabled = !!event?.detail?.enabled;
        setAudioOutputDeviceWatcherEnabled(enabled);
    };
    window.addEventListener('audio-output-device-watch-change', audioOutputDeviceWatchChangeHandler);

    audioOutputDeviceChangeHandler = (event) => {
        const deviceId = event?.detail?.deviceId || 'default';
        void applyAudioOutputDevice(deviceId);
    };
    window.addEventListener('audio-output-device-change', audioOutputDeviceChangeHandler);

    // 监听响度规格化开关变更
    const handleLoudnessChange = (event) => {
        const enabled = event.detail.enabled;
        console.log('[PlayerEngine] 响度规格化开关变更:', enabled);
        toggleLoudnessNormalization(enabled);
    };
    window.addEventListener('loudness-normalization-change', handleLoudnessChange);

    // 初始化歌曲和播放状态
    const current_song = localStorage.getItem('current_song');
    if (current_song) {
        try {
            const savedSong = JSON.parse(current_song);
            if (isLocalSong(savedSong)) {
                savedSong.isLocal = true;
                savedSong.url = '';
                if (isBlobUrl(savedSong.img)) {
                    savedSong.img = './assets/images/ico.png';
                }
            }
            currentSong.value = savedSong;

            if (isLocalSong(savedSong)) {
                void restoreLocalSongCover(savedSong).then((cover) => {
                    if (!cover || currentSong.value.hash !== savedSong.hash) return;
                    currentSong.value.img = cover;
                    const { file, handle, ...savedLocalSong } = currentSong.value;
                    localStorage.setItem('current_song', JSON.stringify({
                        ...savedLocalSong,
                        url: ''
                    }));
                });
            }

            // 如果有URL，恢复播放源
            if (savedSong.url) {
                if (!isLocalSong(savedSong)) {
                    console.log('[PlayerEngine] 从缓存恢复音频源:', savedSong.url);
                    audio.src = savedSong.url;
                }
            } else {
                console.log('[PlayerEngine] 缓存的歌曲没有URL');
            }
        } catch (error) {
            console.error('[PlayerEngine] 解析保存的歌曲信息失败:', error);
        }
    }

    // 初始化播放模式
    playbackMode.initPlaybackMode();

    // 设置媒体会话
    mediaSession.initMediaSession({
        togglePlayPause,
        playPrevious: () => playSongFromQueue('previous'),
        playNext: () => playSongFromQueue('next'),
        seekBackward: (seekOffset) => {
            if (audio.currentTime > seekOffset) {
                audio.currentTime -= seekOffset;
            } else {
                audio.currentTime = 0;
            }
        },
        seekForward: (seekOffset) => {
            if (audio.currentTime + seekOffset < audio.duration) {
                audio.currentTime += seekOffset;
            } else {
                audio.currentTime = audio.duration;
            }
        },
        seekTo: (seekTime) => {
            if (seekTime >= 0 && seekTime <= audio.duration) {
                audio.currentTime = seekTime;
            }
        }
    });

    // 设置系统媒体快捷键
    setupMediaShortcuts();

    // 恢复播放进度
    if (current_song && localStorage.getItem('player_progress')) {
        const savedProgress = localStorage.getItem('player_progress');
        audio.currentTime = savedProgress;
        console.log('[PlayerEngine] 恢复播放进度:', savedProgress);
        progressWidth.value = (audio.currentTime / currentSong.value.timeLength) * 100;
    }

    // 恢复播放速度设置
    const savedSpeed = localStorage.getItem('player_speed');
    if (savedSpeed) {
        currentSpeed.value = parseFloat(savedSpeed);
        setPlaybackRate(currentSpeed.value);
    }

    // 获取VIP
    getVip();

    // 添加事件监听
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleDocumentClick);
    window.addEventListener('settings-change', handleSettingsChange);

    // Windows 跳转列表任务「设置」启动（--settings）：进入设置页
    if (window.electron?.ipcRenderer?.invoke) {
        window.electron.ipcRenderer.invoke('consume-pending-settings').then((pending) => {
            if (pending) openSettingsPage();
        }).catch(() => {});
    }

    // 设置播放引擎的监听器
    audio.addEventListener('pause', () => {
        playing.value = false;
        console.log('[PlayerEngine] 暂停事件');
        // 暂停时清除SMTC位置状态
        mediaSession.clearPositionState();
        if (isElectron()) window.electron.ipcRenderer.send('play-pause-action', playing.value, audio.currentTime);
    });

    audio.addEventListener('play', () => {
        playing.value = true;
        console.log('[PlayerEngine] 播放事件');
        if (!lyricsData.value.length) getCurrentLyrics();
        if (isElectron()) window.electron.ipcRenderer.send('play-pause-action', playing.value, audio.currentTime);
    });

    audio.addEventListener('error', async (e) => {
        console.log('[PlayerEngine] 音频错误代码:', audio.error?.code);
        console.error('[PlayerEngine] 音频错误:', e);
        if(audio.error?.code == 4){
            const result = await addSongToQueue(currentSong.value.hash, currentSong.value.name, currentSong.value.img, currentSong.value.author, true, 'flac');
            if (result && result.song) {
                playSong(result.song);
            }
        }else{
            window.$modal.alert(t('yin-pin-jia-zai-shi-bai'));
        }
    });

    console.log('[PlayerEngine] 音频初始化完成');
});

// 监听歌词数据变化，同步歌词到当前播放进度
watch(lyricsData, (newLyrics) => {
    if (newLyrics && newLyrics.length > 0 && audio.currentTime > 0) {
        console.log('[PlayerEngine] 歌词数据加载完成，同步到当前播放进度:', audio.currentTime);
        highlightCurrentChar(audio.currentTime, false);
        const currentLineIndex = getCurrentLineIndex(audio.currentTime);
        scrollToCurrentLine(currentLineIndex);
    }
});

// 组件卸载清理
onUnmounted(() => {
    // 清除自动切换定时器
    clearAutoSwitchTimer();

    // 停止频谱采集定时器
    if (spectrumTimer) {
        clearInterval(spectrumTimer);
        spectrumTimer = null;
    }

    if (audioOutputDeviceWatchChangeHandler) {
        window.removeEventListener('audio-output-device-watch-change', audioOutputDeviceWatchChangeHandler);
        audioOutputDeviceWatchChangeHandler = null;
    }
    if (audioOutputDeviceChangeHandler) {
        window.removeEventListener('audio-output-device-change', audioOutputDeviceChangeHandler);
        audioOutputDeviceChangeHandler = null;
    }

    cleanupAudioOutputDeviceWatcher?.();
    cleanupAudioOutputDeviceWatcher = null;

    // 移除响度规格化事件监听
    window.removeEventListener('loudness-normalization-change', () => {});

    // 使用AudioController的销毁方法清理基本监听器
    audioController.destroy();

    // 清理组件特定的监听器
    audio.removeEventListener('pause', () => { });
    audio.removeEventListener('play', () => { });
    audio.removeEventListener('error', () => { });

    // 清理系统媒体快捷键
    if (isElectron()) {
        window.electron.ipcRenderer.removeAllListeners('play-previous-track');
        window.electron.ipcRenderer.removeAllListeners('play-next-track');
        window.electron.ipcRenderer.removeAllListeners('volume-up');
        window.electron.ipcRenderer.removeAllListeners('volume-down');
        window.electron.ipcRenderer.removeAllListeners('toggle-play-pause');
        window.electron.ipcRenderer.removeAllListeners('toggle-mute');
        window.electron.ipcRenderer.removeAllListeners('toggle-like');
        window.electron.ipcRenderer.removeAllListeners('toggle-mode');
        window.electron.ipcRenderer.removeAllListeners('sigma-command');
        window.electron.ipcRenderer.removeAllListeners('sigma-request-state');
        window.electron.ipcRenderer.removeAllListeners('open-settings');
        window.electron.ipcRenderer.removeAllListeners('auth-changed');
        window.electron.ipcRenderer.removeAllListeners('settings-changed');
    }

    // 清理键盘事件
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('click', handleDocumentClick);
    window.removeEventListener('settings-change', handleSettingsChange);
});

// 对外暴露接口
defineExpose({
    playing,
    pause: () => {
        pausePlayback();
    },
    addSongToQueue: async (hash, name, img, author) => {
        clearAutoSwitchTimer();

        console.log('[PlayerEngine] 外部调用addSongToQueue:', name);
        audio.pause();
        playing.value = false;
        const result = await addSongToQueue(hash, name, img, author);
        if (result && result.song) {
            await playSong(result.song);
        } else if (result && result.shouldPlayNext) {
            console.log('[PlayerEngine] 歌曲无法播放');
            handleAutoSwitch();
        }
        return result;
    },
    addLocalMusicToQueue: async (localSong) => {
        clearAutoSwitchTimer();

        console.log('[PlayerEngine] 外部调用addLocalMusicToQueue:', localSong.name);
        audio.pause();
        playing.value = false;
        
        const result = await addLocalMusicToQueue(localSong);
        if (result && result.song) {
            await playSong(result.song);
            console.log('[PlayerEngine] 本地音乐播放成功:', localSong.name);
            return { song: result.song };
        } else {
            console.error('[PlayerEngine] 播放本地音乐失败');
            return { error: true };
        }
    },
    addLocalPlaylistToQueue: async (localSongs, append = false) => {
        console.log('[PlayerEngine] 外部调用addLocalPlaylistToQueue:', localSongs.length, '首歌曲');
        
        const queueSongs = await addLocalPlaylistToQueue(localSongs, append);
        
        // 如果不是追加模式，自动播放第一首
        if (!append && queueSongs.length > 0) {
            let songIndex = 0;
            
            // 如果是随机播放模式，则随机选择一首歌曲
            if (currentPlaybackModeIndex.value == 0) {
                songIndex = Math.floor(Math.random() * queueSongs.length);
                console.log('[PlayerEngine] 随机模式下添加本地歌单后随机播放:', queueSongs[songIndex].name);
            } else {
                console.log('[PlayerEngine] 添加本地歌单后自动播放第一首:', queueSongs[0].name);
            }
            
            clearAutoSwitchTimer();
            audio.pause();
            playing.value = false;
            
            const result = await addLocalMusicToQueue(queueSongs[songIndex]);
            if (result && result.song) {
                await playSong(result.song);
            }
        }
        
        return queueSongs;
    },
    getPlaylistAllSongs,
    addPlaylistToQueue: async (info, append = false) => {
        const songs = await addPlaylistToQueue(info, append);
        if (songs && songs.length > 0 && !append) {
            // 根据播放模式决定播放哪首歌曲
            let songIndex = 0;

            // 如果是随机播放模式，则随机选择一首歌曲
            if (currentPlaybackModeIndex.value == 0) {
                songIndex = Math.floor(Math.random() * songs.length);
                console.log('[PlayerEngine] 随机模式下添加歌单后随机播放:', songs[songIndex].name);
            } else {
                console.log('[PlayerEngine] 添加歌单后自动播放第一首:', songs[0].name);
            }
            audio.pause();
            playing.value = false;
            // 播放选中的歌曲
            const result = await addSongToQueue(
                songs[songIndex].hash,
                songs[songIndex].name,
                songs[songIndex].img,
                songs[songIndex].author,
                true
            );
            if (result && result.song) {
                await playSong(result.song);
            }
        }
        return songs;
    },
    addToNext,
    addCloudMusicToQueue: async (hash, name, author, timeLength, cover) => {
        clearAutoSwitchTimer();

        console.log('[PlayerEngine] 外部调用addCloudMusicToQueue:', name);
        audio.pause();
        playing.value = false;
        const result = await addCloudMusicToQueue(hash, name, author, timeLength, cover);
        if (result && result.song) {
            await playSong(result.song);
    } else if (result && result.shouldPlayNext) {
        console.log('[PlayerEngine] 歌曲无法播放');
        handleAutoSwitch();
        }
        return result;
    },
    addCloudPlaylistToQueue: async (songs, append = false) => {
        const queueSongs = await addCloudPlaylistToQueue(songs, append);
        if (queueSongs && queueSongs.length > 0 && !append) {
            // 根据播放模式决定播放哪首歌曲
            let songIndex = 0;

            // 如果是随机播放模式，则随机选择一首歌曲
            if (currentPlaybackModeIndex.value == 0) {
                songIndex = Math.floor(Math.random() * queueSongs.length);
                console.log('[PlayerEngine] 随机模式下添加云盘歌单后随机播放:', queueSongs[songIndex].name);
            } else {
                console.log('[PlayerEngine] 添加云盘歌单后自动播放第一首:', queueSongs[0].name);
            }

            // 播放选中的歌曲
            const result = await addCloudMusicToQueue(
                queueSongs[songIndex].hash,
                queueSongs[songIndex].name,
                queueSongs[songIndex].author,
                queueSongs[songIndex].timeLength,
                queueSongs[songIndex].cover,
                true
            );
            if (result && result.song) {
                await playSong(result.song);
            }
        }
        return queueSongs;
    },
    currentSong
    ,
    audio,
    volume,
    togglePlayPause,
    playNext: () => playSongFromQueue('next'),
    playPrevious: () => playSongFromQueue('previous'),
    currentPlaybackMode,
    currentPlaybackModeIndex,
    togglePlaybackMode,
    setVolumePercent: (percent) => {
        const next = Math.max(0, Math.min(100, Number(percent) || 0));
        volume.value = next;
        changeVolume();
    }
});

// 从播放队列接收事件
const onQueueSongAdd = async (hash, name, img, author) => {
    clearAutoSwitchTimer();

    console.log('[PlayerEngine] 从播放队列收到addSongToQueue事件:', name);
    audio.pause();
    playing.value = false;
    const result = await addSongToQueue(hash, name, img, author);
    if (result && result.song) {
        await playSong(result.song);
    } else if (result && result.shouldPlayNext) {
        console.log('[PlayerEngine] 歌曲无法播放');
        handleAutoSwitch();
    }
};

const onQueueCloudSongAdd = async (hash, name, author, timeLength, cover) => {
    clearAutoSwitchTimer();

    console.log('[PlayerEngine] 从播放队列收到addCloudMusicToQueue事件:', name);
    const result = await addCloudMusicToQueue(hash, name, author, timeLength, cover);
    if (result && result.song) {
        await playSong(result.song);
    } else if (result && result.shouldPlayNext) {
        console.log('[PlayerEngine] 云盘歌曲无法播放');
        handleAutoSwitch();
    }
};

const onQueueLocalSongAdd = async (item) => {
    clearAutoSwitchTimer();
    audio.pause();
    playing.value = false;
    
    console.log('[PlayerEngine] 从播放队列收到addLocalMusicToQueue事件:', item.name);
    const result = await addLocalMusicToQueue(item);
    if (result && result.song) {
        await playSong(result.song);
    } else if (result && result.shouldPlayNext) {
        console.log('[PlayerEngine] 本地音乐无法播放');
        handleAutoSwitch();
    }
};
</script>