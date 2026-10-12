package com.jello.music.system;

import javafx.application.Platform;

import java.awt.Color;
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

    private MenuItem item(String label, Runnable action) {
        MenuItem it = new MenuItem(label);
        it.addActionListener(e -> Platform.runLater(action));
        return it;
    }

    private static void run(Runnable r) {
        if (r != null) {
            r.run();
        }
    }

    /** 现画一个小音符当托盘图标。 */
    private static Image makeIcon() {
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