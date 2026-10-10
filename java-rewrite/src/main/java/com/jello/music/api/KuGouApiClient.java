package com.jello.music.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jello.music.model.KuGouCredentials;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * KuGouMusicApi 的 Java 客户端。
 *
 * <p>后端 api/ 是独立的 Node 子模块（MakcRe/KuGouMusicApi），本类只做 HTTP 调用，
 * 不重复实现其 130+ 接口的请求构造。后续若要彻底去掉 Node 后端，再逐个接口内联到这里。
 *
 * <p>凭据拼装规则来自现有前端 {@code src/utils/request.js} 的请求拦截器：
 * <pre>
 *   token / userid / dfid / t1 / KUGOU_API_MID / KUGOU_API_GUID / KUGOU_API_DEV / KUGOU_API_MAC
 *   以分号连接后放进 Authorization 头
 * </pre>
 * 注意：这些字段是可选的，缺哪个就不拼哪段——已实测只给 token+userid+dfid 就能取到直链。
 *
 * <p>已验证（Maven 不可用时的单文件等价实现，见 P0 探针）：
 * <ul>
 *   <li>无 Authorization 时 /privilege/lite 返回 status=1</li>
 *   <li>带 Authorization 时 /song/url 返回 status=1 并给出 fs.youthandroid.kugou.com 直链</li>
 * </ul>
 */
public final class KuGouApiClient {

    private static final String DEFAULT_BASE = "http://127.0.0.1:6521";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final String base;
    private final HttpClient http;
    private final KuGouCredentials credentials;

    public KuGouApiClient(String base, KuGouCredentials credentials) {
        this.base = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
        this.credentials = credentials;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                // 本机装了 HTTP 代理时，不显式 NO_PROXY 会让所有本地请求拿到 502
                .proxy(HttpClient.Builder.NO_PROXY)
                .build();
    }

    public KuGouApiClient(KuGouCredentials credentials) {
        this(DEFAULT_BASE, credentials);
    }

    /** 授权头；无任何凭据时返回 null，表示不带该头（免登录端点仍可用）。 */
    public String authorizationHeader() {
        return credentials == null ? null : credentials.toAuthorizationHeader();
    }

