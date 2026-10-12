package com.jello.music.ui;

import com.jello.music.player.SpectrumFeed;
import javafx.animation.AnimationTimer;
import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.paint.Color;

import java.util.Arrays;

/**
 * 频谱悬浮窗的绘制部分，1:1 复刻原版 {@code src/views/SpectrumHUD.vue}。
 *
 * <h2>关键：条高是绝对像素，不是 0..1 归一化</h2>
 * 原版的公式链是：
 * <pre>
 *   上游 FFT:  levels[i] = sqrt(re*re + im*im)          // Int16 原始量纲，未归一化
 *   平滑:     levels += (targets - levels) * alpha
 *   换算:     refHeight = sqrt(levels[i]) / 12 - 5      // 注意是 sqrt(levels)，二次根
 *   幅度:     height = max(0, refHeight) * sigmaAmp
 * </pre>
 * 所以 {@code levels} 的量纲极大（上限 {@code SPECTRUM_MAX_AMPLITUDE = 2.256e7}），
 * 一次 sqrt 才落回可显示的像素范围。Java 版之前把上游归一化到 0..1 再按比例画彩色柱状图，
 * 完全是另一套东西 —— 这里整体重做。
 *
 * <h2>sigmaAmp 为什么是常量 × scale</h2>
 * 原版注释写明：条形像素高 = refH × (游戏窗口高 / 1080)，
 * 且<b>与频谱窗自身高度无关</b>（窗口只决定可见范围）。
 * 实测游戏窗口 1920x1009，所以 {@code GAME_FRAMEBUFFER_HEIGHT = 1009}，
 * 1.0x 时绝对像素高度与原版一致。
 */
public final class SpectrumView {

    /** 原版 {@code SPECTRUM_BAR_COUNT}：sigmarebase renderSpectrum 的 maxWidth。 */
    public static final int BAR_COUNT = SpectrumFeed.BAR_COUNT;

    /** 原版 {@code SPECTRUM_SMOOTHING}：sigmarebase 60fps 平滑系数，默认 0.335。 */
    public static final double DEFAULT_SMOOTHING = 0.335;

    /**
     * 原版 {@code GAME_FRAMEBUFFER_HEIGHT}：实测游戏窗口高 1920x1009。
     *
     * <p>条形绝对像素高 = refH × (该值 / 1080)，与频谱窗高度无关。
     */
    public static final double GAME_FRAMEBUFFER_HEIGHT = 1009;

    /** 原版底条色 {@code MID_GREY #999999}，alpha = 0.2 × (1 - (i+1)/BAR_COUNT) 渐隐。 */
    private static final Color MID_GREY = Color.web("#999999");

    private final Canvas canvas;
    private final SpectrumFeed feed;

    /** 当前显示值（平滑后的），条高由此算出。 */
    private final double[] levels;
    /** 生产者发来的目标幅度。 */
    private final double[] targets;
    /** 预烘的灰条样式，左→右渐隐，避免每帧 new 对象。 */
    private final Color[] barStyles;

    private double lastDrawTime;
    private AnimationTimer timer;

    private volatile double spectrumScale = 1.0;
    private volatile double spectrumSmoothing = DEFAULT_SMOOTHING;

    public SpectrumView(SpectrumFeed feed, int bands, double width, double height) {
        this.feed = feed;
        this.levels = new double[bands];
        this.targets = new double[bands];
        this.barStyles = new Color[bands];
        for (int i = 0; i < bands; i++) {
            // 原版：rgba(153,153,153, 0.2 * (1 - (i+1)/BAR_COUNT))
            double alpha = 0.2 * (1 - (double) (i + 1) / bands);
            barStyles[i] = new Color(MID_GREY.getRed(), MID_GREY.getGreen(),
                    MID_GREY.getBlue(), alpha);
        }
        this.canvas = new Canvas(width, height);
    }

    public Canvas canvas() {
        return canvas;
    }

    /**
     * 设置频谱幅度（对应原版设置 {@code spectrumScale}，范围 0.2~3）。
     *
     * <p>即时生效，下一帧就用新值，不必重启。
     */
    public void setSpectrumScale(double scale) {
        this.spectrumScale = Double.isFinite(scale) ? scale : 1.0;
    }

