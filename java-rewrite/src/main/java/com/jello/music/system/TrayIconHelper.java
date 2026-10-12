package com.jello.music.system;

import javafx.application.Platform;

import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.MenuItem;
import java.awt.PopupMenu;
import java.awt.SystemTray;
import java.awt.TrayIcon;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.image.BufferedImage;

/**
 * 系统托盘图标 + 右键菜单。
 *
 * <p>JavaFX 没有托盘 API，这里用 {@link SystemTray}（AWT）。托盘回调发生在 AWT 线程，
 * 所以所有动作都要用 {@link Platform#runLater} 切回 FX 线程。
 *
 * <p><b>设置入口在这</b>——原版也是从托盘进设置（800x600 的面板上没有齿轮），
 * 之前在面板左下角加的齿轮又和封面/触发条叠在一起不好点，不如统一走托盘。
 *
 * <p>托盘图标用代码现画一个小音符，不额外引二进制资源。
 */
public final class TrayIconHelper {

    private TrayIcon trayIcon;
    /** 自绘菜单（绕开 AWT 原生菜单的字体限制）。 */
    private TrayPopupMenu popup;


    /** 装托盘。系统不支持托盘时静默跳过，不影响主功能。 */
    public void install() {
        if (!SystemTray.isSupported()) {
            System.err.println("[Jello] 系统不支持托盘，设置请从别处进入");
            return;
        }
        try {
            trayIcon = new TrayIcon(makeIcon(), "Jello Music");
            trayIcon.setImageAutoSize(true);

            // <b>不用</b> trayIcon.setPopupMenu(...)：
            // Windows 上 java.awt.MenuItem 走 native peer，菜单由系统
            // TrackPopupMenu 绘制，Java 侧 setFont 完全无效
            // （实测 MenuItem.getFont() 返回 null），而系统菜单字体
            // 没有 CJK 字形 -> 中文全是豆腐块 □□□。
            // 详见 {@link TrayPopupMenu} 的类注释。
            popup = buildMenu();

            // 左键单击展开/收起面板；右键弹自绘菜单。
            // 中键一并处理：某些环境下 TrayIcon 不区分右键与中键。
            trayIcon.addMouseListener(new MouseAdapter() {
                @Override
                public void mouseClicked(MouseEvent e) {
                    if (e.getButton() == MouseEvent.BUTTON1) {
                        run(onTogglePanel);
                    } else if (e.getButton() == MouseEvent.BUTTON3
                            || e.getButton() == MouseEvent.BUTTON2) {
                        TrayPopupMenu.onFx(() ->
                                popup.showAt(e.getX(), e.getY()));
                    }
                }
            });

            SystemTray.getSystemTray().add(trayIcon);
        } catch (Exception e) {
            System.err.println("[Jello] 托盘初始化失败: " + e);
        }
    }

    /** 自绘菜单。条目顺序与原版 Electron 托盘一致。 */
    private TrayPopupMenu buildMenu() {
        TrayPopupMenu menu = new TrayPopupMenu();
        menu.addItem("播放 / 暂停", "tray/play.png", () -> run(onPlayPause));
        menu.addItem("上一首", "tray/prev.png", () -> run(onPrev));
        menu.addItem("下一首", "tray/next.png", () -> run(onNext));
        menu.addSeparator();
        menu.addItem("设置", "tray/home.png", () -> run(onSettings));
        menu.addItem("显示 / 隐藏面板", "tray/show.png", () -> run(onTogglePanel));
        menu.addSeparator();
        menu.addItem("退出", "tray/quit.png", () -> run(onQuit));
        return menu;
    }

    // 动作回调，由 MainApp 接
    public Runnable onPlayPause;
    public Runnable onPrev;
    public Runnable onNext;
    public Runnable onSettings;
    public Runnable onTogglePanel;
    public Runnable onQuit;



