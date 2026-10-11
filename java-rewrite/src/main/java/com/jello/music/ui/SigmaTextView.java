package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.layout.Pane;
import javafx.scene.paint.Color;

/**
 * 文字节点 —— 1:1 复刻原版 {@code SigmaText.vue}（canvas + 字形图集逐字贴图）。
 *
 * <p>原版的排版规则全在这一处，写死不改：
 * <pre>
 *   canvasW = boxWidth（不给就量出来）      canvasH = boxHeight（不给就 lineHeight）
 *   x = 左对齐 ? 0 : 居中 ? floor((cssW - textWidth) / 2) : cssW - textWidth
 *   y = floor((cssH - lineHeight) / 2)
 *   逐字：命中图集 -> drawImage(字形, penX, y, w, h)，penX += adv
 *         没命中  -> fillText(ch, penX, y + ascent)，penX += ceil(度量宽)
 * </pre>
 *
 * <p>跑马灯（{@code scroll}）对应 sigmarebase 的 {@code MusicPlayer.method13192}：
 * 8500ms 一轮、前 40% 静止、{@code easeInOutQuad} 缓动、位移
 * {@code textWidth * eased} 再额外左移 {@code 50 * eased}、透明度按
 * {@code 1 - eased * 0.75} 衰减，并在 {@code baseX - shift + textWidth}
 * 处补一份同样文字做出无缝绕回。只有文字超框才进这个分支（原版同样如此）。
 *
 * <p>{@code truncate} 对应 CSS {@code text-overflow: ellipsis}，
 * 判定规则见 {@link #truncate}。
 */
public final class SigmaTextView extends Pane {

    public enum Align {
        LEFT, CENTER, RIGHT
    }

    private static final long CYCLE_MS = 8500L;
    private static final double EXTRA_SHIFT = 50;
    private static final double FADE = 0.75;
    private static final double PAUSE_FRACTION = 0.4;

    private final SigmaAtlas atlas;
    private final double boxW;
    private final double boxH;
    private final Align align;
    private final long phaseMs;
    private final Canvas canvas = new Canvas();
    private final GraphicsContext g;

    private String text = "";
    private Color color = Theme.TEXT;
    private double alpha = 1;
    private boolean scrolling;
    private double offsetX;

    private AnimationTimer timer;

    public SigmaTextView(String family, int size, double boxW, double boxH, Align align) {
        this(family, size, boxW, boxH, align, 0);
    }

    public SigmaTextView(String family, int size, double boxW, double boxH, Align align,
                         long phaseMs) {
        this.atlas = SigmaAtlas.get(family, size);
        this.boxW = boxW;
        this.boxH = boxH <= 0 ? atlas.lineHeight() : boxH;
        this.align = align;
        this.phaseMs = phaseMs;

        applySize();

        canvas.setWidth(width());
        canvas.setHeight(height());
        // 原版 canvas 有 imageSmoothingEnabled=false，但这个JavaFX 构建的 Canvas
        // 没有那个属性（javap 实测）。其实也不需要：下面贴图一律源尺寸 1:1 贴到整数坐标，
        // 不缩放就没有重采样，视觉效果一致。
        g = canvas.getGraphicsContext2D();
        // GraphicsContext 同样没有 setTextAntialiasing（那只在 javafx.scene.text.Text 上），
        // 缺字形的中文由 Prism 自己的字体光栅化处理。
        getChildren().add(canvas);
    }

    /**
     * 画布与盒子尺寸。
     *
     * <p>{@code boxW <= 0} 就是原版的 {@code fluid}：画布宽取量出来的文字宽
     * （Logo 与左时间就是这样）。给固定宽时照 {@code box-width} 走。
     */
    private void applySize() {
        double w = boxW > 0
                ? Math.ceil(boxW)
                : Math.max(1, Math.ceil(atlas.measure(text)));
        double h = Math.max(1, Math.ceil(boxH));
        if (canvas.getWidth() == w && canvas.getHeight() == h && getPrefWidth() == w) {
            return;
        }
        canvas.setWidth(w);
        canvas.setHeight(h);
        setPrefSize(w, h);
        setMinSize(w, h);
        setMaxSize(w, h);
        // 原版 overflow:hidden：超出的部分不画
        setClip(new javafx.scene.shape.Rectangle(w, h));
    }

