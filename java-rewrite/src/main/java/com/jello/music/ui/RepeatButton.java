package com.jello.music.ui;

import javafx.geometry.Rectangle2D;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;

/**
 * 循环模式按钮 27x20 @ (264,540) —— 1:1 复刻原版
 * {@code SigmaChangingButton.vue}（对应 sigmarebase 的 {@code ChangingButton.java}）。
 *
 * <p>原版是三态横向雪碧图 {@code repeat.png}（81x20 = 3 x 27x20），
 * 用 {@code background-position-x} 取 0% / 50% / 100% 三段，整块透明度 0.35。
 * JavaFX 没有 background-position，这里改用 {@link ImageView#setViewport} 裁出对应那一格，
 * 效果等价。
 *
 * <p>状态与原版一一对应：<b>0=不循环 / 1=列表循环 / 2=单曲循环</b>。
 */
public final class RepeatButton extends Pane {

    /** 雪碧图单格宽度，与 27x20 的按钮尺寸一致。 */
    private static final double CELL_W = 27;
    private static final double CELL_H = 20;
    private static final double TOTAL_W = 81;

    /** 原版 CSS {@code opacity: 0.35} */
    private static final double BASE_OPACITY = 0.35;

    private final ImageView view = new ImageView();
    private int state;

    public RepeatButton() {
        Image sprite = Assets.image("repeat.png");
        view.setImage(sprite);
        view.setFitWidth(TOTAL_W);
        view.setFitHeight(CELL_H);
        // 关掉平滑：原版对这两个小图强制 image-rendering: pixelated
        view.setPreserveRatio(false);
        view.setSmooth(true);
        view.setOpacity(BASE_OPACITY);
        getChildren().add(view);
        applyState();

        setOnMouseEntered((MouseEvent e) -> view.setOpacity(0.6));
        setOnMouseExited((MouseEvent e) -> view.setOpacity(BASE_OPACITY));
    }

    public int state() {
        return state;
    }

    public void setState(int s) {
        this.state = Math.max(0, Math.min(2, s));
        applyState();
    }

    /** 点击循环 0 -> 1 -> 2 -> 0。 */
    public void onClick(Runnable r) {
        setOnMouseClicked((MouseEvent e) -> {
            setState((state + 1) % 3);
            if (r != null) {
                r.run();
            }
        });
    }

    private void applyState() {
        view.setViewport(new Rectangle2D(state * CELL_W, 0, CELL_W, CELL_H));
        // viewport 裁剪后，ImageView 自身尺寸要回到单格大小
        view.setFitWidth(TOTAL_W);
        view.setFitHeight(CELL_H);
        setPrefSize(CELL_W, CELL_H);
        setMinSize(CELL_W, CELL_H);
        setMaxSize(CELL_W, CELL_H);
    }
}