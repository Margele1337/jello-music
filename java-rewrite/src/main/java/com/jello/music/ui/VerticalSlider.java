package com.jello.music.ui;

import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;

/**
 * 垂直音量条 4x40 —— 1:1 复刻原版 {@code SigmaVolumeSlider.vue}。
 *
 * <p>原版是两层叠在根背景上：
 * <pre>
 *   .sigma-volume-slider  background rgba(1,1,1,0.2)
 *   .sigma-volume-dark    top 0, height=(1-value)*100%   rgba(1,1,1,0.2)   // 未填充段再叠一层
 *   .sigma-volume-fill    bottom 0, height=value*100%    rgba(254,254,254,0.2)
 * </pre>
 * <b>之前漏了 dark 层</b>，未填充段只画了一层，底色偏亮。
 *
 * <p>原版支持滚轮 {@code @wheel.prevent}，每格 0.05；之前 Java 侧没有。
 * 同样地，原版<b>没有 hover 变色</b>，之前自己加的「悬停变亮」已去掉。
 */
public final class VerticalSlider extends Pane {

    /** 原版滚轮一格 0.05。 */
    private static final double WHEEL_STEP = 0.05;

    private final Region dark = new Region();
    private final Region fill = new Region();
    private final javafx.beans.property.DoubleProperty value =
            new javafx.beans.property.SimpleDoubleProperty(1.0);
    private java.util.function.Consumer<Double> changeHandler;

    public VerticalSlider(double w, double h) {
        getStyleClass().add("sigma-volume-slider"); // 原版 CSS class，拖窗排除表要用（DragGate）
        // 自己管尺寸：Pane 的 prefSize 是从子节点算出来的，构造时不显式设，
        // 独立使用时宽高会算成 0（布局与 layoutFill 全部失效）。
        setPrefSize(w, h);
        setMinSize(w, h);
        setMaxSize(w, h);
        setBackground(javafx.scene.layout.Background.fill(Theme.VOLUME_TRACK));

        dark.setBackground(javafx.scene.layout.Background.fill(Theme.VOLUME_TRACK));
        dark.setPrefWidth(w);
        dark.setLayoutX(0);
        dark.setLayoutY(0);
        dark.setMouseTransparent(true);

        fill.setBackground(javafx.scene.layout.Background.fill(Theme.VOLUME_FILL));
        fill.setPrefWidth(w);
        fill.setLayoutX(0);
        fill.setMouseTransparent(true);

        getChildren().addAll(dark, fill);
        layoutFill();

        value.addListener((o, a, b) -> {
            layoutFill();
            if (changeHandler != null) {
                changeHandler.accept(b.doubleValue());
            }
        });
        setOnMousePressed(this::setFromY);
        setOnMouseDragged(this::setFromY);
        setOnScroll(e -> {
            // 原版：deltaY > 0 减小，否则增大（向上滚=加音量）
            double delta = e.getDeltaY() > 0 ? -WHEEL_STEP : WHEEL_STEP;
            value.set(Math.max(0, Math.min(1, value.get() + delta)));
            e.consume();
        });
    }

    private void setFromY(MouseEvent e) {
        double h = getHeight();
        double v = 1.0 - (e.getY() / h);
        value.set(Math.max(0, Math.min(1, v)));
    }

    private void layoutFill() {
        double h = getHeight() > 0 ? getHeight() : getPrefHeight();
        double v = value.get();
        // 未填充段：从顶部往下 (1-v)
        dark.setPrefHeight(h * (1 - v));
        // 填充段自底部向上
        double fh = h * v;
        fill.setPrefHeight(fh);
        fill.setLayoutY(h - fh);
    }

    /** 未填充段（对应原版 .sigma-volume-dark），供离屏校验确认这一层存在。 */
    public Region darkLayer() {
        return dark;
    }

    public void setOnChange(java.util.function.Consumer<Double> handler) {
        this.changeHandler = handler;
    }

    public javafx.beans.property.DoubleProperty valueProperty() {
        return value;
    }
}