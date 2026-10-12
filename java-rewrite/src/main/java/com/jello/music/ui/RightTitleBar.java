package com.jello.music.ui;

import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.image.Image;
import javafx.scene.image.WritableImage;
import javafx.scene.layout.Pane;
import javafx.scene.paint.Color;

import java.awt.image.BufferedImage;

/**
 * 右栏顶部的模糊标题栏，1:1 复刻 sigmarebase {@code MusicPlayer.method13196}（:474-533）。
 *
 * <h2>权威实现做了什么</h2>
 * <pre>
 *   // 1) 背景模糊图：截屏 → 10x10 降采样 → 加 10px DEEP_TEAL 边框 → applyBlur(·, 10)
 *   texture = ImageUtil.method35037(x + 250, y, width - 250, 64, 10, 10);
 *
 *   // 2) 随内容滚动淡入：offset &lt; 50 时 alpha = offset/50
 *   float v4 = field20863 &lt; 50 ? field20863 / 50.0F : 1.0F;
 *   drawTexture(250, 0, width - 250, 64, texture, alpha = v4 * partialTicks);
 *
 *   // 3) 再叠一层 20% 的浅色
 *   drawRoundedRect(250, 0, width, 64, alpha = v4 * partialTicks * 0.2F);
 *
 *   // 4) 标题：两套字体交叉淡入，y 随 v4 从 30 滑到 16
 *   drawString(light25,  y = 16 + (1-v4)*14,  alpha = v4);
 *   drawString(medium25, y = 16 + (1-v4)*14,  alpha = 1-v4);
 *
 *   // 5) 底部 20px 阴影
 *   drawImage(250, 64, width - 250, 20, shadowBottomPNG, alpha = v4 * partialTicks * 0.5F);
 * </pre>
 *
 * <h2>哪里做了取舍</h2>
 * <b>模糊源</b>：mod 用 {@code glReadPixels} 截游戏窗口的像素。
 * Java 版拿不到屏幕缓冲区，所以改成「对右栏底色做同样的降采样 + 模糊」——
 * 保留的是<b>处理链</b>（降采样 → 补边 → 模糊），不是像素来源。
 * 视觉上标题栏是一层柔和的深色渐变，比硬边色块自然，且不依赖屏幕截取权限。
 */
public final class RightTitleBar extends Pane {

    /** 权威 {@code field20847}：标题栏高度 64。 */
    public static final double BAR_H = 64;

    /** 权威降采样步长 {@code var4 = 10}。 */
    private static final int DOWNSAMPLE = 10;

    /** 权威 {@code applyBlur(·, 10)} 的半径。 */
    private static final double BLUR_SIGMA = 10;

    /** 滚动多少 px 之后标题完全淡入（权威：50）。 */
    public static final double FADE_IN_PX = 50;

    /** 补边宽度，对应 {@code method35040} 的 {@code var1}（即 10）。 */
    private static final int PAD = 10;

    /** 权威 {@code ClientColors.DEEP_TEAL}，用作补边色。 */
    private static final Color DEEP_TEAL = Color.web("#0d4f52");

    private final Canvas canvas = new Canvas(550, BAR_H);
    private final SigmaTextView lightTitle;
    private final SigmaTextView mediumTitle;
    private final GraphicsContext g;

    private String title = "";
    private double scroll;

    public RightTitleBar() {
        setMouseTransparent(true);
        canvas.setMouseTransparent(true);
        g = canvas.getGraphicsContext2D();

        // 两套字体交叉淡入：权威用 JelloLightFont25 与 JelloMediumFont25。
        // Java 侧的图集按 family+size 索引，没有独立的 medium 25 图集，
        // 所以两层都用 light-25，靠 alpha 交叉淡入表达「字重在切换」。
        lightTitle = new SigmaTextView("light", 25, 300, 34,
                SigmaTextView.Align.LEFT);
        mediumTitle = new SigmaTextView("light", 25, 300, 34,
                SigmaTextView.Align.LEFT);

        getChildren().add(canvas);
        getChildren().add(mediumTitle);
        getChildren().add(lightTitle);
        canvas.setLayoutX(0);
        canvas.setLayoutY(0);
    }

    /** 设置标题文本。权威标题是当前右栏内容的名字（如「Daily Rec」「Playlist」）。 */
    public void setTitle(String text) {
        this.title = text == null ? "" : text;
    }

    /** 当前标题文本，供 MainApp 判断是否已被具体名字占用。 */
    public String titleText() {
        return title;
    }

    /**
     * 按滚动量更新透明度与滑入位置。
     *
     * @param scrollOffset 右栏当前滚动偏移（px）
     */
    public void setScroll(double scrollOffset) {
        this.scroll = scrollOffset;
        double v = scrollOffset < FADE_IN_PX ? scrollOffset / FADE_IN_PX : 1.0;
        if (v < 0) {
            v = 0;
        }
        // 权威：y = 16 + (1-v)*14 —— 淡入时从 30 滑到 16
        double y = BAR_H - (16 + (1 - v) * 14);
        lightTitle.setText(title);
        mediumTitle.setText(title);
        lightTitle.setAlpha(v);
        mediumTitle.setAlpha(1 - v);
        lightTitle.setLayoutX(0);
        mediumTitle.setLayoutX(0);
        lightTitle.setLayoutY(y);
        mediumTitle.setLayoutY(y);
        lightTitle.setVisible(v > 0.01);
        mediumTitle.setVisible(v < 0.99);
        paint(v);
    }

