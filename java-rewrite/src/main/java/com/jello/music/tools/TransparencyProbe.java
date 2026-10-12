package com.jello.music.tools;

import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.image.WritableImage;
import javafx.scene.layout.StackPane;
import javafx.scene.paint.Color;
import javafx.stage.Screen;
import javafx.stage.Stage;
import javafx.stage.StageStyle;

import java.awt.image.BufferedImage;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 验证「面板能否透出桌面」。
 *
 * <p>原版 Electron：主窗口<b>没有</b> {@code transparent: true}
 * （{@code appServices.js:50-60} 只在频谱窗/歌词窗上设了），
 * 透明完全靠面板内部那几层 {@code rgba}——见
 * {@code SigmaMusicPlayer.vue:632/641/660}：
 * <pre>
 *   .smp-right-panel { background: rgba(38, 38, 38, 0.8); }
 *   .smp-left-panel  { background: rgba(0, 0, 0, 0.95); }
 *   .smp-strip-overlay { background: rgba(1, 1, 1, 0.43); }
 * </pre>
 *
 * <p>Java 版 Theme 里的颜色已经和这三处一致，<b>但</b>窗口被设成了
 * {@link StageStyle#TRANSPARENT}——比原版多了一层。
 * 这层本身不是错，但它意味着「面板没铺满的地方」会真的透明。
 *
 * <p>本探针把 PlayerPanel 的真实底板搭出来，叠在一个<b>纯红背景</b>上截图，
 * 直接看红有多少透上来——比看「有没有白底」更能说明问题。
 */
public final class TransparencyProbe {

    private TransparencyProbe() {
    }

    public static void main(String[] args) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        Platform.startup(() -> {
            try {
                run(done);
            } catch (Throwable t) {
                t.printStackTrace();
                done.countDown();
            }
        });
        done.await(60, TimeUnit.SECONDS);
        Platform.exit();
    }

    private static void run(CountDownLatch done) throws Exception {
        // 红色底：面板的 rgba 透上来的就是这个红
        StackPane canvas = new StackPane();
        canvas.setStyle("-fx-background-color: #ff0000;");
        canvas.setPrefSize(com.jello.music.ui.Theme.PANEL_W,
                com.jello.music.ui.Theme.PANEL_H);

        var player = new com.jello.music.ui.PlayerPanel();
        canvas.getChildren().add(player);

        Stage stage = new Stage();
        stage.initStyle(StageStyle.TRANSPARENT);
        Scene scene = new Scene(canvas,
                com.jello.music.ui.Theme.PANEL_W, com.jello.music.ui.Theme.PANEL_H);
        scene.setFill(Color.TRANSPARENT);
        stage.setScene(scene);

        System.out.println("=== 面板透光实测（底色纯红 #ff0000）===");
        System.out.println("原版底板：左 rgba(0,0,0,0.95) / 右 rgba(38,38,38,0.8) / 条 rgba(1,1,1,0.43)");
        System.out.println();

        // 不 show 也能 snapshot
        WritableImage img = scene.snapshot(null);
        var reader = img.getPixelReader();
        int w = (int) img.getWidth();
        int h = (int) img.getHeight();

        report(reader, w, h, "左栏中心", 125, 250);
        report(reader, w, h, "右栏中心", 500, 250);
        report(reader, w, h, "右栏边缘", 780, 250);
        report(reader, w, h, "底部条中心", 400, 550);
        report(reader, w, h, "封面处", 125, 487);
        report(reader, w, h, "右下角", w - 3, h - 3);

        // 全图统计：有多少像素的 alpha < 255（= 有透光）
        int transparentPixels = 0;
        for (int y = 0; y < h; y += 2) {
            for (int x = 0; x < w; x += 2) {
                if (((reader.getArgb(x, y) >>> 24) & 0xFF) < 255) {
                    transparentPixels++;
                }
            }
        }
        int total = ((h + 1) / 2) * ((w + 1) / 2);
        System.out.println();
        System.out.printf("透光像素占比：%d / %d = %.1f%%%n",
                transparentPixels, total, 100.0 * transparentPixels / total);
        System.out.println("（应该很小：底板 rgba 覆盖了整块面板，只有圆角等边角会透）");

        writePng(img, System.getProperty("java.io.tmpdir") + "/jello-transparency.png");
        System.out.println("截图: " + System.getProperty("java.io.tmpdir")
                + "/jello-transparency.png");
        done.countDown();
    }

    /** 报告一个点的颜色与 alpha。 */
    private static void report(javafx.scene.image.PixelReader r, int w, int h,
                               String name, int x, int y) {
        x = Math.min(x, w - 1);
        y = Math.min(y, h - 1);
        int argb = r.getArgb(x, y);
        int a = (argb >>> 24) & 0xFF;
        int rr = (argb >>> 16) & 0xFF;
        int gg = (argb >>> 8) & 0xFF;
        int bb = argb & 0xFF;
        // 红色通道占比 = 底下的红透上来多少（暗色底板会把红压暗）
        String note;
        if (a == 0) {
            note = "完全透明（红 100% 透上来）";
        } else if (a == 255) {
            note = "完全不透明";
        } else {
            int redThrough = 100 - (rr * 100 / Math.max(1, (a * 255 / 255)));
            note = String.format("半透明 alpha=%.2f，红通道=%d",
                    a / 255.0, rr);
        }
        System.out.printf("  %-10s (%3d,%3d)  rgba(%3d,%3d,%3d,%.2f)  %s%n",
                name, x, y, rr, gg, bb, a / 255.0, note);
    }

    private static void writePng(WritableImage img, String path) throws Exception {
        BufferedImage bi = new BufferedImage(
                (int) img.getWidth(), (int) img.getHeight(),
                BufferedImage.TYPE_INT_ARGB);
        var reader = img.getPixelReader();
        for (int y = 0; y < bi.getHeight(); y++) {
            for (int x = 0; x < bi.getWidth(); x++) {
                bi.setRGB(x, y, reader.getArgb(x, y));
            }
        }
        javax.imageio.ImageIO.write(bi, "png", new java.io.File(path));
    }
}