    private double width() {
        return canvas.getWidth();
    }

    private double height() {
        return Math.max(1, Math.ceil(boxH));
    }

    public void setText(String t) {
        this.text = t == null ? "" : t;
        applySize();
        if (scrolling && boxW > 0 && textWidth() > boxW) {
            startTimer();
        } else {
            stopTimer();
            renderStatic();
        }
    }

    public void setColor(Color c) {
        this.color = c;
        renderStatic();
    }

    public void setAlpha(double a) {
        this.alpha = a;
        renderStatic();
    }

    /** 开启跑马灯（原版 {@code scroll} 属性），只有超框时才真的动。 */
    public void setScrolling(boolean on, long phaseMs) {
        this.scrolling = on;
        if (on && boxW > 0 && textWidth() > boxW) {
            startTimer();
        } else {
            stopTimer();
            renderStatic();
        }
    }

    /**
     * 切换到「输入框基线」算法 —— 只给搜索框用。
     *
     * <p>原版 {@code SigmaTextField} 不按图集 lineHeight 垂直居中，而是拿浏览器对
     * {@code 'Hg'} 的字体度量算基线，再减掉图集 ascent：
     * <pre>
     *   baseline = round((height - (ascent + descent)) / 2 + ascent)
     *   y        = baseline - atlas.ascent
     * </pre>
     * {@code FALLBACK_STACK} 第一个就是 JelloLight，所以这里用同一个字体量 'Hg'，
     * {@code Text.getBaselineOffset()} 给 ascent，布局高减掉它得 descent。
     */
    public SigmaTextView fieldBaseline(boolean on) {
        this.fieldBaseline = on;
        renderStatic();
        return this;
    }

    private boolean fieldBaseline;

    public String text() {
        return text;
    }

    public long phaseMs() {
        return phaseMs;
    }

    public SigmaAtlas atlas() {
        return atlas;
    }

    /** 当前整串的推进宽度（逐字形累加，对齐原版 {@code measureSigmaText}）。 */
    public double textWidth() {
        return atlas.measure(displayText());
    }

    private String displayText() {
        return text;
    }

    // ---- 绘制 ----

    private void renderStatic() {
        g.clearRect(0, 0, canvas.getWidth(), canvas.getHeight());
        double tw = atlas.measure(text);
        double x = penX(tw);
        double y = textTop();
        g.setGlobalAlpha(alpha);
        drawText(text, x, y);
        g.setGlobalAlpha(1);
    }

    /** 文字上沿在盒子里的 y。默认按图集 lineHeight 垂直居中（取 floor，与原版一致）。 */
private double textTop() {
    if (!fieldBaseline) {
        return Math.floor((height() - atlas.lineHeight()) / 2);
    }
    javafx.scene.text.Text m = new javafx.scene.text.Text("Hg");
    m.setFont(Assets.light(atlas.size()));
    double asc = m.getBaselineOffset();
    double desc = Math.max(0, m.getLayoutBounds().getHeight() - asc);
    return Math.round((height() - (asc + desc)) / 2 + asc) - atlas.ascent();
}

private double penX(double textWidth) {
    if (align == Align.CENTER) {
            return Math.floor((width() - textWidth) / 2);
        }
        if (align == Align.RIGHT) {
            return width() - textWidth;
        }
        return offsetX;
    }

    /**
     * 横向偏移（只对左对齐有意义）。
     *
     * <p>对应原版输入框的 {@code field20746}：文字太长时光标贴到右边界就把文字往回推，
     * 保证光标始终落在盒子内。
     */
    public void setOffsetX(double x) {
        if (this.offsetX == x) {
            return;
        }
        this.offsetX = x;
        renderStatic();
    }

