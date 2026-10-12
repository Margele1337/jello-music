package com.jello.music.tools;

import com.jello.music.api.KuGouApiClient;
import com.jello.music.api.QualityResolver;
import com.jello.music.model.Song;
import com.jello.music.model.UserInfo;
import com.jello.music.player.SpectrumFeed;
import com.jello.music.player.SpectrumTap;
import com.jello.music.AppPrefs;
import com.jello.music.ui.SpectrumView;
import javafx.application.Platform;
import javafx.scene.Scene;
import javafx.scene.canvas.Canvas;
import javafx.scene.image.WritableImage;
import javafx.scene.layout.Pane;

import javax.imageio.ImageIO;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 频谱实测：<b>真实音频 → 真实解码 → 真实渲染 → 截图 + 数值</b>。
 *
 * <p>解决的问题：离屏探针（{@code UiProbe}）只能验公式与参数落地，
 * 但验不了「条形看起来对不对」——条高是绝对像素公式
 * {@code max(0, sqrt(a)/12-5) * (参考窗口高/1080) * scale}，
 * 数值对了但观感不对是很可能的（比如整首都在屏幕外、或全挤在底部 1px）。
 *
 * <p>所以这里不 mock：真连 api、真拉直链、真解码 20 帧，
 * 然后把 {@link SpectrumView} 的 Canvas 抓成 PNG，肉眼直接看。
 *
 * <p>用法：
 * <pre>
 *   java --module-path ... -m com.jello.music/com.jello.music.tools.SpectrumProbe [输出目录]
 * </pre>
 */
public final class SpectrumProbe {

    /** 渲染前先解多少帧——太少看不出形态，太多等太久。 */
    private static final int WARMUP_FRAMES = 60;

    private SpectrumProbe() {
    }

    public static void main(String[] args) throws Exception {
        String outDir = args.length > 0 ? args[0]
                : System.getProperty("java.io.tmpdir");
        new File(outDir).mkdirs();
        System.out.println("===频谱实测 ===");

        // ---- 1. 拿真实直链 ----
        String url = resolveDirectUrl();
        if (url == null) {
            System.out.println("拿不到直链，退出。检查 api 是否在跑、是否已登录。");
            System.exit(1);
        }
        System.out.println("直链: " + url.substring(0, Math.min(80, url.length())) + "...");

        // ---- 2. 真解码 ----
        // 两个 scale 必须在同一次 Platform.startup 里跑完（第二次 startup 会抛
        // IllegalStateException: Platform.exit has been called），所以先解一次、
        // 再在 FX 线程里画两遍。
        double[] amps = decodeOnce(url);
        if (amps == null) {
            System.out.println("解不出帧，退出。");
            System.exit(1);
        }
        reportAmplitude(amps);

        final double[] finalAmps = amps;
        CountDownLatch latch = new CountDownLatch(1);
        Platform.startup(() -> {
            try {
                render(finalAmps, 1.0, outDir);
                render(finalAmps, 2.0, outDir);
            } catch (Throwable t) {
                t.printStackTrace();
            } finally {
                latch.countDown();
            }
        });
        latch.await(60, TimeUnit.SECONDS);
        Platform.exit();

        System.out.println("截图已写入 " + new File(outDir).getAbsolutePath());
    }

    /**
     * 真连api、真拉直链、真解 N 帧并按公式平滑，返回稳定后的 amplitudes。
     */
    private static double[] decodeOnce(String url) throws java.io.IOException {
        List<double[]> frames = new ArrayList<>();
        double sampleRate;
        try (SpectrumTap tap = new SpectrumTap(url, SpectrumFeed.FFT_SIZE)) {
            for (int i = 0; i < WARMUP_FRAMES; i++) {
                double[] raw = tap.nextRawFrame();
                if (raw == null) {
                    break;
                }
                frames.add(SpectrumTap.takeBins(raw, SpectrumFeed.BAR_COUNT));
            }
            sampleRate = tap.sampleRate();
        }
        if (frames.isEmpty()) {
            return null;
        }
        System.out.println("解出 " + frames.size() + " 帧 @ " + sampleRate + " Hz");
        return applySmoothing(frames);
    }

    /** 在已启动的 FX 线程里渲染一个 scale 并截图。 */
    private static void render(double[] amps, double scale, String outDir)
            throws Exception {
        System.out.println();
        System.out.println("--- scale = " + scale + " ---");
        File png = new File(outDir, String.format("spectrum-scale-%.1fx.png", scale));
        WritableImage img = renderWithAmps(amps, scale, png);
        System.out.println("截图: " + (int) img.getWidth() + "x" + (int) img.getHeight()
                + " -> " + png.getName());
    }

