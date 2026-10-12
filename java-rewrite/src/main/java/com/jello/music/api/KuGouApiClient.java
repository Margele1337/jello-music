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
                // /playlist/track/all 要的是 global_collection_id，原版优先取 list_create_gid
                String gid = n.path("list_create_gid").asText("");
                if (gid.isEmpty()) {
                    gid = n.path("global_collection_id").asText("");
                }
                String name = n.path("name").asText(n.path("listname").asText(""));
                int count = n.path("count").asInt(0);
                int sort = n.path("sort").asInt(0);
                String owner = n.path("list_create_userid").asText("");
                if (!gid.isEmpty()) {
                    out.add(new Playlist(gid, name, count, sort, owner));
                }
            }
        }
        return out;
    }

    /**
     * 组装左栏列表 —— 1:1 照抄原版 {@code SigmaPlaylistPanel.vue} 的 {@code load()}：
     *
     * <pre>
     *   [猜你喜欢, 每日推荐]
     *   + 我喜欢（若有）
     *   + 自己的其余歌单
     *   过滤：name === '我喜欢' || list_create_userid === 自己
     *   排序：(a.sort ?? 0) - (b.sort ?? 0)     // 升序
     * </pre>
     *
     * <p>之前 Java 侧是「按歌曲数倒序 + 过滤 count&gt;0」，跟原版既不同序也不同项。
     */
    public static java.util.List<PlaylistTab> playlistTabs(
            java.util.List<Playlist> raw, String myUserid) {
        java.util.List<PlaylistTab> out = new java.util.ArrayList<>();
        out.add(new PlaylistTab(PlaylistTab.GUESS, "猜你喜欢", null));
        out.add(new PlaylistTab(PlaylistTab.DAILY, "每日推荐", null));

        java.util.List<Playlist> mine = new java.util.ArrayList<>(raw);
        mine.removeIf(p -> !p.isMine(myUserid));
        // sort 升序；null 视为 0
        mine.sort(java.util.Comparator.comparingInt(Playlist::sort));

        for (Playlist p : mine) {
            if (p.isLike()) {
                out.add(new PlaylistTab(PlaylistTab.PLAYLIST, "我喜欢", p.gid()));
            }
        }
        for (Playlist p : mine) {
            if (p.isLike() || p.gid() == null || p.gid().isEmpty()) {
                continue;
            }
            out.add(new PlaylistTab(PlaylistTab.PLAYLIST, p.name(), p.gid()));
        }
        return out;
    }

    /**
     * 猜你喜欢 —— {@code /top/card?card_id=1}。
     *
     * <p>原版额外加了 {@code &timestamp=} 绕过 KuGouMusicApi 的 2 分钟同 URL 缓存，
     * 保证每次点都是新推荐，这里照抄。
     */
    public java.util.List<com.jello.music.model.Song> topCard(int cardId)
            throws IOException, InterruptedException {
        JsonNode r = get("/top/card?card_id=" + cardId + "&timestamp=" + System.currentTimeMillis());
        if (!isSuccess(r)) {
            throw new IOException("/top/card 失败: " + errorMessage(r));
        }
        java.util.List<com.jello.music.model.Song> out = new java.util.ArrayList<>();
        JsonNode list = r.path("data").get("song_list");
        if (list != null && list.isArray()) {
            for (JsonNode n : list) {
                var s = com.jello.music.model.Song.fromApi(n);
                if (s != null) {
                    out.add(s);
                }
            }
        }
        return out;
    }

    /**
     * 每日推荐 —— {@code /everyday/recommend?pagesize=&page=}。
     *
     * <p>普通账号服务端默认只给 30 首，所以原版按 pagesize=60 翻两页拉，
     * 还不够再用「猜你喜欢」按 hash 去重补足（见 {@code MainApp#loadDailyRecommend}）。
     */
    public java.util.List<com.jello.music.model.Song> everydayRecommend(int page, int pageSize)
            throws IOException, InterruptedException {
        JsonNode r = get("/everyday/recommend?pagesize=" + pageSize + "&page=" + page);
        if (!isSuccess(r)) {
            throw new IOException("/everyday/recommend 失败: " + errorMessage(r));
        }
        java.util.List<com.jello.music.model.Song> out = new java.util.ArrayList<>();
        JsonNode list = r.path("data").get("song_list");
        if (list != null && list.isArray()) {
            for (JsonNode n : list) {
                var s = com.jello.music.model.Song.fromApi(n);
                if (s != null) {
                    out.add(s);
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
     * 搜索结果 —— 歌单卡 + 歌曲卡，原版是 {@code [...playlists, ...songs]} 的顺序。
     */
    public record SearchResult(java.util.List<com.jello.music.model.ResultCard> playlists,
                               java.util.List<com.jello.music.model.Song> songs) {
    }

    /**
     * 搜索。对应原版 {@code SigmaSearchBox.vue} 的 {@code /search/complex?keywords=}。
     *
     * <p>原版读的是 {@code data.lists} 里按 {@code type} 分组的数组：
     * {@code type === 'collect'} 是歌单、{@code type === 'song'} 是歌曲，
     * 歌单排在前面。之前 Java 侧只取 {@code data.song_list}，
     * 既漏了歌单卡，分组路径也可能对不上。
     */
    public SearchResult search(String keyword)
            throws IOException, InterruptedException {
        String kw = keyword == null ? "" : keyword.trim();
        if (kw.isEmpty()) {
            return new SearchResult(java.util.List.of(), java.util.List.of());
        }
        JsonNode r = get("/search/complex?keywords=" + encode(kw));
        if (!isSuccess(r)) {
            throw new IOException("/search/complex 失败: " + errorMessage(r));
        }
        java.util.List<com.jello.music.model.ResultCard> playlists = new java.util.ArrayList<>();
        java.util.List<com.jello.music.model.Song> songs = new java.util.ArrayList<>();

        JsonNode lists = r.path("data").get("lists");
        if (lists != null && lists.isArray()) {
            for (JsonNode section : lists) {
                String type = section.path("type").asText("");
                JsonNode items = section.path("lists");
                if (items == null || !items.isArray()) {
                    continue;
                }
                if ("collect".equals(type)) {
                    for (JsonNode n : items) {
                        // 搜索结果里 gid 才是 global_collection_id
                        String gid = n.path("gid").asText("");
                        if (gid.isEmpty()) {
                            gid = n.path("global_collection_id").asText("");
                        }
                        if (gid.isEmpty()) {
                            gid = n.path("specialid").asText("");
                        }
                        String special = n.path("specialname").asText(n.path("name").asText(""));
                        int count = n.path("song_count").asInt(0);
                        String cover = n.path("img").asText("").replace("/150/", "/480/");
                        playlists.add(com.jello.music.model.ResultCard.playlist(gid,
                                "歌单 " + stripBrackets(special) + " · " + count + "首", cover));
                    }
                } else if ("song".equals(type)) {
                    for (JsonNode n : items) {
                        String hash = n.path("HQFileHash").asText("");
                        if (hash.isEmpty()) {
                            hash = n.path("SQFileHash").asText("");
                        }
                        if (hash.isEmpty()) {
                            hash = n.path("FileHash").asText("");
                        }
                        if (hash.isEmpty()) {
                            continue;
                        }
                        songs.add(new com.jello.music.model.Song(hash,
                                stripBrackets(firstNonEmpty(
                                        n.path("OriSongName").asText(""),
                                        n.path("SongName").asText(""))),
                                stripBrackets(n.path("SingerName").asText("")),
                                "",
                                n.path("Image").asText("").replace("{size}", "480"),
                                n.path("Duration").asInt(0)));
                    }
                }
            }
        }
        return new SearchResult(playlists, songs);
    }

    /** 原版 {@code stripBrackets}：去掉括号及其内容。 */
    public static String stripBrackets(String value) {
        return value == null ? "" : value.replaceAll("\\([^)]*\\)", "")
                .replaceAll("\\[[^]]*]", "").trim();
    }

    private static String firstNonEmpty(String a, String b) {
        return a != null && !a.isEmpty() ? a : b;
    }

    // ================= 登录（原版 Login.vue） =================

    /**
     * 手机号验证码 —— {@code /captcha/sent?mobile=}。
     *
     * <p>原版成功后进 60s 倒计时（见 {@code LoginView}）。
     */
    public void sendCaptcha(String mobile) throws IOException, InterruptedException {
        JsonNode r = get("/captcha/sent?mobile=" + encode(mobile == null ? "" : mobile));
        if (!isSuccess(r)) {
            throw new IOException("验证码发送失败: " + errorMessage(r));
        }
    }

    /** 手机号 + 验证码登录。{@code userid} 非空时表示「多账号里选了某一个」。 */
    public com.jello.music.model.UserInfo loginByPhone(
            String mobile, String code, String userid) throws IOException, InterruptedException {
        StringBuilder url = new StringBuilder("/login/cellphone?mobile=").append(encode(mobile))
                .append("&code=").append(encode(code == null ? "" : code));
        if (userid != null && !userid.isEmpty()) {
            url.append("&userid=").append(encode(userid));
        }
        JsonNode r = get(url.toString());
        return readLogin(r);
    }

    /** 邮箱 + 密码登录（接口参数叫 username）。 */
    public com.jello.music.model.UserInfo loginByEmail(
            String email, String password) throws IOException, InterruptedException {
        JsonNode r = get("/login?username=" + encode(email) + "&password=" + encode(password));
        return readLogin(r);
    }

    /**
     * 二维码登录三步。
     *
     * <p>原版：{@code /login/qr/key} 取 key → {@code /login/qr/create?key=&qrimg=true}
     * 拿 base64 → 每秒轮询 {@code /login/qr/check}，
     * {@code data.status} 2=已扫码待确认 / 4=成功 / 0=过期。
     */
    public String qrKey() throws IOException, InterruptedException {
        JsonNode r = get("/login/qr/key");
        if (!isSuccess(r)) {
            throw new IOException("二维码生成失败: " + errorMessage(r));
        }
        return r.path("data").path("qrcode").asText("");
    }

    public String qrImage(String key) throws IOException, InterruptedException {
        JsonNode r = get("/login/qr/create?key=" + encode(key) + "&qrimg=true");
        JsonNode data = r.path("data");
        String base64 = data.path("base64").asText("");
        if (base64.isEmpty()) {
            throw new IOException("获取二维码失败: " + errorMessage(r));
        }
        // 原版直接塞进 img.src，所以一般已经带 data: 前缀；没带就补上
        return base64.startsWith("data:") ? base64 : "data:image/png;base64," + base64;
    }

    /** 返回 {@code data.status}；4 表示登录成功。 */
    public int qrStatus(String key) throws IOException, InterruptedException {
        JsonNode r = get("/login/qr/check?key=" + encode(key) + "&timestamp="
                + System.currentTimeMillis());
        return r.path("data").path("status").asInt(-1);
    }

    public String qrNickname(String key) throws IOException, InterruptedException {
        JsonNode r = get("/login/qr/check?key=" + encode(key) + "&timestamp="
                + System.currentTimeMillis());
        return r.path("data").path("nickname").asText("");
    }

    /** 扫码成功的最后一次 check 会直接带回登录态，原版就是用它 setData 的。 */
    public com.jello.music.model.UserInfo qrCheckForUser(String key)
            throws IOException, InterruptedException {
        JsonNode r = get("/login/qr/check?key=" + encode(key) + "&timestamp="
                + System.currentTimeMillis());
        if (!isSuccess(r)) {
            throw new IOException(errorMessage(r));
        }
        com.jello.music.model.UserInfo u = com.jello.music.model.UserInfo.fromApi(r.path("data"));
        if (u == null) {
            u = com.jello.music.model.UserInfo.fromApi(r);
        }
        if (u == null || !u.isAuthenticated()) {
            throw new IOException("登录失败: 响应里没有登录态");
        }
        return u;
    }

    /** 登录响应既可能是 {@code {status:1,data:{...}}} 也可能是 {@code {code:200,data:{...}}}。 */
    private com.jello.music.model.UserInfo readLogin(JsonNode r) throws IOException {
        // 多账号：一个手机号绑了多个酷狗账号时，接口在 data.info_list 里回列表而不是登录态。
        // 原版走的是 catch 分支读 error.response.data.data.info_list，这里效果一样
        JsonNode list = r.path("data").get("info_list");
        if (list != null && list.isArray() && !list.isEmpty()) {
            java.util.List<com.jello.music.model.UserInfo> accounts =
                    new java.util.ArrayList<>();
            for (JsonNode n : list) {
                var u = com.jello.music.model.UserInfo.fromApi(n);
                if (u != null) {
                    accounts.add(u);
                }
            }
            if (!accounts.isEmpty()) {
                throw new MultiAccountException(accounts);
            }
        }
        if (!isSuccess(r) && r.path("code").asInt(0) != 200) {
            throw new IOException(errorMessage(r));
        }
        com.jello.music.model.UserInfo user = com.jello.music.model.UserInfo.fromApi(r.path("data"));
        if (user == null) {
            user = com.jello.music.model.UserInfo.fromApi(r);
        }
        if (user == null || !user.isAuthenticated()) {
            throw new IOException("登录失败: 响应里没有登录态");
        }
        return user;
    }

    /**
     * 「该手机号绑了多个账号，请选择」——原版切到账号选择界面。
     *
     * <p>只有首次登录（没带 userid）才会走到；选了某个账号再失败就是真失败了，
     * 与原版 {@code if (info_list && !selectedUserId)} 的判断一致。
     */
    public static final class MultiAccountException extends IOException {
        private final java.util.List<com.jello.music.model.UserInfo> accounts;

        MultiAccountException(java.util.List<com.jello.music.model.UserInfo> accounts) {
            super("该手机绑定多个账号，请选择要登录的账号");
            this.accounts = java.util.List.copyOf(accounts);
        }

        public java.util.List<com.jello.music.model.UserInfo> accounts() {
            return accounts;
        }
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
        return songUrl(hash, String.valueOf(quality));
    }

    /**
     * 取歌曲的音频直链，音质用字符串。
     *
     * <p>原版 {@code OnlineMusicQueue.js} 传的 quality 就是字符串，
     * 含 {@code flac / high / viper_*} 这类非数字档，所以这里不能用 int。
     */
    public String songUrl(String hash, String quality) throws IOException, InterruptedException {
        JsonNode r = get("/song/url?hash=" + hash + "&quality=" + quality
                + "&ppage_id=" + QualityResolver.PPAGE_ID);
        if (!isSuccess(r)) {
            throw new IOException("/song/url 失败: errcode="
                    + (r.has("errcode") ? r.get("errcode").asText() : "?")
                    + " " + errorMessage(r));
        }
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