    /** 同步重绘一帧（跑马灯动画每帧会调用）。 */
    public void renderNow() {
        renderStatic();
    }

    /** 逐字形贴图；缺字形（中文）退回字体渲染，基线对齐图集 ascent。 */
    private void drawText(String s, double x, double y) {
        if (s.isEmpty()) {
            return;
        }
        javafx.scene.image.Image tinted = atlas.tinted(color);
        double pen = x;
        g.setFill(color);
        g.setFont(Assets.light(atlas.size()));
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            i += Character.charCount(cp);
            SigmaAtlas.Glyph glyph = atlas.glyph(cp);
            if (glyph != null) {
                g.drawImage(tinted, glyph.x(), glyph.y(), glyph.w(), glyph.h(),
                        Math.round(pen), Math.round(y), glyph.w(), glyph.h());
                pen += glyph.adv();
            } else {
                String ch = new String(Character.toChars(cp));
                g.fillText(ch, Math.round(pen), Math.round(y) + atlas.ascent());
                pen += atlas.fallbackWidth(ch);
            }
        }
    }

    // ---- 跑马灯 ----

    private void startTimer() {
        if (timer != null) {
            return;
        }
        timer = new AnimationTimer() {
            @Override
            public void handle(long now) {
                renderFrame(now / 1_000_000L);
            }
        };
        timer.start();
    }

    void renderFrame(long nowMs) {
        double eased = easeInOutQuad(progress(nowMs, phaseMs));
        String s = displayText();
        double tw = atlas.measure(s);
        if (tw <= 0) {
            return;
        }
        double visible = Math.min(width(), tw);
        double baseX = Math.floor((width() - visible) / 2);
        double shift = tw * eased;
        double y = textTop();

        g.clearRect(0, 0, canvas.getWidth(), canvas.getHeight());
        g.setGlobalAlpha(alpha * Math.min(1, Math.max(0, 1 - eased * FADE)));
        drawText(s, baseX - shift - EXTRA_SHIFT * eased, y);
        g.setGlobalAlpha(1);
        // 跟随副本：从右侧进入，全亮
        if (eased > 0) {
            drawText(s, baseX - shift + tw, y);
        }
    }

    private void stopTimer() {
        if (timer != null) {
            timer.stop();
            timer = null;
        }
    }

    public void dispose() {
        stopTimer();
    }

    /**
     * 整轮 8500ms：前 40% 静止，剩下 60% 走完一个 easeInOutQuad。
     * <p>抽成静态方法是为了让离屏校验能直接断言这段时序，不用真等 8.5 秒。
     */
    public static double progress(long nowMs, long phaseMs) {
        double cycle = (((nowMs + phaseMs) % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
        double p = cycle / (double) CYCLE_MS;
        if (p < PAUSE_FRACTION) {
            return 0;
        }
        return (p - PAUSE_FRACTION) / (1 - PAUSE_FRACTION);
    }

    public static double easeInOutQuad(double t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    // ---- 截断 ----

    /**
     * 超宽截断（对应 CSS {@code text-overflow: ellipsis}）。
     *
     * <p>原版 {@code truncateSigmaText}：整串放得下就原样返回；否则先给省略号留出宽度，
     * 逐字累加，{@code width + adv > maxWidth - dotsWidth} 就停，末尾补一个 '…'。
     */
    public String truncate(double maxWidth) {
        return truncate(text, maxWidth);
    }

    public String truncate(String source, double maxWidth) {
        if (maxWidth <= 0 || source == null || source.isEmpty()) {
            return source == null ? "" : source;
        }
        if (atlas.measure(source) <= maxWidth) {
            return source;
        }
        double dotsWidth = atlas.measure("…");
        StringBuilder kept = new StringBuilder();
        for (int i = 0; i < source.length(); ) {
            int cp = source.codePointAt(i);
            i += Character.charCount(cp);
            String ch = new String(Character.toChars(cp));
            if (atlas.measure(kept + ch) > maxWidth - dotsWidth) {
                break;
            }
            kept.append(ch);
        }
        return kept.append('…').toString();
    }
}
