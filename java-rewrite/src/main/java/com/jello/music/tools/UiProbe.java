package com.jello.music.tools;

import com.jello.music.ui.CanvasStrip;
import com.jello.music.ui.PlayerPanel;
import com.jello.music.ui.PlaylistPanel;
import com.jello.music.ui.SearchBox;
import com.jello.music.ui.ThumbnailCard;
import com.jello.music.model.Song;
import com.jello.music.ui.MarqueeText;
import com.jello.music.ui.RepeatButton;
import com.jello.music.ui.Theme;
import javafx.application.Platform;
import javafx.geometry.Bounds;
import javafx.scene.Node;
import javafx.scene.Parent;
import javafx.scene.Scene;
import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.control.Label;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.image.WritableImage;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 静默 UI 校验 —— <b>不显示任何窗口、不发声</b>。
 *
 * <p>做法：只启动 JavaFX 工具箱（{@link Platform#startup}），构造与
 * {@code MainApp} 相同的面板，手工 {@code applyCss() + layout()}，
 * 再对节点树做 {@link Node#snapshot} 离屏截图。
 * 全程不创建 Stage，因此不抢焦点、不会在屏幕上闪现，打游戏时可以跑。
 *
 * <p>断言覆盖这几个踩过的坑：
 * <ul>
 *   <li>Label 必须有非零宽高（{@code styleText} 漏设高度会算成 0 而完全不渲染）</li>
 *   <li>歌名/歌手/两个时间标签都要存在，且落在原版坐标上</li>
 *   <li>频谱 Canvas 不许再压住 (68,430) 的 114x114 专辑封面</li>
 *   <li>截图必须不是纯色（确认离屏渲染真出了像素，而不是空白图）</li>
 * </ul>
 *
 * <p>退出码：0 全过，1 有失败。
 */
public final class UiProbe {

    private static final String SONG = "红色高跟鞋（静默校验）";
    private static final String ARTIST = "测试歌手";
    private static final String TIME_RE = "\\d\\d:\\d\\d";

    private static int failures;

    private UiProbe() {
    }

    public static void main(String[] args) throws Exception {
        String png = args.length > 0 ? args[0]
                : System.getProperty("java.io.tmpdir") + "/jello-ui-probe.png";

        CountDownLatch latch = new CountDownLatch(1);
        Platform.startup(() -> {
            try {
                run(png);
            } catch (Throwable t) {
                t.printStackTrace();
                failures++;
            } finally {
                latch.countDown();
            }
        });

        if (!latch.await(60, TimeUnit.SECONDS)) {
            System.out.println("UI PROBE: TIMEOUT");
            System.exit(1);
        }
        Platform.exit();
        System.out.println(failures == 0 ? "UI PROBE: ALL PASS" : "UI PROBE: " + failures + " FAILURE(S)");
        System.exit(failures == 0 ? 0 : 1);
    }

    private static void run(String pngPath) throws Exception {
        Pane root = new Pane();
        root.setPrefSize(Theme.PANEL_W, Theme.PANEL_H);

        PlayerPanel player = new PlayerPanel();
        root.getChildren().add(player);

        PlaylistPanel playlists = new PlaylistPanel(Theme.PLAYLIST_W, Theme.PLAYLIST_H, i -> {
        });
        playlists.setLayoutX(Theme.PLAYLIST_X);
        playlists.setLayoutY(Theme.PLAYLIST_Y);
        playlists.setItems(List.of("我喜欢", "今日有酒今朝醉"));
        root.getChildren().add(playlists);

        player.setSong(SONG, ARTIST, null);
        player.setCover(null);

        // 不 show()，手工推一遍 CSS + 布局，否则节点宽高全是 0
        new Scene(root, Theme.PANEL_W, Theme.PANEL_H);
        root.applyCss();
        root.layout();

        List<Label> labels = collect(root, Label.class);

        // 歌名/歌手现在是 MarqueeText 视口（clip 在容器上，内层 Label 平移）
        List<MarqueeText> marquees = collect(root, MarqueeText.class);
        MarqueeText titleBox = marquees.stream().filter(m -> m.phaseMs() == 0).findFirst().orElse(null);
        MarqueeText artistBox = marquees.stream().filter(m -> m.phaseMs() == -1000).findFirst().orElse(null);
        check("歌名跑马灯存在（phase=0）", titleBox != null, null);
        check("歌手跑马灯存在（phase=-1000）", artistBox != null, null);
        if (titleBox != null) {
            check("歌名坐标 == 原版",
                    titleBox.getLayoutX() == Theme.TITLE_X && titleBox.getLayoutY() == Theme.TITLE_Y,
                    String.format("x=%.0f y=%.0f w=%.0f h=%.0f",
                            titleBox.getLayoutX(), titleBox.getLayoutY(),
                            titleBox.getBoundsInParent().getWidth(),
                            titleBox.getBoundsInParent().getHeight()));
            check("歌名视口有 clip（对齐 overflow:hidden）", titleBox.getClip() != null, null);
            check("歌名文字已写入", firstWithText(labels, SONG) != null, null);
        }
        if (artistBox != null) {
            check("歌手坐标 == 原版",
                    artistBox.getLayoutX() == Theme.TITLE_X
                            && artistBox.getLayoutY() == Theme.SUBTITLE_Y,
                    String.format("x=%.0f y=%.0f", artistBox.getLayoutX(), artistBox.getLayoutY()));
            check("歌手文字已写入", firstWithText(labels, ARTIST) != null, null);
        }

        long times = labels.stream().filter(l -> l.getText().matches(TIME_RE)).count();
        check("左右两个时间 Label 都在", times == 2, "found=" + times);

        Label timeLeft = labels.stream()
                .filter(l -> l.getText().matches(TIME_RE) && l.getLayoutX() == Theme.TIME_L_X)
                .findFirst().orElse(null);
        check("左时间 Label 落在 x=" + Theme.TIME_L_X, timeLeft != null,
                timeLeft == null ? "missing" : at(timeLeft));

        // 回归护栏：频谱 Canvas 曾被塞在左栏 (15,452)，正好压住 114x114 封面
        ImageView artwork = collect(root, ImageView.class).stream()
                .filter(v -> v.getLayoutX() == Theme.ARTWORK_X && v.getLayoutY() == Theme.ARTWORK_Y)
                .findFirst().orElse(null);
        check("专辑封面 ImageView 在 (" + (int) Theme.ARTWORK_X + "," + (int) Theme.ARTWORK_Y + ")",
                artwork != null, null);

        if (artwork != null) {
            Bounds box = artwork.getBoundsInParent();
            check("专辑封面尺寸 == " + (int) Theme.ARTWORK_S + "x" + (int) Theme.ARTWORK_S,
                    box.getWidth() == Theme.ARTWORK_S && box.getHeight() == Theme.ARTWORK_S,
                    String.format("%.0fx%.0f", box.getWidth(), box.getHeight()));

            StringBuilder hits = new StringBuilder();
            for (Node n : collect(root, Canvas.class)) {
                Bounds c = n.getBoundsInParent();
                if (c.intersects(box)) {
                    hits.append(String.format("canvas@%.0f,%.0f ", c.getMinX(), c.getMinY()));
                }
            }
            check("没有 Canvas 压住专辑封面", hits.isEmpty(), hits.toString());
        }

        // 循环按钮 27x20 @ (264,540)
        RepeatButton repeat = collect(root, RepeatButton.class).stream()
                .findFirst().orElse(null);
        check("循环模式按钮存在 @ (264,540)",
                repeat != null
                        && repeat.getLayoutX() == Theme.REPEAT_X
                        && repeat.getLayoutY() == Theme.REPEAT_Y,
                repeat == null ? "missing"
                        : String.format("x=%.0f y=%.0f", repeat.getLayoutX(), repeat.getLayoutY()));
        if (repeat != null) {
            // 三态雪碧图：0/1/2 各切一次，确认 viewport 跟着走且不抛异常
            repeat.setState(0);
            int a = repeat.state();
            repeat.setState(2);
            int b = repeat.state();
            repeat.setState(1);
            check("循环按钮三态可切换", a == 0 && b == 2 && repeat.state() == 1,
                    String.format("0->%d 2->%d now=%d", a, b, repeat.state()));
        }

        // 无歌手时标题应下移到 .single 的 y=562
        player.setSong("只有标题", null, null);
        root.layout();
        MarqueeText singleBox = collect(root, MarqueeText.class).stream()
                .filter(m -> m.phaseMs() == 0).findFirst().orElse(null);
        check("无歌手时标题下移到 y=562",
                singleBox != null && singleBox.getLayoutY() == Theme.TITLE_SINGLE_Y,
                singleBox == null ? "missing" : String.format("y=%.0f", singleBox.getLayoutY()));
        check("无歌手时歌手行隐藏", !subtitleVisible(labels, "只有标题"),
                "subtitle should be hidden");
        // 复位，别影响后面截图
        player.setSong(SONG, ARTIST, null);
        root.layout();

        // 原版 .smp-dock-trigger：面板 x=0..41 全高
        Region trigger = collect(root, Region.class).stream()
                .filter(r -> r.getLayoutX() == 0 && r.getLayoutY() == 0
                        && r.getPrefWidth() == Theme.EDGE_TRIGGER)
                .findFirst().orElse(null);
        check("41px 贴边触发条存在", trigger != null, null);
        if (trigger != null) {
            check("展开态触发条鼠标穿透（不挡左栏）", trigger.isMouseTransparent(),
                    "mouseTransparent=" + trigger.isMouseTransparent());
        }

        // 原版文字是 nowrap + overflow:hidden，JavaFX 默认会换行
        check("文字 Label 不换行（对齐 nowrap）", labels.stream().noneMatch(Label::isWrapText),
                "wrapText offenders=" + labels.stream().filter(Label::isWrapText).count());
        long uncut = labels.stream()
                .filter(l -> l.getClip() == null && !insideMarquee(l))
                .count();
        check("文字均已裁切（Label 自带 clip 或在跑马灯视口内）", uncut == 0, "uncut=" + uncut);

        // 搜索框 550x506 @ (250,0)
        SearchBox box = collect(root, SearchBox.class).stream().findFirst().orElse(null);
        check("搜索框存在 @ (250,0)",
                box != null && box.getLayoutX() == 250 && box.getLayoutY() == 0
                        && box.getPrefWidth() == 550 && box.getPrefHeight() == 506,
                box == null ? "missing" : String.format("x=%.0f y=%.0f %.0fx%.0f",
                        box.getLayoutX(), box.getLayoutY(), box.getPrefWidth(), box.getPrefHeight()));
        if (box != null) {
            box.showResults(List.of(
                    new Song("H1", "歌名一", "歌手一", "专辑一", null, 1000),
                    new Song("H2", "歌名二", "歌手二", "专辑二", null, 2000),
                    new Song("H3", "歌名三", "歌手三", "专辑三", null, 3000),
                    new Song("H4", "歌名四", "歌手四", "专辑四", null, 4000)));
            root.layout();
            List<ThumbnailCard> cards = collect(root, ThumbnailCard.class);
            check("结果卡片铺了 3 列（超出面板高度的不显示）", cards.size() == 3,
                    "cards=" + cards.size());
            // 列 x=10/183/356，行 y=90
            double[] wantX = {10, 183, 356};
            boolean colsOk = cards.size() == 3;
            for (int i = 0; i < cards.size() && i < 3; i++) {
                ThumbnailCard c = cards.get(i);
                colsOk &= c.getLayoutX() == wantX[i] && c.getLayoutY() == 90
                        && c.getPrefWidth() == 183 && c.getPrefHeight() == 220;
            }
            check("卡片坐标/尺寸 == 原版网格", colsOk, cards.isEmpty() ? "no cards"
                    : String.format("first x=%.0f y=%.0f %.0fx%.0f",
                            cards.get(0).getLayoutX(), cards.get(0).getLayoutY(),
                            cards.get(0).getPrefWidth(), cards.get(0).getPrefHeight()));
            box.clear();
            check("clear() 后卡片清空", collect(root, ThumbnailCard.class).isEmpty(),
                    "left=" + collect(root, ThumbnailCard.class).size());
        }

        checkMarqueeTiming();

        writeSnapshot(root, pngPath);
        checkStripBlur();
    }

    private static boolean insideMarquee(Label l) {
        javafx.scene.Parent p = l.getParent();
        while (p != null) {
            if (p instanceof com.jello.music.ui.MarqueeText) {
                return true;
            }
            p = p.getParent();
        }
        return false;
    }

    private static boolean subtitleVisible(List<Label> labels, String titleText) {
        return labels.stream()
                .filter(l -> l.getLayoutX() == Theme.TITLE_X && l.getLayoutY() == Theme.SUBTITLE_Y)
                .anyMatch(Label::isVisible);
    }

    /**
     * 校验底部封面条真的被模糊了。
     *
     * <p>做法是自对照：拿一张高对比度棋盘图，同一张图分别走
     * ① {@link CanvasStrip}（带 GaussianBlur）与 ② 裸 Canvas（不带特效），
     * 然后比较两者在封面条区域内的平均水平梯度。模糊必然大幅拉低梯度，
     * 所以「模糊版梯度 &lt; 锐利版的一半」这条断言不会因为素材选得不好而误判。
     */
    private static void checkStripBlur() throws Exception {
        int w = (int) Theme.STRIP_W;
        int h = (int) Theme.STRIP_H;
        Image checker = loadCheckerboard(480, 480, 40);

        CanvasStrip strip = new CanvasStrip(w, h);
        strip.setCoverImage(checker);
        Pane blurredRoot = new Pane();
        blurredRoot.getChildren().add(strip);
        blurredRoot.applyCss();
        blurredRoot.layout();
        double blurred = rmsGradient(blurredRoot.snapshot(null, null), 0, 0, w, h);

        Canvas plain = new Canvas(w, h);
        GraphicsContext g = plain.getGraphicsContext2D();
        drawCover(g, plain, checker);
        Pane sharpRoot = new Pane();
        sharpRoot.getChildren().add(plain);
        sharpRoot.applyCss();
        sharpRoot.layout();
        double sharp = rmsGradient(sharpRoot.snapshot(null, null), 0, 0, w, h);

        check("封面条已模糊（梯度降到锐利版一半以下）", blurred < sharp * 0.5,
                String.format("blurred=%.2f sharp=%.2f", blurred, sharp));
    }

    /** 与 {@code CanvasStrip.draw()} 同样的 cover 裁切，用作无模糊对照组。 */
    private static void drawCover(GraphicsContext g, Canvas target, Image img) {
        double w = target.getWidth();
        double h = target.getHeight();
        double r = w / h;
        double ir = img.getWidth() / img.getHeight();
        double dw = ir > r ? h * ir : w;
        double dh = ir > r ? h : w / ir;
        g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }

    private static Image loadCheckerboard(int w, int h, int cell) throws Exception {
        BufferedImage src = new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int v = (((x / cell) + (y / cell)) % 2 == 0) ? 255 : 0;
                src.setRGB(x, y, (v << 16) | (v << 8) | v);
            }
        }
        File tmp = File.createTempFile("jello-checker", ".png");
        tmp.deleteOnExit();
        ImageIO.write(src, "png", tmp);
        return new Image(tmp.toURI().toString());
    }

    /**
     * 区域内的水平梯度 RMS（高频能量），越大越锐利。
     *
     * <p>不能用「平均 |梯度|」：模糊不改变总变化量，只把它摊到更多像素上，
     * 平均值几乎不变（实测 3.19 vs 3.79，看着像没生效，其实是指标选错了）。
     * RMS 才反映峰值——锐利边缘一步跳 255，模糊后被摊成每步几格。
     *
     * <p>采样区向内缩，避开 clip 边界与模糊溢出造成的边缘伪影。
     */
    private static double rmsGradient(WritableImage img, int x0, int y0, int rw, int rh) {
        int w = (int) img.getWidth();
        int h = (int) img.getHeight();
        javafx.scene.image.PixelReader reader = img.getPixelReader();
        int insetX = Math.max(x0 + 20, x0);
        int insetY = Math.max(y0 + 15, y0);
        int endX = Math.min(x0 + rw - 20, w);
        int endY = Math.min(y0 + rh - 15, h);
        double sumSq = 0;
        int n = 0;
        for (int y = insetY; y < endY; y += 2) {
            for (int x = insetX; x < endX; x += 2) {
                double d = luma(reader.getArgb(x, y)) - luma(reader.getArgb(x + 1, y));
                sumSq += d * d;
                n++;
            }
        }
        return n == 0 ? 0 : Math.sqrt(sumSq / n);
    }

    private static int luma(int argb) {
        int r = (argb >> 16) & 0xFF;
        int g = (argb >> 8) & 0xFF;
        int b = argb & 0xFF;
        return (r * 299 + g * 587 + b * 114) / 1000;
    }

    /**
     * 跑马灯时序断言。直接验 {@link MarqueeText#progress(long, long)} 这段纯函数，
     * 不用真等 8.5 秒，也不受跑测时那一刻墙上时间的影响。
     */
    private static void checkMarqueeTiming() {
        // 8500ms 一轮：0..3400(40%) 静止，3400..8500 走完
        // 注意 t=3400 时 p 恰好等于 0.4，走的是「不小于则推进」分支，结果为 0，
        // 所以推进区要从 3401 算起。
        boolean pause = MarqueeText.progress(0, 0) == 0
                && MarqueeText.progress(2000, 0) == 0
                && MarqueeText.progress(3400, 0) == 0;
        boolean ramp = MarqueeText.progress(3401, 0) > 0
                && MarqueeText.progress(6000, 0) > 0
                && MarqueeText.progress(6000, 0) < 1.0
                && MarqueeText.progress(8499, 0) < 1.0;
        boolean wrap = MarqueeText.progress(8500, 0) == 0;
        // phase=-1000 表示在周期里往前挪 1s，所以 t=300 时歌名还在静止段、
        // 歌手行却已经开跑——这正是原版给两行错开的效果。
        boolean phased = MarqueeText.progress(300, -1000) > 0
                && MarqueeText.progress(300, 0) == 0;
        check("跑马灯前 40% 静止（8500ms 周期）", pause, null);
        check("跑马灯 40%~100% 推进并在整轮处归零", ramp && wrap, null);
        check("phase 错开生效（歌手行早 1s 起跑）", phased, null);

        boolean ease = MarqueeText.easeInOutQuad(0) == 0
                && MarqueeText.easeInOutQuad(1) == 1
                && MarqueeText.easeInOutQuad(0.5) < 1
                && MarqueeText.easeInOutQuad(0.25) < MarqueeText.easeInOutQuad(0.75);
        check("easeInOutQuad 端点与单调性正确", ease, null);
    }

    /**
     * 离屏截图 + 「是不是纯色」校验。
     * <p>不用 {@code SwingFXUtils}：它属于 javafx.swing，本项目没引这个模块，
     * 直接用 PixelReader 搬到 BufferedImage，只多依赖 java.desktop。
     */
    private static void writeSnapshot(Node root, String pngPath) throws Exception {
        WritableImage snap = root.snapshot(null, null);
        int w = (int) snap.getWidth();
        int h = (int) snap.getHeight();
        BufferedImage img = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        javafx.scene.image.PixelReader reader = snap.getPixelReader();
        int[] row = new int[w];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                row[x] = reader.getArgb(x, y);
            }
            img.setRGB(0, y, w, 1, row, 0, w);
        }

        File f = new File(pngPath);
        f.getParentFile().mkdirs();
        ImageIO.write(img, "png", f);

        Set<Integer> colors = new HashSet<>();
        for (int y = 0; y < h; y += 7) {
            for (int x = 0; x < w; x += 7) {
                colors.add(img.getRGB(x, y));
            }
        }
        check("离屏截图有实际像素（非纯色）", colors.size() > 8, "distinct=" + colors.size());
        System.out.println("snapshot -> " + f.getAbsolutePath() + " (" + w + "x" + h + ")");
    }

    /**
     * 自己递归收集，不用 {@code lookupAll}。
     * <p>原因：{@code Parent.lookupAll(String)} 与 {@code Node.lookupAll(Predicate)}
     * 同名，javac 在这里会把 lambda 判给 String 那个重载，直接编译失败。
     */
    private static <T extends Node> List<T> collect(Node root, Class<T> type) {
        List<T> out = new ArrayList<>();
        walk(root, type, out);
        return out;
    }

    private static <T extends Node> void walk(Node node, Class<T> type, List<T> out) {
        if (type.isInstance(node)) {
            out.add(type.cast(node));
        }
        if (node instanceof Parent parent) {
            for (Node child : parent.getChildrenUnmodifiable()) {
                walk(child, type, out);
            }
        }
    }

    private static Label firstWithText(List<Label> labels, String text) {
        return labels.stream().filter(l -> text.equals(l.getText())).findFirst().orElse(null);
    }

    private static void checkNonZero(String name, Node n) {
        Bounds b = n.getBoundsInParent();
        check(name, b.getWidth() > 0 && b.getHeight() > 0, at(n));
    }

    private static String at(Node n) {
        Bounds b = n.getBoundsInParent();
        return String.format("x=%.0f y=%.0f w=%.0f h=%.0f",
                n.getLayoutX(), n.getLayoutY(), b.getWidth(), b.getHeight());
    }

    private static void check(String name, boolean ok, String detail) {
        System.out.printf("%-40s %s%s%n", name, ok ? "PASS" : "FAIL",
                detail == null || detail.isEmpty() ? "" : "  (" + detail + ")");
        if (!ok) {
            failures++;
        }
    }
}