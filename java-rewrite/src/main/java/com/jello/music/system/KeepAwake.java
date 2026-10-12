package com.jello.music.system;

import com.jello.music.AppPrefs;

import java.util.Locale;

/**
 * 阻止系统休眠，对应原版 {@code electron/main.js:200-202}：
 * <pre>
 *   if (settings?.preventAppSuspension === 'on') {
 *       blockerId = powerSaveBlocker.start('prevent-display-sleep');
 *   }
 * </pre>
 *
 * <h2>Java 侧怎么做</h2>
 * Electron 的 {@code powerSaveBlocker} 内部就是 Win32 的
 * {@code SetThreadExecutionState}，Java 没有直接 API，但那条 Win32 函数是稳定的：
 * <pre>
 *   SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED)
 * </pre>
 * 恢复时传 {@code ES_CONTINUOUS}。
 *
 * <p><b>它是 thread-local 的</b>——只对<b>调用它的那个线程</b>生效。
 * 所以必须挂在 FX 线程上（{@code Platform.runLater}），
 * 挂到后台线程等于没开。这是这�� API 唯一容易踩空的地方。
 *
 * <p>原版用的 {@code 'prevent-display-sleep'} 语义上就是
 * 「不熄屏 + 不让系统进入睡眠」，对应上面那三个 flag。
 */
public final class KeepAwake {

    /** 设置项 key，对应原版 {@code settings.preventAppSuspension}。 */
    public static final String SETTING_KEY = "preventAppSuspension";

    /** 让系统保持唤醒（ES_CONTINUOUS）。 */
    private static final int ES_CONTINUOUS = 0x80000000;

    /** 阻止显示器关闭。 */
    private static final int ES_DISPLAY_REQUIRED = 0x00000002;

    /** 阻止系统进入睡眠。 */
    private static final int ES_SYSTEM_REQUIRED = 0x00000001;

    private KeepAwake() {
    }

    private interface Kernel32 extends com.sun.jna.Library {
        Kernel32 INSTANCE = com.sun.jna.Native.load("kernel32", Kernel32.class);

        /**
         * 设置当前线程的执行状态。
         *
         * @return 之前的状态（取低 32 位），0 表示之前没有任何要求
         */
        int SetThreadExecutionState(int esFlags);
    }

    /** 读设置里的开关。默认关，与原版一致。 */
    public static boolean isEnabledInSettings() {
        return "on".equals(AppPrefs.getSetting(SETTING_KEY, "off"));
    }

    /**
     * 按设置应用。
     *
     * <p><b>必须在 FX 线程调用</b>——{@code SetThreadExecutionState} 是 thread-local 的。
     * 传 {@code false} 时恢复成 {@code ES_CONTINUOUS}（不再阻止休眠）。
     */
    public static void applyFromSettings() {
        apply(isEnabledInSettings());
    }

    /**
     * 开启或关闭「阻止休眠」。
     *
     * @param enabled true = 阻止熄屏与睡眠
     * @return 是否成功（失败一般是非 Windows 或线程不对）
     */
    public static boolean apply(boolean enabled) {
        if (!isWindows()) {
            return false;
        }
        try {
            int flags = enabled
                    ? (ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED)
                    : ES_CONTINUOUS;
            return Kernel32.INSTANCE.SetThreadExecutionState(flags) != 0;
        } catch (Throwable t) {
            System.err.println("[KeepAwake] 设置执行状态失败: " + t);
            return false;
        }
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "")
                .toLowerCase(Locale.ROOT).startsWith("windows");
    }
}