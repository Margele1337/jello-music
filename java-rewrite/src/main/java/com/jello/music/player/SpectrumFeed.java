package com.jello.music.player;

import java.io.IOException;
import java.util.function.DoubleSupplier;

/**
 * 把 {@link SpectrumTap} 放到后台线程持续取频谱，供 UI 线程安全读取。
 *
 * <p>{@code SpectrumTap.nextRawFrame()} 是阻塞的（一帧一个 MP3 帧约 26ms），
 * 绝不能放在 JavaFX 的 UI 线程里调用，否则界面会卡顿。
 *
 * <h2>队列：为什么是「取队首」而不是「取最新一帧」</h2>
 * sigmarebase（{@code MusicManager.java:398-407}）每解完一帧就往
 * {@code visualizerData} 追加一份幅度谱，超过 <b>18</b> 帧就 {@code remove(0)}，
 * 渲染端 {@code onRender2D} 永远读 {@code get(0)}——也就是队首。
 *
 * <p>所以画面<b>滞后</b>于解码：18 帧 × 26.12ms ≈ 470ms。
 * 这个滞后是原版观感的组成部分（画面拖在声音后面一段），
 * 不是 bug，所以这里照抄 18，而不是为了「跟手」去缩短它。
 *
 * <h2>线程安全</h2>
 * UI 侧读的是 {@link #levels}（volatile 引用，指向不可变数组），
 * 后台写的是 {@link #rawFrame} 与队列内部状态。
 */
public final class SpectrumFeed implements AutoCloseable {

    /** 渲染条数，与 sigmarebase {@code renderSpectrum} 的 {@code maxWidth = 114.0F} 一致。 */
    public static final int BAR_COUNT = 114;

    /**
     * FFT 长度。
     *
     * <p><b>为什么是 1024 而不是「一个 MP3 帧的 1152 采样」</b>：
     * mod 的 {@code MusicManager:398} 写的是 {@code new JavaFFT(var29.length)}，
     * 而 {@code var29} 是一个 MP3 帧的 1152 个采样。但 1152 = 128 × 9
     * <b>不是 2 的幂</b>，而 radix-2 FFT 只接受 2 的幂——mod 的
     * {@code JavaFFT.transform}（:89）同样是 {@code blockSize <<= 1} 的
     * Cooley-Tukey，所以那条路在 mod 里其实也跑不通。
     *
     * <p>取 1024：最接近 1152 的 2 的幂，只少 128 个采样（一帧 1152 vs 1024，
     * 差 11%，对频谱形态没有可见影响），且与 Electron 版
     * {@code SPECTRUM_FFT_SIZE} 一致。
     */
    public static final int FFT_SIZE = 1024;

    /**
     * 队列上限，对应 {@code MusicManager.java:405-407} 的
     * {@code if (visualizerData.size() > 18) visualizerData.remove(0)}。
     */
    private static final int QUEUE_MAX = 18;

    /** sigmarebase {@code onRender2D} 里 {@code amplitudes} 的长度上限（:138-140）。 */
    public static final int AMPLITUDE_MAX = 1024;

    /** 原版 {@code 2.256E7}：sigmarebase amplitudes 的钳位上限（:149）。 */
    public static final double MAX_AMPLITUDE = 2.256e7;

    /** 暂停时清队列的轮询间隔，对应 {@code while(!playing){ Thread.sleep(300L); ... }}（:372-374）。 */
    private static final long PAUSE_POLL_MILLIS = 300;

    private final SpectrumTap tap;
    private final java.util.ArrayDeque<double[]> queue = new java.util.ArrayDeque<>(QUEUE_MAX);
    private volatile double[] levels;
    private volatile double[] rawFrame;
    private volatile boolean running = true;
    private volatile boolean playing = true;
    private volatile String error;
    private final int bandCount;
    private final Thread worker;

    /** 频谱相对播放位置领先的秒数（对应原版预读 Audio 的 leadMs）。 */
    private volatile double leadSeconds;

    /**
     * 播放位置来源（秒）。
     *
     * <p>为 null 时频谱只能顺序解码，没有参照系也就谈不上音画差对齐——
     * {@code MainApp} 会把 {@code MediaPlayer.getCurrentTime()} 接进来。
     */
    private volatile DoubleSupplier playbackPosition;

    /** 换歌后豁免一次重定位（见 {@link #resetAlignment()}）。 */
    private volatile boolean skipResyncOnce;

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

        this.worker = new Thread(() -> {
            while (running) {
                if (!playing) {
                    // 权威实现：暂停时在 while 循环里 sleep(300) 并 clear()，
                    // 所以是「最多 300ms 内清空」，不是立刻清。这里照抄这个节奏。
                    clearForPause();
                    try {
                        Thread.sleep(PAUSE_POLL_MILLIS);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                    continue;
                }
                try {
                    realignToPlayback();
                    double[] frame = tap.nextRawFrame();
                    if (frame == null) {
                        // 流结束
                        break;
                    }
                    this.rawFrame = frame;
                    // 整份幅度谱入队（对应 visualizerData.add），
                    // 渲染端只取前 114 个，不是分箱
                    double[] b = SpectrumTap.takeBins(frame, bandCount);
                    queue.addLast(b);
                    while (queue.size() > QUEUE_MAX) {
                        queue.pollFirst();
                    }
                    // 渲染端读 get(0)：永远是队首
                    this.levels = queue.peekFirst();
                } catch (Exception e) {
                    this.error = e.getMessage();
                    break;
                }
            }
        }, "spectrum-feed");
        this.worker.setDaemon(true);
        this.worker.start();
    }

