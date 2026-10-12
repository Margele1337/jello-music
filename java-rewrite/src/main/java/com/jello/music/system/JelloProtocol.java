package com.jello.music.system;

import java.util.Locale;

/**
 * {@code jello://} 协议，1:1 复刻原版 {@code electron/appServices.js:1481-1545}
 * 的 {@code registerProtocolHandler} / {@code handleUrl}。
 *
 * <p>原版做的事：
 * <pre>
 *   app.setAsDefaultProtocolClient('jello', process.execPath);
 *   handleUrl(url) {
 *     hash    = url.searchParams.get('hash')   || ''
 *     listid  = url.searchParams.get('listid') || ''
 *     urlPath = url.pathname.substring(1)    // 去掉前导斜杠
 *     → 发'url-params' 给渲染进程，由它决定播哪首
 *   }
 * </pre>
 *
 * <p>Electron 用 {@code app.setAsDefaultProtocolClient} 一句搞定注册，
 * Java 没有等价 API，所以走注册表：{@code HKCU\Software\Classes\jello}
 * 下写 {@code URL Protocol} 与 {@code shell\open\command}，
 * 效果与 {@code setAsDefaultProtocolClient} 一致。
 */
public final class JelloProtocol {

    /** 协议名，不带 {@code ://}。 */
    public static final String SCHEME = "jello";

    /** 注册表里的协议键。 */
    private static final String CLASSES_KEY =
            "Software\\Classes\\" + SCHEME;

    /** 从命令行解析出来的分享内容。 */
    public record Share(String hash, String listId, String path) {
        /** 是否带上了可播放的信息。 */
        public boolean isPlayable() {
            return (hash != null && !hash.isBlank())
                    || (listId != null && !listId.isBlank());
        }
    }

    private JelloProtocol() {
    }

    /**
     * 从启动参数里找 {@code jello://} URL。
     *
     * <p>Windows 上协议被点击时，URL 会作为命令行参数传进来，
     * 位置不固定（可能在 exe 之后、也可能被引号包住），所以逐个扫。
     *
     * @return 找到的 URL；没有则返回 null
     */
    public static String findUrlIn(String[] args) {
        if (args == null) {
            return null;
        }
        String prefix = SCHEME + "://";
        for (String a : args) {
            if (a == null) {
                continue;
            }
            String trimmed = a.trim();
            // 去掉可能存在的引号（cmd 传参会带）
            if (trimmed.length() >= 2 && trimmed.startsWith("\"")
                    && trimmed.endsWith("\"")) {
                trimmed = trimmed.substring(1, trimmed.length() - 1);
            }
            if (trimmed.toLowerCase(Locale.ROOT).startsWith(prefix)) {
                return trimmed;
            }
        }
        return null;
    }

    /**
     * 解析 {@code jello://} URL。
     *
     * <p>对应原版 {@code handleUrl}：取 hash / listid 两个 query 参数，
     * 以及去掉前导斜杠的 path。
     *
     * <p><b>不引 URL 解析器</b>：原版用浏览器的 {@code new URL}，
     * Java 侧手写更省事，也避免 {@code java.net.URI} 对非标准 scheme 的严格校验
     * （{@code jello://search?hash=xxx} 这类host 为空的形式会被 URI 判成非法）。
     */
    public static Share parse(String url) {
        if (url == null || url.isBlank()) {
            return new Share("", "", "");
        }
        String rest = url.trim();
        String lower = rest.toLowerCase(Locale.ROOT);
        if (lower.startsWith(SCHEME + "://")) {
            rest = rest.substring((SCHEME + "://").length());
        } else if (lower.startsWith(SCHEME + ":")) {
            rest = rest.substring((SCHEME + ":").length());
        }

        String query = "";
        int q = rest.indexOf('?');
        if (q >= 0) {
            query = rest.substring(q + 1);
            rest = rest.substring(0, q);
        }
        // 去掉 fragment（# 之后）
        int hashIdx = rest.indexOf('#');
        if (hashIdx >= 0) {
            rest = rest.substring(0, hashIdx);
        }
        // 原版是 url.pathname.substring(1)，即去掉前导斜杠
        String path = rest.startsWith("/") ? rest.substring(1) : rest;

        String hash = "";
        String listId = "";
        for (String pair : query.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int eq = pair.indexOf('=');
            String k = eq >= 0 ? pair.substring(0, eq) : pair;
            String v = eq >= 0 ? urlDecode(pair.substring(eq + 1)) : "";
            switch (k.toLowerCase(Locale.ROOT)) {
                case "hash" -> hash = v;
                case "listid" -> listId = v;
                default -> {
                    // 其余参数原版也不处理
                }
            }
        }
        return new Share(hash, listId, path);
    }

