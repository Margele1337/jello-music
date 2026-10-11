package com.jello.music.system;

import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 右 Shift（RSHIFT）全局热键 —— 1:1 复刻原版
 * {@code electron/services/globalKeyService.js} 的 Windows 分支。
 *
 * <p>原版的做法是<b>每 8ms 轮询 {@code GetAsyncKeyState(0xA1)}</b>，而不是装低级键盘钩子，
 * 原因写在原文件注释里：游戏普遍注册 Raw Input，会让其它进程的
 * {@code WH_KEYBOARD_LL} 钩子收不到按键（表现为「游戏内不亮」）。
 * 轮询走的是全局键盘状态，游戏里照样有效。Java 侧沿用同一套方案，
 * 只把 FFI 调用换成 JNA（{@code koffi} 的对应物）。
 *
 * <p>触发规则：只在<b>按下沿</b>触发（{@code rshift && !prev}），按住不放不会连发；
 * {@link #setSuspended} 对应原版的 {@code setGlobalKeySuspended}，
 * 用于新手教程等需要用户按 Shift 的场景临时挂起。
 *
 * <p>回调在轮询线程上触发，调用方需要自己切回 FX 线程。
 */
public final class RightShiftPoller implements AutoCloseable {

    /** 抽象的按键状态读取，测试时注入假的，原生实现走 JNA。 */
    public interface KeyState {
        boolean isDown(int vk);
    }

    /** 右 Shift 的虚拟键码，与原版 {@code RSHIFT_VK} 一致。 */
    public static final int VK_RSHIFT = 0xa1;

    /** 轮询间隔，对应原版 {@code POLL_INTERVAL_MS}。 */
    public static final long POLL_INTERVAL_MS = 8;

    private final KeyState keys;
    private final Runnable onRightShift;
    private final ScheduledExecutorService loop;

    private volatile boolean suspended;
    private volatile boolean closed;
    /** 只由轮询线程访问：上一轮是否已按下。 */
    private boolean wasDown;

    public RightShiftPoller(KeyState keys, long pollMillis, Runnable onRightShift) {
        this.keys = keys;
        this.onRightShift = onRightShift;
        this.loop = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "jello-rshift");
            t.setDaemon(true);
            return t;
        });
        // 先采一次当前状态：启动时用户本来就按着 RSHIFT 的话，
        // 不预采样就会被当成一次「刚刚按下」，开机自启时会莫名其妙弹出窗口。
        wasDown = keys.isDown(VK_RSHIFT);
        loop.scheduleWithFixedDelay(this::poll, pollMillis, pollMillis,
                TimeUnit.MILLISECONDS);
    }

    private void poll() {
        if (closed) {
            return;
        }
        boolean down;
        try {
            down = keys.isDown(VK_RSHIFT);
        } catch (Throwable t) {
            // 读键盘状态失败就停掉这条线程，别让异常把调度器干掉
            return;
        }
        if (down == wasDown) {
            return;
        }
        wasDown = down;
        if (down && !suspended) {
            onRightShift.run();
        }
    }

    /** 挂起/恢复（对应 {@code setGlobalKeySuspended}）。 */
    public void setSuspended(boolean flag) {
        this.suspended = flag;
    }

    public boolean isSuspended() {
        return suspended;
    }

    /**
     * 建一个走 Win32 {@code GetAsyncKeyState} 的实例；本机不是 Windows、
     * 或 JNA 加载不了 {@code user32.dll} 时返回 {@code null}（调用方退回窗口内快捷键）。
     */
    public static RightShiftPoller createNative(Runnable onRightShift) {
        if (!isWindows()) {
            return null;
        }
        try {
            User32 user32 = User32.INSTANCE;
            return new RightShiftPoller(
                    vk -> (user32.GetAsyncKeyState(vk) & 0x8000) != 0,
                    POLL_INTERVAL_MS, onRightShift);
        } catch (Throwable t) {
            System.err.println("[RightShiftPoller] 无法加载 user32.dll，全局热键不可用: " + t);
            return null;
        }
    }

    /** 本机是否具备跑原生全局热键的条件（Windows 且 JNA 能加载 user32）。 */
    public static boolean isNativeSupported() {
        if (!isWindows()) {
            return false;
        }
        try {
            return User32.INSTANCE != null;
        } catch (Throwable t) {
            return false;
        }
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows");
    }

    @Override
    public void close() {
        closed = true;
        loop.shutdownNow();
    }

    /**
     * Win32 {@code user32.dll} 的那一个函数。
     *
     * <p>{@code GetAsyncKeyState} 返回 {@code SHORT}：最高位 0x8000 表示当前按着。
     * 只声明这一个函数，不引 {@code jna-platform}（那个包有一大堆本项目用不到的映射）。
     */
    private interface User32 extends com.sun.jna.Library {
        User32 INSTANCE = com.sun.jna.Native.load("user32", User32.class);

        short GetAsyncKeyState(int vKey);
    }
}