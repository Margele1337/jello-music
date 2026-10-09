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
            System.out.println();
            System.out.println("[2] 跳过直链与频谱：未设置 JELLO_HASH");
            System.out.println("    第 1 段已通过，说明 Java 调 api 的链路可用。");
            return;
        }
        System.out.println();
        System.out.println("[2] 调用 /song/url  hash=" + hash);
        String directUrl;
        try {
            directUrl = api.songUrl(hash, 320);
        } catch (Exception e) {
            System.out.println("    失败: " + e.getMessage());
            System.out.println("    常见原因：凭据无效，或触发了 20028 风控（需验证码）。");
            return;
        }
        System.out.println("    直链: " + directUrl);

        // ---- 第 3 段：解码 + FFT ----
        System.out.println();
        System.out.println("[3] 拉流解码并计算 FFT");
        try (SpectrumTap tap = new SpectrumTap(directUrl, 2048)) {
            double[] first = tap.nextFrame();
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
                double[] f = tap.nextFrame();
                if (f == null) {
                    break;
                }
                frames++;
                sumPeak += max(f);
            }
            System.out.println("    连续解码帧数=" + frames
                    + "  平均峰值=" + fmt(frames == 0 ? 0 : sumPeak / frames));

            double[] last = tap.nextFrame();
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

    private static KuGouCredentials credentialsFromEnv() {
        KuGouCredentials c = new KuGouCredentials();
        c.setToken(env("JELLO_TOKEN", ""));
        c.setUserid(env("JELLO_USERID", ""));
        c.setDfid(env("JELLO_DFID", ""));
        c.setT1(env("JELLO_T1", ""));
        c.setMid(env("JELLO_MID", ""));
        c.setGuid(env("JELLO_GUID", ""));
        return c;
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