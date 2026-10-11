package com.jello.music.ui;

import javafx.scene.image.ImageView;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;

/**
 * 细进度条 550x5 —— 1:1 复刻原版 {@code SigmaProgressBar.vue}。
 *
 * <p>原版是四层，自底向上：
 * <pre>
 *   .sigma-progress-track      inset 0            rgba(153,153,153,0.075)
 *   .sigma-progress-played     left 0, width=percent%   #fefefe
 *   .sigma-progress-remaining  right 0, left=percent%   rgba(1,1,1,0.43)
 *   .sigma-progress-knob       left=percent%, margin-left:-5px，shadow_right.png 5x5
 *                              仅 percent &gt; 0 时渲染
 * </pre>
 *
 * <p><b>之前漏了两层</b>：只剩轨道 + 已播放，所以未播放那段底色偏亮；
 * 而且末端没有 {@code shadow_right.png} 那个 5x5 的高光，原版一眼就能看出来。
 */
public final class ThinProgressBar extends Pane {

    private final Region played = new Region();
    private final Region remaining = new Region();
    private final ImageView knob = new ImageView();
    private double percent;
    private java.util.function.Consumer<Double> seekHandler;

    public ThinProgressBar(double w, double h) {
        // 自己管尺寸：Pane 的 prefSize 是从子节点算出来的，构造时不显式设，
        // 独立使用时宽高会算成 0（布局与 setPercent 全部失效）。
        setPrefSize(w, h);
        setMinSize(w, h);
        setMaxSize(w, h);
        setBackground(javafx.scene.layout.Background.fill(Theme.PROGRESS_TRACK));

        played.setBackground(javafx.scene.layout.Background.fill(Theme.TEXT));
        played.setPrefHeight(h);
        played.setPrefWidth(0);
        played.setMouseTransparent(true);

        // 未播放段：left = percent%，铺到右边
        remaining.setBackground(javafx.scene.layout.Background.fill(Theme.PROGRESS_REMAIN));
        remaining.setPrefHeight(h);
        remaining.setMouseTransparent(true);

        // 末端高光 5x5，margin-left:-5px（向左偏半格，骑在进度头上）
        knob.setImage(Assets.image("shadow_right.png"));
        knob.setFitWidth(5);
        knob.setFitHeight(5);
        knob.setPreserveRatio(false);
        knob.setMouseTransparent(true);
        knob.setVisible(false);

        getChildren().addAll(remaining, played, knob);

        setOnMousePressed(this::seekFromX);
        setOnMouseDragged(this::seekFromX);
    }

    public void setPercent(double p) {
        this.percent = Math.max(0, Math.min(1, p));
        double w = getWidth() > 0 ? getWidth() : getPrefWidth();
        played.setPrefWidth(w * this.percent);
        remaining.setLayoutX(w * this.percent);
        remaining.setPrefWidth(w - w * this.percent);
        knob.setLayoutX(w * this.percent - 5);
        knob.setVisible(this.percent > 0);
    }

    public double getPercent() {
        return percent;
    }

    /** 末端高光节点，供离屏校验确认它真的在跟着进度走。 */
    public ImageView knob() {
        return knob;
    }

    /** 未播放段，供离屏校验确认这一层存在。 */
    public Region remainingLayer() {
        return remaining;
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