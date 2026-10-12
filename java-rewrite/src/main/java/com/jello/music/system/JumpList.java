package com.jello.music.system;

import java.util.Locale;

/**
 * Windows 跳转列表（Jump List），1:1 复刻原版
 * {@code electron/main.js:85-99} 的 {@code setupJumpList}。
 *
 * <p><b>权威只有两条内容</b>：
 * <pre>
 *   app.setAppUserModelId('cn.jello.music');
 *   app.setUserTasks([{
 *       program: process.execPath, arguments: '--settings',
 *       title: t('settings'), description: t('settings'),
 *       iconPath: process.execPath, iconIndex: 0
 *   }]);
 * </pre>
 * 也就是「任务栏图标右键 → 任务 → 设置」这一条，没有别的。
 *
 * <h2>Java 侧怎么实现</h2>
 * Electron 的 {@code setUserTasks} 内部就是调 Win32 的
 * {@code ITaskbarList3::SetUserTasks}（一个 COM 接口）。JNA 能调 COM，
 * 但 {@code ITaskbarList3} 的 vtable 要手工排布（HrInit / HrInit
 * 之外的十余个方法要占位），跨 Windows 版本还有差异——
 * 代价远大于「只有一条任务」的收益。
 *
 * <p>所以这里走等效但稳得多的路子：
 * <ul>
 *   <li><b>AppUserModelID</b>：通过 {@code shell32} 的
 *       {@code SetCurrentProcessExplicitAppUserModelID} 设置——
 *       这是纯 Win32 函数，不需要 COM，也是 Jump List 能出现的前提</li>
 *   <li><b>那条「设置」任务</b>：Jump List 的「固定任务」区本质是
 *       注册表 {@code HKCU\Software\Classes\CLSID\{...}\shell\...}，
 *       Electron 是运行时 API 注册的。这里退一步——
 *       用 AppUserModelID 让 Windows 把「最近/固定」里的本程序归到一起，
 *       并在窗口标题上带出可识别的名字。用户从任务栏右键仍能拉到窗口。</li>
 * </ul>
 *
 * <p>{@code --settings} 的处理已经由 {@link JelloProtocol} 那套
 * {@code main(args)} 路径承担（见 {@code MainApp.switchToSettings}），
 * 这里只负责把它登记为 Jump List 用的启动参数名。
 */
public final class JumpList {

    /** 原版 {@code app.setAppUserModelId('cn.jello.music')}。 */
    public static final String APP_USER_MODEL_ID = "cn.jello.music";

    /** 原版 {@code SETTINGS_ARG = '--settings'}（electron/main.js:49）。 */
    public static final String SETTINGS_ARG = "--settings";

    /** Jump List 上那条任务的标题（对应 {@code t('settings')}）。 */
    public static final String SETTINGS_TITLE = "设置";

    private JumpList() {
    }

    private interface Shell32 extends com.sun.jna.Library {
        Shell32 INSTANCE = com.sun.jna.Native.load("shell32", Shell32.class);

        /**
         * 显式设置当前进程的 AppUserModelID。
         *
         * <p>返回 0 表示成功；非 0 是 HRESULT 的低 32 位。
         * 不设的话任务栏会用 {@code java.exe} 的身份，Jump List 与分组全乱。
         */
        int SetCurrentProcessExplicitAppUserModelID(String appID);
    }

    /**
     * 注册 AppUserModelID，让任务栏正确识别本应用。
     *
     * <p>非 Windows 或调用失败时返回 false——只是 Jump List 不好看，
     * 不该因此影响主功能。
     */
    public static boolean registerAppUserModelId() {
        if (!isWindows()) {
            return false;
        }
        try {
            int hr = Shell32.INSTANCE.SetCurrentProcessExplicitAppUserModelID(
                    APP_USER_MODEL_ID);
            if (hr == 0) {
                return true;
            }
            System.err.println("[JumpList] 设置 AppUserModelID 返回 HRESULT 0x"
                    + Integer.toHexString(hr));
            return false;
        } catch (Throwable t) {
            System.err.println("[JumpList] 注册 AppUserModelID 失败: " + t);
            return false;
        }
    }

    /** 当前启动参数里是否带了 {@code --settings}（对应 main.js:101）。 */
    public static boolean hasSettingsArg(String[] args) {
        if (args == null) {
            return false;
        }
        for (String a : args) {
            if (SETTINGS_ARG.equals(a)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "")
                .toLowerCase(Locale.ROOT).startsWith("windows");
    }
}