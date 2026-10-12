package com.jello.music.tools;

import com.jello.music.ui.EdgeDock;
import com.jello.music.ui.PlayerPanel;
import com.jello.music.ui.Theme;

import javafx.application.Platform;
import javafx.geometry.Rectangle2D;
import javafx.scene.Scene;
import javafx.scene.layout.StackPane;
import javafx.scene.paint.Color;
import javafx.stage.Screen;
import javafx.stage.Stage;
import javafx.stage.StageStyle;

import javax.imageio.ImageIO;
import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 收起态的<b>真实桌面</b>验证：窗口贴在屏幕右缘、只露出 40px，
 * 然后截屏看那 40px 到底显示的是<b>半透明的面板</b>还是<b>白色</b>。
 *
 * <p>{@code Node.snapshot} 测不出这件事——它只在 Scene 内合成，
 * 看不到「Stage 与桌面之间」的 DWM 合成结果。只有截屏能回答。
 *
 * <p>之所以怀疑这里：用户报告「收起时还是有白色」。
 * 收起时 root.opacity = 0.5，按理该透出桌面；
 * 如果看到白色，可能是 JavaFX 的 TRANSPARENT Stage 在
 * 「整窗几乎完全移出屏幕、只剩一条窄边」时 DWM 分层合成的边界情况。
 */
public final class DockedShot {

    private DockedShot() {
    }

    public static void main(String[] args) throws Exception {
        CountDownLatch ready = new CountDownLatch(1);
        Platform.startup(() -> {
            try {
                run();
            } catch (Throwable t) {
                t.printStackTrace();
            } finally {
                ready.countDown();
            }
        });
        ready.await(40, TimeUnit.SECONDS);
        Thread.sleep(1200); // 等 DWM 合成稳定
        Platform.exit();
    }

