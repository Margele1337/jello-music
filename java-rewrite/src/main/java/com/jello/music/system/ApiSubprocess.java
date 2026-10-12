package com.jello.music.system;

import java.io.File;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * 内置 KuGou API 子进程，替代 {@code run.bat} 里的 {@code :api_start} 那套。
 *
 * <p><b>为什么需要</b>：打包出的 {@code JelloMusic.exe} 只带 Java 侧，
 * 而播放链路依赖 {@code api/}（Node 服务，端口 6521）。
 * 之前打包完必须手动 {@code npm run api}，否则 exe 起得来却放不出声。
 *
 * <p>行为与 {@code run.bat} 对齐（{@code :api_alive} / {@code api_start} /
 * {@code :cleanup}）：
 * <ul>
 *   <li>端口已有监听 → <b>什么都不做</b>，用户自己起的 API 不碰</li>
 *   <li>端口没人 → 拉起 API，并记住是自己拉起的</li>
 *   <li>退出时只收掉<b>自己拉起</b>的那个，绝不误杀用户自己的</li>
 * </ul>
 *
 * <h2>优先用单文件 exe，而不是源码目录</h2>
 * {@code api/package.json} 自带 {@code pkgwin} 脚本
 * （{@code pkg . -t node14-win-x64 -C GZip -o bin/app_win}），
 * 产物 {@code api/bin/app_win.exe} 是<b>自带 node 运行时</b>的单文件，34MB。
 * 相比拷整个 {@code api/}（123MB，其中 node_modules 占 88MB）小得多，
 * 而且不要求使用者机器上有 Node。所以优先找它。
 *
 * <p>找不到单文件 exe 时退回源码目录（要求机器上有 node），
 * 最后退回已装的 node + 仓库源码（开发场景）。
 */
public final class ApiSubprocess implements AutoCloseable {

    /** 与 {@code run.bat} 的 {@code API_PORT} 一致。 */
    public static final int PORT = 6521;

    /** 启动后等多久算就绪（秒）。Node 起服务通常 1~2 秒。 */
    private static final int READY_TIMEOUT_SECONDS = 20;

    /**
 * API 入口的<b>目录名</b>候选，按优先级排列。
 *
 * <p>拼在 {@link #baseDir()} 之后。刻意<b>不</b>用相对当前工作目录的路径：
 * 用户从任何位置双击 exe 时 cwd 都不是 exe 目录，相对路径会全部失效。
 */
private static final String[] CANDIDATE_SUBDIRS = {
            "api",        // 打包形态：app\api\app_win.exe（package.ps1 放的）
            "api\\bin",    // 开发形态：仓库里 pkg 产物的位置
            "..\\api",    // 代码在别的层级时
            "..\\api\\bin",
            ".",          // exe 同级
    };

    /** 入口文件名，按优先级。单文件 exe 优先（自带 node）。 */
    private static final String[] CANDIDATE_FILES = {
            "app_win.exe",   // pkg 单文件版，自带 node 运行时，~34MB
            "app.js",        // 源码入口，需要机器上有 node
    };

    private Process process;
    private Path startedFrom;

    private ApiSubprocess() {
    }

    /**
     * 确保 API 在跑。
     *
     * @return true 表示 API 可用（本来就在跑，或我们成功拉起了）
     */
    public static boolean ensureRunning() {
        if (isAlive()) {
            // 端口已有人监听——多半是 run.bat 起的，或用户自己起的。不碰。
            return true;
        }
        Path entry = findEntry();
        if (entry == null) {
            System.err.println("[ApiSubprocess] 找不到内置 API，播放会失败。"
                    + "打包版请确认 app\\api\\app_win.exe 存在；"
                    + "开发版请在仓库根目录 npm run api。");
            return false;
        }
        Path node = entry.toString().endsWith(".exe") ? null : findNode();
        if (entry.toString().endsWith(".exe") == false && node == null) {
            System.err.println("[ApiSubprocess] 只找到源码版 api/app.js，但机器上没有 node。"
                    + "请安装 Node.js，或把 app_win.exe 放进 app\\api\\。");
            return false;
        }
        ApiSubprocess api = new ApiSubprocess();
        try {
            ProcessBuilder pb;
            if (node == null) {
                // 单文件 exe：自带 node 运行时，直接跑
                pb = new ProcessBuilder(entry.toString(),
                        "--platform=lite", "--port=" + PORT);
            } else {
                pb = new ProcessBuilder(node.toString(), entry.toString(),
                        "--platform=lite", "--port=" + PORT);
                // 工作目录设为 api/ 的父目录：Node 侧会按 cwd 找资源
                pb.directory(entry.getParent().getParent().toFile());
            }
            pb.redirectErrorStream(true);
            pb.redirectOutput(ProcessBuilder.Redirect.DISCARD);
            api.process = pb.start();
            api.startedFrom = entry;
            System.out.println("[ApiSubprocess] 已拉起内置 API: " + entry);
        } catch (IOException e) {
            System.err.println("[ApiSubprocess] 拉起 API 失败: " + e);
            return false;
        }
        if (api.waitUntilReady()) {
            INSTANCE = api;
            return true;
        }
        System.err.println("[ApiSubprocess] API 在 " + READY_TIMEOUT_SECONDS
                + " 秒内没有监听到端口 " + PORT);
        api.close();
        return false;
    }

