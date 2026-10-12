package com.jello.music.system;

import com.jello.music.AppPrefs;

import java.io.File;
import java.util.Locale;
import java.util.prefs.BackingStoreException;
import java.util.prefs.Preferences;

/**
 * 开机自启，对应原版 {@code electron/main.js:273-277} 的
 * {@code app.setLoginItemSettings({ openAtLogin: settings?.autoStart === 'on' })}。
 *
 * <p>Electron 在 Windows 上就是写注册表
 * {@code HKCU\Software\Microsoft\Windows\CurrentVersion\Run}，
 * 所以这里写同一个键——行为等价，而且从开发模式（{@code run.bat}）
 * 切到打包版（exe）时登录项会自动指向新的可执行文件。
 *
 * <h2>为什么用 {@link Preferences} 而不是 JNA 直调 advapi32</h2>
 * 最初这里用 JNA 调 {@code RegCreateKeyExW}，实测返回
 * {@code ERROR_ACCESS_DENIED = 1010}，而当前用户对 Run 键确实有写权限。
 * 补上 {@code KEY_QUERY_VALUE}（读回校验需要）后仍不通——
 * 这条路在当前环境不稳定，且报错完全看不出是权限位的问题。
 *
 * <p>{@code Preferences} 在 Windows 上默认就是注册表后端
 * （{@code java.util.prefs.WindowsPreferences} → {@code HKCU\Software\JavaSoft\Prefs}），
 * 用自定义节点路径 {@code /Software/Microsoft/Windows/CurrentVersion/Run} 就能落到目标键。
 * 失败时静默降级（只写 stderr），不挡启动。
 */
public final class AutoStart {

    /**
     * 登录项的存储位置。
     *
     * <p>对应 {@code HKCU\Software\Microsoft\Windows\CurrentVersion\Run}。
     * {@code Preferences} 用 {@code /} 分隔层级。
     */
    private static final String RUN_NODE =
            "/Software/Microsoft/Windows/CurrentVersion/Run";

    /** 登录项名。用产品名，和原版的快捷方式名保持一致。 */
    private static final String VALUE_NAME = "Jello Music";

    /** 设置项 key，对应原版 localStorage 的 {@code settings.autoStart}。 */
    private static final String SETTING_KEY = "autoStart";

    private AutoStart() {
    }

    /** 读设置里的开关状态。默认关，与原版 {@code defaultValue: 'off'} 一致。 */
    public static boolean isEnabledInSettings() {
        return "on".equals(AppPrefs.getSetting(SETTING_KEY, "off"));
    }

    /** 把当前设置应用到系统登录项。启动时调一次，设置变更时也调。 */
    public static void applyFromSettings() {
        apply(isEnabledInSettings());
    }

    /**
     * 设置 / 取消开机自启。
     *
     * @param enabled true = 开机启动
     */
    public static void apply(boolean enabled) {
        if (!isWindows()) {
            return;
        }
        try {
            Preferences run = runPrefs();
            if (enabled) {
                String command = loginCommand();
                if (command == null) {
                    System.err.println("[AutoStart] 无法确定启动命令，开机自启未设置");
                    return;
                }
                run.put(VALUE_NAME, command);
            } else {
                run.remove(VALUE_NAME);
            }
            run.flush();
        } catch (BackingStoreException | RuntimeException e) {
            // 拿不到就退化成「开关无效」，不该因此挡住启动
            System.err.println("[AutoStart] 设置开机自启失败: " + e);
        }
    }

