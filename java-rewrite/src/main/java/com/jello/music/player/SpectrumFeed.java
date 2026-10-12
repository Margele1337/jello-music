package com.jello.music.player;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * 把 {@link SpectrumTap} 放到后台线程持续取频谱，供 UI 线程安全读取。
 *
 * <p>{@code SpectrumTap.nextRawFrame()} 是阻塞的（一帧一个 MP3 帧约 26ms），
 * 绝不能放在 JavaFX 的 UI 线程里调用，否则界面会卡顿。
 *
 * <h2>为什么是「队列」而不是「取最新一帧」</h2>
 * 原版（{@code PlayerEngine.vue}）实测到 sigmarebase 的音频线程<b>不是均匀推帧</b>的：
 * 约每 250ms 被 {@code SourceDataLine} 放行一次，一次推入 9~10 帧
 * （间隔直方图 0ms×453 / 250ms×59）。所以它的频谱观感是
 * 「保持 250ms 不动 → 整体前移 ~10 帧」的<b>台阶</b>，而不是平滑流动。
 *
 * <p>这里 1:1 复刻这个结构：{@link #sigmaQueue} 只保留最近 {@code SIGMA_QUEUE_MAX} 帧，
 * 每攒够 {@code SIGMA_BATCH_SECONDS}（0.25s）才入队一批，UI 永远读队首。
 * 队列越长画面越滞后于声音，所以容量取 4 帧（约 105ms）——
 * 原版是 18 帧，但它的解码提前量让画面领先声音 421.7ms；
 * 我们靠 {@link SpectrumFeed#setLeadSeconds} 的预读提前量对齐音画差，补偿不了的部分用小队列补。
 *
 * <h2>线程安全</h2>
 * UI 侧读的是 {@link #levels}（volatile 引用，指向不可变数组），
 * 后台写的是 {@link #latest}与队列内部状态。
 */
public final class SpectrumFeed implements AutoCloseable {

    /** 原版 {@code SPECTRUM_BAR_COUNT}：sigmarebase renderSpectrum 的 maxWidth。 */
    public static final int BAR_COUNT = 114;

    /** 原版 {@code SPECTRUM_FFT_SIZE}：JavaFFT numberOfSamples。 */
    public static final int FFT_SIZE = 1024;

    /** 原版 {@code SPECTRUM_SIGMA_QUEUE_MAX}。 */
    private static final int SIGMA_QUEUE_MAX = 4;

    /** 原版 {@code SPECTRUM_SIGMA_BATCH_SECONDS}：每 250ms 放行一批。 */
    private static final double SIGMA_BATCH_SECONDS = 0.25;

    /** 原版 {@code SPECTRUM_SIGMA_BATCH_MAX}：防止异常时一批积太多。 */
    private static final int SIGMA_BATCH_MAX = 12;

    /**
     * 原版 {@code SPECTRUM_SIGMA_FRAME_SECONDS}：worklet 每块 1152 采样 @44.1kHz。
     *
     * <p>用块时长累加而不是墙钟时间，是原版的注释里特意说明过的：
     * 后者更新粒度粗，会出现 275ms 的毛刺。
     */
    private static final double SIGMA_FRAME_SECONDS = 1152 / 44100.0;

    /** 原版 {@code SPECTRUM_MAX_AMPLITUDE}：sigmarebase amplitudes 上限。 */
    public static final double MAX_AMPLITUDE = 2.256e7;

    private final SpectrumTap tap;
    private final Deque<double[]> sigmaQueue = new ArrayDeque<>(SIGMA_QUEUE_MAX);
    private final Deque<double[]> sigmaPending = new ArrayDeque<>(SIGMA_BATCH_MAX);
    private volatile double[] levels;
    private volatile double[] rawFrame;
    private volatile boolean running = true;
    private volatile boolean playing = true;
    private volatile String error;
    private final int bandCount;
    private final Thread worker;

    /** 批量累加器：达到 {@link #SIGMA_BATCH_SECONDS} 才把 pending 刷进 queue。 */
    private double batchAccumulator = SIGMA_BATCH_SECONDS;

    /** 频谱相对播放位置领先的秒数（对应原版预读 Audio 的 leadMs）。 */
    private volatile double leadSeconds;

    /** 播放位置提供器；为 null 时频谱自由跑（拉流开头即对应当前播放点）。 */
    private volatile java.util.function.DoubleSupplier playbackPosition;

    /** 换歌时置位，渲染端下一帧直接复制目标、不做渐变（对应原版 amplitudes.isEmpty 分支）。 */
    private volatile boolean pendingSnap;

    public SpectrumFeed(String directUrl, int fftSize, int bandCount, int fps) {
        this.bandCount = bandCount;
        if (directUrl == null || directUrl.isBlank()) {
            // 没有直链时不启动后台线程，界面照常显示，只是没有频谱
            this.tap = null;
            this.error = "未提供音频直链";
            this.worker = null;
            return;
        }
        SpectrumTap t;
        try {
            t = new SpectrumTap(directUrl, fftSize);
        } catch (IOException e) {
            // 拉流失败也让对象可用，只是没有频谱
            this.tap = null;
            this.error = e.getMessage();
            this.worker = null;
            return;
        }
        this.tap = t;

        long intervalNanos = 1_000_000_000L / Math.max(1, fps);
        this.worker = new Thread(() -> {
            while (running) {
                if (!playing) {
                    // 原版暂停时：清空 visualizerData 与 amplitudes，UI 端条形立即消失。
                    // 这里不能只是空转，否则队首还留着旧帧，画面会僵住不动。
                    clearForPause();
                    sleepQuietly(intervalNanos);
                    continue;
                }
                try {
                    double[] frame = tap.nextRawFrame();
                    if (frame == null) {
                        // 流结束
                        break;
                    }
                    this.rawFrame = frame;
                    double[] b = SpectrumTap.takeBins(frame, bandCount);
                    // 幅度上限：原版 SPECTRUM_MAX_AMPLITUDE，超了会撑爆条高
                    for (int i = 0; i < b.length; i++) {
                        if (b[i] > MAX_AMPLITUDE) {
                            b[i] = MAX_AMPLITUDE;
                        }
                    }
                    pushSigmaFrame(b);
                } catch (Exception e) {
                    this.error = e.getMessage();
                    break;
                }
                sleepQuietly(intervalNanos);
            }
        }, "spectrum-feed");
        this.worker.setDaemon(true);
        this.worker.start();
    }

    /**
     * 复刻原版的批量入队：攒够 250ms 才推进队列，读队首。
     * 这样 UI 看到的就是「保持 250ms → 整体前移 ~10 帧」的台阶观感。
     */
    private void pushSigmaFrame(double[] b) {
        sigmaPending.addLast(b);
        batchAccumulator += SIGMA_FRAME_SECONDS;
        if (batchAccumulator >= SIGMA_BATCH_SECONDS
                || sigmaPending.size() >= SIGMA_BATCH_MAX) {
            for (double[] f : sigmaPending) {
                sigmaQueue.addLast(f);
                while (sigmaQueue.size() > SIGMA_QUEUE_MAX) {
                    sigmaQueue.pollFirst();
                }
            }
            sigmaPending.clear();
            batchAccumulator -= SIGMA_BATCH_SECONDS;
            if (batchAccumulator < 0) {
                batchAccumulator = 0;
            }
        }
        this.levels = sigmaQueue.peekFirst();
    }

    /** 暂停时清空队列与待入队批次（对应原版 resetSigmaQueue + levels.fill(0)）。 */
    private void clearForPause() {
        sigmaQueue.clear();
        sigmaPending.clear();
        batchAccumulator = SIGMA_BATCH_SECONDS;
        this.levels = null;
    }

    private static void sleepQuietly(long nanos) {
        try {
            Thread.sleep(nanos / 1_000_000L, (int) (nanos % 1_000_000L));
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }

    /** 取当前频段数据；尚未就绪时返回 null。返回的数组不可被调用方修改。 */
    public double[] levels() {
        return levels;
    }

    public double[] rawFrame() {
        return rawFrame;
    }

    /**
     * 1.7 原版 {@code latestFrame()} 的保留名，取原始幅度谱。
     *
     * @deprecated 命名有歧义（听起来像「最新一帧 levels」），改用 {@link #rawFrame()}。
     */
    @Deprecated
    public double[] latestFrame() {
        return rawFrame;
    }

    public int sampleRate() {
        return tap == null ? 0 : tap.sampleRate();
    }

    public int channels() {
        return tap == null ? 0 : tap.channels();
    }

    public String error() {
        return error;
    }

    public boolean isRunning() {
        return running && (worker == null || worker.isAlive());
    }

    /** 频谱已解码到的播放秒数（不含领先量），用于与播放位置对表。 */
    public double decodedSeconds() {
        return tap == null ? 0 : tap.decodedSeconds();
    }

    /** 设置频谱领先播放的秒数（对应原版 {@code lookaheadLeadMs}）。 */
    public void setLeadSeconds(double seconds) {
        this.leadSeconds = Math.max(0, Math.min(2.0, seconds));
    }

    public double leadSeconds() {
        return leadSeconds;
    }

    /** 绑定播放位置来源，供后台线程判断是否需要重新对齐。 */
    public void setPlaybackPosition(java.util.function.DoubleSupplier position) {
        this.playbackPosition = position;
    }

    /**
     * 播放/暂停切换。对应原版 {@code playing-status} 事件：
     * 暂停清空幅度（条形立即消失），恢复时下一帧直接复制目标、不做渐变。
     */
    public void setPlaying(boolean value) {
        if (this.playing == value) {
            return;
        }
        this.playing = value;
        if (value) {
            pendingSnap = true;
        } else {
            pendingSnap = false;
            clearForPause();
        }
    }

    /**
     * 渲染端是否应当「吸附」——换歌或恢复播放后的第一帧直接复制目标。
     *
     * <p>对应原版 {@code pendingSnap} / {@code data.reset}。
     * 这里返回后即清位，保证只有一帧生效。
     */
    public boolean consumeSnapRequest() {
        if (!pendingSnap) {
            return false;
        }
        pendingSnap = false;
        return true;
    }

    @Override
    public void close() {
        running = false;
        if (worker != null) {
            worker.interrupt();
        }
        if (tap != null) {
            tap.close();
        }
        sigmaQueue.clear();
        sigmaPending.clear();
        this.levels = null;
    }
}