package com.jello.music.ui;

import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;

import java.util.function.Consumer;

/**
 * 频谱开关按钮 40x40 —— 1:1 复刻原版 {@code SigmaSpectrumButton.vue}：
 * 三根 5px 宽的竖条，关闭 opacity 0.09，开启 0.29，hover 0.34 / 开启+hover 0.54。
 *
 * <p>三根条的几何（取自原 CSS）：
 * <pre>
 *   bar-1: left 10, top 16, height 14
 *   bar-2: left 17, top 10, height 20
 *   bar-3: left 24, top 20, height 10
 * </pre>
 */
public final class SpectrumToggleButton extends Pane {

    private final Region b1 = bar(10, 16, 14);
    private final Region b2 = bar(17, 10, 20);
    private final Region b3 = bar(24, 20, 10);
    private boolean active;
    private Consumer<Boolean> onToggle;

    public SpectrumToggleButton(double size) {
        getChildren().addAll(b1, b2, b3);
        applyOpacity(Theme.SPECTRUM_BAR_OFF);
        setOnMouseClicked(e -> {
            active = !active;
            applyOpacity(active ? Theme.SPECTRUM_BAR_ON : Theme.SPECTRUM_BAR_OFF);
            if (onToggle != null) {
                onToggle.accept(active);
            }
        });
    }

    private static Region bar(double x, double top, double height) {
        Region r = new Region();
        r.setLayoutX(x);
        r.setLayoutY(top);
        r.setPrefWidth(5);
        r.setPrefHeight(height);
        return r;
    }

    private void applyOpacity(double o) {
        String s = "-fx-background-color: #fefefe; -fx-opacity: " + o + ";";
        b1.setStyle(s);
        b2.setStyle(s);
        b3.setStyle(s);
    }

    /** 悬停高亮：原版 hover 0.34、active+hover 0.54。 */
    private void hover(boolean on) {
        double o;
        if (on) {
            o = active ? 0.54 : 0.34;
        } else {
            o = active ? Theme.SPECTRUM_BAR_ON : Theme.SPECTRUM_BAR_OFF;
        }
        applyOpacity(o);
    }

    public void setOnToggle(Consumer<Boolean> c) {
        this.onToggle = c;
        setOnMouseEntered(e -> hover(true));
        setOnMouseExited(e -> hover(false));
    }

    public void setActiveStyle(boolean a) {
        this.active = a;
        applyOpacity(a ? Theme.SPECTRUM_BAR_ON : Theme.SPECTRUM_BAR_OFF);
    }

    public boolean isActiveStyle() {
        return active;
    }
}