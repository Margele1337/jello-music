package com.jello.music;

import java.util.prefs.BackingStoreException;
import java.util.prefs.Preferences;

/**
 * 少量本地设置 —— 对应原版 {@code SigmaUI.vue} 用 localStorage 存的那几项。
 *
 * <p>Java 版走 {@link Preferences}（Windows 下落在注册表的 HKCU\Software\JavaSoft\Prefs），
 * 等价于 localStorage 的「按用户持久化、跨会话有效、不进代码仓库」。
 *
 * <p>目前只有一项：新手教程是否已完成（{@code jello-onboarding-done}）。
 */
public final class AppPrefs {

    private static final String ONBOARDING_DONE = "jello-onboarding-done";

    private static final Preferences NODE =
            Preferences.userNodeForPackage(AppPrefs.class);

    private AppPrefs() {
    }

    public static boolean onboardingDone() {
        return "1".equals(NODE.get(ONBOARDING_DONE, "0"));
    }

    public static void setOnboardingDone() {
        NODE.put(ONBOARDING_DONE, "1");
        try {
            NODE.flush();
        } catch (BackingStoreException e) {
            System.err.println("[Jello] 设置写入失败: " + e.getMessage());
        }
    }

    /** 首次启动才弹教程：跑过一次就不再来。原版也是这个判断。 */
    public static boolean shouldShowOnboarding() {
        return !onboardingDone();
    }
}