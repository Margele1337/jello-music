package com.jello.music.ui;

import javafx.scene.control.Label;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.layout.Pane;
import javafx.scene.paint.Color;
import javafx.scene.shape.Rectangle;

/**
 * 频谱窗左下角的信息块，1:1 复刻 sigmarebase {@code MusicManager.renderSpectrum()}
 * 的 :215-240 一段。
 *
 * <p>权威实现：
 * <pre>
 *   GL11.glTranslated(60.0, H - 55, 0.0);
 *   GL11.glScalef(scale, scale, 0.0F);
 *   GL11.glTranslated(-60.0, -(H - 55), 0.0);
 *   drawImage(10, H - 110, 100, 100, notificationImage);
 *   drawRoundedRect(10, H - 110, 100, 100, 14.0F, 0.3F);
 *   drawString(130, H - 70, title);
 * </pre>
 *
 * <p>注意缩放锚点是 <b>(60, H-55)</b> 而不是封面自己的中心 (60, H-60)——
 * 锚点低 5px，所以放大时封面会略微往上顶。JavaFX 的 {@code Scale} 默认绕中心，
 * 这里用 {@code setScaleX/Y} + {@code layoutX/Y} 补偿，绕 (60, H-55) 缩放。
 *
 * <p>歌名用 {@code JelloLightFont18}，原版叠了两层（深青 0.5 + 浅色 0.7）做描边。
 * Java 侧同样叠两层 Label。
 */
public final class SpectrumInfoBlock extends Pane {

    /** 封面尺寸（权威：100x100）。 */
    private static final double COVER = 100;

    /** 封面圆角（权威：14.0F）。 */
    private static final double COVER_RADIUS = 14;

    /** 封面横向位置（权威：x=10）。 */
    private static final double COVER_X = 10;

    /**
     * 封面纵向位置（权威：y = H - 110）。
     *
     * <p>权威坐标系原点在<b>左上角</b>、y 向下为正；JavaFX 原点在<b>左下角</b>、y 向上为正，
     * 所以同一位置在 JavaFX 里是 {@code -(H - 110)} = {@code 110 - H}。
     */
    private static final double COVER_Y_OFFSET = 110;

    /** 缩放锚点（权威：glTranslated(60, H-55)）。 */
    private static final double ANCHOR_X = 60;
    private static final double ANCHOR_Y_OFFSET = 55;

    /** 歌名横向位置（权威：x=130）。 */
    private static final double TITLE_X = 130;

    /**
     * 歌名纵向位置（权威：y = H - 70）。
     *
     * <p>同 {@link #COVER_Y_OFFSET}，坐标系换算后是 {@code 70 - H}。
     */
    private static final double TITLE_Y_OFFSET = 70;

    private final ImageView coverView;
    private final Rectangle coverMask;
    private final Rectangle coverBorder;
    private final Label titleShadow;
    private final Label title;

    /** 低频缩放带来的平移量，由 {@link #applyScale} 算、{@link #reposition()} 用。 */
    private double scaleOffsetX;
    private double scaleOffsetY;

    public SpectrumInfoBlock() {
        setMouseTransparent(true);

        coverView = new ImageView();
        coverView.setFitWidth(COVER);
        coverView.setFitHeight(COVER);
        coverView.setPreserveRatio(true);
        coverView.setSmooth(true);

        // 圆角遮罩：JavaFX 没有 drawRoundedRect，用带圆角的裁剪。
        // clip 走的是被裁剪节点自己的坐标系（原点左上、y 向下），
        // 而 coverView 在 JavaFX 场景里原点在左下——JavaFX 会自动翻转 clip，
        // 所以这里按 100x100 居中放即可，不用手动换算。
        coverMask = new Rectangle(COVER, COVER);
        coverMask.setArcWidth(COVER_RADIUS * 2);
        coverMask.setArcHeight(COVER_RADIUS * 2);
        coverView.setClip(coverMask);

        // 直接挂 ImageView，不用 StackPane：StackPane 的 CENTER 对齐会覆盖
        // layoutX/layoutY，而低频缩放要精确控制偏移。
        getChildren().add(coverView);

        // 描边：对应原版 drawRoundedRect(..., 0.3F)
        coverBorder = new Rectangle(COVER, COVER);
        coverBorder.setArcWidth(COVER_RADIUS * 2);
        coverBorder.setArcHeight(COVER_RADIUS * 2);
        coverBorder.setFill(Color.TRANSPARENT);
        coverBorder.setStroke(Color.color(1, 1, 1, 0.3));
        coverBorder.setStrokeWidth(1.5);
        coverBorder.setMouseTransparent(true);
        getChildren().add(coverBorder);

        // 歌名：两层叠加做描边（原版 DEEP_TEAL 0.5 + LIGHT_GREYISH_BLUE 0.7）
        titleShadow = makeTitleLabel(Color.web("#0d4f52", 0.5));
        title = makeTitleLabel(Color.web("#e6e3ee", 0.7));
        getChildren().add(titleShadow);
        getChildren().add(title);

        // 尺寸变了要重排：坐标依赖高度（H - 110 之类）
        widthProperty().addListener((o, was, now) -> reposition());
        heightProperty().addListener((o, was, now) -> reposition());
    }

