package com.jello.music.ui;

import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.image.Image;
import javafx.scene.layout.Pane;
import javafx.scene.paint.Color;

/**
 * 底部封面条 —— 复刻原版 {@code SigmaMusicPlayer.vue} 的 {@code .smp-strip}：
 * 取当前封面、cover 裁切铺满 800x94。
 *
 * <p><b>关于模糊</b>：原版用 CSS {@code filter: blur(15px)}。JavaFX 里对 Canvas
 * 做实时高斯模糊需要 {@code snapshot()}（要求窗口已显示）或引入 ImageOps，
 * 两者都偏重。这里改为「cover 裁切 + 上下两片渐变遮罩」模拟柔化观感。
 *
 * <p>视觉差异有限：原版在这条封面条上又叠了两层 rgba(1,1,1,0.43) 遮罩
 * （{@code .smp-strip-overlay} 与 {@code .smp-strip-overlay-bottom}），
 * 本身就已经压得很暗，模糊与否在最终画面上区分度不高。
 */
public final class CanvasStrip extends Pane {

    private final Canvas canvas = new Canvas();
    private final GraphicsContext g;
    private Image current;

    public CanvasStrip(double w, double h) {
        canvas.setWidth(w);
        canvas.setHeight(h);
        g = canvas.getGraphicsContext2D();
        getChildren().add(canvas);
        // Pane 默认没有背景，透明是对的；但要显式给 canvas 铺底色，
        // 否则在深色底板上会露出下层（JavaFX Canvas 本身从不自动填充）
        g.setFill(javafx.scene.paint.Color.web("#1a1a1a"));
        g.fillRect(0, 0, w, h);
        current = Assets.image("artwork.png");
        draw();
    }

    public void setCover(String url) {
        if (url == null || url.isBlank()) {
            current = Assets.image("artwork.png");
        } else {
            try {
                current = new Image(url, true);
            } catch (Exception e) {
                current = Assets.image("artwork.png");
            }
        }
        draw();
    }

    private void draw() {
        double w = canvas.getWidth();
        double h = canvas.getHeight();
        g.clearRect(0, 0, w, h);
        if (current == null) {
            return;
        }

        // cover 裁切：等比铺满画布并居中
        double r = w / h;
        double ir = current.getWidth() / current.getHeight();
        double dw, dh;
        if (ir > r) {
            dh = h;
            dw = h * ir;
        } else {
            dw = w;
            dh = w / ir;
        }
        g.drawImage(current, (w - dw) / 2, (h - dh) / 2, dw, dh);

        // 柔化替代：上下边缘压暗，弱化裁切边缘
        g.setFill(new Color(0, 0, 0, 0.18));
        g.fillRect(0, 0, w, 2);
        g.fillRect(0, h - 2, w, 2);
    }
}