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

    /** 用来验证字体有没有中文字形的样本。 */
    private static final String CJK_SAMPLE = "播放设置退出上一首下一首";

    /** 装托盘。系统不支持托盘时静默跳过，不影响主功能。 */
    public void install() {
        if (!SystemTray.isSupported()) {
            System.err.println("[Jello] 系统不支持托盘，设置请从别处进入");
            return;
        }
        try {
            trayIcon = new TrayIcon(makeIcon(), "Jello Music");
            trayIcon.setImageAutoSize(true);

            PopupMenu menu = new PopupMenu();

            menu.add(item("播放 / 暂停", () -> run(onPlayPause)));
            menu.add(item("上一首", () -> run(onPrev)));
            menu.add(item("下一首", () -> run(onNext)));
            menu.addSeparator();
            menu.add(item("设置", () -> run(onSettings)));
            menu.add(item("显示 / 隐藏面板", () -> run(onTogglePanel)));
            menu.addSeparator();
            menu.add(item("退出", () -> run(onQuit)));

            trayIcon.setPopupMenu(menu);
            // 左键单击直接展开/收起面板，托盘右键才是菜单
            trayIcon.addMouseListener(new MouseAdapter() {
                @Override
                public void mouseClicked(MouseEvent e) {
                    if (e.getButton() == MouseEvent.BUTTON1) {
                        run(onTogglePanel);
                    }
                }
            });

            SystemTray.getSystemTray().add(trayIcon);
        } catch (Exception e) {
            System.err.println("[Jello] 托盘初始化失败: " + e);
        }
    }

    // 动作回调，由 MainApp 接
    public Runnable onPlayPause;
    public Runnable onPrev;
    public Runnable onNext;
    public Runnable onSettings;
    public Runnable onTogglePanel;
    public Runnable onQuit;

    /**
     * 造一个菜单项。
     *
     * <p><b>字体必须显式指定</b>：AWT 的 {@link MenuItem} 默认走
     * {@code MenuFont.systemFont}，它在部分 Windows 环境（尤其是精简版系统、
     * 缺 {@code msyh.ttc} / {@code simhei.ttf} 时）会退到一个<b>没有中文字形</b>
     * 的字体，于是「播放 / 暂停」渲染成一片豆腐块 □□□。
     *
     * <p>这不是编码问题——源码与 class 都是正确的 UTF-8（已实测字节），
     * 是<b>字体缺字形</b>。所以修复方式是挑一个物理上存在、
     * 且覆盖 CJK 的字体，而不是去转码或加 {@code -Dfile.encoding}。
     */
    private MenuItem item(String label, Runnable action) {
        MenuItem it = new MenuItem(label);
        it.setFont(cjkFont());
        // AWT 的 java.awt.MenuItem <b>没有</b> setIcon（实测 getMethods 里
        // 没有任何 icon 相关方法），它不是 Swing 组件。
        // 原生菜单里塞图标只能加兄弟节点，那会变成可点的独立条目，
        // 出现「点图标区域不触发菜单项」这类怪问题——
        // 所以 AWT 托盘菜单<b>没有可靠的图标方案</b>，保持纯文字。
        // 图标统一放在托盘图标本身（用原版 app.ico）。
        it.addActionListener(e -> Platform.runLater(action));
        return it;
    }

    /**
     * 挑一个带中文字形的字体。
     *
     * <p>按优先级试：微软雅黑 -> 黑体 -> 宋体 -> 系统默认。
     * 每个都用 {@link Font#canDisplayUpTo} 真正验证能否显示中文，
     * 光看名字不算数——字体文件在但字形被裁掉的情况是存在的。
     */
    private static Font cjkFont() {
        // 托盘菜单在 Windows 上按系统 DPI 缩放，14 是可读的下限
        int size = 14;
        for (String name : new String[]{"Microsoft YaHei UI", "Microsoft YaHei",
                "微软雅黑", "SimHei", "黑体", "SimSun", "宋体",
                "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei"}) {
            Font f = new Font(name, Font.PLAIN, size);
            if (f.canDisplayUpTo(CJK_SAMPLE) < 0) {
                return f;
            }
        }
        // 都试遍仍没有：显式用 Dialog，它在 AWT 里做最后兜底，
        // 比默认菜单字体更可能带 CJK fallback
        return new Font(Font.DIALOG, Font.PLAIN, size);
    }

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
        if (trayIcon != null && SystemTray.isSupported()) {
            SystemTray.getSystemTray().remove(trayIcon);
            trayIcon = null;
        }
    }
}