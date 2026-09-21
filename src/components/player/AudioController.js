import { ref } from 'vue';
import spectrumTapProcessorCode from './spectrumTapProcessor.js?raw';

export default function useAudioController({ onSongEnd, updateCurrentTime }) {
    const audio = new Audio();
    // 设置 crossOrigin 以支持 Web Audio API 跨域访问
    audio.crossOrigin = 'anonymous';

    const playing = ref(false);
    const isMuted = ref(false);
    const volume = ref(66);
    const playbackRate = ref(1.0);

    // Web Audio 音频图：source → volumeGain → loudnessGain → destination
    //                               └→ spectrumTap（pre-volume，输出静音）
    const audioContext = ref(null);
    const sourceNode = ref(null);
    const volumeGainNode = ref(null);
    const gainNode = ref(null);
    const spectrumTapNode = ref(null);
    const spectrumTapKind = ref(null);
    const currentLoudnessGain = ref(1.0); // 当前响度增益系数
    const loudnessNormalizationEnabled = ref(false); // 响度规格化开关，默认关闭
    const webAudioInitialized = ref(false); // 标记 Web Audio 是否已初始化

    let volumeBeforeMute = null;
    let desiredSinkId = 'default';

    // 频谱采集：每个音频帧块（默认 1152 采样/声道 ≈ 一个 MP3 帧）回调一次 Int16Array(1024) 交错采样
    const spectrumBlockHandlers = new Set();
    const onSpectrumBlock = (handler) => {
        spectrumBlockHandlers.add(handler);
        return () => spectrumBlockHandlers.delete(handler);
    };
    const emitSpectrumBlock = (block) => {
        for (const handler of spectrumBlockHandlers) {
            try {
                handler(block);
            } catch (error) {
                console.error('[AudioController] 频谱帧处理失败:', error);
            }
        }
    };

    // 采集帧长：按 44.1kHz MP3 帧的时长折算到当前上下文采样率，
    // 保证 38.28Hz 的推送节奏与 sigmarebase 一致（即便设备混音率是 48kHz）
    const getSpectrumFrameSize = () => {
        const rate = audioContext.value?.sampleRate || 44100;
        return Math.max(1, Math.round((1152 * rate) / 44100));
    };

    // 音量走音频图（音量节点在频谱采集点之后），保证 FFT 输入与音量无关（同 SourceDataLine MASTER_GAIN 只作用于输出）
    const applyVolumeToOutput = () => {
        const percent = Math.max(0, Math.min(100, Number(volume.value) || 0));
        const linear = percent / 100;
        if (webAudioInitialized.value && volumeGainNode.value && audioContext.value) {
            const target = isMuted.value ? 0 : linear;
            // 先设好音量增益，再放开元素音量，避免切换瞬间出现满音量毛刺
            volumeGainNode.value.gain.setValueAtTime(target, audioContext.value.currentTime);
            if (audio.volume !== 1) audio.volume = 1;
            if (audio.muted) audio.muted = false;
        } else {
            audio.volume = linear;
            audio.muted = isMuted.value;
        }
    };

    const createWorkletTap = async (frameSize) => {
        const blob = new Blob([spectrumTapProcessorCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        try {
            await audioContext.value.audioWorklet.addModule(url);
        } finally {
            URL.revokeObjectURL(url);
        }
        const node = new AudioWorkletNode(audioContext.value, 'spectrum-tap', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: { frameSize }
        });
        node.port.onmessage = (event) => {
            if (event.data) emitSpectrumBlock(event.data);
        };
        return node;
    };

    const createScriptTap = (frameSize) => {
        const node = audioContext.value.createScriptProcessor(1024, 2, 1);
        const left = new Float32Array(frameSize);
        const right = new Float32Array(frameSize);
        let fill = 0;

        node.onaudioprocess = (event) => {
            const buffer = event.inputBuffer;
            if (!buffer || buffer.numberOfChannels === 0) return;
            const l = buffer.getChannelData(0);
            const stereo = buffer.numberOfChannels > 1;
            const r = stereo ? buffer.getChannelData(1) : l;
            let offset = 0;

            while (offset < l.length) {
                const take = Math.min(frameSize - fill, l.length - offset);
                left.set(l.subarray(offset, offset + take), fill);
                if (stereo) right.set(r.subarray(offset, offset + take), fill);
                fill += take;
                offset += take;

                if (fill === frameSize) {
                    const out = new Int16Array(1024);
                    if (stereo) {
                        for (let i = 0; i < 512; i++) {
                            const lv = Math.round(left[i] * 32768);
                            const rv = Math.round(right[i] * 32768);
                            out[i * 2] = lv < -32768 ? -32768 : lv > 32767 ? 32767 : lv;
                            out[i * 2 + 1] = rv < -32768 ? -32768 : rv > 32767 ? 32767 : rv;
                        }
                    } else {
                        for (let i = 0; i < 1024; i++) {
                            const v = Math.round(left[i] * 32768);
                            out[i] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
                        }
                    }
                    emitSpectrumBlock(out);
                    fill = 0;
                }
            }
        };
        return node;
    };

    const createSpectrumTap = async (frameSize) => {
        try {
            const node = await createWorkletTap(frameSize);
            spectrumTapKind.value = 'worklet';
            return node;
        } catch (error) {
            console.warn('[AudioController] AudioWorklet 频谱采集不可用，回退 ScriptProcessor:', error);
        }
        try {
            const node = createScriptTap(frameSize);
            spectrumTapKind.value = 'script';
            return node;
        } catch (error) {
            console.error('[AudioController] 频谱采集初始化失败:', error);
        }
        return null;
    };

    // 创建音频管线：只在首次播放（用户手势）时调用
    const ensureAudioPipeline = async () => {
        if (webAudioInitialized.value) return true;

        try {
            if (!audioContext.value) {
                // 固定 44.1kHz：sigmarebase 的 JavaFFT 是按 44.1kHz MP3 帧取的
                // （1024 个交错采样 = 11.6ms、bin 间隔 43.07Hz、帧长 26.12ms），
                // 设备混音率是 48k/96k 时窗口与频段映射都会偏，这里强制对齐原版。
                audioContext.value = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
                console.log('[AudioController] AudioContext 初始化成功, 采样率:', audioContext.value.sampleRate);
            }
        } catch (error) {
            console.error('[AudioController] AudioContext 创建失败:', error);
            return false;
        }

        try {
            if (!sourceNode.value) {
                sourceNode.value = audioContext.value.createMediaElementSource(audio);
            }
        } catch (sourceError) {
            console.error('[AudioController] 创建音频源失败（可能是CORS问题）:', sourceError);
            console.warn('[AudioController] 由于CORS限制，Web Audio 已禁用，使用原生播放');
            return false;
        }

        try {
            if (!volumeGainNode.value) {
                volumeGainNode.value = audioContext.value.createGain();
                volumeGainNode.value.gain.setValueAtTime(1, audioContext.value.currentTime);
            }
            if (!gainNode.value) {
                gainNode.value = audioContext.value.createGain();
                gainNode.value.gain.setValueAtTime(
                    loudnessNormalizationEnabled.value ? currentLoudnessGain.value : 1.0,
                    audioContext.value.currentTime
                );
            }

            sourceNode.value.connect(volumeGainNode.value);
            volumeGainNode.value.connect(gainNode.value);
            gainNode.value.connect(audioContext.value.destination);

            if (!spectrumTapNode.value) {
                const tap = await createSpectrumTap(getSpectrumFrameSize());
                if (tap) {
                    sourceNode.value.connect(tap);
                    tap.connect(audioContext.value.destination);
                    spectrumTapNode.value = tap;
                }
            }

            webAudioInitialized.value = true;
            applyVolumeToOutput();

            if (desiredSinkId && desiredSinkId !== 'default' && typeof audioContext.value.setSinkId === 'function') {
                try {
                    await audioContext.value.setSinkId(desiredSinkId);
                } catch (sinkError) {
                    console.warn('[AudioController] 设置 AudioContext 输出设备失败:', sinkError);
                }
            }

            console.log('[AudioController] Web Audio 音频图创建完成, 频谱采集:', spectrumTapKind.value);
            return true;
        } catch (error) {
            console.error('[AudioController] Web Audio 音频图创建失败:', error);
            webAudioInitialized.value = false;
            return false;
        }
    };

    // 切换音频输出设备（元素与 AudioContext 都要设置，Web Audio 输出走 AudioContext）
    const setOutputDevice = async (deviceId) => {
        desiredSinkId = deviceId || 'default';
        try {
            if (typeof audio.setSinkId === 'function') {
                await audio.setSinkId(desiredSinkId);
            }
            if (webAudioInitialized.value && typeof audioContext.value?.setSinkId === 'function') {
                await audioContext.value.setSinkId(desiredSinkId);
            }
            return true;
        } catch (error) {
            console.warn('[AudioController] 切换音频输出设备失败:', error);
            return false;
        }
    };

    // 应用响度规格化
    const applyLoudnessNormalization = (loudnessData) => {
        // 如果 Web Audio 未初始化，不做任何处理
        if (!webAudioInitialized.value || !loudnessNormalizationEnabled.value) {
            console.log('[AudioController] Web Audio 未启用，跳过响度规格化');
            return;
        }

        console.log('[AudioController] 开始应用响度规格化, loudnessData:', loudnessData);

        if (!loudnessData) {
            console.log('[AudioController] 歌曲无响度规格化数据，使用默认增益');
            currentLoudnessGain.value = 1.0;

            // 更新 gainNode
            if (gainNode.value && audioContext.value) {
                gainNode.value.gain.setValueAtTime(1.0, audioContext.value.currentTime);
                console.log('[AudioController] 重置音频增益为 1.0, 当前增益值:', gainNode.value.gain.value);
            }
            return;
        }

        try {
            const { volume: loudnessVolume, volumeGain, volumePeak } = loudnessData;

            // 响度规格化算法
            // loudnessVolume: LUFS 值 (例如 -11.4 表示音频响度为 -11.4 LUFS)
            // volumeGain: 建议的增益调整值 (dB)
            // volumePeak: 峰值 (0-1)

            // 目标响度为 -14 LUFS (Spotify 标准)
            const targetLoudness = -14.0;
            const loudnessAdjustment = targetLoudness - loudnessVolume;

            // 计算增益系数 (dB 转线性)
            // gain = 10^(dB/20)
            let gainAdjustment = Math.pow(10, loudnessAdjustment / 20);

            // 应用 volumeGain (如果 API 已经提供了增益建议)
            if (volumeGain !== 0) {
                gainAdjustment *= Math.pow(10, volumeGain / 20);
            }

            // 防止削波: 如果应用增益后峰值会超过 1.0，则限制增益
            if (volumePeak > 0 && volumePeak * gainAdjustment > 0.95) {
                gainAdjustment = 0.95 / volumePeak;
                console.log('[AudioController] 限制增益以防止削波');
            }

            // 限制增益范围 (0.1 到 3.0，即 -20dB 到 +9.5dB)
            currentLoudnessGain.value = Math.max(0.1, Math.min(3.0, gainAdjustment));

            console.log('[AudioController] 响度规格化:', {
                volume: loudnessVolume + ' LUFS',
                volumeGain: volumeGain + ' dB',
                volumePeak,
                adjustment: loudnessAdjustment.toFixed(2) + ' dB',
                finalGain: (20 * Math.log10(currentLoudnessGain.value)).toFixed(2) + ' dB',
                gainMultiplier: currentLoudnessGain.value.toFixed(3)
            });

            // 应用新的增益
            if (gainNode.value && audioContext.value) {
                gainNode.value.gain.setValueAtTime(currentLoudnessGain.value, audioContext.value.currentTime);
                console.log('[AudioController] 增益已应用, 当前增益值:', gainNode.value.gain.value);
            }
        } catch (error) {
            console.error('[AudioController] 应用响度规格化失败:', error);
            currentLoudnessGain.value = 1.0;
            // 发生错误时也要重置增益
            if (gainNode.value && audioContext.value) {
                gainNode.value.gain.setValueAtTime(1.0, audioContext.value.currentTime);
            }
        }
    };

    // 确保 AudioContext 处于运行状态（如果未初始化则先初始化，然后恢复）
    const ensureAudioContextRunning = async () => {
        if (!webAudioInitialized.value) {
            await ensureAudioPipeline();
        }

        if (webAudioInitialized.value && audioContext.value) {
            console.log('[AudioController] 检查 AudioContext 状态:', audioContext.value.state);

            if (audioContext.value.state === 'suspended') {
                console.log('[AudioController] AudioContext 处于 suspended，尝试恢复...');
                try {
                    await audioContext.value.resume();
                    console.log('[AudioController] AudioContext 已恢复为:', audioContext.value.state);
                } catch (error) {
                    console.error('[AudioController] 恢复 AudioContext 失败:', error);
                }
            } else {
                console.log('[AudioController] AudioContext 状态正常:', audioContext.value.state);
            }

            if (volumeGainNode.value) {
                console.log('[AudioController] 当前音量增益值:', volumeGainNode.value.gain.value);
            }
        }
    };

    // 切换响度规格化
    const toggleLoudnessNormalization = (enabled) => {
        const previousState = loudnessNormalizationEnabled.value;
        loudnessNormalizationEnabled.value = enabled;

        // 保存到 settings
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        settings.loudnessNormalization = enabled ? 'on' : 'off';
        localStorage.setItem('settings', JSON.stringify(settings));

        if (gainNode.value && audioContext.value) {
            const newGain = enabled ? currentLoudnessGain.value : 1.0;
            gainNode.value.gain.setValueAtTime(newGain, audioContext.value.currentTime);
            console.log('[AudioController] 响度规格化', enabled ? '已启用' : '已禁用', ', 增益:', newGain);
        } else if (enabled && !previousState) {
            console.warn('[AudioController] 启用响度规格化需要刷新页面才能生效');
        }

        console.log('[AudioController] 响度规格化开关变更:', enabled ? '开启' : '关闭');
    };

    // 初始化音频设置
    const initAudio = () => {
        const savedVolume = localStorage.getItem('player_volume');
        if (savedVolume !== null) volume.value = parseFloat(savedVolume);
        isMuted.value = volume.value === 0;
        if (!isMuted.value) volumeBeforeMute = volume.value;
        applyVolumeToOutput();

        // 初始化播放速度
        const savedSpeed = localStorage.getItem('player_speed');
        if (savedSpeed !== null) {
            playbackRate.value = parseFloat(savedSpeed);
            audio.playbackRate = playbackRate.value;
        }

        // 检查是否启用响度规格化，但不立即初始化 Web Audio
        // Web Audio 将在首次播放时初始化，以确保在用户手势上下文中
        const savedSettings = JSON.parse(localStorage.getItem('settings') || '{}');
        const savedNormalization = savedSettings.loudnessNormalization || 'off';
        loudnessNormalizationEnabled.value = savedNormalization === 'on';

        audio.addEventListener('ended', onSongEnd);
        audio.addEventListener('pause', handleAudioEvent);
        audio.addEventListener('play', handleAudioEvent);
        audio.addEventListener('timeupdate', updateCurrentTime);

        console.log('[AudioController] 初始化完成，音量设置为:', volume.value, '播放速度:', audio.playbackRate);
        console.log('[AudioController] 响度规格化状态:', loudnessNormalizationEnabled.value ? '已启用（将在首次播放时初始化）' : '未启用');
    };

    // 处理播放/暂停事件
    const handleAudioEvent = (event) => {
        if (event.type === 'play') {
            playing.value = true;
        } else if (event.type === 'pause') {
            playing.value = false;
        }
        console.log(`[AudioController] ${event.type}事件: playing=${playing.value}`);
        if (typeof window !== 'undefined' && typeof window.electron !== 'undefined') {
            window.electron.ipcRenderer.send('play-pause-action', playing.value, audio.currentTime);
        }
    };

    // 切换播放/暂停
    const togglePlayPause = async () => {
        console.log(`[AudioController] 切换播放状态: playing=${playing.value}, src=${audio.src}`);
        if (playing.value) {
            audio.pause();
            playing.value = false;
        } else {
            try {
                // 在用户手势上下文中创建/恢复音频图
                await ensureAudioContextRunning();
                await audio.play();
                playing.value = true;
            } catch (error) {
                console.error('[AudioController] 播放失败:', error);
                return false;
            }
        }
        return true;
    };

    // 切换静音
    const toggleMute = () => {
        if (!isMuted.value) {
            volumeBeforeMute = volume.value > 0 ? volume.value : (volumeBeforeMute || 66);
            isMuted.value = true;
            volume.value = 0;
        } else {
            isMuted.value = false;
            volume.value = volumeBeforeMute || 66;
        }
        applyVolumeToOutput();
        localStorage.setItem('player_volume', volume.value);
        console.log(`[AudioController] 切换静音: muted=${isMuted.value}, volume=${volume.value}`);
    };

    // 修改音量
    const changeVolume = () => {
        volume.value = Math.max(0, Math.min(100, Number(volume.value) || 0));
        if (volume.value > 0) {
            isMuted.value = false;
            volumeBeforeMute = volume.value;
        } else {
            isMuted.value = true;
        }
        applyVolumeToOutput();
        localStorage.setItem('player_volume', volume.value);
        console.log(`[AudioController] 修改音量: volume=${volume.value}, muted=${isMuted.value}`);
    };

    // 设置进度
    const setCurrentTime = (time) => {
        audio.currentTime = time;
        console.log(`[AudioController] 设置进度: time=${time}`);
    };

    // 设置播放速度
    const setPlaybackRate = (speed) => {
        playbackRate.value = speed;
        audio.playbackRate = speed;
        localStorage.setItem('player_speed', speed);
        console.log('[AudioController] 设置播放速度:', speed);
    };

    // 销毁时清理
    const destroy = () => {
        console.log('[AudioController] 销毁音频控制器');
        audio.pause();
        audio.load();
        audio.removeEventListener('play', handleAudioEvent);
        audio.removeEventListener('ended', onSongEnd);
        audio.removeEventListener('pause', handleAudioEvent);
        audio.removeEventListener('timeupdate', updateCurrentTime);

        spectrumBlockHandlers.clear();

        if (spectrumTapNode.value) {
            try {
                spectrumTapNode.value.disconnect();
            } catch (error) {
                /* ignore */
            }
            if (spectrumTapNode.value.port) spectrumTapNode.value.port.onmessage = null;
            spectrumTapNode.value.onaudioprocess = null;
            spectrumTapNode.value = null;
        }
        for (const node of [sourceNode.value, volumeGainNode.value, gainNode.value]) {
            if (node) {
                try {
                    node.disconnect();
                } catch (error) {
                    /* ignore */
                }
            }
        }
        if (audioContext.value) {
            try {
                audioContext.value.close();
            } catch (error) {
                /* ignore */
            }
        }
        sourceNode.value = null;
        volumeGainNode.value = null;
        gainNode.value = null;
        audioContext.value = null;
        webAudioInitialized.value = false;
    };

    return {
        audio,
        playing,
        isMuted,
        volume,
        playbackRate,
        initAudio,
        togglePlayPause,
        toggleMute,
        changeVolume,
        setCurrentTime,
        setPlaybackRate,
        destroy,
        // 响度规格化相关
        applyLoudnessNormalization,
        ensureAudioContextRunning,
        toggleLoudnessNormalization,
        loudnessNormalizationEnabled,
        currentLoudnessGain,
        webAudioInitialized,
        audioContext,
        setOutputDevice,
        // 频谱采集（AudioWorklet 帧块）
        onSpectrumBlock
    };
}
