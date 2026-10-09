package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.paint.Color;
import com.jello.music.player.SpectrumFeed;

/**
 * 频谱柱状图（Canvas 自绘），对应原 Vue 版 {@code SpectrumHUD} 的柱状展示。
 *
 * <p>绘制放在 {@link AnimationTimer} 里跟随 vsync，60fps 上限。
 * 视觉参数对齐原版：低频在左、高频在右，柱体从底部生长并带轻微圆角。
 */
public final class SpectrumView {

    private final Canvas canvas;
    private final SpectrumFeed feed;
    private final int bands;
    private AnimationTimer timer;

    // 颜色取自原 CSS 变量 --primary-color / --secondary-color
    private static final Color BAR_LOW = Color.web("#1a9aba");
    private static final Color BAR_HIGH = Color.web("#44d9e6");

    public SpectrumView(SpectrumFeed feed, int bands, double width, double height) {
        this.feed = feed;
        this.bands = bands;
        this.canvas = new Canvas(width, height);
    }

    public Canvas canvas() {
        return canvas;
    }

    public void start() {
        if (timer != null) {
            return;
        }
        timer = new AnimationTimer() {
            private long lastNanos = 0;

            @Override
            public void handle(long now) {
                // 限制到约 60fps，避免高刷屏上做无谓的重绘
                if (lastNanos != 0 && now - lastNanos < 16_000_000L) {
                    return;
                }
                lastNanos = now;
                draw();
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

    private void draw() {
        GraphicsContext g = canvas.getGraphicsContext2D();
        double w = canvas.getWidth();
        double h = canvas.getHeight();
        g.clearRect(0, 0, w, h);

        double[] data = feed.bands();
        if (data == null) {
            return;
        }

        double gap = 2.0;
        double barW = (w - gap * (bands - 1)) / bands;
        for (int i = 0; i < bands && i < data.length; i++) {
            double v = Math.max(0, Math.min(1, data[i]));
            double barH = Math.max(2, v * (h - 4));
            double x = i * (barW + gap);
            double y = h - barH;

            // 低频偏主色，高频偏青色，与原版色相走向一致
            double t = (double) i / Math.max(1, bands - 1);
            // JavaFX 的插值方法是 interpolate，不是 lerp
            g.setFill(BAR_LOW.interpolate(BAR_HIGH, t));
            g.fillRoundRect(x, y, barW, barH, 2, 2);
        }
    }
}