    /**
     * 用真实的 amplitudes 渲染频谱窗。
     *
     * <p>刻意<b>不</b>走 {@link SpectrumView}：那个类的目标数据来自
     * {@code feed.levels()}（只能从网络流灌），而这里要渲染的是刚解出来的具体数值。
     * 但绘制公式逐行照抄 {@code SpectrumView.draw} 的实现，
     * 两条路径共用同一套常量与公式——改一处必须改两处，注释里标明了。
     */
    private static WritableImage renderWithAmps(double[] amps, double scale, File png)
            throws Exception {
        final int w = 420;
        final int h = 130;
        // 底部留 22px 给信息块（封面 100x100 + 上边距）
        final int plotH = h - 22;

        Canvas canvas = new Canvas(w, h);
        var g = canvas.getGraphicsContext2D();
        // 深色底，跟频谱窗实际背景一致
        g.setFill(javafx.scene.paint.Color.web("#262626"));
        g.fillRect(0, 0, w, h);

        double barW = Math.ceil((double) w / SpectrumFeed.BAR_COUNT);
        double heightRatio = (SpectrumView.REFERENCE_HEIGHT / 1080.0) * scale;
        double maxH = 0;
        for (int i = 0; i < SpectrumFeed.BAR_COUNT; i++) {
            double refHeight = Math.sqrt(amps[i]) / 12.0 - 5.0;
            double barH = Math.min(plotH, Math.max(0, refHeight) * heightRatio);
            maxH = Math.max(maxH, barH);
            // 底条：alpha = 0.2 * (1 - (i+1)/114)，与 SpectrumView.barStyles 一致
            double alpha = 0.2 * (1 - (double) (i + 1) / SpectrumFeed.BAR_COUNT);
            g.setFill(javafx.scene.paint.Color.color(0.6, 0.6, 0.6, alpha));
            g.fillRect(i * barW, plotH - barH, barW, barH);
        }
        System.out.println("    最高条形 = " + String.format("%.1f", maxH)
                + " px / 可用高度 " + plotH + " px  (占 "
                + String.format("%.0f", maxH / plotH * 100) + "%)");

        Pane root = new Pane(canvas);
        Scene scene = new Scene(root, w, h);
        // 离屏渲染
        root.applyCss();
        root.layout();
        WritableImage img = root.snapshot(null, null);
        ImageIO.write(swapArgb(img), "png", png);
        return img;
    }

    /** WritableImage 是预乘 alpha 的，存成 BufferedImage 时要转回直通 alpha。 */
    private static java.awt.image.BufferedImage swapArgb(WritableImage img) {
        int w = (int) img.getWidth();
        int h = (int) img.getHeight();
        var out = new java.awt.image.BufferedImage(w, h,
                java.awt.image.BufferedImage.TYPE_INT_ARGB);
        var reader = img.getPixelReader();
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int argb = reader.getArgb(x, y);
                int a = (argb >>> 24);
                int r = (argb >> 16) & 0xFF;
                int g2 = (argb >> 8) & 0xFF;
                int b = argb & 0xFF;
                out.setRGB(x, y, (a << 24) | (r << 16) | (g2 << 8) | b);
            }
        }
        return out;
    }

    /**
     * 复刻 {@code SpectrumView} 的平滑：取最后一帧为当前值，
     * 再按 {@code alpha = min(smoothing * (60/实测FPS), 1)} 收敛若干帧。
     *
     * <p>这里把「当前值」初始化成 0（等价于刚起播），让平滑从 0 往上走——
     * 这样能看出稳定后的实际形态，而不是直接显示目标值。
     */
    private static double[] applySmoothing(List<double[]> frames) {
        double[] amps = new double[SpectrumFeed.BAR_COUNT];
        double smoothing = SpectrumView.DEFAULT_SMOOTHING;
        double alpha = Math.min(1.0, Math.max(0.001, smoothing) * (60.0 / 60.0));
        for (double[] target : frames) {
            for (int i = 0; i < amps.length; i++) {
                double next = amps[i] - (amps[i] - target[i]) * alpha;
                amps[i] = Double.isFinite(next)
                        ? Math.min(SpectrumFeed.MAX_AMPLITUDE, Math.max(0.0, next))
                        : 0;
            }
        }
        return amps;
    }

    /** 打印幅度的关键统计，方便和公式预期对照。 */
    private static void reportAmplitude(double[] amps) {
        double max = 0;
        double sum = 0;
        int over0 = 0;
        for (double a : amps) {
            max = Math.max(max, a);
            sum += a;
            if (a > 0) {
                over0++;
            }
        }
        System.out.println("    幅度: max=" + String.format("%.1f", max)
                + " avg=" + String.format("%.1f", sum / amps.length)
                + " 非零条数=" + over0 + "/" + amps.length);
        // 换算成条高，方便和截图对照
        double hr = SpectrumView.REFERENCE_HEIGHT / 1080.0;
        StringBuilder sb = new StringBuilder("    前12条 sqrt(a)/12-5: ");
        for (int i = 0; i < 12; i++) {
            sb.append(String.format("%.1f ", Math.sqrt(amps[i]) / 12.0 - 5.0));
        }
        System.out.println(sb);
        System.out.println("    对应像素高(1.0x): " + String.format("%.1f",
                Math.max(0, Math.sqrt(max) / 12.0 - 5.0) * hr));
    }

    /** 拿一条真实直链（凭据来源与 MainApp 一致）。 */
    private static String resolveDirectUrl() {
        try {
            UserInfo u = AppPrefs.loadUser();
            if (u == null || !u.isAuthenticated()) {
                System.out.println("未登录：先跑一次应用完成登录");
                return null;
            }
            var c = new com.jello.music.model.KuGouCredentials();
            c.setToken(u.getToken());
            c.setUserid(u.getUserid());
            c.setT1(u.getT1());
            KuGouApiClient api = new KuGouApiClient(c);

            List<Song> songs = api.topCard(1);
            for (Song s : songs) {
                String hash = s.getHash();
                if (hash == null || hash.isBlank()) {
                    continue;
                }
                try {
                    return api.songUrl(hash, QualityResolver.selectedQuality());
                } catch (Exception e) {
                    System.out.println("  这首取不到直链（" + e.getMessage() + "），换下一首");
                }
            }
        } catch (Exception e) {
            System.out.println("取直链失败: " + e.getMessage());
        }
        return null;
    }
}