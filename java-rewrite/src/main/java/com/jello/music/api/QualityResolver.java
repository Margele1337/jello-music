package com.jello.music.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.jello.music.AppPrefs;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 音质选择与降级协商，1:1 复刻原版
 * {@code src/components/player/songQueue/OnlineMusicQueue.js}（:1-200）。
 *
 * <p><b>为什么不能直接传一个 quality 就完事</b>：高音质要 VIP 权限，
 * 无权限时 {@code /song/url} 会返回 {@code status=1} 且没有 url。
 * 原版的做法是：先问 {@code /privilege/lite} 拿这首歌「实际能听哪些档」，
 * 再按「用户想要的档 → 往下逐级降」的顺序试，直到某一档真的拿到直链。
 *
 * <p>降级链（{@code getFallbackChain}，:19）是把 QUALITY_LEVELS 截到目标位再 reverse，
 * 所以用户选 viper_tape 时试的顺序是 viper_tape → viper_clear → viper_atmos →
 * high → flac → 320 → 128。
 *
 * <p>还有两条兜底（:186-196）：
 * <ul>
 *   <li>候选里没有 128 时，追加一次「原始 hash + free_part」试听片段请求</li>
 *   <li>拿到的 {@code extName} 是 {@code mp4} 时跳过该档（JavaFX MediaPlayer 放不了）</li>
 * </ul>
 */
public final class QualityResolver {

    /** 原版 {@code QUALITY_LEVELS}，顺序即音质高低。 */
    public static final List<String> LEVELS = List.of(
            "128", "320", "flac", "high", "viper_atmos", "viper_clear", "viper_tape");

    /** 原版 {@code QUALITY_LABELS}。 */
    private static final Map<String, String> LABELS = Map.of(
            "128", "标准",
            "320", "高品",
            "flac", "FLAC",
            "high", "Hi-Res",
            "viper_atmos", "全景声",
            "viper_clear", "超清",
            "viper_tape", "母带");

    /** 原版 {@code PPAGE_ID}，请求 {@code /song/url} 时必须带上。 */
    public static final String PPAGE_ID = "356753938";

    /** 设置项 key，对应原版 localStorage 的 {@code settings.quality}。 */
    public static final String SETTING_KEY = "quality";

    /** 原版默认值是 {@code 128}，不是 320。 */
    public static final String DEFAULT = "128";

    private QualityResolver() {
    }

    /** 原版 {@code normalizeQuality}：不在列表里就落回 128。 */
    public static String normalize(String quality) {
        return LEVELS.contains(quality) ? quality : DEFAULT;
    }

    /**
     * 读用户设置的音质。
     *
     * <p>之前 {@code MainApp} 里写死 {@code songUrl(hash, 320)}，
     * 设置项能改却不生效——这里改成从 {@link AppPrefs} 读。
     */
    public static String selectedQuality() {
        return normalize(AppPrefs.getSetting(SETTING_KEY, DEFAULT));
    }

    /** 原版 {@code getQualityLabel}。 */
    public static String label(String quality) {
        return LABELS.getOrDefault(quality, "");
    }

    /** 设置项下拉里的显示文本，对齐原版 settings.js:123-129。 */
    public static String displayText(String quality) {
        return switch (normalize(quality)) {
            case "128" -> "标准音质 - 128Kbps";
            case "320" -> "高品音质 - 320Kbps";
            case "flac" -> "FLAC 无损";
            case "high" -> "Hi-Res 无损";
            case "viper_atmos" -> "蝰蛇全景";
            case "viper_clear" -> "蝰蛇超清";
            default -> "蝰蛇母带";
        };
    }

    /** 一档候选：原版 {@code {hash, quality}} 对象。 */
    public record Candidate(String hash, String quality) {
    }

    /**
     * 原版 {@code getFallbackChain}：截到目标档再反序，即「从想要的档往下试」。
     */
    public static List<String> fallbackChain(String quality) {
        String q = normalize(quality);
        List<String> chain = new ArrayList<>(LEVELS.subList(0, LEVELS.indexOf(q) + 1));
        java.util.Collections.reverse(chain);
        return chain;
    }

