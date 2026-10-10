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
 */
public final class CanvasStrip extends Pane {

    /** 图未就绪 / 加载失败时的兜底底色，避免浅色桌面从透明处透上来。 */
    private static final Color FALLBACK_BG = Color.web("#1a1a1a");

    private final Canvas canvas = new Canvas();
    private final GraphicsContext g;
    private Image current;

    public CanvasStrip(double w, double h) {
        canvas.setWidth(w);
        canvas.setHeight(h);
        g = canvas.getGraphicsContext2D();
        getChildren().add(canvas);
        current = Assets.image("artwork.png");
        draw();
    }

    public void setCover(String url) {
        if (url == null || url.isBlank()) {
            current = Assets.image("artwork.png");
            draw();
            return;
        }
        // 构造参数 true 是「后台加载」，是异步的：构造函数返回时图片宽高还是 0，
        // 此时算出的缩放比是 NaN，drawImage 什么都不画，整条封面就成了一块透明，
        // 底下的 rgba(1,1,1,0.43) 遮罩压不住浅色桌面，于是歌名/时长这些 #fefefe
        // 的字全都「隐形」了。之前没有「加载完再重绘」，封面永远出不来。
        // 这里监听 progress 到 1，再回 FX 线程重绘。
        Image img = new Image(url, true);
        if (img.getProgress() < 1.0) {
            img.progressProperty().addListener((o, was, now) -> {
                if (now.doubleValue() >= 1.0) {
                    javafx.application.Platform.runLater(() -> {
                        current = img.getException() == null ? img : Assets.image("artwork.png");
                        draw();
                    });
                }
            });
        } else {
            current = img.getException() == null ? img : Assets.image("artwork.png");
            draw();
        }
    }

    private void draw() {
        double w = canvas.getWidth();
        double h = canvas.getHeight();
        g.clearRect(0, 0, w, h);
        if (current == null || current.getWidth() <= 0 || current.getHeight() <= 0) {
            g.setFill(FALLBACK_BG);
            g.fillRect(0, 0, w, h);
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