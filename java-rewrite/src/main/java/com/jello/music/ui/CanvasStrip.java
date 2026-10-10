package com.jello.music.ui;

import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.effect.GaussianBlur;
import javafx.scene.image.Image;
import javafx.scene.layout.Pane;
import javafx.scene.paint.Color;
import javafx.scene.shape.Rectangle;

/**
 * 底部封面条 —— 复刻原版 {@code SigmaMusicPlayer.vue} 的 {@code .smp-strip}：
 * 取当前封面、cover 裁切铺满 800x94，再整体 {@code filter: blur(15px)}。
 *
 * <p>原版是「先裁切再模糊」，所以这里也保持这个次序：Canvas 只负责把封面按 cover
 * 裁切画满，然后给整个 Canvas 挂 {@link GaussianBlur}，而不是去模糊原图再拉伸——
 * 后者边缘会被拉花，和原版对不上。
 *
 * <p>另外加了 {@code clip}：CSS 的 blur 会溢出元素盒外，JavaFX 挂特效同样会，
 * 不裁的话会糊到上方右栏（那里是半透明底板，一糊就发灰）。
 */
public final class CanvasStrip extends Pane {

    /** 与原版 CSS {@code blur(15px)} 一致。 */
    private static final double BLUR_RADIUS = 15;

    /** 图未就绪 / 加载失败时的兜底底色，避免浅色桌面从透明处透上来。 */
    private static final Color FALLBACK_BG = Color.web("#1a1a1a");

    private final Canvas canvas = new Canvas();
    private final GraphicsContext g;
    private Image current;

    public CanvasStrip(double w, double h) {
        canvas.setWidth(w);
        canvas.setHeight(h);
        canvas.setEffect(new GaussianBlur(BLUR_RADIUS));
        canvas.setClip(new Rectangle(w, h));
        g = canvas.getGraphicsContext2D();
        getChildren().add(canvas);
        current = Assets.image("artwork.png");
        draw();
    }

    /**
     * 直接给定一张已加载好的封面。
     * <p>运行期走 {@link #setCover(String)}；离屏校验用这个，因为不必等异步加载。
     */
    public void setCoverImage(Image img) {
        boolean bad = img == null || img.getWidth() <= 0 || img.getException() != null;
        current = bad ? Assets.image("artwork.png") : img;
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
                    javafx.application.Platform.runLater(() -> setCoverImage(img));
                }
            });
        } else {
            setCoverImage(img);
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

        // cover 裁切：等比铺满画布并居中，多余部分溢出（被 clip 收掉）
        double r = w / h;
        double ir = current.getWidth() / current.getHeight();
        double dw;
        double dh;
        if (ir > r) {
            dh = h;
            dw = h * ir;
        } else {
            dw = w;
            dh = w / ir;
        }
        g.drawImage(current, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
}