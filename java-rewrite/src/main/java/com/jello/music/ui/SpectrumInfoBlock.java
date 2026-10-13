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

    /** 封面尺寸。权威：{@code SpectrumHUD.vue:301} {@code width:64px; height:64px}。 */
    private static final double COVER = 64;

    /** 封面圆角。权威：{@code SpectrumHUD.vue:302} {@code border-radius:10px}。 */
    private static final double COVER_RADIUS = 10;

    /** 封面横向位置。权威：{@code left:14px}（:295）。 */
    private static final double COVER_X = 14;

    /**
     * 封面纵向位置。权威：{@code bottom:12px}（:295）。
     *
     * <p>JavaFX 原点在<b>左下角</b>、y 向上为正，
     * 所以「距底 12」就是 {@code -(COVER + 12)}。
     */
    private static final double COVER_Y_FROM_BOTTOM = COVER + 12;

    /**
     * 缩放锚点。
     *
     * <p>原版是 OpenGL 的 {@code glTranslated}，坐标系原点在左下 ——
     * 对应 {@code (60, H-55)}。这里保留同样的数值，
     * JavaFX 下 y 直接用 {@code -55}（原点在左下，往上为正）。
     */
    private static final double ANCHOR_X = 60;
    private static final double ANCHOR_Y_OFFSET = 55;

    /**
     * 歌名横向位置。权威：{@code .spectrum-info} 是 flex + gap:10px，
     * 封面 64 + gap 10 -&gt; meta 起点 = 14 + 64 + 10 = 88。
     */
    private static final double TITLE_X = COVER_X + COVER + 10;

    /** 歌名字号。权威：{@code font-size:15px}（:311）。 */
    private static final int TITLE_SIZE = 15;

    /** 作者字号。权威：{@code font-size:12px}（:315）。 */
    private static final int AUTHOR_SIZE = 12;

    /** meta 内部行距。权威：{@code gap:2px}（:307）。 */
    private static final double META_GAP = 2;

    private final ImageView coverView;
    private final Rectangle coverMask;
    private final Rectangle coverBorder;
    private final Label titleShadow;
    private final Label title;
    /** 作者行（权威 SpectrumHUD.vue:315）。 */
    private final Label author;

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
        titleShadow = makeTitleLabel(Color.web("#0d4f52", 0.5), TITLE_SIZE);
        title = makeTitleLabel(Color.web("#e6e3ee", 0.7), TITLE_SIZE);
        getChildren().add(titleShadow);
        getChildren().add(title);

        // 作者行：原版 {@code .spectrum-info .author}
        // （rgba(255,255,255,0.75) / 12px / 与歌名间距 2px，:307,315）。
        // 之前 Java 版只有歌名，作者整行没做——频谱窗里少了半块信息。
        author = new Label();
        author.setFont(Assets.light(AUTHOR_SIZE));
        author.setTextFill(Color.color(1, 1, 1, 0.75));
        author.setMouseTransparent(true);
        getChildren().add(author);

        // 尺寸变了要重排：坐标依赖高度
        widthProperty().addListener((o, was, now) -> reposition());
        heightProperty().addListener((o, was, now) -> reposition());
    }

    private Label makeTitleLabel(Color fill, int size) {
        Label l = new Label();
        l.setFont(Assets.light(size));
        l.setTextFill(fill);
        l.setMouseTransparent(true);
        return l;
    }

    /** 设置作者行。空串表示没有作者，原版此时只显示歌名。 */
    public void setAuthor(String name) {
        author.setText(name == null ? "" : name.trim());
        reposition();
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
        // 原版 .spectrum-info 是 left:14 bottom:12 的 flex 容器
        // （SpectrumHUD.vue:293-297），cover 在最左，meta 在右侧 column 排布。
        //
        // <b>注意坐标系</b>：本块是普通 Pane，原点在<b>左上</b>、y 向下为正，
        // 所以「距底 12」= h - COVER - 12，不能写成 -COVER_Y_FROM_BOTTOM
        //（那是 Canvas 的左下坐标，用在这里会跑到窗外去）。
        double coverY = h - COVER_Y_FROM_BOTTOM;
        double dx = scaleOffsetX;
        double dy = scaleOffsetY;
        coverView.resizeRelocate(COVER_X + dx, coverY + dy, COVER, COVER);
        coverBorder.resizeRelocate(COVER_X + dx, coverY + dy, COVER, COVER);

        // meta：歌名在上、作者在下，整体相对封面<b>垂直居中</b>
        // （原版 align-items:center + meta 自身 column gap:2px）。
        double metaX = TITLE_X;
        double metaW = Math.max(0, w - metaX - 12);
        double titleH = TITLE_SIZE + 4;
        double authorH = AUTHOR_SIZE + 4;
        double blockH = titleH + META_GAP + authorH;
        double baseY = coverY + (COVER - blockH) / 2.0;

        titleShadow.resizeRelocate(metaX, baseY, metaW, titleH);
        title.resizeRelocate(metaX, baseY, metaW, titleH);
        author.resizeRelocate(metaX, baseY + titleH + META_GAP, metaW, authorH);
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
        // 与 reposition 一致：普通 Pane 原点左上，封面顶在 h - COVER - 12
        double cy = h - COVER_Y_FROM_BOTTOM + COVER / 2.0;
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
        return COVER_Y_FROM_BOTTOM;
    }

    // ---- 离屏断言用的只读访问器（UiProbe）----
    public double coverSize() {
        return COVER;
    }

    public double coverCornerRadius() {
        return COVER_RADIUS;
    }

    public double coverX() {
        return COVER_X;
    }

    public String authorText() {
        return author.getText();
    }

    public javafx.geometry.Bounds authorBoundsInParent() {
        return new javafx.geometry.BoundingBox(
                author.getLayoutX(), author.getLayoutY(),
                author.getWidth(), author.getHeight());
    }

    public javafx.geometry.Bounds titleBoundsInParent() {
        return new javafx.geometry.BoundingBox(
                title.getLayoutX(), title.getLayoutY(),
                title.getWidth(), title.getHeight());
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