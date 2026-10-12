package com.jello.music.system;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;

/**
 * 单实例锁，对应原版 {@code electron/main.js:105-133}：
 * <pre>
 *   const gotTheLock = app.requestSingleInstanceLock();
 *   if (!gotTheLock) { app.quit(); process.exit(0); }
 *   else { app.on('second-instance', (e, commandLine) =&gt; { ...唤醒已有窗口... }); }
 * </pre>
 *
 * <h2>为什么用文件锁</h2>
 * Electron 的 {@code requestSingleInstanceLock} 底层是 Windows 的命名互斥体
 * （CreateMutex + ERROR_ALREADY_EXISTS 判断），跨进程可靠。
 * Java 没有直接 API，最接近的是 {@link FileLock}——它由 OS 文件句柄支撑，
 * 进程退出时句柄自动释放，语义与互斥体一致（不像「写个 pid 文件」那样
 * 遇到崩溃就留下僵尸锁）。
 *
 * <h2>顺带做的事</h2>
 * 原版 {@code second-instance} 拿到二次启动的参数后会：
 * <ul>
 *   <li>窗口最小化了就 restore</li>
 *   <li>带 {@code --settings} 参数就直接开设置页</li>
 *   <li>否则把 Sigma 窗口提到最前（贴边收起会顺带滑出）</li>
 * </ul>
 * 这些通过 {@link #takePendingCommand()} 传给首个实例去做——
 * 锁本身只解决「谁活下来」，具体动作由活着的那一方执行。
 */
public final class SingleInstance implements AutoCloseable {

    /** 锁文件名，放在用户目录下（跨用户不共享才对）。 */
    private static final String LOCK_FILE = "jello-music.lock";

    /** 二次启动的请求文件名。 */
    private static final String REQUEST_FILE = "jello-music.activate";

    private final Path lockPath;
    private final Path requestPath;
    private FileChannel channel;
    private FileLock lock;
    /** 本进程自己的 pid，持锁者才有。 */
    private String myPid;

    private SingleInstance(Path lockPath, Path requestPath) {
        this.lockPath = lockPath;
        this.requestPath = requestPath;
    }

    /**
     * 尝试成为唯一实例。
     *
     * @return 拿到锁返回实例（调用方应持有它直到退出）；已被占用返回 null，
     *         此时本进程应当立刻退出
     */
    public static SingleInstance tryAcquire() {
        try {
            Path home = Paths.get(System.getProperty("user.home", "."));
            SingleInstance si = new SingleInstance(
                    home.resolve(LOCK_FILE), home.resolve(REQUEST_FILE));
            si.channel = FileChannel.open(si.lockPath,
                    java.nio.file.StandardOpenOption.CREATE,
                    java.nio.file.StandardOpenOption.WRITE);
            si.lock = si.channel.tryLock();
            if (si.lock == null) {
                // 已有实例在跑：通知它唤醒，然后本进程退出
                signalExisting(si.requestPath);
                si.channel.close();
                return null;
            }
            si.writePid();
            return si;
        } catch (OverlappingFileLockException e) {
            // <b>同一个 JVM 内</b>再抢一次会抛这个，而不是返回 null。
            // 它其实正是「已有一个实例在跑」的另一种表现，但要注意：
            // 此时没有别的进程，也就没人会去读唤醒信号，
            // 所以只在「跨进程」场景才需要 signalExisting。
            // 单实例的测试会在一个 JVM 里连着调两次，属于这种情况。
            return null;
        } catch (IOException | RuntimeException e) {
            // 拿不到锁就按「只有一个实例」处理：宁可少一个功能，也别开出两个面板
            System.err.println("[SingleInstance] 获取锁失败，按单实例模式继续: " + e);
            return null;
        }
    }

    /** 把当前进程号写进锁文件，纯为诊断（看谁占着锁时方便）。 */
    private void writePid() {
        this.myPid = String.valueOf(ProcessHandle.current().pid());
        try {
            ByteBufferHelper.write(channel, myPid);
        } catch (IOException ignored) {
            // 写不进去不影响加锁本身
        }
    }

    /** 读锁文件里的进程号，诊断用。 */
    /**
     * 锁的持有者进程号，诊断用。
     *
     * <p><b>为什么不能开另一个 READ 通道去读锁文件</b>：Windows 上
     * 持有 {@link FileLock} 的文件不允许别的通道并发打开去读
     * （会抛 {@code NonReadableChannelException} 或读到空）。
     * 所以持锁者自己记住 pid 直接返回；非持锁时才尝试读文件
     * ——但那种情况下读到的也只是上一次运行留下的旧值，仅供参考。
     */
    public String holderPid() {
        if (myPid != null) {
            return myPid;
        }
        try (FileChannel ch = FileChannel.open(lockPath,
                java.nio.file.StandardOpenOption.READ)) {
            return ByteBufferHelper.read(ch);
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    /**
     * 二次启动时给已有实例发唤醒信号。
     *
     * <p>原版是操作系统直接回调 {@code second-instance} 事件；
     * 这里只能「写个文件 + 让已有实例轮询」，所以间隔由调用方决定
     * （见 {@code MainApp} 里的 AnimationTimer）。
     */
    private static void signalExisting(Path requestPath) {
        try {
            Files.writeString(requestPath, String.valueOf(
                    System.currentTimeMillis()));
        } catch (IOException ignored) {
            // 发不出信号而已：已有实例仍可正常运行
        }
    }

    /**
     * 取走并清掉唤醒信号。
     *
     * @return 有信号返回 true（说明是二次启动，要唤醒窗口）
     */
    public boolean takePendingCommand() {
        try {
            if (!Files.exists(requestPath)) {
                return false;
            }
            Files.deleteIfExists(requestPath);
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    /** 当前系统是否支持（Windows 与 macOS 上原版才有这个概念，Linux 单实例少见）。 */
    public static boolean isSupported() {
        String os = System.getProperty("os.name", "").toLowerCase(Locale.ROOT);
        return os.startsWith("windows") || os.contains("mac");
    }

    @Override
    public void close() {
        try {
            if (lock != null && lock.isValid()) {
                lock.release();
            }
        } catch (IOException ignored) {
            // 释放失败不影响退出
        }
        try {
            if (channel != null) {
                channel.close();
            }
        } catch (IOException ignored) {
            // 同上
        }
    }

    /** 读写锁文件的小工具（内容是进程号文本）。 */
    private static final class ByteBufferHelper {
        private ByteBufferHelper() {
        }

        static void write(FileChannel ch, String text) throws IOException {
            byte[] data = (text + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            java.nio.ByteBuffer buf = java.nio.ByteBuffer.wrap(data);
            // truncate 之后 position 会被置 0，这里再显式设一次，
            // 否则第一次写入可能落在 truncate 之后的旧 offset 上，读出来是空的
            ch.truncate(0);
            ch.position(0);
            int written = 0;
            while (written < data.length) {
                written += ch.write(buf);
            }
            // 立刻落盘：holderPid() 会另开一个 READ 通道读同一文件，
            // 不 force 的话可能读到旧内容或空内容
            ch.force(false);
        }

        static String read(FileChannel ch) throws IOException {
            java.nio.ByteBuffer buf = java.nio.ByteBuffer.allocate(64);
            int n = ch.read(buf);
            if (n <= 0) {
                return null;
            }
            buf.flip();
            byte[] data = new byte[buf.remaining()];
            buf.get(data);
            return new String(data, java.nio.charset.StandardCharsets.UTF_8).trim();
        }
    }
}