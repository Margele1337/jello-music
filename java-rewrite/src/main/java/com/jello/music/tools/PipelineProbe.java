package com.jello.music.tools;

import com.fasterxml.jackson.databind.JsonNode;
import com.jello.music.api.KuGouApiClient;
import com.jello.music.model.KuGouCredentials;
import com.jello.music.player.SpectrumTap;

/**
 * 端到端链路探针：api → 直链 → MP3 解码 → FFT。
 *
 * <p>不拉起任何窗口，可在无 GUI 环境运行，用于在开发早期确认各段是否打通。
 *
 * <p>凭据走环境变量，避免把 token 写进命令行历史：
 * <pre>
 *   set JELLO_TOKEN=xxx
 *   set JELLO_USERID=xxx
 *   set JELLO_DFID=xxx
 *   set JELLO_HASH=歌曲hash
 *   mvn -s settings.xml exec:java
 * </pre>
 */
public final class PipelineProbe {

    public static void main(String[] args) {
        System.out.println("=== Jello Music Java · 链路探针 ===");

        KuGouCredentials cred = credentialsFromEnv();
        System.out.println("[凭据] " + cred);

        // ---- 第 1 段：api 连通性 ----
        KuGouApiClient api = new KuGouApiClient(cred);
        System.out.println();
        System.out.println("[1] 调用 /privilege/lite");
        try {
            JsonNode r = api.get("/privilege/lite?hash=8CB1B4AFDE9FAE9A9E5C0FA5F1FFB06D");
            System.out.println("    " + (KuGouApiClient.isSuccess(r) ? "成功" : "失败")
                    + "  error_code=" + r.path("error_code").asText("-"));
        } catch (Exception e) {
            System.out.println("    失败: " + e);
            return;
        }

        // ---- 第 2 段：取直链 ----
        String hash = env("JELLO_HASH", "");
        if (hash.isBlank()) {
            // 没指定 hash 就自己找一首：让探针「开箱即用」，
            // 不用每次都去 App 里复制 hash 再设环境变量
            hash = pickAnyHash(api);
            if (hash.isBlank()) {
                System.out.println();
                System.out.println("[2] 跳过直链与频谱：未设置 JELLO_HASH，且推荐接口没返回歌曲");
                System.out.println("    第 1 段已通过，说明 Java 调 api 的链路可用。");
                return;
            }
            System.out.println();
            System.out.println("[2] 未设 JELLO_HASH，自动选了一首: " + hash);
        }
        System.out.println();
        System.out.println("[2b] 调用 /song/url  hash=" + hash);
        String directUrl;
        try {
            // 直连当前设置里的那一档（不做协商），探针要的就是「这一档能不能出直链」。
            // 协商与降级是 QualityResolver.resolve 的事，MainApp 走那条路。
            String quality = com.jello.music.api.QualityResolver.selectedQuality();
            directUrl = api.songUrl(hash, quality);
            System.out.println("    音质: " + quality);
        } catch (Exception e) {
            System.out.println("    失败: " + e.getMessage());
            System.out.println("    常见原因：凭据无效，或触发了 20028 风控（需验证码）。");
            System.out.println("    也可能是所选音质需要 VIP 权限 —— 试试在设置里降到 128。");
            return;
        }
        System.out.println("    直链: " + directUrl);

        // ---- 第 3 段：解码 + FFT ----
        System.out.println();
        System.out.println("[3] 拉流解码并计算 FFT");
        try (SpectrumTap tap = new SpectrumTap(directUrl, 2048)) {
            // 探针看的是「频谱形状对不对」，所以用归一化到 0..1 的 magnitudes()；
            // 渲染链路走的是不归一化的 rawMagnitudes()，两者量纲完全不同。
            double[] first = tap.frameForProbe();
            if (first == null) {
                System.out.println("    首帧即结束，音频流为空");
                return;
            }
            // 元信息要解完第一个 MP3 帧才拿得到，所以先解码再打印
            System.out.println("    采样率=" + tap.sampleRate() + " Hz  声道=" + tap.channels()
                    + "  帧长=" + first.length + "  首帧峰值=" + fmt(max(first)));

            int frames = 0;
            double sumPeak = 0;
            for (int i = 0; i < 20; i++) {
                double[] f = tap.frameForProbe();
                if (f == null) {
                    break;
                }
                frames++;
                sumPeak += max(f);
            }
            System.out.println("    连续解码帧数=" + frames
                    + "  平均峰值=" + fmt(frames == 0 ? 0 : sumPeak / frames));

            double[] last = tap.frameForProbe();
            if (last != null) {
                double[] bands = SpectrumTap.toLogBands(last, 24);
                StringBuilder sb = new StringBuilder("    24 频段: ");
                for (double b : bands) {
                    sb.append(String.format("%.2f ", b));
                }
                System.out.println(sb);
            }
            System.out.println("    累计解码帧数=" + tap.decodedFrameCount());
        } catch (Exception e) {
            System.out.println("    失败: " + e.getMessage());
            e.printStackTrace();
        }
        System.out.println();
        System.out.println("=== 链路探针结束 ===");
    }

    /**
     * 取凭据：环境变量优先，其次回落登录页持久化的登录态。
 *
     * <p><b>为什么要回落</b>：登录页会把登录态写进 {@code AppPrefs}
     * （见 {@code MainApp.initCredentials}），所以正常使用时并不需要设
     * {@code JELLO_*} 环境变量。探针只认环境变量的话，
     * 「明明在 App 里能播歌、探针却报未登录」——这个不一致很容易让人以为
     * 是 API 或凭据坏了。优先级与 {@code MainApp} 保持一致。
     */
    private static KuGouCredentials credentialsFromEnv() {
        KuGouCredentials c = new KuGouCredentials();
        c.setToken(env("JELLO_TOKEN", ""));
        c.setUserid(env("JELLO_USERID", ""));
        c.setDfid(env("JELLO_DFID", ""));
        c.setT1(env("JELLO_T1", ""));
        c.setMid(env("JELLO_MID", ""));
        c.setGuid(env("JELLO_GUID", ""));
        if (!c.getToken().isEmpty()) {
            return c;
        }
        // 环境变量没有就回落登录页持久化的登录态
        com.jello.music.model.UserInfo u = com.jello.music.AppPrefs.loadUser();
        if (u != null && u.isAuthenticated()) {
            KuGouCredentials saved = new KuGouCredentials();
            saved.setToken(u.getToken());
            saved.setUserid(u.getUserid());
            saved.setT1(u.getT1());
            saved.setDfid(c.getDfid());
            return saved;
        }
        return c;
    }

    /**
     * 从「猜你喜欢」里随便挑一首的hash。
 *
     * <p>探针要的是「一条真实音频链路能跑通」，用哪首歌无所谓。
     * {@code /top/card?card_id=1} 不需要额外参数也不会被搜索的关键词卡住，
     * 比搜索稳。
     *
     * @return hash；取不到时返回空串
     */
    private static String pickAnyHash(com.jello.music.api.KuGouApiClient api) {
        try {
            for (com.jello.music.model.Song s : api.topCard(1)) {
                if (s.getHash() != null && !s.getHash().isBlank()) {
                    return s.getHash();
                }
            }
        } catch (Exception e) {
            System.out.println("    自动选歌失败: " + e.getMessage());
        }
        return "";
    }

    private static String env(String k, String def) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? def : v;
    }

    private static double max(double[] a) {
        double m = 0;
        for (double v : a) {
            m = Math.max(m, v);
        }
        return m;
    }

    private static String fmt(double v) {
        return String.format("%.4f", v);
    }
}