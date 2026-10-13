package com.jello.music.system;

import com.sun.jna.Library;
import com.sun.jna.Native;
import com.sun.jna.Platform;
import com.sun.jna.Pointer;
import com.sun.jna.Structure;

import java.awt.Rectangle;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 前台窗口是否全屏 —— 用来在游戏全屏时把频谱窗贴到<b>屏幕物理底边</b>。
 *
 * <h2>对应原版</h2>
 * <pre>
 *   electron/services/fullscreenWatcher.js  161 行 PowerShell 探针
 *   electron/appServices.js:170-191        getSpectrumAnchorBottom()
 *     有应用全屏 -&gt; anchorArea = display.bounds    （物理底边，绕过任务栏）
 *     否则      -&gt; anchorArea = display.workArea  （任务栏上沿）
 *   electron/appServices.js:192-203        anchorSpectrumWindow() 按 y 贴底
 * </pre>
 *
 * <h2>为什么用 JNA 而不是照抄 PowerShell 探针</h2>
 * 原版起一个常驻 PowerShell 子进程，每 300~500ms 跑一次
 * {@code GetForegroundWindow + GetWindowRect + MonitorFromWindow + GetMonitorInfo}，
 * 再从 stdout 读 {@code "1,x,y,w,h"}。Java 侧这些都在 {@code user32} 里，
 * {@link User32} 已经直接提供，<b>不需要子进程、不需要解析文本</b>。
 *
 * <p>轮询仍由调用方决定（原版 300ms 一次足够，人感知不到）。
 */
public final class FullscreenWatcher {

    private FullscreenWatcher() {
    }

    /**
     * 需要的几个 {@code user32} 导出，自己声明即可。
     *
     * <p>本项目只依赖 {@code net.java.dev.jna:jna}（核心），
     * <b>没有</b> {@code jna-platform}（那里面才有现成的 {@code User32}），
     * 所以在这里手写映射 —— 也正好只要这 5 个函数。
     */
    private interface User32 extends Library {
        User32 INSTANCE = Native.load("user32", User32.class);

        Pointer GetForegroundWindow();

        Pointer GetShellWindow();

        boolean IsWindowVisible(Pointer hWnd);

        boolean GetWindowRect(Pointer hWnd, RECT rect);

        boolean GetMonitorInfo(Pointer hMonitor, MONITORINFO info);

        /** {@code MonitorFromWindow}，flags=2 时是 DEFAULTTONEAREST。 */
        Pointer MonitorFromWindow(Pointer hWnd, int flags);
    }

    /** {@code RECT}（Win32 的 POINT×2）。 */
    public static final class RECT extends Structure {
        public int left;
        public int top;
        public int right;
        public int bottom;

        @Override
        protected java.util.List<String> getFieldOrder() {
            return java.util.Arrays.asList("left", "top", "right", "bottom");
        }

        public int width() {
            return right - left;
        }

        public int height() {
            return bottom - top;
        }

        /** 转成 {@link Rectangle}（含物理坐标）。 */
        public Rectangle toRect() {
            return new Rectangle(left, top, width(), height());
        }
    }

    /** {@code MONITORINFO}。 */
    public static final class MONITORINFO extends Structure {
        public int cbSize;
        public RECT rcMonitor = new RECT();
        public RECT rcWork = new RECT();
        public int dwFlags;

        @Override
        protected java.util.List<String> getFieldOrder() {
            return java.util.Arrays.asList(
                    "cbSize", "rcMonitor", "rcWork", "dwFlags");
        }
    }

    /**
     * 查前台窗口是否全屏。
     *
     * @return 全屏返回 {@code true}；非 Windows、JNA 不可用、
     *         拿不到前台窗口（锁屏/切换桌面）都返回 {@code false}
     */
    public static boolean isForegroundFullscreen() {
        if (!Platform.isWindows()) {
            return false;
        }
        try {
            User32 u = User32.INSTANCE;
            Pointer hwnd = u.GetForegroundWindow();
            if (hwnd == null || Pointer.NULL.equals(hwnd)) {
                return false;
            }
            // 排除桌面/外壳 —— 它们也是「铺满屏幕」，但不算「应用在全屏」
            Pointer shell = u.GetShellWindow();
            if (hwnd.equals(shell)) {
                return false;
            }
            if (!u.IsWindowVisible(hwnd)) {
                return false;
            }
            RECT wr = new RECT();
            if (!u.GetWindowRect(hwnd, wr)) {
                return false;
            }
            Pointer hmon = u.MonitorFromWindow(hwnd, 2);
            if (hmon == null || Pointer.NULL.equals(hmon)) {
                return false;
            }
            MONITORINFO mi = new MONITORINFO();
            mi.cbSize = mi.size();
            if (!u.GetMonitorInfo(hmon, mi)) {
                return false;
            }
            // 判定：窗口矩形【完全覆盖】所在显示器
            RECT m = mi.rcMonitor;
            return wr.left <= m.left && wr.top <= m.top
                    && wr.right >= m.right && wr.bottom >= m.bottom;
        } catch (Throwable t) {
            // JNA 加载失败等一律当成「非全屏」——宁可频谱贴任务栏上沿，
            // 也不能因为探针挂了把频谱丢到看不见的地方
            return false;
        }
    }

    /**
     * 启动轮询：状态变化时回调。
     *
     * @param intervalMs 轮询间隔，原版 300ms
     * @return 停止句柄；调用 {@link Thread#interrupt()} 即可停
     */
    public static Thread watch(int intervalMs, java.util.function.Consumer<Boolean> onChange) {
        AtomicReference<Boolean> last = new AtomicReference<>(null);
        Thread t = new Thread(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                boolean fs = isForegroundFullscreen();
                Boolean prev = last.getAndSet(fs);
                if (prev == null || prev != fs) {
                    onChange.accept(fs);
                }
                try {
                    Thread.sleep(intervalMs);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }, "jello-fullscreen-watch");
        t.setDaemon(true);
        t.start();
        return t;
    }
}
