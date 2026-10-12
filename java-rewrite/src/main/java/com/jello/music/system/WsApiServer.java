package com.jello.music.system;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * 对外控制服务，1:1 复刻原版 {@code electron/services/apiService.js}（124 行）。
 *
 * <p>协议是 WebSocket（{@code ws://127.0.0.1:6520}），但原版用的是 Node 的
 * {@code ws} 库，Java 没有内置实现，所以这里手写 RFC 6455 的服务端最小子集：
 * <ul>
 *   <li>握手：读 HTTP Upgrade，算 {@code Sec-WebSocket-Accept}（SHA-1 + base64）</li>
 *   <li>帧：只支持文本帧 + ping/pong + close，客户端→服务端的帧必须解掩码</li>
 *   <li>不处理分片与续帧——原版的客户端（{@code data.command}）消息都很短，
 *       实际用不到</li>
 * </ul>
 *
 * <p><b>为什么绑 127.0.0.1</b>：与原版一致（{@code port: 6520} 默认全接口，
 * 但这是控制接口，能开关播放，不该暴露到局域网）。
 *
 * <h2>命令集（{@code handleControlCommand}，:89-105）
 * <pre>
 *   {"type":"control","data":{"command":"toggle"}}   播放/暂停
 *   {"type":"control","data":{"command":"next"}}     下一首
 *   {"type":"control","data":{"command":"prev"}}     上一首
 * </pre>
 * 连上后会先收到 {@code welcome} 与 {@code playerState}，
 * 之后原版在播放状态变化时主动推 {@code playerState}，这里同样做。
 *
 * <p>歌词推送（{@code type:"lyrics"}）原版有，本项目<b>不做歌词</b>，
 * 所以那一路留空——不是遗漏，是按当前范围刻意不实现。
 */
public final class WsApiServer implements AutoCloseable {

    /** 原版端口。 */
    public static final int PORT = 6520;

    /** 连接时的欢迎语，与原版逐字一致。 */
    public static final String WELCOME =
            "感谢接入 Jello Music，项目地址：https://github.com/Margele1337/jello-music";

    /** 播放控制回调，在各自的线程上被调用，调用方需自行切回 FX 线程。 */
    public interface Controller {
        void togglePlayPause();

        void next();

        void previous();

        /** 当前播放状态，用于新连接接入时的 {@code playerState}。 */
        boolean isPlaying();

        /** 当前播放位置（秒）。 */
        double currentTime();
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    private final Controller controller;
    private final Set<Socket> clients = new CopyOnWriteArraySet<>();
    private ServerSocket serverSocket;
    private Thread acceptThread;
    private volatile boolean running;

    public WsApiServer(Controller controller) {
        this.controller = controller;
    }

    /** 启动服务；端口被占用时返回 false（不抛异常，不影响主流程）。 */
    public boolean start() {
        if (running) {
            return true;
        }
        try {
            serverSocket = new ServerSocket();
            serverSocket.setReuseAddress(true);
            serverSocket.bind(new InetSocketAddress("127.0.0.1", PORT), 8);
        } catch (IOException e) {
            System.err.println("[WsApi] 监听 " + PORT + " 失败（可能已被占用）: "
                    + e.getMessage());
            return false;
        }
        running = true;
        acceptThread = new Thread(this::acceptLoop, "jello-wsapi");
        acceptThread.setDaemon(true);
        acceptThread.start();
        System.out.println("[WsApi] WebSocket 服务已启动 ws://127.0.0.1:" + PORT);
        return true;
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket client = serverSocket.accept();
                clients.add(client);
                Thread t = new Thread(() -> serve(client), "jello-wsapi-client");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (running) {
                    System.err.println("[WsApi] accept 失败: " + e.getMessage());
                }
                return;
            }
        }
    }

    /** 处理一个客户端连接。 */
    private void serve(Socket socket) {
        try (socket) {
            socket.setTcpNoDelay(true);
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();

            if (!handshake(in, out)) {
                // 不是 WS 请求（可能只是端口探测/健康检查），安静断开
                return;
            }
            // 连上先补齐原版的三条消息
            send(out, message("welcome", WELCOME));
            broadcastState(out);

            while (running) {
                String text = readTextFrame(in);
                if (text == null) {
                    return;
                }
                handleMessage(text);
            }
        } catch (IOException e) {
            // 客户端断开是正常路径，不打日志
        } catch (RuntimeException e) {
            // 这个要打：说明握手/读帧逻辑有 bug
            System.err.println("[WsApi] 连接处理异常: " + e);
            e.printStackTrace();
        } finally {
            clients.remove(socket);
        }
    }

    /**
     * WebSocket 握手（RFC 6455 §4.2.2），返回 false 表示这不是 WS 请求。
     *
     * <p><b>按行读而不是攒字符</b>：先前把读到的字节都塞进一个 StringBuilder
     * 只在遇到 '\n' 时计数，结果 '\r' 被跳过、换行也没真的分段，
     * 最后一行请求头会和前一行粘在一起，
     * {@code line.startsWith("sec-websocket-key:")} 永远不成立。
     * 结果是所有握手都被判成「非 WS 请求」，连接立刻被关掉——
     * 而日志里只看到 read=-1，完全看不出是这个原因。
     */
    private boolean handshake(InputStream in, OutputStream out) throws IOException {
        String key = null;
        int headerCount = 0;
        // HTTP 请求以<b>一个空行</b>结束。之前写成「空行出现两次才break」或
        // 「sawBlank 置位后再要一个空行」，两种都会在读完那个空行之后
        // 继续去 readLine —— 而客户端此时在等响应，不会再发数据，
        // 于是服务端永远阻塞在这里，握手响应发不出去。
        // 症状：客户端 SocketTimeout，服务端线程停在 SocketDispatcher.read0。
        while (headerCount < 200) {
            String line = readLine(in);
            if (line == null) {
                return false;
            }
            if (line.isEmpty()) {
                break;
            }
            headerCount++;
            String lower = line.toLowerCase(Locale.ROOT);
            if (lower.startsWith("sec-websocket-key:")) {
                key = line.substring(line.indexOf(':') + 1).trim();
            }
        }
        if (key == null) {
            // 没带 Sec-WebSocket-Key：不是 WS 握手
            System.err.println("[WsApi] 收到非 WS 请求（无 Sec-WebSocket-Key），断开");
            return false;
        }
        String accept = base64(sha1(key + WS_GUID));
        String resp = "HTTP/1.1 101 Switching Protocols\r\n"
                + "Upgrade: websocket\r\n"
                + "Connection: Upgrade\r\n"
                + "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
        out.write(resp.getBytes(StandardCharsets.US_ASCII));
        out.flush();
        return true;
    }

    /**
     * 读一行（以 {@code \n} 结尾，去掉结尾的 {@code \r}）。
     *
     * @return 该行；流结束返回 null
     */
    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder(64);
        int b;
        while ((b = in.read()) >= 0) {
            if (b == '\n') {
                return sb.toString();
            }
            if (b == '\r') {
                continue;
            }
            sb.append((char) b);
            if (sb.length() > 8192) {
                throw new IOException("请求头过长");
            }
        }
        return sb.length() == 0 ? null : sb.toString();
    }

    /** 读一个文本帧；返回 null 表示连接结束。 */
    private String readTextFrame(InputStream in) throws IOException {
        int b0 = in.read();
        if (b0 < 0) {
            return null;
        }
        int opcode = b0 & 0x0F;
        int b1 = in.read();
        if (b1 < 0) {
            return null;
        }
        boolean masked = (b1 & 0x80) != 0;
        long len = b1 & 0x7F;
        if (len == 126) {
            len = ((long) readByte(in) << 8) | readByte(in);
        } else if (len == 127) {
            len = 0;
            for (int i = 0; i < 8; i++) {
                len = (len << 8) | readByte(in);
            }
        }
        if (opcode == 0x8) {
            return null; // close
        }
        if (opcode == 0x9) {
            return ""; // ping：原版客户端不发，这里忽略
        }
        if (opcode == 0xA) {
            return ""; // pong
        }
        byte[] mask = new byte[4];
        if (masked) {
            readFully(in, mask);
        }
        byte[] payload = new byte[(int) Math.min(len, 1 << 20)];
        readFully(in, payload);
        if (masked) {
            for (int i = 0; i < payload.length; i++) {
                payload[i] ^= mask[i % 4];
            }
        }
        return new String(payload, StandardCharsets.UTF_8);
    }

    /** 处理一条客户端消息（对应原版 {@code ws.on('message')}）。 */
    private void handleMessage(String text) {
        if (text == null || text.isBlank()) {
            return;
        }
        try {
            JsonNode root = MAPPER.readTree(text);
            if (!"control".equals(root.path("type").asText())) {
                return;
            }
            String command = root.path("data").path("command").asText("");
            switch (command) {
                case "toggle" -> controller.togglePlayPause();
                case "next" -> controller.next();
                case "prev" -> controller.previous();
                default -> System.err.println("[WsApi] 未知命令: " + command);
            }
        } catch (Exception e) {
            System.err.println("[WsApi] 无效消息: " + text);
        }
    }

    /**
     * 广播播放状态变化，对应原版 {@code updatePlayerState}。
     *
     * <p>由 {@link MainApp} 在播放/暂停/切歌时调用。
     */
    public void broadcastState() {
        if (clients.isEmpty()) {
            return;
        }
        ObjectNode state = MAPPER.createObjectNode();
        state.put("isPlaying", controller.isPlaying());
        state.put("currentTime", controller.currentTime());
        String text = message("playerState", null, state);
        for (Socket s : clients) {
            try {
                send(s.getOutputStream(), text);
            } catch (IOException e) {
                clients.remove(s);
            }
        }
    }

    /** 给单个新连接补一条 playerState。 */
    private void broadcastState(OutputStream out) {
        try {
            ObjectNode state = MAPPER.createObjectNode();
            state.put("isPlaying", controller.isPlaying());
            state.put("currentTime", controller.currentTime());
            send(out, message("playerState", null, state));
        } catch (IOException e) {
            // 补发失败就当这连接不可用
        }
    }

    private static String message(String type, String data) {
        ObjectNode n = MAPPER.createObjectNode();
        n.put("type", type);
        n.put("data", data);
        return n.toString();
    }

    private static String message(String type, String data, JsonNode payload) {
        ObjectNode n = MAPPER.createObjectNode();
        n.put("type", type);
        n.set("data", payload);
        return n.toString();
    }

    /** 写一个文本帧（服务端→客户端不加掩码）。 */
    private static void send(OutputStream out, String text) throws IOException {
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        out.write(0x81); // FIN + text
        int len = payload.length;
        if (len < 126) {
            out.write(len);
        } else if (len <= 0xFFFF) {
            out.write(126);
            out.write((len >> 8) & 0xFF);
            out.write(len & 0xFF);
        } else {
            out.write(127);
            for (int i = 7; i >= 0; i--) {
                out.write((int) (((long) len >> (8 * i)) & 0xFF));
            }
        }
        out.write(payload);
        out.flush();
    }

    private static int readByte(InputStream in) throws IOException {
        int b = in.read();
        if (b < 0) {
            throw new IOException("连接已关闭");
        }
        return b;
    }

    private static void readFully(InputStream in, byte[] buf) throws IOException {
        int off = 0;
        while (off < buf.length) {
            int n = in.read(buf, off, buf.length - off);
            if (n < 0) {
                throw new IOException("连接已关闭");
            }
            off += n;
        }
    }

    private static byte[] sha1(String s) {
        try {
            return MessageDigest.getInstance("SHA-1")
                    .digest(s.getBytes(StandardCharsets.UTF_8));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-1 不可用", e);
        }
    }

    private static String base64(byte[] b) {
        return Base64.getEncoder().encodeToString(b);
    }

    @Override
    public void close() {
        running = false;
        for (Socket s : clients) {
            try {
                s.close();
            } catch (IOException ignored) {
                // 关闭失败无需处理
            }
        }
        clients.clear();
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
                // 同上
            }
        }
    }
}