    private static void run(Runnable r) {
        if (r != null) {
            r.run();
        }
    }

/**
 * 托盘图标：用<b>原版资源</b> {@code build/icons/icon.ico}，
 * 不再代码现画音符。
 *
 * <p>原文件是一份多尺寸 ico（16/24/32/48/64/128/256），
 * {@link ImageIO} 只会解出<b>第一帧</b>，所以这里自己按目标尺寸挑：
 * {@code javax.imageio} 的 ico 插件只暴露一种尺寸，
 * 靠 {@link Image#getScaledInstance} 缩放反而糊。
 *
 * <p>做法：直接用 {@code Toolkit} 读 ico 的多帧
 * （{@code sun.awt.image.ToolkitImage} 会自己选最接近的尺寸），
 * 托盘 16/24/32 都能拿到原生那一帧，不做缩放。
 *
 * <p>{@code setImageAutoSize(true)} 会让 Windows 再缩一次到托盘格大小，
 * 正好适配不同 DPI 的任务栏。
 */
private static Image makeIcon() {
    Image scaled = loadTraySized();
    if (scaled != null) {
        return scaled;
    }
    // 资源缺失时退回现画音符，保证托盘至少有个图标
    return drawFallbackIcon();
}

/**
 * 读原版 ico 里最接近托盘尺寸的那一帧。
 *
 * <p>{@code ImageIO} 对 ico 只解一帧，且往往是最大的 256，
 * 缩到 16 会糊。这里改用 {@code Toolkit.createImage}，
 * 由 AWT 的 ico 解析器挑帧。
 */
    /**
     * 从原版 {@code app.ico} 里挑出最接近托盘尺寸的那一帧。
     *
     * <p><b>为什么手工解析而不用 AWT 自动挑</b>（走过两条弯路）：
     * <ol>
     *   <li>{@code new ImageIcon(url).getImage()} 在 JPMS 模块化 classpath 下
     *       返回 {@code -1x-1} —— Toolkit 异步加载没完成</li>
     *   <li>{@code Toolkit.createImage} + {@code MediaTracker} 等到了加载完成，
     *       但在模块化 classpath 下照样 {@code -1x-1}（读不到 jar 内资源）</li>
     * </ol>
     *
     * <p>ico 的结构是「6 字节头 + N×16 字节目录项 + 各帧数据」，
     * 目录项给出每帧宽高、字节数、偏移。本文件有 7 帧（16/24/32/48/64/128/256），
     * 32x32 以上的帧内部就是 PNG，直接喂 {@link javax.imageio.ImageIO} 解。
     *
     * <p>挑的是<b>原生那一帧</b>，不做缩放；不同 DPI 由
     * {@code setImageAutoSize(true)} 缩，避免「256 缩到 16」那种糊。
     */
    private static Image loadTraySized() {
        byte[] bytes = readResource("/icons/app.ico");
        if (bytes == null || bytes.length < 6) {
            return null;
        }
        int frames = (bytes[4] & 0xFF) | ((bytes[5] & 0xFF) << 8);
        // 托盘常见 16/24/32，选最接近 24 的那一帧
        int want = 24;
        int bestOff = -1;
        int bestDiff = Integer.MAX_VALUE;
        for (int i = 0; i < frames; i++) {
            int off = 6 + i * 16;
            if (off + 16 > bytes.length) {
                break;
            }
            int diff = Math.abs((bytes[off] & 0xFF) - want);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestOff = off;
            }
        }
        if (bestOff < 0) {
            return null;
        }
        int size = le32(bytes, bestOff + 8);
        int pos = le32(bytes, bestOff + 12);
        if (size <= 0 || pos < 0 || pos + size > bytes.length) {
            System.err.println("[Jello] app.ico 帧越界 size=" + size + " pos=" + pos);
            return null;
        }
        byte[] frame = new byte[size];
        System.arraycopy(bytes, pos, frame, 0, size);
        BufferedImage bi = decodeIcoFrame(frame);
        if (bi == null) {
            // 兜底：极老的 ico 里会直接塞整张 PNG
            try {
                bi = javax.imageio.ImageIO.read(
                        new java.io.ByteArrayInputStream(frame));
            } catch (Exception ignored) {
                // 下面统一报 null
            }
        }
        return bi;
    }

    /**
     * 解 ico 的一帧。
     *
     * <p>本文件 16/24/32/48/64/128 各帧内部都是 <b>32 位无压缩 BMP</b>
     * （{@code BITMAPINFOHEADER}，biHeight 是宽的 2 倍 —— 多出来那半是 AND 掩码），
     * 只有 256 那帧是 PNG。所以 {@link javax.imageio.ImageIO} <b>解不了</b>
     * （它不认 BMP-in-ICO），必须手工走一遍。
     *
     * <p>格式（{@code BITMAPINFOHEADER} 40 字节后接像素）：
     * <pre>
     *   偏移 0  : biSize = 40
     *   偏移 4  : biWidth
     *   偏移 8  : biHeight = 实际高 × 2（像素 + 掩码）
     *   偏移 14 : biBitCount = 32
     *   偏移 16 : biCompression = 0 (BI_RGB)
     *   偏移 20 : biSizeImage
     *   偏移 40 : BGRA 像素，自<b>下</b>向上、每行 4 字节对齐
     * </pre>
     */
    private static BufferedImage decodeIcoFrame(byte[] d) {
        if (d.length < 40) {
            return null;
        }
        int headerSize = (d[0] & 0xFF) | ((d[1] & 0xFF) << 8)
                | ((d[2] & 0xFF) << 16) | ((d[3] & 0xFF) << 24);
        if (headerSize != 40) {
            return null; // 不是 BITMAPINFOHEADER，交给 ImageIO 试
        }
        int w = (d[4] & 0xFF) | ((d[5] & 0xFF) << 8)
                | ((d[6] & 0xFF) << 16) | ((d[7] & 0xFF) << 24);
        int h2 = (d[8] & 0xFF) | ((d[9] & 0xFF) << 8)
                | ((d[10] & 0xFF) << 16) | ((d[11] & 0xFF) << 24);
        int bits = (d[14] & 0xFF) | ((d[15] & 0xFF) << 8);
        int compression = (d[16] & 0xFF) | ((d[17] & 0xFF) << 8)
                | ((d[18] & 0xFF) << 16) | ((d[19] & 0xFF) << 24);
        if (w <= 0 || bits != 32 || compression != 0) {
            // 只处理最常见的 32 位无压缩；其它交给调用方兜底
            return null;
        }
        int h = h2 / 2;
        if (h <= 0) {
            return null;
        }
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        int stride = w * 4;
        int base = 40;
        for (int y = 0; y < h; y++) {
            int srcRow = (h - 1 - y) * stride; // BMP 自下而上
            for (int x = 0; x < w; x++) {
                int p = base + srcRow + x * 4;
                if (p + 3 >= d.length) {
                    break;
                }
                int b = d[p] & 0xFF;
                int g = d[p + 1] & 0xFF;
                int r = d[p + 2] & 0xFF;
                int a = d[p + 3] & 0xFF;
                out.setRGB(x, y, (a << 24) | (r << 16) | (g << 8) | b);
            }
        }
        return out;
    }

    /** 读 classpath 资源为字节数组。 */
    private static byte[] readResource(String path) {
        try (java.io.InputStream in =
                     TrayIconHelper.class.getResourceAsStream(path)) {
            return in == null ? null : in.readAllBytes();
        } catch (Exception e) {
            System.err.println("[Jello] 读资源失败 " + path + ": " + e);
            return null;
        }
    }

    /** 小端 32 位有符号读（ico 目录项用）。 */
    private static int le32(byte[] b, int off) {
        if (off + 4 > b.length) {
            return -1;
        }
        return (b[off] & 0xFF) | ((b[off + 1] & 0xFF) << 8)
                | ((b[off + 2] & 0xFF) << 16) | ((b[off + 3] & 0xFF) << 24);
    }

/** 资源读不到时的兜底：现画一个小音符。 */
private static Image drawFallbackIcon() {
    int size = 32;
    BufferedImage img = new BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB);
    Graphics2D g = img.createGraphics();
    g.setRenderingHint(java.awt.RenderingHints.KEY_ANTIALIASING,
            java.awt.RenderingHints.VALUE_ANTIALIAS_ON);
    // 圆形深底，和面板配色一致
    g.setColor(new Color(0x14, 0x16, 0x1b));
    g.fillOval(0, 0, size - 1, size - 1);
    g.setColor(Color.WHITE);
    // 符头 + 符干 + 符尾
    int cx = size / 2;
    g.fillOval(cx - 7, size - 15, 8, 6);
    g.fillRect(cx + 1, 8, 3, size - 15);
    g.fillRect(cx + 1, 8, 9, 3);
    g.fillRect(cx + 7, 8, 3, 9);
    g.dispose();
    return img;
}

    public void dispose() {
        if (popup != null) {
            TrayPopupMenu.onFx(popup::hide);
            popup = null;
        }
        if (trayIcon != null && SystemTray.isSupported()) {
            SystemTray.getSystemTray().remove(trayIcon);
            trayIcon = null;
        }
    }
}