package com.jello.music.system;

import javafx.stage.Window;

import java.lang.reflect.Method;

/**
 * 频谱悬浮窗的「鼠标穿透」，对应原版 Electron 的
 * {@code ipcRenderer.send('set-spectrum-ignore-mouse-events', locked)}。
 *
 * <h2>为什么必须走 Win32</h2>
 * JavaFX 21 <b>没有</b>公开的鼠标穿透开关（{@code Scene} 上不存在
 * {@code setMouseTransparent}，{@code Stage} 上也没有对应物）。
 * {@code com.sun.javafx.tk.quantum.WindowUtils} 在 21 里已被移除，
 * 只剩包私有的 {@code WindowStage.getRawHandle()}。
 *
 * <p>所以这里反射取到原生窗口句柄，再用 {@code WS_EX_TRANSPARENT}
 * 让 Windows 把鼠标事件整个跳过这个窗口——这正是 Electron 内部做的事，
 * 语义完全一致（点击直接落到下层窗口，频谱窗自己收不到鼠标）。
 *
 * <p>取不到句柄（非 Windows / JNA 加载失败 / JavaFX 版本变化）时
 * <b>不抛异常</b>，退化成「不穿透」：频谱窗会挡住点击，但不影响播放与绘制。
 */
public final class MousePassthrough {

    /** {@code GetWindowLongPtrW} 的 GWL_EXSTYLE。 */
    private static final int GWL_EXSTYLE = -20;

    /** {@code WS_EX_TRANSPARENT}：鼠标事件穿透到下层窗口。 */
    private static final int WS_EX_TRANSPARENT = 0x00000020;

    /** {@code WS_EX_LAYERED}：分层窗口，配合 TRANSPARENT 才稳定生效。 */
    private static final int WS_EX_LAYERED = 0x00080000;

    /** {@code WS_EX_TOOLWINDOW}：不在任务栏 / Alt-Tab 里出现。 */
    private static final int WS_EX_TOOLWINDOW = 0x00000080;

    /** {@code WS_EX_NOACTIVATE}：点击时不抢焦点。 */
    private static final int WS_EX_NOACTIVATE = 0x08000000;

    private static Gdi32 gdi32;

    private MousePassthrough() {
    }

    private interface Gdi32 extends com.sun.jna.Library {
        Gdi32 INSTANCE = com.sun.jna.Native.load("gdi32", Gdi32.class);

        /** 32 位版本；本项目只在 x64 Windows 上跑，指针宽度一致。 */
        int GetWindowLongW(com.sun.jna.Pointer hWnd, int nIndex);

        int SetWindowLongW(com.sun.jna.Pointer hWnd, int nIndex, int dwNewLong);
    }

    /**
     * 设置频谱窗的鼠标穿透。
     *
     * @param window 目标窗口（{@link javafx.stage.Stage}）
     * @param passThrough true = 鼠标穿透（锁定态）；false = 正常接收鼠标（解锁态）
     */
    public static void setPassThrough(Window window, boolean passThrough) {
        if (window == null) {
            return;
        }
        long raw = nativeHandle(window);
        if (raw == 0) {
            return;
        }
        try {
            if (gdi32 == null) {
                gdi32 = Gdi32.INSTANCE;
            }
            com.sun.jna.Pointer hwnd = new com.sun.jna.Pointer(raw);
            int ex = gdi32.GetWindowLongW(hwnd, GWL_EXSTYLE);
            if (passThrough) {
                // 分层 + 穿透 + 不抢焦点 + 不进任务栏
                ex |= (WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW);
            } else {
                ex &= ~(WS_EX_TRANSPARENT | WS_EX_NOACTIVATE);
                // 分层必须留着：窗口本身是半透明的，去掉会变成黑底
                ex |= WS_EX_LAYERED | WS_EX_TOOLWINDOW;
            }
            gdi32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex);
        } catch (Throwable t) {
            // 拿不到就退化成不穿透，不影响主流程
            System.err.println("[MousePassthrough] 设置鼠标穿透失败: " + t);
        }
    }

    /**
     * 取 JavaFX 窗口的原生句柄。
     *
     * <p>{@code Window.getImpl()} 在 21 里是包私有的（返回 {@code WindowPeer}），
     * 只能反射。{@code WindowPeer} 有个 {@code getStage()}，再取它的
     * {@code WindowStage.getRawHandle()}。
     */
    private static long nativeHandle(Window window) {
        try {
            Method getImpl = Window.class.getDeclaredMethod("getImpl");
            getImpl.setAccessible(true);
            Object impl = getImpl.invoke(window);
            if (impl == null) {
                return 0;
            }
            Method getStage = impl.getClass().getMethod("getStage");
            Object stage = getStage.invoke(impl);
            if (stage == null) {
                return 0;
            }
            Method getRawHandle = stage.getClass().getMethod("getRawHandle");
            Object raw = getRawHandle.invoke(stage);
            return raw instanceof Long ? (Long) raw : 0;
        } catch (Throwable t) {
            return 0;
        }
    }
}