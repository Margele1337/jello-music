package com.jello.music.ui;

import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.image.Image;
import javafx.scene.image.WritableImage;
import javafx.scene.layout.Pane;

import java.awt.image.BufferedImage;

/**
 * 底部封面条 —— 1:1 复刻原版 {@code SigmaMusicPlayer.vue} 的 {@code renderStrip()}：
 *
 * <pre>
 *   const off = canvas(封面原图尺寸)
 *   octx.filter = 'blur(15px)'
 *   octx.drawImage(image, 0, 0)                    // 整张封面先模糊
 *   const cropY = Math.floor(off.height * 0.75)    // 再取 75% 处往下 20% 高的一条
 *   const cropH = Math.max(1, Math.floor(off.height * 0.2))
 *   ctx.drawImage(off, 0, cropY, off.width, cropH, 0, 0, 800, 94)
 * </pre>
 *
 * <p><b>顺序不能换</b>：原版是「整图模糊 → 裁一条 → 拉伸铺满」，
 * 换成「裁切铺满 → 模糊」得到的是完全不同的画面（之前就是这么写的，
 * 底部条上糊出来的是封面正中的音符，不是底部那条渐变）。
 *
 * <p><b>高斯模糊怎么做</b>：原版靠 canvas 的 {@code ctx.filter}。
 * JavaFX 没有卷积滤镜，{@code javafx.scene.effect.GaussianBlur} 只能挂在节点上
 * （那等于「画完再模糊」，又回到错误的顺序），所以这里走 {@code java.awt.image}：
 * 三次盒式模糊近似高斯（Kutskir 的经典做法，逐趟 O(1)/像素）。
 *
 * <p><b>σ 取 blur(15px) / 2</b>：CSS {@code filter: blur(r)} 在 Chromium 里
 * 对应的是高斯的 stdDeviation = r/2，不是 r。
 *
 * <p>无封面 / 封面加载失败时，原版回退到 {@code bg.png} 直接拉伸铺满（不模糊），
 * 这里照抄，不再拿 {@code artwork.png} 顶替。
 */
public final class CanvasStrip extends Pane {

    /** 与原版 CSS {@code ctx.filter = 'blur(15px)'} 一致。 */
    private static final double BLUR_PX = 15;
    /** Chromium 的 blur(r) → stdDeviation = r / 2。 */
    private static final double BLUR_SIGMA = BLUR_PX / 2;
    /** 取原图 75% ~ 95% 这一条。 */
    private static final double CROP_FROM = 0.75;
    private static final double CROP_HEIGHT = 0.2;

    private final Canvas canvas = new Canvas();
    private final GraphicsContext g;
    private BufferedImage current;

    public CanvasStrip(double w, double h) {
        canvas.setWidth(w);
        canvas.setHeight(h);
        g = canvas.getGraphicsContext2D();
        getChildren().add(canvas);
        current = toBuffered(Assets.image("bg.png"));
        draw();
    }

    /**
     * 直接给定一张已加载好的封面（离屏校验走这里，不必等异步加载）。
     */
    public void setCoverImage(Image img) {
        boolean bad = img == null || img.getWidth() <= 0 || img.getException() != null;
        setCoverBuffered(bad ? toBuffered(Assets.image("bg.png")) : toBuffered(img));
    }

    public void setCover(String url) {
        if (url == null || url.isBlank()) {
            setCoverBuffered(toBuffered(Assets.image("bg.png")));
            return;
        }
        // 构造参数 true 是「后台加载」，是异步的：构造函数返回时图片宽高还是 0，
        // 此时算出的缩放比是 NaN，drawImage 什么都不画，整条封面就成了一块透明，
        // 底下的 rgba(1,1,1,0.43) 遮罩压不住浅色桌面，于是歌名/时长这些 #fefefe
        // 的字全都「隐形」了。之前没有「加载完再重绘」，封面永远出不来。
        // 这里监听 progress 到 1，再回 FX 线程重绘。
        Image img = new Image(url, true);
        if (img.getProgress() < 1.0) {
            img.progressProperty().addListener((o, was, now) -> {
                if (now.doubleValue() >= 1.0) {
                    javafx.application.Platform.runLater(() -> setCoverImage(img));
                }
            });
        } else {
            setCoverImage(img);
        }
    }

    private void setCoverBuffered(BufferedImage img) {
        current = img;
        draw();
    }

    /** 模糊 → 裁条 → 拉伸铺满。480x480 的封面整趟算下来几毫秒，可以直接跑在 FX 线程。 */
    private void draw() {
        double w = canvas.getWidth();
        double h = canvas.getHeight();
        g.clearRect(0, 0, w, h);
        if (current == null || current.getWidth() <= 0 || current.getHeight() <= 0) {
            return;
        }

        BufferedImage blurred = blur(current, BLUR_SIGMA);
        int cropY = (int) Math.floor(blurred.getHeight() * CROP_FROM);
        int cropH = Math.max(1, (int) Math.floor(blurred.getHeight() * CROP_HEIGHT));

        WritableImage fx = toFxImage(blurred);
        g.drawImage(fx, 0, cropY, blurred.getWidth(), cropH, 0, 0, w, h);
    }

    // ---- 模糊 ----