    public double spectrumScale() {
        return spectrumScale;
    }

    /**
     * 设置平滑系数（对应原版设置 {@code spectrumSigmaSmoothing}，范围 0.001~1）。
     *
     * <p>原版会夹到 {@code [0.001, 1]}，这里同样处理。
     */
    public void setSpectrumSmoothing(double smoothing) {
        if (!Double.isFinite(smoothing)) {
            return;
        }
        this.spectrumSmoothing = Math.max(0.001, Math.min(1, smoothing));
    }

    public double spectrumSmoothing() {
        return spectrumSmoothing;
    }

    public void start() {
        if (timer != null) {
            return;
        }
        timer = new AnimationTimer() {
            @Override
            public void handle(long now) {
                draw(now);
            }
        };
        timer.start();
    }

    public void stop() {
        if (timer != null) {
            timer.stop();
            timer = null;
        }
    }

    /** 立刻把条形清零并重绘一帧空白（关闭频谱窗 / 暂停时用）。 */
    public void clear() {
        Arrays.fill(levels, 0);
        Arrays.fill(targets, 0);
        GraphicsContext g = canvas.getGraphicsContext2D();
        if (g != null) {
            g.clearRect(0, 0, canvas.getWidth(), canvas.getHeight());
        }
    }

    private void draw(double now) {
        GraphicsContext g = canvas.getGraphicsContext2D();
        if (g == null) {
            return;
        }
        final double w = canvas.getWidth();
        final double h = canvas.getHeight();
        g.clearRect(0, 0, w, h);

        // 帧率补偿，保证不同刷新率下衰减速度一致（原版 dt 逻辑）
        double dt = lastDrawTime > 0 ? Math.min(now - lastDrawTime, 100) : 1000 / 60;
        lastDrawTime = now;

        // ===== 平滑：复刻 sigmarebase onRender2D =====
        // 原版每帧 alpha = min(0.335 * 60 / MinecraftFps, 1)。游戏跑在 300~1100FPS，
        // 实测等效时间常数 τ 稳定在 49.0ms（系数 0.335 → τ = 16.67/0.335 ≈ 49.8ms）。
        // 按 τ 做指数步进，任何刷新率下曲线都与原版一致。
        double tauMs = 1000 / (Math.max(0.001, spectrumSmoothing) * 60);
        double alpha = Math.min(1, 1 - Math.exp(-dt / tauMs));

        double[] data = feed.levels();
        if (data != null) {
            int n = Math.min(targets.length, data.length);
            System.arraycopy(data, 0, targets, 0, n);
        }
        // 换歌 / 恢复播放后第一帧直接复制目标（原版 amplitudes.isEmpty() 分支）
        boolean snap = feed.consumeSnapRequest();
        for (int i = 0; i < levels.length; i++) {
            if (snap) {
                levels[i] = targets[i];
                continue;
            }
            double next = levels[i] + (targets[i] - levels[i]) * alpha;
            levels[i] = Double.isFinite(next)
                    ? Math.max(0, Math.min(SpectrumFeed.MAX_AMPLITUDE, next))
                    : 0;
        }

        // ===== 1:1 复刻 sigmarebase renderSpectrum =====
        // 条宽 ceil(画布宽 / 114)；条高按原版绝对像素高度，不随频谱窗高度缩放
        double sigmaBarWidth = Math.ceil(w / BAR_COUNT);
        double sigmaAmp = (GAME_FRAMEBUFFER_HEIGHT / 1080) * spectrumScale;

        // 预分配每帧高度数组，避免高频 GC
        double[] heights = new double[levels.length];
        for (int i = 0; i < levels.length; i++) {
            double refHeight = Math.sqrt(levels[i]) / 12 - 5;
            heights[i] = Math.min(h, Math.max(0, refHeight) * sigmaAmp);
        }

        // 灰色底条，左→右渐隐
        for (int i = 0; i < BAR_COUNT; i++) {
            double x = i * sigmaBarWidth;
            if (x >= w) {
                break;
            }
            g.setFill(barStyles[i]);
            g.fillRect(x, h - heights[i], sigmaBarWidth, heights[i]);
        }
    }
}