package com.jello.music.tools;

import javax.imageio.ImageIO;
import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.image.BufferedImage;
import java.io.File;

/**
 * 截取<b>真实桌面</b>，用来看运行中的面板到底透不透。
 *
 * <p>{@link TransparencyProbe} 用 {@code Node.snapshot} 只能在 Scene 内测——
 * 而 snapshot 会把子节点合成掉，看不到「窗口与桌面之间」的合成结果。
 * 「面板能不能透出桌面」这件事只能靠截屏回答。
 *
 * <p>刻意<b>不引 JavaFX</b>：纯 {@code java.awt.Robot} 就够，
 * 少一层依赖也少一个模块路径上的坑。
 *
 * <p>用法：应用已经跑起来之后，另起一个进程跑这个：
 * <pre>
 *   java --module-path ... -m com.jello.music/com.jello.music.tools.DesktopShot [文件名]
 * </pre>
 */
public final class DesktopShot {

    private DesktopShot() {
    }

    public static void main(String[] args) throws Exception {
        Rectangle screen = new Rectangle(
                java.awt.Toolkit.getDefaultToolkit().getScreenSize());
        BufferedImage shot = new Robot().createScreenCapture(screen);
        File out = new File(System.getProperty("java.io.tmpdir"),
                args.length > 0 ? args[0] : "jello-desktop.png");
        ImageIO.write(shot, "png", out);
        System.out.println("screen " + shot.getWidth() + "x" + shot.getHeight()
                + " -> " + out);
    }
}
