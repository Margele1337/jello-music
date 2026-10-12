package com.jello.music.ui;

import javafx.scene.layout.Pane;
import javafx.scene.shape.Rectangle;

/**
 * 可滚动容器 —— 1:1 复刻原版 {@code SigmaScrollablePanel.vue}
 * （对应 sigmarebase 的 {@code ScrollableContentPanel.java}）。
 *
 * <p>原版就是三条 CSS：
 * <pre>
 *   .sigma-scrollable-panel { position:absolute; overflow-y:auto; overflow-x:hidden; }
 *   ::-webkit-scrollbar    { width:0; height:0; display:none; }
 * </pre>
 * 也就是<b>纵向可滚、横向裁掉、滚动条完全隐藏</b>，只留滚轮。
 * 滚动量直接取 {@code deltaY}（浏览器原生滚动就是 1:1 的像素位移）。
 *
 * <p><b>为什么不用 {@link javafx.scene.control.ScrollPane}</b>：JavaFX 模期样式给
 * {@code .scroll-pane > .viewport} 设了白色背景，只写
 * {@code -fx-background-color: transparent} 管不到它，结果整个区域被染成白色
 * （{@link PlaylistPanel} 踩过一次）。这里用一个 Pane 包一个内层 Pane，
 * 靠平移内层 + clip 模拟滚动，外观完全由自己掌控。
 *
 * <p><b>为什么滚动条连 3px 轨道都不画</b>：原版是 {@code display:none}。
 * 留一条轨道会在右上角多出一截滑块，视觉上像脏点。
 */
public final class SigmaScrollablePanel extends Pane {

    private final Pane viewport = new Pane();
    private final double viewW;
    private final double viewH;
    private double scroll;
    private double contentHeight;

    public SigmaScrollablePanel(double w, double h) {
        getStyleClass().add("sigma-scrollable-panel"); // 原版 CSS class，拖窗排除表要用（DragGate）
        this.viewW = w;
        this.viewH = h;
        setPrefSize(w, h);
        setMinSize(w, h);
        setMaxSize(w, h);
        setBackground(javafx.scene.layout.Background.fill(javafx.scene.paint.Color.TRANSPARENT));
        // overflow-x/overflow-y:hidden —— 超出容器的部分不画
        setClip(new Rectangle(w, h));

        viewport.setLayoutX(0);
        viewport.setLayoutY(0);
        // viewport <b>必须显式透明</b>：{@code Pane} 继承 {@code Region}，
        // JavaFX modena 默认样式会给它画一层<b>浅灰背景</b>，
        // 而原版 {@code .sigma-scrollable-panel} 的内容区是透明的
        // （SigmaScrollablePanel.vue 只设了 overflow / scrollbar，没有 background）。
        // 不设的话歌单面板右侧会出现一条贯穿的浅灰竖带 —— 就是这个坑。
        viewport.setBackground(javafx.scene.layout.Background.fill(
                javafx.scene.paint.Color.TRANSPARENT));
        getChildren().add(viewport);

        setOnScroll(e -> {
            onWheel(e.getDeltaY());
            e.consume();
        });
    }

    /**
     * 滚轮位移：直接取 deltaY（浏览器原生滚动就是 1:1 的像素位移）。
     *
     * <p>抽成方法是因为 {@link javafx.scene.input.ScrollEvent} 只有全参构造，
     * 离屏校验里造一个出来很别扭，而要验的其实就是这一行位移与钳制逻辑。
     */
    public void onWheel(double deltaY) {
        scrollBy(deltaY);
    }

    /** 内容层：绝对定位的子节点加到这里，对应原版 slot 里的卡片。 */
    public Pane viewport() {
        return viewport;
    }

    public double contentHeight() {
        return contentHeight;
    }

    /** 内容高度。浏览器里由子节点自然撑开，这里因为子节点是绝对定位，需要显式报一次。 */
    public void setContentHeight(double h) {
        this.contentHeight = Math.max(h, viewH);
        if (scroll > maxScroll()) {
            scrollTo(maxScroll());
        }
    }

    /** 最大滚动量 = 内容高 - 视口高，不足一屏时为 0。 */
    public double maxScroll() {
        return Math.max(0, contentHeight - viewH);
    }

    public double scroll() {
        return scroll;
    }

    /** 设定滚动位置，超出范围会被钳制（对应浏览器的边界行为）。 */
    public void scrollTo(double y) {
        scroll = Math.max(0, Math.min(maxScroll(), y));
        viewport.setLayoutY(-scroll);
    }

    public void scrollBy(double dy) {
        scrollTo(scroll + dy);
    }

    /** 视口尺寸，外部算布局时用得到。 */
    public double viewportWidth() {
        return viewW;
    }

    public double viewportHeight() {
        return viewH;
    }
}