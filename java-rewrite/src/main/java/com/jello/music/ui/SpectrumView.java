package com.jello.music.ui;

import com.jello.music.player.SpectrumFeed;
import javafx.animation.AnimationTimer;
import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.paint.Color;

import java.util.Arrays;

/**
 * 频谱悬浮窗的绘制部分，1:1 复刻 sigmarebase {@code MusicManager.renderSpectrum()}（:171-240）。
 *
 * <h2>条高是绝对像素，不是 0..1 归一化</h2>
 * 权威公式（{@code MusicManager.java:181}）：
 * <pre>
 *   height = (float)(Math.sqrt(amplitudes.get(i)) / 12.0) - 5.0F) * heightRatio
 *   heightRatio = 游戏窗口高 / 1080.0F
 * </pre>
 * 幅度上限 {@code 2.256E7}，所以要先开方才落回像素范围。
 * <b>上游任何归一化 / 分箱 / 加窗都会让条高整体不对。</b>
 *
 * <h2>平滑是插值，不是指数</h2>
 * {@code onRender2D}（:144-151）：
 * <pre>
 *   float fps = 60.0F / Minecraft.getFps();
 *   alpha = min(0.335F * fps, 1.0F);
 *   amplitudes[i] = min(2.256e7, max(0, amplitudes[i] - (amplitudes[i]-target)*alpha));
 * </pre>
 * 系数随实际帧率反向补偿：游戏跑得越快，alpha 越小，单帧步进越细。
 * Java 侧没有 {@code Minecraft.getFps()}，用画布实测帧率代替（见 {@link #fps}）。
 */
public final class SpectrumView {

    /** 渲染条数，对应 {@code renderSpectrum} 的 {@code maxWidth = 114.0F}。 */
    public static final int BAR_COUNT = SpectrumFeed.BAR_COUNT;

    /** {@code onRender2D} 的默认平滑系数 0.335F（60fps 下）。 */
    public static final double DEFAULT_SMOOTHING = 0.335;

/**
 * 高度比基准：{@code heightRatio = REFERENCE_HEIGHT / 1080}。
 *
 * <h2>为什么不是 1080（mod 的原始值）</h2>
 * mod 画在<b>整个游戏窗口</b>底部（{@code mc.getMainWindow().getHeight()}），
 * 1080p 下 {@code heightRatio} 恰好 = 1.0，实测最满条约 220px，
 * 占全窗高度约 20%——看着舒服。
 *
 * <p>但本项目的频谱窗只有 420x130，扣掉信息块只剩约 108px 可用。
 * 沿用 1080 会让 1.0x 直接顶满甚至溢出（实测 207px vs 108px 可用 = 192%），
 * 条形被窗口顶截断、2.0x 更是完全看不见。
 *
 * <p>所以这里标定成「1.0x 时最满条约占可用高度的一半」，
 * 让 {@code spectrumScale} 的 0.2~3 正好覆盖「几乎贴地 ~ 顶满并溢出」，
 * 动态范围落在可用空间里。实测依据见 {@code SpectrumProbe}。
 */
    public static final double REFERENCE_HEIGHT = 290;

    /** {@code 2.256E7}：sigmarebase amplitudes 的钳位上限。 */
    public static final double MAX_AMPLITUDE = SpectrumFeed.MAX_AMPLITUDE;

    /** 底条颜色 {@code ClientColors.MID_GREY}，alpha = {@code 0.2F * alphaValue}。 */
    private static final Color MID_GREY = Color.web("#999999");

    private final Canvas canvas;
    private final SpectrumFeed feed;

    /** 当前显示值（平滑后的），条高由此算出。 */
    private final double[] amplitudes;
    /** 生产者发来的目标幅度。 */
    private final double[] targets;
    /** 预烘的灰条样式，左→右渐隐，避免每帧 new 对象。 */
    private final Color[] barStyles;

    private AnimationTimer timer;

    private volatile double spectrumScale = 1.0;
    private volatile double spectrumSmoothing = DEFAULT_SMOOTHING;

    /** 实测帧率，供 alpha 的帧率补偿用（对应 {@code Minecraft.getFps()}）。 */
    private double fps = 60.0;
    private long lastFrameNanos;

    /** 封面叠加图（模糊后取底部 20%，对应 {@code songThumbnail}）。 */
    private volatile javafx.scene.image.Image overlayImage;
    private volatile javafx.scene.image.Image coverImage;