    /**
     * 三次盒式模糊近似高斯。
     *
     * <p>不用 {@code ConvolveOp}：核宽约 2σ·3 ≈ 45px，480x480 的图要算 10 亿次乘加，
     * 主线程直接卡死。盒式模糊用滑动窗口求和，每像素 O(1)，三趟下来视觉上与高斯无异。
     * 核宽取 {@code wIdeal = sqrt(12σ²/3 + 1)}，再强制成奇数以保证半径对称。
     */
    public static BufferedImage blur(BufferedImage src, double sigma) {
        if (sigma <= 0) {
            return src;
        }
        int passes = 3;
        double wIdeal = Math.sqrt(12.0 * sigma * sigma / passes + 1.0);
        int wl = (int) Math.floor(wIdeal);
        int wu = wl + 1;
        int width = (wl + wu * passes - 1) / passes;
        if ((width & 1) == 0) {
            width--;
        }
        int r = width / 2;
        if (r < 1) {
            return src;
        }

        BufferedImage cur = argb(src);
        int w = cur.getWidth();
        int h = cur.getHeight();
        int[] px = cur.getRGB(0, 0, w, h, null, 0, w);
        for (int i = 0; i < passes; i++) {
            px = boxH(px, w, h, r);
            px = boxV(px, w, h, r);
        }
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        out.setRGB(0, 0, w, h, px, 0, w);
        return out;
    }

    private static BufferedImage argb(BufferedImage src) {
        if (src.getType() == BufferedImage.TYPE_INT_ARGB) {
            return src;
        }
        BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(),
                BufferedImage.TYPE_INT_ARGB);
        out.getGraphics().drawImage(src, 0, 0, null);
        return out;
    }

    /**
     * 横向一遍：窗口内求和 + 滑动。
     *
     * <p><b>必须用 {@code |=} 而不是 {@code =}</b>：四个通道各扫一遍，
     * 每次只填自己那一个字节；用 {@code =} 的话最后一次（alpha）会把 RGB 整个覆盖成 0，
     * 整张图只剩纯黑——这个 bug 排查过一次，现象是「封面条变成一条纯黑带」。
     */
    private static int[] boxH(int[] src, int w, int h, int r) {
        int[] out = new int[src.length];
        for (int y = 0; y < h; y++) {
            int row = y * w;
            for (int c = 0; c < 4; c++) {
                long sum = 0;
                long n = 0;
                for (int x = -r; x <= r; x++) {
                    int xx = clamp(x, w);
                    sum += (src[row + xx] >>> (c * 8)) & 0xFF;
                    n++;
                }
                for (int x = 0; x < w; x++) {
                    out[row + x] |= (int) ((sum / n) << (c * 8));
                    int add = clamp(x + r + 1, w);
                    int sub = clamp(x - r, w);
                    sum += (src[row + add] >>> (c * 8)) & 0xFF;
                    sum -= (src[row + sub] >>> (c * 8)) & 0xFF;
                }
            }
        }
        return out;
    }

    private static int[] boxV(int[] src, int w, int h, int r) {
        int[] out = new int[src.length];
        for (int x = 0; x < w; x++) {
            for (int c = 0; c < 4; c++) {
                long sum = 0;
                long n = 0;
                for (int y = -r; y <= r; y++) {
                    int yy = clamp(y, h);
                    sum += (src[yy * w + x] >>> (c * 8)) & 0xFF;
                    n++;
                }
                for (int y = 0; y < h; y++) {
                    out[y * w + x] |= (int) ((sum / n) << (c * 8));
                    int add = clamp(y + r + 1, h);
                    int sub = clamp(y - r, h);
                    sum += (src[add * w + x] >>> (c * 8)) & 0xFF;
                    sum -= (src[sub * w + x] >>> (c * 8)) & 0xFF;
                }
            }
        }
        return out;
    }

    private static int clamp(int v, int max) {
        if (v < 0) {
            return 0;
        }
        return v >= max ? max - 1 : v;
    }

    // ---- 图像转换 ----

    private static BufferedImage toBuffered(Image img) {
        if (img == null) {
            return null;
        }
        int w = (int) img.getWidth();
        int h = (int) img.getHeight();
        if (w <= 0 || h <= 0) {
            return null;
        }
        // 显式指定非预乘 ARGB：PixelReader.getPixels 的默认格式取决于图片来源
        // （Canvas 快照是预乘的），而 BufferedImage.setRGB 按非预乘解释
        int[] argb = new int[w * h];
        img.getPixelReader().getPixels(0, 0, w, h,
                javafx.scene.image.PixelFormat.getIntArgbInstance(), argb, 0, w);
        BufferedImage out = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        out.setRGB(0, 0, w, h, argb, 0, w);
        return out;
    }

    /**
     * {@link BufferedImage} → {@link WritableImage}。
     *
     * <p><b>不用 {@code javafx.embed.swing.SwingFXUtils}</b>：它在 {@code javafx.swing}
     * 模块里，而这个模块只存在于<b>不带 classifier</b> 的 {@code javafx-graphics} jar。
     * {@code package.ps1} 去重时会把非 {@code -win} 的 javafx jar 全丢掉
     * （否则 javafx.graphics 模块会被注册两次，jpackage 直接报 FileAlreadyExistsException），
     * 结果就是「编译得过、打包后 ClassNotFound」。自己搬像素只多一次循环。
     */
    private static WritableImage toFxImage(BufferedImage img) {
        int w = img.getWidth();
        int h = img.getHeight();
        int[] argb = img.getRGB(0, 0, w, h, null, 0, w);
        WritableImage out = new WritableImage(w, h);
        out.getPixelWriter().setPixels(0, 0, w, h,
                javafx.scene.image.PixelFormat.getIntArgbInstance(), argb, 0, w);
        return out;
    }
}