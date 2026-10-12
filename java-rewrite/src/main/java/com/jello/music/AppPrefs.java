package com.jello.music;

import java.util.Map;
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
    private static final String PLAYBACK_MODE = "player-playback-mode";
    private static final String TOKEN = "userinfo-token";
    private static final String USERID = "userinfo-userid";
    private static final String T1 = "userinfo-t1";
    private static final String NICKNAME = "userinfo-nickname";
    private static final String PIC = "userinfo-pic";
    private static final String GRADE = "userinfo-grade";

    private static final Preferences NODE =
            Preferences.userNodeForPackage(AppPrefs.class);

    private AppPrefs() {
    }

    public static boolean onboardingDone() {
        return "1".equals(NODE.get(ONBOARDING_DONE, "0"));
    }

    public static void setOnboardingDone() {
        NODE.put(ONBOARDING_DONE, "1");
        flush();
    }

    /** 清掉教程标记，下次启动（或「重新观看教程」）会再弹一次。 */
    public static void clearOnboardingDone() {
        NODE.remove(ONBOARDING_DONE);
        flush();
    }

    /**
     * 读回上次的登录态。
     *
     * <p>原版把 {@code MoeData} 整个存进 localStorage，Java 侧对应存这几个字段。
     * 没有它的话每次启动都得重新设 {@code JELLO_*} 环境变量，登录页也就白做了。
     */
    public static com.jello.music.model.UserInfo loadUser() {
        String userid = NODE.get(USERID, "");
        if (userid.isEmpty()) {
            return null;
        }
        com.jello.music.model.UserInfo u = new com.jello.music.model.UserInfo();
        u.setToken(NODE.get(TOKEN, ""));
        u.setUserid(userid);
        u.setT1(NODE.get(T1, ""));
        u.setNickname(NODE.get(NICKNAME, ""));
        u.setPic(NODE.get(PIC, ""));
        u.setGrade(NODE.get(GRADE, ""));
        return u;
    }

    public static void saveUser(com.jello.music.model.UserInfo u) {
        if (u == null) {
            clearUser();
            return;
        }
        NODE.put(TOKEN, u.getToken());
        NODE.put(USERID, u.getUserid());
        NODE.put(T1, u.getT1());
        NODE.put(NICKNAME, u.getNickname());
        NODE.put(PIC, u.getPic());
        NODE.put(GRADE, u.getGrade());
        flush();
    }

    public static void clearUser() {
        for (String k : new String[]{TOKEN, USERID, T1, NICKNAME, PIC, GRADE}) {
            NODE.remove(k);
        }
        flush();
    }

    private static void flush() {
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

    /**
     * 播放模式（0 随机 / 1 列表循环 / 2 单曲循环 / 3 顺序），对应原版
     * {@code localStorage['player_playback_mode']}（{@code PlaybackMode.js:18}），默认 1。
     */
    public static int playbackMode() {
        try {
            return Integer.parseInt(NODE.get(PLAYBACK_MODE, "1"));
        } catch (NumberFormatException e) {
            return 1;
        }
    }

    public static void setPlaybackMode(int mode) {
        NODE.put(PLAYBACK_MODE, String.valueOf(mode));
        flush();
    }

    // ---- 通用设置项（对应原版 localStorage 的各个 key）----

    public static String getSetting(String key, String fallback) {
        return NODE.get(key, fallback);
    }

    public static void setSetting(String key, String value) {
        NODE.put(key, value);
    }

    /** 批量写，最后统一 flush。 */
    public static void putSettings(Map<String, String> values) {
        for (Map.Entry<String, String> e : values.entrySet()) {
            NODE.put(e.getKey(), e.getValue());
        }
        flush();
    }

    // ---- 频谱窗位置 / 大小（对应原版 electron 的 spectrumWindowPosition）----
    //
    // 原版 electron/appServices.js:165 与 main.js:459 都会存这个键。
    // 存成 "x,y" 一对数，用逗号分隔 —— Preferences 只能存字符串，
    // 拆成两个键反而容易出现只写了一半的不一致状态。

    private static final String SPECTRUM_POS_X = "spectrum-window-x";
    private static final String SPECTRUM_POS_Y = "spectrum-window-y";

    /** 频谱窗左上角坐标；没存过（或读出来是 NaN）时返回 null。 */
    public static double[] spectrumWindowPosition() {
        String xs = NODE.get(SPECTRUM_POS_X, null);
        String ys = NODE.get(SPECTRUM_POS_Y, null);
        if (xs == null || ys == null) {
            return null;
        }
        try {
            double x = Double.parseDouble(xs);
            double y = Double.parseDouble(ys);
            if (!Double.isFinite(x) || !Double.isFinite(y)) {
                return null;
            }
            return new double[]{x, y};
        } catch (NumberFormatException e) {
            return null;
        }
    }

    public static void setSpectrumWindowPosition(double x, double y) {
        NODE.put(SPECTRUM_POS_X, String.valueOf(x));
        NODE.put(SPECTRUM_POS_Y, String.valueOf(y));
        flush();
    }
}