    /** 读回当前登录项命令，测试与诊断用；没设置时返回 null。 */
    public static String currentLoginCommand() {
        try {
            return runPrefs().get(VALUE_NAME, null);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static Preferences runPrefs() {
        return Preferences.userRoot().node(RUN_NODE);
    }

    /**
     * 开机要执行的命令行。
     *
     * <p>开发形态是 {@code java -m ...}（还得带 module path，否则 javafx 加载不了），
     * 打包形态是 exe 本身。两条都按当前进程的<b>实际形态</b>拼，
     * 这样从开发切到打包时登录项不会指向失效路径。
     *
     * <p>{@link JelloProtocol} 也用它来猜 {@code jello://} 的处理命令。
     */
    public static String loginCommand() {
        File exe = locatePackagedExe();
        if (exe != null) {
            return "\"" + exe.getAbsolutePath() + "\"";
        }
        // 注意局部变量别叫 java —— 那会遮蔽包名 java.io，
        // 下面写 java.io.File 就变成「字段 java 的 .io.File」直接编译失败。
        String javaHome = System.getProperty("java.home");
        if (javaHome == null) {
            return null;
        }
        String javaw = javaHome + File.separator + "bin" + File.separator + "javaw.exe";
        String real = new File(javaw).exists()
                ? javaw
                : javaHome + File.separator + "bin" + File.separator + "java.exe";
        String mp = devModulePath();
        return "\"" + real + "\"" + (mp == null ? "" : mp)
                + " -m com.jello.music/com.jello.music.MainApp";
    }

    /**
     * 找打包形态下的 {@code JelloMusic.exe}；不在打包形态返回 null。
     *
     * <p>jar 的位置：打包版 {@code <root>\JelloMusic\app\<jar>}，
     * 所以 exe 在 jar 所在目录的<b>上两级</b>。
     *
     * <p>不依赖 jpackage 注入的系统属性——我们重写过 cfg 的 java-options，
     * 那些属性未必还在，按代码位置判断更可靠。
     */
    static File locatePackagedExe() {
        try {
            File jar = codeSourceFile();
            if (jar == null || !jar.isFile()) {
                return null;
            }
            File app = jar.getParentFile();
            File root = app == null ? null : app.getParentFile();
            if (root == null) {
                return null;
            }
            File exe = new File(root, "JelloMusic.exe");
            return exe.isFile() ? exe : null;
        } catch (Throwable t) {
            return null;
        }
    }

    /** 当前代码所在的 classes 目录或 jar 文件。 */
    private static File codeSourceFile() {
        try {
            java.net.URL loc = AutoStart.class.getProtectionDomain()
                    .getCodeSource().getLocation();
            if (loc == null) {
                return null;
            }
            return new File(loc.toURI());
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * 开发形态下的 {@code --module-path} 参数。
     *
     * <p><b>必须显式带上</b>：登录项脱离 {@code run.bat} 启动，拿不到
     * {@code run.bat} 拼的 module path，结果就是
     * {@code Unsupported JavaFX configuration}——javafx 必须在模块路径上。
     * 这里读 {@code cp.txt}（Maven 的 dependency:build-classpath 产物，
     * {@code run.bat} 与 {@code package.ps1} 都用它）再过滤掉不带 classifier 的
     * javafx jar——那会和带 classifier 的重复注册同一个模块。
     */
    private static String devModulePath() {
        try {
            File src = codeSourceFile();
            if (src == null) {
                return null;
            }
            // 开发形态：代码在 target/classes（目录），cp.txt 在 java-rewrite/（上两级）
            // 打包形态：代码是 jar，此时根本不走这条分支
            File home = src.isFile()
                    ? parent(parent(src))          // jar -> app -> root
                    : parent(parent(src));        // target/classes -> target -> root
            if (home == null) {
                return null;
            }
            File cpTxt = new File(home, "cp.txt");
            if (!cpTxt.isFile()) {
                // 再试一层：某些启动方式下根目录会差一级
                File alt = new File(new File(home, ".."), "cp.txt");
                if (!alt.isFile()) {
                    return null;
                }
                cpTxt = alt;
            }
            String deps = java.nio.file.Files.readString(cpTxt.toPath()).trim();
            if (deps.isEmpty()) {
                return null;
            }
            StringBuilder sb = new StringBuilder();
            for (String part : deps.split(";")) {
                String p = part.trim();
                if (p.isEmpty()) {
                    continue;
                }
                String name = p.replace('\\', '/');
                int slash = name.lastIndexOf('/');
                name = slash >= 0 ? name.substring(slash + 1) : name;
                // 不带 classifier 的 javafx jar 会和带 classifier 的重复注册同一模块
                if (name.startsWith("javafx-") && !name.endsWith("-win.jar")) {
                    continue;
                }
                // cp.txt 有可能是被不带 -Dmdep.includeScope 的调用生成的，
                // 里面会混进 junit / opentest4j / apiguardian 这些 test scope 的 jar。
                // 放进登录项纯属浪费（还可能触发模块冲突），一律滤掉
                if (isTestScope(name)) {
                    continue;
                }
                if (sb.length() > 0) {
                    sb.append(';');
                }
                sb.append(p);
            }
            return " --module-path \"" + src.getPath() + ';' + sb + '"';
        } catch (Throwable t) {
            return null;
        }
    }

    private static boolean isTestScope(String jarName) {
        return jarName.startsWith("junit-")
                || jarName.startsWith("junit.")
                || jarName.startsWith("opentest4j-")
                || jarName.startsWith("apiguardian-")
                || jarName.startsWith("hamcrest-");
    }

    private static File parent(File f) {
        return f == null ? null : f.getParentFile();
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows");
    }
}