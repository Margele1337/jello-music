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
}