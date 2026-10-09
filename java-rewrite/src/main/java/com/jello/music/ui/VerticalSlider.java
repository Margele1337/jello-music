package com.jello.music.ui;

import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;
import javafx.scene.paint.Color;

/**
 * 垂直音量条 4x40 —— 1:1 复刻原版 {@code SigmaVolumeSlider.vue}：
 * 轨道 rgba(1,1,1,0.2)，填充 rgba(254,254,254,0.2) 自底部生长，hover 转为半透明深色。
 */
public final class VerticalSlider extends Pane {

    private final Region fill = new Region();
    private final javafx.beans.property.DoubleProperty value =
            new javafx.beans.property.SimpleDoubleProperty(1.0);

    public VerticalSlider(double w, double h) {
        setBackground(javafx.scene.layout.Background.fill(Theme.VOLUME_TRACK));
        fill.setBackground(javafx.scene.layout.Background.fill(Theme.VOLUME_FILL));
        fill.setPrefWidth(w);
        fill.setLayoutX(0);
        getChildren().add(fill);
        layoutFill();

        value.addListener((o, a, b) -> layoutFill());
        setOnMousePressed(this::setFromX);
        setOnMouseDragged(this::setFromX);
        setOnMouseEntered(e -> setBackground(javafx.scene.layout.Background.fill(
                Color.color(0.9961, 0.9961, 0.9961, 0.09))));
        setOnMouseExited(e -> setBackground(
                javafx.scene.layout.Background.fill(Theme.VOLUME_TRACK)));
    }

    private void setFromX(MouseEvent e) {
        double h = getHeight();
        double v = 1.0 - (e.getY() / h);
        value.set(Math.max(0, Math.min(1, v)));
    }

    private void layoutFill() {
        double h = getHeight();
        double v = value.get();
        // 填充自底部向上：顶部留出未播放部分
        double fh = h * v;
        fill.setPrefHeight(fh);
        fill.setLayoutY(h - fh);
    }

    public javafx.beans.property.DoubleProperty valueProperty() {
        return value;
    }
}