    private Label makeTitleLabel(Color fill) {
        Label l = new Label();
        l.setFont(Assets.light(18));
        l.setTextFill(fill);
        l.setMouseTransparent(true);
        return l;
    }

    public void setCover(Image img) {
        coverView.setImage(img);
    }

    /**
     * 设置歌名。
     *
     * <p>权威按 {@code songTitle.split(" - ")} 分两行画（:222-240），
     * 这里合成一个 Label 里换行。
     */
    public void setTitle(String songTitle) {
        String text;
        if (songTitle == null || songTitle.isBlank()) {
            text = "";
        } else {
            String[] parts = songTitle.split(" - ");
            if (parts.length <= 1) {
                text = parts[0].isEmpty() ? "Jello Music" : parts[0];
            } else {
                text = parts[1] + "\n" + parts[0];
            }
        }
        title.setText(text);
        titleShadow.setText(text);
    }

/**
     * 按当前高度重新定位子节点。
     *
     * <p><b>为什么不覆写 {@code layoutChildren}</b>：JavaFX 里
     * {@code Parent.layout()} 与 {@code Region.layoutChildren()} <b>都是 final</b>，
     * 想按自定义规则摆子节点只能自己监听尺寸变化后手动 {@code resizeRelocate}。
     * {@link javafx.scene.layout.Pane} 的自动布局只认 {@code managed} 子节点的
     * 布局约束，这里三个子节点都要精确到像素，不交给它管。
     */
    private void reposition() {
        double h = getHeight() > 0 ? getHeight() : getPrefHeight();
        double w = getWidth() > 0 ? getWidth() : getPrefWidth();
        double coverY = h - COVER_Y_OFFSET;
        double titleY = h - TITLE_Y_OFFSET;
        double dx = scaleOffsetX;
        double dy = scaleOffsetY;
        coverView.resizeRelocate(COVER_X + dx, coverY + dy, COVER, COVER);
        coverBorder.resizeRelocate(COVER_X + dx, coverY + dy, COVER, COVER);
        titleShadow.resizeRelocate(TITLE_X, titleY, Math.max(0, w - TITLE_X), TITLE_Y_OFFSET);
        title.resizeRelocate(TITLE_X, titleY, Math.max(0, w - TITLE_X), TITLE_Y_OFFSET);
    }

    /**
     * 按低频缩放封面，锚点 (60, H-55)。
     *
     * <p><b>为什么不能直接 {@code scaleX/scaleY}</b>：JavaFX 的缩放绕 layoutBounds
     * 中心，而原版的 {@code glScalef} 锚在 (60, H-55)，两者只差 5px——
     * 但这 5px 决定了放大时封面是往上顶还是往下沉。
     * 做法是算出「缩放前后中心该平移多少」，写进 offset 交给 layout 用。
     *
     * @param scale {@link SpectrumView#coverScale} 算出的 1.0~1.14
     */
    public void applyScale(double scale) {
        if (!Double.isFinite(scale) || scale <= 0) {
            return;
        }
        double h = getHeight() > 0 ? getHeight() : getPrefHeight();
        double pivotX = ANCHOR_X;
        double pivotY = h - ANCHOR_Y_OFFSET;
        double cx = COVER_X + COVER / 2.0;
        double cy = (h - COVER_Y_OFFSET) + COVER / 2.0;
        this.scaleOffsetX = (1 - scale) * (pivotX - cx);
        this.scaleOffsetY = (1 - scale) * (pivotY - cy);
        coverView.setScaleX(scale);
        coverView.setScaleY(scale);
        coverMask.setScaleX(scale);
        coverMask.setScaleY(scale);
        coverBorder.setScaleX(scale);
        coverBorder.setScaleY(scale);
        reposition();
    }

    @Override
    protected double computePrefWidth(double height) {
        return TITLE_X + 220;
    }

    @Override
    protected double computePrefHeight(double height) {
        return COVER_Y_OFFSET;
    }

    /** 歌名文本，离屏断言用。 */
    public String titleText() {
        return title.getText();
    }

    /** 封面在父节点坐标系里的包围盒，离屏断言用。 */
    public javafx.geometry.Bounds coverBoundsInParent() {
        return coverView.getBoundsInParent();
    }
}