    private static String urlDecode(String s) {
        try {
            return java.net.URLDecoder.decode(s,
                    java.nio.charset.StandardCharsets.UTF_8);
        } catch (RuntimeException e) {
            return s;
        }
    }

    /** 本机是否支持（协议是 Windows 上的概念）。 */
    public static boolean isSupported() {
        return System.getProperty("os.name", "")
                .toLowerCase(Locale.ROOT).startsWith("windows");
    }

    /**
     * 把当前可执行文件注册为 {@code jello://} 的处理程序。
     *
     * <p>写三个值：
     * <ul>
     *   <li>{@code (默认) = "URL:Jello Protocol"} —— 显示名</li>
     *   <li>{@code URL Protocol = ""} —— 有这个空值键才被系统认作协议</li>
     *   <li>{@code shell\open\command = "<exe>" "%1"} —— 实际执行</li>
     * </ul>
     *
     * <p>用 {@link java.util.prefs.Preferences} 写注册表而不是 JNA 直调
     * {@code RegSetValueEx}：后者在这台机器上返回
     * {@code ERROR_ACCESS_DENIED = 1010}（见 {@link AutoStart} 的注释）。
     *
     * @param executable 目标可执行文件；传 null 时用当前进程的 java.home 推
     * @return 是否写入成功
     */
    public static boolean register(String executable) {
        if (!isSupported()) {
            return false;
        }
        String cmd = executable != null ? executable : guessCommand();
        if (cmd == null) {
            return false;
        }
        try {
            java.util.prefs.Preferences root =
                    java.util.prefs.Preferences.userRoot()
                            .node("/Software/Classes/" + SCHEME);
            root.put("", "URL:Jello Protocol");
            // 空字符串值：Windows 靠它判定这是协议处理器
            root.put("URL Protocol", "");
            java.util.prefs.Preferences shell =
                    root.node("shell/open/command");
            shell.put("", "\"" + cmd + "\" \"%1\"");
            shell.flush();
            root.flush();
            return true;
        } catch (java.util.prefs.BackingStoreException | RuntimeException e) {
            System.err.println("[JelloProtocol] 注册 jello:// 失败: " + e);
            return false;
        }
    }

    /**
     * 猜当前的启动命令。
     *
     * <p>打包形态用 exe 本身；开发形态沿用 {@link AutoStart} 的那套
     * （含 module-path，否则 JavaFX 拒绝从 classpath 加载）。
     */
    private static String guessCommand() {
        return AutoStart.locatePackagedExe() != null
                ? AutoStart.locatePackagedExe().getAbsolutePath()
                : AutoStart.loginCommand();
    }

    /** 取消注册（还原成没有处理程序）。 */
    public static boolean unregister() {
        if (!isSupported()) {
            return false;
        }
        try {
            java.util.prefs.Preferences.userRoot()
                    .node("/Software/Classes/" + SCHEME + "/shell/open")
                    .removeNode();
            return true;
        } catch (java.util.prefs.BackingStoreException | RuntimeException e) {
            return false;
        }
    }
}