package com.jello.music.ui;

import javafx.geometry.Rectangle2D;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;
import javafx.scene.paint.Color;
import javafx.scene.shape.SVGPath;

/**
 * 循环模式按钮 27x20 @ (264,540) —— 1:1 复刻原版
 * {@code SigmaChangingButton.vue}（对应 sigmarebase 的 {@code ChangingButton.java}）。
 *
 * <p>原版是 {@link #MODES} 四态，但图标只有三种来源：
 * <ul>
 *   <li>0 随机播放 —— 内联 SVG（唯一不走雪碧图的）</li>
 *   <li>1 列表循环 / 2 单曲循环 / 3 顺序播放 —— {@code repeat.png}（81x20 = 3 x 27x20）</li>
 * </ul>
 * 雪碧图三帧靠 {@code background-position-x} 的 0% / 50% / 100% 切换，
 * JavaFX 没有 background-position，这里改用 {@link ImageView#setViewport} 裁出对应那一格，效果等价。
 *
 * <p><b>坑</b>：模式索引和雪碧图帧号不是一回事（{@code SigmaMusicPlayer.vue:219-226} 的
 * {@code repeatType}）。随机 ↔ 顺序是对调的：
 * <pre>
 *   模式 0 随机 -> type 3  -> SVG
 *   模式 1 列表 -> type 1  -> 雪碧图第 1 格
 *   模式 2 单曲 -> type 2  -> 雪碧图第 2 格
 *   模式 3 顺序 -> type 0  -> 雪碧图第 0 格
 * </pre>
 * 直接拿模式索引当帧号，随机和顺序会显示成同一个图标。
 *
 * <p>整块透明度固定 0.35。原版 {@code .sigma-changing-button} <b>没有 hover 样式</b>
 * （只有 cursor:pointer），之前 Java 侧自己加了「悬停变亮 0.6」，已去掉。
 */
public final class RepeatButton extends Pane {

    /** 模式顺序与原版 {@code PlaybackMode.js:4-9} 的 playbackModes 一致，默认 1（列表循环）。 */
    public static final int MODE_SHUFFLE = 0;
    public static final int MODE_ALL = 1;
    public static final int MODE_ONE = 2;
    public static final int MODE_SEQUENTIAL = 3;
    public static final int MODE_COUNT = 4;

    /** 雪碧图单格宽度，和 27x20 的按钮尺寸一致。 */
    private static final double CELL_W = 27;
    private static final double CELL_H = 20;

    /** 原版 CSS {@code opacity: 0.35} */
    private static final double BASE_OPACITY = 0.35;

    /** 原版 SVG viewBox 是 24x24，靠 background-size:contain 缩进 27x20 的按钮。 */
    private static final double SVG_VIEWBOX = 24;

    /**
     * 原版 {@code SigmaChangingButton.vue:18-20} 的内联 SVG，{@code encodeURIComponent} 前的原文。
     * viewBox 0 0 24 24，单一 fill #fff，无描边；两段子路径拼在同一个 {@code d} 里。
     */
    private static final String SHUFFLE_PATH =
            "M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41z"
                    + "M14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5z"
                    + "m.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z";

    private final ImageView view = new ImageView();
    private final SVGPath shuffle = new SVGPath();
    private int state = MODE_ALL;

    public RepeatButton() {
        getStyleClass().add("sigma-changing-button");
        Image sprite = Assets.image("repeat.png");
        view.setImage(sprite);
        view.setSmooth(false);
        view.setOpacity(BASE_OPACITY);
        getChildren().add(view);

        shuffle.setContent(SHUFFLE_PATH);
        shuffle.setFill(Color.web("#fefefe"));
        shuffle.setOpacity(BASE_OPACITY);
        // SVG 是矢量，原版没有 image-rendering: pixelated，保持平滑
        getChildren().add(shuffle);

        applyState();
    }

    /** 模式索引 0..3，语义见 {@link #MODE_SHUFFLE} 等常量。 */
    public int state() {
        return state;
    }

    public void setState(int s) {
        // 原版 setPlaybackMode 是 (index+1)%4 循环，这里同样夹回 0..3
        this.state = ((s % MODE_COUNT) + MODE_COUNT) % MODE_COUNT;
        applyState();
    }

    /** 点击循环 0 -> 1 -> 2 -> 3 -> 0（原版 {@code togglePlaybackMode}）。 */
    public void onClick(Runnable r) {
        setOnMouseClicked((MouseEvent e) -> {
            setState(state + 1);
            if (r != null) {
                r.run();
            }
        });
    }

    /** 模式索引 -> repeat.png 帧号（对应原版 repeatType）。随机返回 -1，表示走 SVG。 */
    public static int spriteFrame(int mode) {
        return switch (mode) {
            case MODE_SHUFFLE -> -1;
            case MODE_SEQUENTIAL -> 0;
            default -> mode;
        };
    }

    private void applyState() {
        int frame = spriteFrame(state);
        boolean random = frame < 0;

        view.setVisible(!random);
        shuffle.setVisible(random);
        setClip(new javafx.scene.shape.Rectangle(CELL_W, CELL_H));
        setPrefSize(CELL_W, CELL_H);
        setMinSize(CELL_W, CELL_H);
        setMaxSize(CELL_W, CELL_H);

        if (random) {
            applyShuffleIcon();
        } else {
            view.setViewport(new Rectangle2D(frame * CELL_W, 0, CELL_W, CELL_H));
            // viewport 裁出的是 27x20 那一格，ImageView 自身尺寸就必须是 27x20，
            // 之前这里设 fitWidth = 81，结果 JavaFX 把裁好的 27px 又横向拉成 81px
            // ——图标被拉宽 3 倍并溢出按钮，压到左边的时间标签上（离屏截图里能直接看出来）
            view.setPreserveRatio(false);
            view.setFitWidth(CELL_W);
            view.setFitHeight(CELL_H);
            view.setLayoutX(0);
            view.setLayoutY(0);
        }
    }

    /**
     * 复刻 {@code background-size: contain; background-position: center}。
     *
     * <p>24x24 的正方形塞进 27x20，高度先到边，缩放比 20/24，成品 20x20 左右各空
     * (27-20)/2 = 3.5px；这个图标又是自己在 viewBox 里居中的，所以等价于把缩放后的
     * 字形中心摆到 (27/2, 20/2) = (13.5, 10)。
     *
     * <p><b>坑</b>：JavaFX 的缩放是绕 layoutBounds 中心，而不是缩放后再按框居中，
     * 所以 {@code layoutX} 要用「目标中心 - 字形中心」算，不能用
     * {@code (27 - 缩放后宽)/2}。另外别用 StackPane 居中——它会把算出来的 1.5
     * 吸附成 2，图标整整偏右 0.5px（UiProbe 数像素能看出来）。
     *
     * <p>本图标的字形在 viewBox 里占 4..20，中心正好 (12, 12)；UiProbe 有断言守着。
     */
    private void applyShuffleIcon() {
        double scale = CELL_H / SVG_VIEWBOX;
        shuffle.setScaleX(scale);
        shuffle.setScaleY(scale);
        shuffle.setLayoutX(CELL_W / 2 - SVG_VIEWBOX / 2);
        shuffle.setLayoutY(CELL_H / 2 - SVG_VIEWBOX / 2);
    }
}