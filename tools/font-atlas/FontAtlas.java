import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import javax.imageio.ImageIO;

/**
 * Generates bitmap font atlases that are pixel-identical to sigmarebase's
 * Slick TrueTypeFont rendering (org.newdawn.slick.TrueTypeFont).
 *
 * Mirrors Slick exactly:
 *   - glyph image size   : charWidth x fontMetrics.getHeight()
 *   - rendering hints    : only KEY_ANTIALIASING = VALUE_ANTIALIAS_ON
 *                          (text AA stays Java2D default -> grayscale AA on ARGB)
 *   - glyph color        : white, baseline drawn at y = ascent
 *   - advance            : fontMetrics.charWidth(c), min 1
 *   - no kerning
 *
 * Usage: java FontAtlas.java <font.ttf> <outDir> <size1,size2,...>
 */
public class FontAtlas {

    static final int FIRST = 32;
    static final int LAST = 255;

    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("usage: java FontAtlas.java <font.ttf> <outDir> <size1,size2,...>");
            System.exit(2);
        }
        File ttf = new File(args[0]);
        File outDir = new File(args[1]);
        if (!outDir.exists() && !outDir.mkdirs()) {
            throw new IllegalStateException("cannot create " + outDir);
        }
        String prefix = args.length > 3 ? args[3] : "atlas";
        for (String part : args[2].split(",")) {
            int size = Integer.parseInt(part.trim());
            build(ttf, outDir, size, prefix);
        }
    }

    static void build(File ttf, File outDir, int size, String prefix) throws Exception {
        // 文件路径 = TrueType 字体；否则按 Java 逻辑字体名（SansSerif/Dialog 等）处理，
        // 后者用于复刻 ResourceRegistry.getChineseFont（缩略图卡片用它渲染中英文）
        Font font;
        if (ttf.isFile()) {
            font = Font.createFont(Font.TRUETYPE_FONT, ttf).deriveFont((float) size);
        } else {
            font = new Font(ttf.getName(), Font.PLAIN, size);
        }

        // probe metrics the same way Slick does
        BufferedImage probe = new BufferedImage(1, 1, BufferedImage.TYPE_INT_ARGB);
        Graphics2D pg = probe.createGraphics();
        pg.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        pg.setFont(font);
        FontMetrics fm = pg.getFontMetrics();
        pg.dispose();

        int ascent = fm.getAscent();
        int lineHeight = fm.getHeight();
        if (lineHeight <= 0) {
            lineHeight = size;
        }

        int count = LAST - FIRST + 1;
        BufferedImage[] glyphs = new BufferedImage[count];
        int[] advance = new int[count];

        int maxWidth = 1;
        for (int i = 0; i < count; i++) {
            char c = (char) (FIRST + i);
            int w = fm.charWidth(c);
            if (w <= 0) {
                w = 1;
            }
            advance[i] = w;
            if (w > maxWidth) {
                maxWidth = w;
            }

            BufferedImage gi = new BufferedImage(w, lineHeight, BufferedImage.TYPE_INT_ARGB);
            Graphics2D gg = gi.createGraphics();
            gg.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            gg.setFont(font);
            gg.setColor(Color.WHITE);
            gg.drawString(String.valueOf(c), 0, ascent);
            gg.dispose();
            glyphs[i] = gi;
        }

        // simple row packer (same idea as Slick's nextX/nextY/currentRowHeight)
        int atlasWidth = nextPow2(Math.max(256, maxWidth * 16));
        int x = 0;
        int y = 0;
        int rowH = 0;
        int usedHeight = 0;
        int[] gx = new int[count];
        int[] gy = new int[count];
        for (int i = 0; i < count; i++) {
            int w = glyphs[i].getWidth();
            int h = glyphs[i].getHeight();
            if (x + w > atlasWidth) {
                x = 0;
                y += rowH + 1;
                rowH = 0;
            }
            gx[i] = x;
            gy[i] = y;
            x += w + 1;
            if (h > rowH) {
                rowH = h;
            }
            if (y + h > usedHeight) {
                usedHeight = y + h;
            }
        }
        int atlasHeight = nextPow2(Math.max(64, usedHeight));

        BufferedImage atlas = new BufferedImage(atlasWidth, atlasHeight, BufferedImage.TYPE_INT_ARGB);
        Graphics2D ag = atlas.createGraphics();
        ag.setComposite(java.awt.AlphaComposite.Src);
        for (int i = 0; i < count; i++) {
            ag.drawImage(glyphs[i], gx[i], gy[i], null);
        }
        ag.dispose();

        String base = prefix + "-" + size;
        File png = new File(outDir, base + ".png");
        ImageIO.write(atlas, "png", png);

        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        sb.append("  \"size\": ").append(size).append(",\n");
        sb.append("  \"lineHeight\": ").append(lineHeight).append(",\n");
        sb.append("  \"ascent\": ").append(ascent).append(",\n");
        sb.append("  \"descent\": ").append(fm.getDescent()).append(",\n");
        sb.append("  \"leading\": ").append(fm.getLeading()).append(",\n");
        sb.append("  \"atlasWidth\": ").append(atlasWidth).append(",\n");
        sb.append("  \"atlasHeight\": ").append(atlasHeight).append(",\n");
        sb.append("  \"glyphs\": {\n");
        for (int i = 0; i < count; i++) {
            int code = FIRST + i;
            sb.append("    \"").append(code).append("\": {\"x\": ").append(gx[i])
              .append(", \"y\": ").append(gy[i])
              .append(", \"w\": ").append(glyphs[i].getWidth())
              .append(", \"h\": ").append(glyphs[i].getHeight())
              .append(", \"adv\": ").append(advance[i]).append("}");
            if (i != count - 1) {
                sb.append(",");
            }
            sb.append("\n");
        }
        sb.append("  }\n");
        sb.append("}\n");

        File json = new File(outDir, base + ".json");
        try (Writer w = new OutputStreamWriter(new FileOutputStream(json), StandardCharsets.UTF_8)) {
            w.write(sb.toString());
        }

        System.out.println("size " + size + ": atlas " + atlasWidth + "x" + atlasHeight
            + ", ascent " + ascent + ", lineHeight " + lineHeight
            + " -> " + png.getName() + " + " + json.getName());
    }

    static int nextPow2(int v) {
        int p = 1;
        while (p < v) {
            p <<= 1;
        }
        return p;
    }
}