    private static void run() throws Exception {
        Rectangle2D area = Screen.getPrimary().getVisualBounds();
        System.out.println("=== 收起态真实桌面验证 ===");
        System.out.println("屏幕 " + (int) area.getWidth() + "x" + (int) area.getHeight()
                + " 右界 " + (int) area.getMaxX());

        PlayerPanel panel = new PlayerPanel();
        StackPane overlay = new StackPane(panel);
        panel.setOpacity(0.5); // EdgeDock 收起稳态就是 0.5

        Stage stage = new Stage();
        stage.initStyle(StageStyle.TRANSPARENT);
        Scene scene = new Scene(overlay, Theme.PANEL_W, Theme.PANEL_H);
        scene.setFill(Color.TRANSPARENT);
        stage.setScene(scene);
        // 必须置顶：否则桌面上别的窗口（实测时是 QQ 音乐）会盖住这块区域，
        // 截出来的是人家的窗口，看起来就像「面板发白」
        stage.setAlwaysOnTop(true);
        stage.toFront();

        EdgeDock dock = new EdgeDock(stage);
        dock.attachOpacityTarget(panel);
        stage.show();
        dock.placeInitially();

        double dockedX = area.getMaxX() - 40;
        System.out.println("收起位 x=" + (int) dockedX + "（露出 40px）");
        System.out.println("面板右缘 " + (int) (stage.getX() + stage.getWidth())
                + " -> 越界");
        System.out.println("实际 stage.getX()=" + (int) stage.getX()
                + "  与目标差 " + (int) (stage.getX() - dockedX)
                + "px（Windows 可能拒绝把窗口放到这个位置）");
        Thread.sleep(600);

        int x0 = (int) dockedX;
        int w = 44;
        int y0 = (int) (area.getMaxY() - 620) / 2;
        int h = 60;

        // 先截「同一位置、窗口还没过去」的底图，算出真实的桌面底色。
        // 不这么做就无法判断截到的是面板还是别的窗口——
        // 实测里就因为桌面上有个白色窗口，把 40px 认成了面板发白。
        stage.setX(area.getMaxX() - 400); // 先挪开
        Thread.sleep(500);
        BufferedImage backdrop = capture(x0, y0, w, h);
        stage.setX(dockedX);
        Thread.sleep(700);

        BufferedImage shot = capture(x0, y0, w, h);
        System.out.println();
        System.out.println("收起位 40px 区域：");
        dump(shot, w, h);
        System.out.println("同一位置的桌面底色（窗口挪开时）：");
        dump(backdrop, w, h);
        System.out.println();

        // 逐像素比：与桌面底色一致 = 那块其实不是面板，是后面的窗口
        int same = 0, total = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int a = shot.getRGB(x, y);
                int b = backdrop.getRGB(x, y);
                total++;
                if (Math.abs(((a >> 16) & 0xFF) - ((b >> 16) & 0xFF)) < 6
                        && Math.abs(((a >> 8) & 0xFF) - ((b >> 8) & 0xFF)) < 6
                        && Math.abs((a & 0xFF) - (b & 0xFF)) < 6) {
                    same++;
                }
            }
        }
        int samePct = same * 100 / Math.max(1, total);
        System.out.println("与桌面底色一致的像素：" + samePct + "%");
        System.out.println();
        if (samePct > 80) {
            System.out.println("  >>> 面板根本没出现在这块区域 <<<（露出的 40px 是它后面的东西）");
        } else if (isNearWhite(shot) && !isNearWhite(backdrop)) {
            System.out.println("  >>> 面板确实发白（桌面底色不白，但面板是白的）<<<");
        } else {
            System.out.println("  >>> 面板是半透明的，能透出桌面 <<<");
        }
        save(shot, "jello-docked-strip.png");
        save(backdrop, "jello-docked-backdrop.png");
        save(full(), "jello-docked-full.png");
    }

    private static boolean isNearWhite(BufferedImage img) {
        int light = 0, total = 0;
        for (int y = 0; y < img.getHeight(); y++) {
            for (int x = 0; x < img.getWidth(); x++) {
                int rgb = img.getRGB(x, y) & 0xFFFFFF;
                int r = (rgb >> 16) & 0xFF, g = (rgb >> 8) & 0xFF, b = rgb & 0xFF;
                total++;
                if (r > 200 && g > 200 && b > 200) {
                    light++;
                }
            }
        }
        return total > 0 && light * 100 / total > 60;
    }

    private static boolean isDark(BufferedImage img) {
        int dark = 0, total = 0;
        for (int y = 0; y < img.getHeight(); y++) {
            for (int x = 0; x < img.getWidth(); x++) {
                int rgb = img.getRGB(x, y) & 0xFFFFFF;
                int r = (rgb >> 16) & 0xFF, g = (rgb >> 8) & 0xFF, b = rgb & 0xFF;
                total++;
                if ((r + g + b) / 3 < 90) {
                    dark++;
                }
            }
        }
        return total > 0 && dark * 100 / total > 60;
    }

    private static void dump(BufferedImage img, int w, int h) {
        // 采样几列，打印主色
        for (int frac = 0; frac <= 4; frac++) {
            int x = Math.min(w - 1, frac * (w - 1) / 4);
            StringBuilder sb = new StringBuilder();
            for (int fracY = 0; fracY <= 2; fracY++) {
                int y = Math.min(h - 1, fracY * (h - 1) / 2);
                sb.append(String.format("(%d,%d)=#%06X  ", x, y, img.getRGB(x, y) & 0xFFFFFF));
            }
            System.out.println("    " + sb);
        }
    }

    private static BufferedImage capture(int x, int y, int w, int h) throws Exception {
        return new Robot().createScreenCapture(new Rectangle(x, y, w, h));
    }

    private static BufferedImage full() throws Exception {
        return new Robot().createScreenCapture(new Rectangle(
                (int) (Screen.getPrimary().getVisualBounds().getMaxX() - 500),
                100, 500, 700));
    }

    private static void save(BufferedImage img, String name) throws Exception {
        File f = new File(System.getProperty("java.io.tmpdir"), name);
        ImageIO.write(img, "png", f);
        System.out.println("  截图: " + f);
    }
}