    /** 全局实例（只保留自己拉起的那一个）。 */
    private static ApiSubprocess INSTANCE;

    /** 端口上是否已有监听。 */
    public static boolean isAlive() {
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress("127.0.0.1", PORT), 500);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** 等 API 监听端口，最多 {@link #READY_TIMEOUT_SECONDS} 秒。 */
    private boolean waitUntilReady() {
        long deadline = System.nanoTime()
                + TimeUnit.SECONDS.toNanos(READY_TIMEOUT_SECONDS);
        while (System.nanoTime() < deadline) {
            if (process != null && !process.isAlive()) {
                // 进程自己退了，多半是启动参数错
                return false;
            }
            if (isAlive()) {
                return true;
            }
            try {
                Thread.sleep(200);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }

    /**
 * 定位的基准目录。
 *
 * <p>优先用<b>本类的代码位置</b>推导，而不是 cwd：
 * <ul>
 *   <li>开发形态：代码在 {@code <repo>\java-rewrite\target\classes\...}
 *       或 {@code <repo>\java-rewrite\src\main\java\...}，
 *       往上两级就是 {@code <repo>\api}</li>
 *   <li>打包形态：代码在 {@code <root>\app\jello-music-java-*.jar}，
 *       即 {@code <root>\app}，所以 API 在它的同级的 {@code api\}</li>
 * </ul>
 * 两者都靠「代码在哪」而不是「从哪启动的」，用户双击 exe 也能找到。
 */
static Path baseDir() {
    try {
        java.net.URL loc = ApiSubprocess.class.getProtectionDomain()
                .getCodeSource().getLocation();
        if (loc == null) {
            return Paths.get("").toAbsolutePath();
        }
        File f = new File(loc.toURI());
        // jar -> 它的目录就是 app/；classes -> target/classes，往上两级是 java-rewrite
        if (f.isFile()) {
            return f.getParentFile().toPath().toAbsolutePath().normalize();
        }
        // f 是 target\classes 或 target\classes\ -> 往上两级
        return f.toPath().toAbsolutePath().normalize()
                .getParent().getParent();
    } catch (Throwable t) {
        return Paths.get("").toAbsolutePath();
    }
}

/**
 * 找 API 入口。
 *
 * <p>先找单文件 {@code app_win.exe}（自带 node，任何机器都能跑），
 * 找不到才退到源码 {@code app.js}（需要系统装 node）。
 */
static Path findEntry() {
        Path base = baseDir();
        for (String dir : CANDIDATE_SUBDIRS) {
            for (String file : CANDIDATE_FILES) {
                try {
                    Path p = base.resolve(dir).resolve(file).normalize();
                    if (Files.isRegularFile(p)) {
                        return p;
                    }
                } catch (RuntimeException ignored) {
                    // 非法路径组合，换下一个
                }
            }
        }
        return null;
    }

    /**
     * 找 {@code node}。
     *
     * <p>顺序：① 用户自设的 {@code JELLO_NODE}（打包后想自带 node 时用）
     * ② node.exe 跟 JRE 放一起（打包时若把 node 一起打进去就能命中）
     * ③ 交给系统 PATH 解析。
     */
    static Path findNode() {
        String custom = System.getenv("JELLO_NODE");
        if (custom != null && !custom.isBlank() && Files.isRegularFile(Paths.get(custom))) {
            return Paths.get(custom);
        }
        // 与 exe 同级的 node.exe：打包时可把 node 一起放进来
        try {
            Path exeDir = Paths.get("").toAbsolutePath();
            for (String name : new String[]{"node.exe", "node"}) {
                Path p = exeDir.resolve(name);
                if (Files.isRegularFile(p)) {
                    return p;
                }
            }
        } catch (RuntimeException ignored) {
            // 路径取不到就退回 PATH
        }
        // PATH
        String pathEnv = System.getenv("PATH");
        if (pathEnv == null) {
            return null;
        }
        String exe = System.getProperty("os.name", "")
                .toLowerCase(Locale.ROOT).startsWith("windows") ? ".exe" : "";
        for (String dir : pathEnv.split(";")) {
            if (dir.isBlank()) {
                continue;
            }
            try {
                Path p = Paths.get(dir.trim()).resolve("node" + exe);
                if (Files.isRegularFile(p)) {
                    return p;
                }
            } catch (RuntimeException ignored) {
                // 非法 PATH 项，跳过
            }
        }
        return null;
    }

    /** 当前实例拉起时的入口路径，诊断用。 */
    public Path startedFrom() {
        return startedFrom;
    }

    /**
     * 关掉「由本进程拉起」的 API。
     *
     * <p>对应 {@code run.bat} 的 {@code if defined API_STARTED_BY_US call :api_kill}：
     * 只收自己起的，用户自己起的那个绝不动。
     */
    public static void stopIfStartedByUs() {
        if (INSTANCE != null) {
            INSTANCE.close();
            INSTANCE = null;
        }
    }

    @Override
    public void close() {
        if (process == null) {
            return;
        }
        // 只收自己拉起的那个，用户自己起的由 run.bat 或用户自己管
        process.destroy();
        try {
            if (!process.waitFor(3, TimeUnit.SECONDS)) {
                process.destroyForcibly();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
        }
        System.out.println("[ApiSubprocess] 已停止内置 API");
        process = null;
    }
}