    /** 调一个 GET 端点并解析 JSON。 */
    public JsonNode get(String pathAndQuery) throws IOException, InterruptedException {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base + pathAndQuery))
                .timeout(Duration.ofSeconds(20))
                .header("Accept", "application/json")
                .GET();
        String auth = authorizationHeader();
        if (auth != null) {
            b.header("Authorization", auth);
        }
        HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return parseApiResponse(r.body());
    }

    /**
     * api 会在响应体外层包一层 HTML 注释标记（KG_TAG_RES），且部分端点用 HTTP 502
     * 携带 status=1 的正常载荷，直接按状态码判成败会误判，这里一律以 JSON 内容为准。
     */
    static JsonNode parseApiResponse(String body) throws IOException {
        String cleaned = body.replaceAll("<!--[\\s\\S]*?-->", "").trim();
        if (cleaned.isEmpty()) {
            throw new IOException("空响应");
        }
        return MAPPER.readTree(cleaned);
    }

    /** 酷狗的错误结构不统一：有的在 status/errcode，有的在 status/error_code。 */
    public static boolean isSuccess(JsonNode node) {
        JsonNode status = node.get("status");
        if (status == null) {
            return false;
        }
        if (status.isInt()) {
            return status.asInt() == 1;
        }
        return "1".equals(status.asText());
    }

    /** 用户歌单列表（默认收藏、我喜欢等）。 */
    public java.util.List<Playlist> userPlaylists(int page, int pageSize)
            throws IOException, InterruptedException {
        JsonNode r = get("/user/playlist?pagesize=" + pageSize + "&page=" + page);
        if (!isSuccess(r)) {
            throw new IOException("/user/playlist 失败: " + errorMessage(r));
        }
        java.util.List<Playlist> out = new java.util.ArrayList<>();
        JsonNode info = r.path("data").get("info");
        if (info != null && info.isArray()) {
            for (JsonNode n : info) {
                String id = n.path("global_collection_id").asText("");
                String name = n.path("name").asText(n.path("listname").asText(""));
                int count = n.path("count").asInt(0);
                if (!id.isEmpty()) {
                    out.add(new Playlist(id, name, count));
                }
            }
        }
        return out;
    }

    /**
     * 歌单里的一页歌曲。api 的歌曲数组在 {@code data.songs}，
     * 每项含 hash / name(歌手-歌名) / remark(歌名) / singerinfo / albuminfo /
     * cover / timelen(毫秒) / extname。
     */
    public java.util.List<com.jello.music.model.Song> playlistTracks(
            String playlistId, int page, int pageSize) throws IOException, InterruptedException {
        JsonNode r = get("/playlist/track/all?id=" + playlistId
                + "&pagesize=" + pageSize + "&page=" + page);
        if (!isSuccess(r)) {
            throw new IOException("/playlist/track/all 失败: " + errorMessage(r));
        }
        java.util.List<com.jello.music.model.Song> out = new java.util.ArrayList<>();
        JsonNode songs = r.path("data").get("songs");
        if (songs != null && songs.isArray()) {
            for (JsonNode n : songs) {
                var s = com.jello.music.model.Song.fromApi(n);
                if (s != null) {
                    out.add(s);
                }
            }
        }
        return out;
    }

    /**
     * 搜索。对应原版 {@code SigmaSearchBox.vue} 的 {@code /search/complex?keywords=}。
     * <p>该接口把结果按类型分组（歌曲/歌单/专辑…），这里只取歌曲部分，
     * 路径为 {@code data.song_list}；个别情况下会退化到 {@code data.songs}。
     */
    public java.util.List<com.jello.music.model.Song> search(String keyword)
            throws IOException, InterruptedException {
        String kw = keyword == null ? "" : keyword.trim();
        if (kw.isEmpty()) {
            return java.util.List.of();
        }
        JsonNode r = get("/search/complex?keywords=" + encode(kw));
        if (!isSuccess(r)) {
            throw new IOException("/search/complex 失败: " + errorMessage(r));
        }
        java.util.List<com.jello.music.model.Song> out = new java.util.ArrayList<>();
        for (String key : new String[]{"song_list", "songs"}) {
            JsonNode arr = r.path("data").get(key);
            if (arr != null && arr.isArray()) {
                for (JsonNode n : arr) {
                    var s = com.jello.music.model.Song.fromApi(n);
                    if (s != null) {
                        out.add(s);
                    }
                }
                if (!out.isEmpty()) {
                    break;
                }
            }
        }
        return out;
    }

    public static String errorMessage(JsonNode node) {
        for (String k : new String[]{"error", "error_msg", "message"}) {
            JsonNode v = node.get(k);
            if (v != null && !v.asText().isEmpty()) {
                return v.asText();
            }
        }
        return "未知错误";
    }

    /** 取歌曲的音频直链；调用方需要已登录的凭据。 */
    public String songUrl(String hash, int quality) throws IOException, InterruptedException {
        JsonNode r = get("/song/url?hash=" + hash + "&quality=" + quality);
        if (!isSuccess(r)) {
            throw new IOException("/song/url 失败: errcode="
                    + (r.has("errcode") ? r.get("errcode").asText() : "?")
                    + " " + errorMessage(r));
        }
        // 响应结构：url / backup_url 数组，或嵌套在 data 下
        for (JsonNode arr : new JsonNode[]{r.get("url"), r.get("backup_url"), r.path("data").get("url")}) {
            if (arr != null && arr.isArray() && !arr.isEmpty()) {
                String u = arr.get(0).asText();
                if (u.startsWith("http")) {
                    return u;
                }
            }
        }
        throw new IOException("/song/url 未返回直链: " + r.toString().substring(0, Math.min(300, r.toString().length())));
    }

    public static String encode(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}