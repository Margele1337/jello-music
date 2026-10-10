package com.jello.music.ui;

import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;

/**
 * 细进度条 550x5 —— 1:1 复刻原版 {@code SigmaProgressBar.vue}：
 * 轨道 rgba(153,153,153,0.075)，已播部分 #fefefe，
 * 未播部分 rgba(1,1,1,0.43)（原版是从右边铺过来的 remaining 层）。
 */
public final class ThinProgressBar extends Pane {

    private final Region played = new Region();
    private double percent;
    private java.util.function.Consumer<Double> seekHandler;

    public ThinProgressBar(double w, double h) {
        setBackground(javafx.scene.layout.Background.fill(Theme.PROGRESS_TRACK));
        played.setBackground(javafx.scene.layout.Background.fill(Theme.TEXT));
        played.setPrefWidth(0);
        played.setPrefHeight(h);
        getChildren().add(played);

        setOnMousePressed(this::seekFromX);
        setOnMouseDragged(this::seekFromX);
    }

    public void setPercent(double p) {
        this.percent = Math.max(0, Math.min(1, p));
        played.setPrefWidth(getWidth() * this.percent);
    }

    public double getPercent() {
        return percent;
    }

    public void setOnSeek(java.util.function.Consumer<Double> handler) {
        this.seekHandler = handler;
    }

    /**
     * 点击/拖拽定位。
     * <p>按下与拖动都走这里，回调带的是 0..1 的比例；
     * 原先 {@code setOnSeek(Runnable)} 只挪了视觉、既不回传比例又会顶掉拖动监听，
     * 所以进度条一直是只读显示。
     */
    private void seekFromX(MouseEvent e) {
        double w = getWidth();
        if (w <= 0) {
            return;
        }
        double v = Math.max(0, Math.min(1, e.getX() / w));
        setPercent(v);
        if (seekHandler != null) {
            seekHandler.accept(v);
        }
    }
}