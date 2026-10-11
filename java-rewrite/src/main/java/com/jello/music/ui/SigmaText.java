package com.jello.music.ui;

import javafx.scene.text.Font;
import javafx.scene.text.Text;

/**
 * 文字度量与超宽截断 —— 1:1 复刻原版 {@code utils/sigmaFontAtlas.js} 的
 * {@code measureSigmaText} / {@code truncateSigmaText}，
 * 对应 sigmarebase 里 Slick {@code TrueTypeFont} 的逐字形宽度累加。
 *
 * <p>原版算法（{@code truncateSigmaText}）：
 * <ol>
 *   <li>整串量得下就直接返回原样；</li>
 *   <li>量不下就先给省略号留出宽度（{@code size/2}，缺字形时按浏览器度量 '…'}），</li>
 *   <li>逐字累加，{@code width + adv > maxWidth - dotsWidth} 就停，末尾补一个 '…'。</li>
 * </ol>
 *
 * <p><b>JavaFX 为什么不能用 {@code Labeled.setTextTruncation}</b>：
 * 那个 API 是 JavaFX 22 才有的，本项目用的 21.0.5 上没有
 * （{@code javap javafx.scene.control.Labeled} 实测）。
 * CSS 的 {@code text-overflow: ellipsis} 同样没有等价实现——
 * {@link javafx.scene.control.Label} 只会硬裁掉溢出部分，尾部一个字都不剩。
 * 所以按原版算法在 Java 侧把字符串本身截短，视觉才和原版一致。
 *
 * <p>原版逐字累加的是字形 advance（无字距调整），这里用 {@link Text#getLayoutBounds()}
 * 量前缀：量到的就是真正会画出来的宽度，比逐字求和更贴合实际渲染，
 * 而「逐字加、超框即停」的判定规则与原版完全相同。
 *
 * <p>必须在 FX 线程调用（{@link Text} 的度量依赖 JavaFX 工具箱）。
 */
public final class SigmaText {

    private SigmaText() {
    }

    /** 量一段文字的渲染宽度（px）。 */
    public static double measure(String text, Font font) {
        if (text == null || text.isEmpty()) {
            return 0;
        }
        Text t = new Text(text);
        t.setFont(font);
        return t.getLayoutBounds().getWidth();
    }

    /**
     * 超宽截断：放不下就在尾部补 '…'，放得下原样返回。
     *
     * @param maxWidth 可用宽度（对应原版传入的 CSS 盒宽）
     */
    public static String truncate(String text, Font font, double maxWidth) {
        if (text == null || text.isEmpty()) {
            return text == null ? "" : text;
        }
        if (maxWidth <= 0) {
            return text;
        }
        if (measure(text, font) <= maxWidth) {
            return text;
        }
        double dotsWidth = measure("…", font);
        StringBuilder kept = new StringBuilder();
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            String ch = new String(Character.toChars(cp));
            if (measure(kept.toString() + ch, font) > maxWidth - dotsWidth) {
                break;
            }
            kept.append(ch);
            i += Character.charCount(cp);
        }
        return kept.append('…').toString();
    }
}