    /**
     * 问服务端这首歌实际能听哪些档。
     *
     * <p>原版 {@code getQualityOptions}（:36-49）+ {@code getPrivilegeVariants}（:23-34）：
     * 把 {@code data[]} 里每一项和它的 {@code relate_goods[]} 都摊平，
     * 跳过 {@code level == 0} 与不在 QUALITY_LEVELS 里的，同档位只保留第一个。
     *
     * @return 档位 → 该档专用 hash（可能与原 hash 不同）
     */
    public static Map<String, String> qualityOptions(KuGouApiClient api, String hash)
            throws IOException, InterruptedException {
        Map<String, String> out = new LinkedHashMap<>();
        JsonNode resp = api.get("/privilege/lite?hash=" + hash);
        JsonNode data = resp.path("data");
        if (!data.isArray()) {
            return out;
        }
        for (JsonNode item : data) {
            // 原版：[item, ...(item?.relate_goods || [])]
            collectVariant(out, item);
            for (JsonNode rel : item.path("relate_goods")) {
                collectVariant(out, rel);
            }
        }
        return out;
    }

    private static void collectVariant(Map<String, String> out, JsonNode v) {
        String h = v.path("hash").asText("");
        int level = v.path("level").asInt(0);
        String q = v.path("quality").asText("");
        if (h.isEmpty() || level == 0 || !LEVELS.contains(q)) {
            return;
        }
        out.putIfAbsent(q, h);
    }

    /**
     * 原版 {@code getPrivilegeCandidates}（:51-72）：
     * 按降级链取该用户实际有权限的候选；一个 128 都没有时补一条原始 hash。
     */
    public static List<Candidate> candidates(Map<String, String> options,
                                              String quality, String originalHash) {
        List<Candidate> out = new ArrayList<>();
        for (String q : fallbackChain(quality)) {
            String h = options.get(q);
            if (h != null) {
                out.add(new Candidate(h, q));
            }
        }
        if (out.stream().noneMatch(c -> "128".equals(c.quality()))) {
            // 兜底：无 VIP / 权限数据缺失时，用原始 hash 再试一次免费 128
            out.add(new Candidate(originalHash, "128"));
        }
        return out;
    }

    /**
     * 按候选顺序取直链，返回第一条真的能播的。
     *
     * <p>跳过两种情况（对应原版 :159-171）：
     * <ul>
     *   <li>{@code extName == "mp4"} —— 原版是「试下一档」，因为 mp4 走不通它的解码器。
     *       Java 侧同样放不了（MediaPlayer 不吃 mp4），所以行为一致</li>
     *   <li>没有 url —— 权限不足或该档不可用</li>
     * </ul>
     *
     * <p>全部候选都失败时，试一次 {@code free_part=1} 的试听片段（原版 :186-196）。
     *
     * @return 可播放的直链；都拿不到则抛 IOException
     */
    public static String resolve(KuGouApiClient api, String hash, String quality)
            throws IOException, InterruptedException {
        String q = normalize(quality);
        Map<String, String> options = qualityOptions(api, hash);
        for (Candidate c : candidates(options, q, hash)) {
            JsonNode r = api.get("/song/url?hash=" + c.hash()
                    + "&quality=" + c.quality()
                    + "&ppage_id=" + PPAGE_ID);
            if (isMp4(r)) {
                continue;
            }
            String url = firstUrl(r);
            if (url != null) {
                return url;
            }
        }
        // 兜底：试听片段
        JsonNode trial = api.get("/song/url?hash=" + hash + "&quality=128&free_part=1");
        String trialUrl = isMp4(trial) ? null : firstUrl(trial);
        if (trialUrl != null) {
            return trialUrl;
        }
        throw new IOException("没有可用音质（已试 " + candidates(options, q, hash).size()
                + " 档，含试听片段）");
    }

    private static boolean isMp4(JsonNode r) {
        return "mp4".equals(r.path("extName").asText(""));
    }

    /** 取响应里的第一条直链，兼容 url / backup_url / data.url 三种结构。 */
    private static String firstUrl(JsonNode r) {
        for (JsonNode arr : new JsonNode[]{r.path("url"), r.path("backup_url"), r.path("data").path("url")}) {
            if (arr.isArray() && !arr.isEmpty()) {
                String u = arr.get(0).asText();
                if (u.startsWith("http")) {
                    return u;
                }
            }
        }
        return null;
    }
}