    public SpectrumView(SpectrumFeed feed, int bands, double width, double height) {
        this.feed = feed;
        this.amplitudes = new double[bands];
        this.targets = new double[bands];
        this.barStyles = new Color[bands];
        for (int i = 0; i < bands; i++) {
            // 权威：alphaValue = 1 - (i+1)/maxWidth，底条 alpha = 0.2 * alphaValue
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
     * 设置频谱幅度缩放（用户设置 {@code spectrumScale}，范围 0.2~3）。
     *
     * <p>原版没有这个开关，它是 Electron 版加的乘数，这里保留。
     */
    public void setSpectrumScale(double scale) {
        this.spectrumScale = Double.isFinite(scale) ? scale : 1.0;
    }

    public double spectrumScale() {
        return spectrumScale;
    }

    /** 设置平滑系数（用户设置 {@code spectrumSigmaSmoothing}），覆盖默认 0.335。 */
    public void setSpectrumSmoothing(double smoothing) {
        if (!Double.isFinite(smoothing)) {
            return;
        }
        this.spectrumSmoothing = Math.max(0.001, Math.min(1, smoothing));
    }

    public double spectrumSmoothing() {
        return spectrumSmoothing;
    }

    /** 设置封面，驱动信息块与条形叠加层。 */
    public void setCover(javafx.scene.image.Image cover, javafx.scene.image.Image blurredStrip) {
        this.coverImage = cover;
        this.overlayImage = blurredStrip;
    }

    public javafx.scene.image.Image coverImage() {
        return coverImage;
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

    /** 立刻把条形清零并重绘空白（关闭频谱窗 / 暂停时用）。 */
    public void clear() {
        Arrays.fill(amplitudes, 0);
        Arrays.fill(targets, 0);
        GraphicsContext g = canvas.getGraphicsContext2D();
        if (g != null) {
            g.clearRect(0, 0, canvas.getWidth(), canvas.getHeight());
        }
    }

    /**
     * 封面缩放：低频越猛，封面弹得越大。
     *
     * <p>权威 {@code MusicManager.java:207-213}：
     * <pre>
     *   double var9 = max( sqrt(amplitudes[i]) - 1000 )  for i in 0..2
     *   float scale = 1.0F + round( var9 / (4750-1000) * 0.14F * 75 ) / 75
     * </pre>
     * 取整到 1/75 的档位，所以是「跳变」而不是连续缩放——
     * 少了这层取整，封面会随低频连续抖，看着廉价。
     */
    public static double coverScale(double[] amplitudes) {
        double peak = 0;
        for (int i = 0; i < 3 && i < amplitudes.length; i++) {
            peak = Math.max(peak, Math.sqrt(amplitudes[i]) - 1000.0);
        }
        if (peak <= 0) {
            return 1.0;
        }
        double raw = 1.0 + Math.round(peak / 3750.0 * 0.14 * 75.0) / 75.0;
        // 上限 1 + 0.14 = 1.14，peak 超过 3750 后不再继续放大
        return Math.min(1.14, raw);
    }

    private void draw(long now) {
        GraphicsContext g = canvas.getGraphicsContext2D();
        if (g == null) {
            return;
        }
        final double w = canvas.getWidth();
        final double h = canvas.getHeight();
        g.clearRect(0, 0, w, h);

        // ---- 帧率实测，对应 Minecraft.getFps() ----
        if (lastFrameNanos > 0) {
            double deltaSec = (now - lastFrameNanos) / 1_000_000_000.0;
            if (deltaSec > 0 && deltaSec < 1.0) {
                // 指数平滑，避免单帧抖动把 alpha 甩飞
                fps = fps * 0.9 + (1.0 / deltaSec) * 0.1;
            }
        }
        lastFrameNanos = now;

        // ===== 平滑：复刻 onRender2D =====
        // fps = 60 / 实际FPS；alpha = min(smoothing * fps, 1)
        double frameRateComp = 60.0 / Math.max(1.0, fps);
        double alpha = Math.min(1.0, Math.max(0.001, spectrumSmoothing) * frameRateComp);

        double[] data = feed.levels();
        if (data != null) {
            int n = Math.min(targets.length, data.length);
            System.arraycopy(data, 0, targets, 0, n);
        }
        boolean snap = feed.consumeSnapRequest();
        for (int i = 0; i < amplitudes.length; i++) {
            if (snap || amplitudes[i] == 0) {
                // 对应 if (amplitudes.isEmpty()) amplitudes = targets
                amplitudes[i] = targets[i];
                continue;
            }
            double next = amplitudes[i] - (amplitudes[i] - targets[i]) * alpha;
            amplitudes[i] = Double.isFinite(next)
                    ? Math.min(MAX_AMPLITUDE, Math.max(0.0, next))
                    : 0.0;
        }

        // ===== renderSpectrum 复刻 =====
        double barWidth = Math.ceil(w / BAR_COUNT);
        double heightRatio = (REFERENCE_HEIGHT / 1080.0) * spectrumScale;

        double[] heights = new double[amplitudes.length];
        for (int i = 0; i < amplitudes.length; i++) {
            double refHeight = Math.sqrt(amplitudes[i]) / 12.0 - 5.0;
            heights[i] = Math.max(0, refHeight) * heightRatio;
        }

        // 1) 灰底条，左→右渐隐
        for (int i = 0; i < BAR_COUNT; i++) {
            double x = i * barWidth;
            if (x >= w) {
                break;
            }
            g.setFill(barStyles[i]);
            g.fillRect(x, h - heights[i], barWidth, heights[i]);
        }

        // 2) 条形内叠加模糊封面，alpha 0.4。
        //    原版走 OpenGL stencil（initStencilBuffer → configureStencilTest → drawImage），
        //    JavaFX 没有 stencil；这里改成「逐条按条形区域绘制」达到同样效果，
        //    避免为了一个 clip 引入 Path。
        javafx.scene.image.Image overlay = overlayImage;
        if (overlay != null && overlay.getWidth() > 0 && overlay.getException() == null) {
            g.save();
            g.setGlobalAlpha(0.4);
            for (int i = 0; i < BAR_COUNT; i++) {
                double x = i * barWidth;
                if (x >= w) {
                    break;
                }
                if (heights[i] > 0) {
                    g.drawImage(overlay, x, h - heights[i], barWidth, heights[i]);
                }
            }
            g.restore();
        }
    }
}