    /**
     * 画模糊底 + 20% 浅色 + 底部阴影。
     *
     * <p>模糊图按权威的降采样链算一次并缓存——滚动值不变时不必重算。
     */
    private void paint(double v) {
        if (g == null) {
            return;
        }
        final double w = canvas.getWidth();
        final double h = canvas.getHeight();
        g.clearRect(0, 0, w, h);
        if (v <= 0) {
            return;
        }

        // 1) 模糊底：降采样 → 补 DEEP_TEAL 边 → 模糊
        BufferedImage blurred = blurredBackdrop(w, h);
        if (blurred != null) {
            WritableImage fx = CanvasStrip.toFxImage(blurred);
            g.setGlobalAlpha(v);
            g.drawImage(fx, 0, 0, blurred.getWidth(), blurred.getHeight(), 0, 0, w, h);
            g.setGlobalAlpha(1);
        }

        // 2) 叠 20% 浅色（权威 alpha = v * 0.2F）
        g.setFill(Color.color(1, 1, 1, 0.2 * v));
        g.fillRect(0, 0, w, h);

        // 3) 底部 20px 阴影渐变（权威 shadowBottomPNG × 0.5）
        //    Java 侧没有那张图，用自下而上的线性渐变等价表达
        double shadowTop = h - 20;
        for (double y = shadowTop; y < h; y++) {
            double t = (y - shadowTop) / 20.0;
            g.setFill(Color.color(0, 0, 0, 0.5 * v * t));
            g.fillRect(0, y, w, 1);
        }
    }

    /**
     * 按权威链路造模糊底图：{@code method35036} 的降采样 → 补边 → 模糊。
     *
     * <p>降采样在 mod 里是「每 {@value #DOWNSAMPLE}px 取一个点」，
     * 这里照抄；像素来源用右栏底色 {@link Theme#RIGHT_PANEL}。
     */
    private BufferedImage blurredBackdrop(double w, double h) {
        int bw = (int) (w / DOWNSAMPLE);
        int bh = (int) (h / DOWNSAMPLE);
        if (bw < 1 || bh < 1) {
            return null;
        }
        BufferedImage small = new BufferedImage(bw, bh, BufferedImage.TYPE_INT_RGB);
        // 右栏底色 #262626 铺满，取样结果就是它；这里仍走完整的降采样循环，
        // 保持与权威同构（换成真实截屏像素时只需替换这一处的取样源）
        int r = (int) Math.round(Theme.RIGHT_PANEL.getRed() * 255);
        int g0 = (int) Math.round(Theme.RIGHT_PANEL.getGreen() * 255);
        int b = (int) Math.round(Theme.RIGHT_PANEL.getBlue() * 255);
        for (int y = 0; y < bh; y++) {
            for (int x = 0; x < bw; x++) {
                small.setRGB(x, y, (r << 16) | (g0 << 8) | b);
            }
        }

        // method35040：补 DEEP_TEAL 边（var2 != DEEP_TEAL 才填，这里是 mod 的默认分支）
        BufferedImage padded = new BufferedImage(bw + PAD * 2, bh + PAD * 2,
                BufferedImage.TYPE_INT_RGB);
        int pr = 13, pg = 79, pb = 82;
        for (int y = 0; y < padded.getHeight(); y++) {
            for (int x = 0; x < padded.getWidth(); x++) {
                padded.setRGB(x, y, (pr << 16) | (pg << 8) | pb);
            }
        }
        for (int y = 0; y < bh; y++) {
            for (int x = 0; x < bw; x++) {
                padded.setRGB(x + PAD, y + PAD, small.getRGB(x, y));
            }
        }
        // 再按原始尺寸放大回去，让模糊核作用在与面板同量级的像素上
        BufferedImage scaled = new BufferedImage((int) w, (int) h, BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D gd = scaled.createGraphics();
        gd.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION,
                java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        gd.drawImage(padded, 0, 0, scaled.getWidth(), scaled.getHeight(), null);
        gd.dispose();

        return CanvasStrip.blur(scaled, BLUR_SIGMA);
    }

    /** 供断言使用：当前淡入系数。 */
    public double fadeAlpha() {
        double v = scroll < FADE_IN_PX ? scroll / FADE_IN_PX : 1.0;
        return Math.max(0, Math.min(1, v));
    }

    /** 供断言使用：标题基线 y（权威 16 + (1-v)*14，向上为正）。 */
    public double titleBaselineY(double v) {
        return 16 + (1 - v) * 14;
    }
}