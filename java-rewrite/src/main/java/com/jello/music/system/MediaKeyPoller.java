package com.jello.music.system;

import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 系统媒体键，对应原版 {@code MediaSession.js}（浏览器 {@code navigator.mediaSession}）。
 *
 * <p>原版注册的处理：play / pause / previoustrack / nexttrack /
 * seekbackward / seekforward / seekto，并会同步曲名与封面。
 * 浏览器那套在 Java 侧没有对应物，但<b>键盘上的媒体键是真的存在</b>，
 * 而且键盘驱动是以 {@code VK_MEDIA_*} 虚拟键码形式上报的——
 * 所以用与 {@link RightShiftPoller} 相同的方式轮询
 * {@code GetAsyncKeyState} 就能接住，不需要 SMTC 那一整套 COM。
 *
 * <h2>为什么不用 SMTC</h2>
 * 原版 {@code MediaSession} 的元信息（标题/歌手/封面 + 进度条）走的是
 * Windows SMTC，要通过 {@code GlobalSystemMediaTransportControlsSessionManager}
 * 这个 WinRT 接口注册。那套在 Java 里只能靠 JNA 手搓 COM vtable，
 * 依赖 {@code combase.dll} 的 ABI，且不同 Windows 版本行为不一致——
 * 相比之下硬件媒体键是纯 {@code user32} 输入路径，稳定得多。
 * 代价是：键盘能控播放，但系统音量面板/通知栏里看不到曲名与进度。
 *
 * <h2>轮询而非钩子</h2>
 * 与 RSHIFT 同理：游戏普遍注册 Raw Input，
 * {@code WH_KEYBOARD_LL} 钩子会收不到媒体键，轮询则照样有效。
 */
public final class MediaKeyPoller implements AutoCloseable {

    /** 播放 / 暂停（同一个键，原版也只给一个 togglePlayPause）。 */
    public static final int VK_MEDIA_PLAY_PAUSE = 0xB3;
    /** 停止。 */
    public static final int VK_MEDIA_STOP = 0xB2;
    /** 下一首。 */
    public static final int VK_MEDIA_NEXT_TRACK = 0xB0;
    /** 上一首。 */
    public static final int VK_MEDIA_PREV_TRACK = 0xB1;

    /**
     * 轮询间隔。
     *
     * <p>比 RSHIFT 的 8ms 放宽到 25ms：媒体键是人手动按的，
     * 不像游戏里 RSHIFT 那样要跟手，25ms 足够跟手又省 CPU。
     */
    public static final long POLL_MILLIS = 25;

    /** 回调定义。 */
    public interface Handler {
        default void onPlayPause() {
        }

        default void onStop() {
        }

        default void onNext() {
        }

        default void onPrevious() {
        }
    }

    /** 按键状态读取，测试时可注入假的。 */
    public interface KeyState {
        boolean isDown(int vk);
    }

    private final KeyState keys;
    private final Handler handler;
    private final ScheduledExecutorService loop;
    private final int[] tracked;
    private final boolean[] wasDown;
    private volatile boolean closed;

    public MediaKeyPoller(KeyState keys, long pollMillis, Handler handler, int... virtualKeys) {
        this.keys = keys;
        this.handler = handler;
        this.tracked = virtualKeys.length == 0
                ? new int[]{VK_MEDIA_PLAY_PAUSE, VK_MEDIA_STOP,
                    VK_MEDIA_NEXT_TRACK, VK_MEDIA_PREV_TRACK}
                : virtualKeys;
        this.wasDown = new boolean[this.tracked.length];
        this.loop = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "jello-mediakey");
            t.setDaemon(true);
            return t;
        });
        // 预采样：开机自启时用户可能正按着某个键，不预采样会被当成「刚刚按下」
        for (int i = 0; i < tracked.length; i++) {
            wasDown[i] = safeDown(tracked[i]);
        }
        loop.scheduleWithFixedDelay(this::poll, pollMillis, pollMillis, TimeUnit.MILLISECONDS);
    }

    private void poll() {
        if (closed) {
            return;
        }
        for (int i = 0; i < tracked.length; i++) {
            boolean down = safeDown(tracked[i]);
            boolean was = wasDown[i];
            wasDown[i] = down;
            if (down && !was) {
                dispatch(tracked[i]);
            }
        }
    }

    private boolean safeDown(int vk) {
        try {
            return keys.isDown(vk);
        } catch (Throwable t) {
            // 读失败就当没按，别让异常把调度器干掉
            return false;
        }
    }

    private void dispatch(int vk) {
        try {
            if (vk == VK_MEDIA_PLAY_PAUSE) {
                handler.onPlayPause();
            } else if (vk == VK_MEDIA_STOP) {
                handler.onStop();
            } else if (vk == VK_MEDIA_NEXT_TRACK) {
                handler.onNext();
            } else if (vk == VK_MEDIA_PREV_TRACK) {
                handler.onPrevious();
            }
        } catch (Throwable t) {
            System.err.println("[MediaKey] 处理按键失败: " + t);
        }
    }

    /**
     * 建一个走 Win32 {@code GetAsyncKeyState} 的实例；
     * 非Windows 或 JNA 加载失败时返回 null（调用方退回托盘/面板操作）。
     */
    public static MediaKeyPoller createNative(Handler handler) {
        if (!isWindows()) {
            return null;
        }
        try {
            return new MediaKeyPoller(
                    vk -> (User32.INSTANCE.GetAsyncKeyState(vk) & 0x8000) != 0,
                    POLL_MILLIS, handler);
        } catch (Throwable t) {
            System.err.println("[MediaKey] 媒体键不可用: " + t);
            return null;
        }
    }

    /** 本机是否支持（与 RSHIFT 同一个 user32 依赖）。 */
    public static boolean isSupported() {
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
     * Win32 {@code user32.dll} 里的 {@code GetAsyncKeyState}。
     *
     * <p>与 {@link RightShiftPoller} 各自声明了一份——它们的
     * {@code User32} 是私有的嵌套接口，共享会让「一个类加载失败拖垮另一个」。
     */
    private interface User32 extends com.sun.jna.Library {
        User32 INSTANCE = com.sun.jna.Native.load("user32", User32.class);

        short GetAsyncKeyState(int vKey);
    }
}