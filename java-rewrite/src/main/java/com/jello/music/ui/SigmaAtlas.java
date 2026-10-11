package com.jello.music.ui;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import javafx.scene.image.Image;
import javafx.scene.image.PixelReader;
import javafx.scene.image.WritableImage;
import javafx.scene.paint.Color;
import javafx.scene.text.Text;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 字形图集 —— 直接复用原 Vue 版 {@code assets/sigma/fonts/atlas-*.json/png}。
 *
 * <p><b>为什么非要它</b>：原版（{@code sigmaFontAtlas.js}，同源于 sigmarebase 的 Slick
 * {@code TrueTypeFont}）是用 Java2D 把每个字形烘成位图，再按 advance 逐字贴图，
 * {@code imageSmoothingEnabled = false}。它的注释写得很直白：
 * 「浏览器端只做1:1 贴图，不做文本排版，从而保证英文与原版逐像素一致」。
 * 换成 JavaFX 的 {@code Label}/{@code Text} 走的是另一套光栅化 + 字距调整，
 * 英文数字都会差几个百分点——想要<b>像素级</b>对齐就只能用同一批位图。
 *
 * <p>图集只含 ASCII（224 个字形）。中文等缺字形时退回字体渲染，
 * 与原版的 {@code FALLBACK_STACK} 分支一致：宽度按 {@code ceil(measureText(ch))} 取。
 *
 * <p>每个 (family, size) 只解析一次，全局缓存。
 */
public final class SigmaAtlas {

    /** 一个字形：图集中的位置与推进宽度。 */
    public record Glyph(int x, int y, int w, int h, int adv) {
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Map<String, SigmaAtlas> CACHE = new ConcurrentHashMap<>();

    private final int size;
    private final int lineHeight;
    private final int ascent;
    private final Map<Integer, Glyph> glyphs = new HashMap<>();
    private final Image image;
    private final String family;

    /** 着色缓存：图集是白色字形，原版用 {@code source-in} 整体染色，这里同样按色缓存一份。 */
    private final Map<Integer, WritableImage> tints = new ConcurrentHashMap<>();

    private SigmaAtlas(String family, int size, int lineHeight, int ascent,
                       Map<Integer, Glyph> glyphs, Image image) {
        this.family = family;
        this.size = size;
        this.lineHeight = lineHeight;
        this.ascent = ascent;
        this.glyphs.putAll(glyphs);
        this.image = image;
    }

    /**
     * 取图集。family 取 {@code "light"}（JelloLight）或 {@code "sans"}（缩略卡/输入框用）。
     */
    public static SigmaAtlas get(String family, int size) {
        String key = family + "-" + size;
        return CACHE.computeIfAbsent(key, k -> {
            String base = "/com/jello/music/atlas/atlas-" + key;
            try (InputStream meta = SigmaAtlas.class.getResourceAsStream(base + ".json");
                 InputStream png = SigmaAtlas.class.getResourceAsStream(base + ".png")) {
                if (meta == null || png == null) {
                    throw new IllegalStateException("字形图集缺失: " + base);
                }
                JsonNode root = MAPPER.readTree(meta);
                Map<Integer, Glyph> gs = new HashMap<>();
                JsonNode glyphs = root.path("glyphs");
                glyphs.fields().forEachRemaining(e -> {
                    JsonNode g = e.getValue();
                    gs.put(Integer.parseInt(e.getKey()),
                            new Glyph(g.path("x").asInt(), g.path("y").asInt(),
                                    g.path("w").asInt(), g.path("h").asInt(),
                                    g.path("adv").asInt()));
                });
                return new SigmaAtlas(family, size,
                        root.path("lineHeight").asInt(size),
                        root.path("ascent").asInt(size),
                        gs, new Image(png));
            } catch (Exception e) {
                throw new IllegalStateException("字形图集加载失败: " + base, e);
            }
        });
    }

    public int size() {
        return size;
    }

    public int lineHeight() {
        return lineHeight;
    }

    public int ascent() {
        return ascent;
    }

    public Glyph glyph(int codePoint) {
        return glyphs.get(codePoint);
    }

    /** 原图（白色字形）。 */
    public Image image() {
        return image;
    }

    /**
     * 按 {@code source-in} 的思路把白色字形整体染成 {@code color}。
     *
     * <p>原版就是一张 {@code getTintedAtlas} 缓存表；这里照抄（按颜色 key 缓存）。
     */
    public Image tinted(Color color) {
        int argb = toArgb(color);
        return tints.computeIfAbsent(argb, k -> {
            int w = (int) image.getWidth();
            int h = (int) image.getHeight();
            PixelReader r = image.getPixelReader();
            WritableImage out = new WritableImage(w, h);
            int rgb = argb & 0x00FFFFFF;
            int alpha = argb >>> 24;
            // PixelWriter 只有单像素的 setArgb，没有批量重载；图集很小（几百 x 18），直接逐像素写
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int a = r.getArgb(x, y) >>> 24;
                    out.getPixelWriter().setArgb(x, y, ((a * alpha / 255) << 24) | rgb);
                }
            }
            return out;
        });
    }

    private static int toArgb(Color c) {
        return ((int) Math.round(c.getOpacity() * 255) << 24)
                | ((int) Math.round(c.getRed() * 255) << 16)
                | ((int) Math.round(c.getGreen() * 255) << 8)
                | (int) Math.round(c.getBlue() * 255);
    }

    /**
     * 量一段文字的推进宽度。
     *
     * <p><b>逐字形 advance 累加</b>，与原版 {@code measureSigmaText} 一致：
     * 不做字距调整、不做连字，因此不能拿 JavaFX 的 {@code Text.getLayoutBounds()}
     * 直接量——那个会把整串连起来排版，英文数字会偏。
     * 缺字形按 {@code ceil(字体度量)} 取。
     */
    public double measure(String text) {
        if (text == null || text.isEmpty()) {
            return 0;
        }
        double width = 0;
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            i += Character.charCount(cp);
            Glyph g = glyph(cp);
            if (g != null) {
                width += g.adv();
            } else {
                width += fallbackWidth(new String(Character.toChars(cp)));
            }
        }
        return width;
    }

    /** 缺字形（中文等）的单字宽度，对应原版的 {@code Math.ceil(ctx.measureText(ch).width)}。 */
    public double fallbackWidth(String ch) {
        Text t = new Text(ch);
        t.setFont(Assets.light(size));
        return Math.ceil(t.getLayoutBounds().getWidth());
    }
}