    /** 暂停时清空队列（对应 {@code visualizerData.clear()}）。 */
    private void clearForPause() {
        queue.clear();
        this.levels = null;
    }

    /**
     * 让频谱的解码位置跟上「播放位置 + 领先量」。
     *
     * <p>1:1 对应原版 {@code syncLookahead}（{@code AudioController.js:106-124}）：
     * <pre>
     *   const expected = currentTime + lookaheadLeadMs / 1000;
     *   if (force || Math.abs(lookahead.currentTime - expected) > 0.08)
     *       lookahead.currentTime = expected;
     * </pre>
     *
     * <p>差别在于「怎么跳」：原版给一个真实的 Audio 元素设 {@code currentTime}，
     * 浏览器负责 seek；Java 侧的旁路流是自己拉、自己解的，
     * 所以改成按字节偏移重开一条 Range 请求（见 {@link SpectrumTap#seekToSeconds}）。
     *
     * <p><b>为什么默认 590ms 是「领先」而不是「落后」</b>：解码比播放快，
     * 顺序拉流会一路跑到播放位置前面；这个偏移量就是把这个「天然领先」
     * 拉回到 sigmarebase 实测的音画差上（原版注释：画面领先声音 421.7ms）。
     */
    private void realignToPlayback() {
        if (tap == null) {
            return;
        }
        if (skipResyncOnce) {
            skipResyncOnce = false;
            return;
        }
        DoubleSupplier pos = playbackPosition;
        if (pos == null) {
            // 没有播放位置来源（例如还没开始播放）：只能顺序解码，
            // 此时频谱会一路领先，与真实播放位置脱节——这是没有参照系的必然结果
            return;
        }
        double current;
        try {
            current = pos.getAsDouble();
        } catch (RuntimeException e) {
            return;
        }
        if (!Double.isFinite(current) || current < 0) {
            return;
        }
        double expected = current + leadSeconds;
        double drift = tap.decodedSeconds() - expected;
        if (Math.abs(drift) <= RESYNC_TOLERANCE_SECONDS) {
            return;
        }
        // 只往后跳，不往回跳：已经解出来的帧不能「撤销」，
        // 强行回到过去只会把顺序解码打乱，收益也不明显
        if (drift < 0) {
            return;
        }
        if (tap.seekToSeconds(expected)) {
            // 跳完清队列：队列里是跳转前的旧帧，留着会让画面「倒带」一下
            queue.clear();
            this.levels = null;
        }
    }

    /** 与原版的 0.08s 容差一致：偏差小就不动，避免频繁重开连接。 */
    private static final double RESYNC_TOLERANCE_SECONDS = 0.08;

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

    /**
     * 绑定播放位置来源。
     *
     * <p>有了它 {@link #realignToPlayback()} 才能把解码位置对齐到
     * 「播放位置 + 领先量」，也就是原版 {@code syncLookahead} 的等价物。
     * 传 null 退回纯顺序解码。
     */
    public void setPlaybackPosition(DoubleSupplier position) {
        this.playbackPosition = position;
    }

    /**
     * 播放 / 暂停切换。对应 sigmarebase 里的
     * {@code while (!playing) { Thread.sleep(300L); visualizerData.clear(); }}。
     *
     * <p>恢复播放时置 {@code pendingSnap}，渲染端下一帧直接复制目标不做渐变，
     * 对应 {@code onRender2D} 里的 {@code if (amplitudes.isEmpty()) amplitudes = targets}。
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
     * 渲染端是否应当「吸附」——恢复播放后的第一帧直接复制目标。
     *
     * <p>对应 {@code onRender2D} 里 {@code if (amplitudes.isEmpty())} 的分支。
     * 这里返回后即清位，保证只有一帧生效。
     */
    public boolean consumeSnapRequest() {
        if (!pendingSnap) {
            return false;
        }
        pendingSnap = false;
        return true;
    }

    /** 队列当前长度，供断言与诊断用。 */
    public int queueSize() {
        return queue.size();
    }

    /** 队列上限，对应 {@code visualizerData} 的 18 帧。 */
    public static int queueMax() {
        return QUEUE_MAX;
    }

    /**
     * 放弃当前对齐，下一帧不重定位。
     *
     * <p>换歌后用：新的直链从头解，而播放位置可能已经不在 0，
     * 若还拿旧的对齐基准去跳会跳错位置。跳一次之后这条豁免就失效，
     * 之后仍按「播放位置 + 领先量」正常跟随。
     */
    public void resetAlignment() {
        this.skipResyncOnce = true;
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
        queue.clear();
        this.levels = null;
    }
}