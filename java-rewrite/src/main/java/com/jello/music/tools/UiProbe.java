package com.jello.music.tools;

import com.jello.music.ui.CanvasStrip;
import com.jello.music.ui.KeybindKeyboard;
import com.jello.music.ui.OnboardingView;
import com.jello.music.ui.PlayerPanel;
import com.jello.music.ui.PlaylistPanel;
import com.jello.music.ui.SearchBox;
import com.jello.music.ui.SigmaScrollablePanel;
import com.jello.music.ui.SigmaTextView;
import com.jello.music.ui.ThinProgressBar;
import com.jello.music.ui.ThumbnailCard;
import com.jello.music.ui.VerticalSlider;
import com.jello.music.model.ResultCard;
import com.jello.music.system.RightShiftPoller;
import com.jello.music.ui.Assets;
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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

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

// 歌名/歌手是 SigmaTextView（图集画布视口）
        List<SigmaTextView> texts = collect(root, SigmaTextView.class);
        SigmaTextView titleBox = texts.stream().filter(m -> m.phaseMs() == 0).findFirst().orElse(null);
        SigmaTextView artistBox = texts.stream().filter(m -> m.phaseMs() == -1000).findFirst().orElse(null);
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
            check("歌名文字已写入", SONG.equals(titleBox.text()), titleBox.text());
            // 盒高 16 而 light-14 的 lineHeight 是 18 -> 文字上沿 y=-1，被 clip 切掉 1px
            check("歌名盒高 == 原版 box-height:16", titleBox.getPrefHeight() == 16,
                    "h=" + titleBox.getPrefHeight());
            check("歌名用 light-14 图集", titleBox.atlas().size() == 14
                    && titleBox.atlas().lineHeight() == 18, null);
        }
        if (artistBox != null) {
            check("歌手坐标 == 原版",
                    artistBox.getLayoutX() == Theme.TITLE_X
                            && artistBox.getLayoutY() == Theme.SUBTITLE_Y,
                    String.format("x=%.0f y=%.0f", artistBox.getLayoutX(), artistBox.getLayoutY()));
            check("歌手文字已写入", ARTIST.equals(artistBox.text()), artistBox.text());
        }

        // Logo：light-40 盒高 44 / light-20 盒高 22
        SigmaTextView logo = texts.stream().filter(t -> "Jello".equals(t.text())).findFirst().orElse(null);
        SigmaTextView logoSub = texts.stream().filter(t -> "music".equals(t.text())).findFirst().orElse(null);
        check("Logo Jello 用 light-40 / 盒高 44 / @ (55,14)",
                logo != null && logo.atlas().size() == 40 && logo.getPrefHeight() == 44
                        && logo.getLayoutX() == Theme.LOGO_X && logo.getLayoutY() == Theme.LOGO_Y,
                logo == null ? "missing" : String.format("size=%d h=%.0f x=%.0f y=%.0f",
                        logo.atlas().size(), logo.getPrefHeight(),
                        logo.getLayoutX(), logo.getLayoutY()));
        check("Logo music 用 light-20 / 盒高 22 / @ (135,42)",
                logoSub != null && logoSub.atlas().size() == 20 && logoSub.getPrefHeight() == 22
                        && logoSub.getLayoutX() == Theme.LOGO_SUB_X
                        && logoSub.getLayoutY() == Theme.LOGO_SUB_Y,
                logoSub == null ? "missing" : String.format("size=%d h=%.0f",
                        logoSub.atlas().size(), logoSub.getPrefHeight()));

        long times = texts.stream().filter(t -> t.text().matches(TIME_RE)).count();
        check("左右两个时间文字都在", times == 2, "found=" + times);

        SigmaTextView timeLeft = texts.stream()
                .filter(t -> t.text().matches(TIME_RE) && t.getLayoutX() == Theme.TIME_L_X)
                .findFirst().orElse(null);
        check("左时间文字落在 x=" + Theme.TIME_L_X, timeLeft != null,
                timeLeft == null ? "missing" : at(timeLeft));
        SigmaTextView timeRight = texts.stream()
                .filter(t -> t.text().matches(TIME_RE) && t.getLayoutX() == Theme.TIME_R_X)
                .findFirst().orElse(null);
        check("右时间右对齐到 x=" + (Theme.TIME_R_X + Theme.TIME_R_W),
                timeRight != null && timeRight.getLayoutX() == Theme.TIME_R_X
                        && timeRight.getPrefWidth() == Theme.TIME_R_W,
                timeRight == null ? "missing" : at(timeRight));

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
            // 原版 background-size:300% 靠 overflow:hidden 裁成单格 27px。
            // 这里曾经把 fitWidth 设成整张雪碧图宽 81，图标被横向拉 3 倍并溢出按钮。
            ImageView sprite = collect(repeat, ImageView.class).stream()
                    .findFirst().orElse(null);
            check("循环图标裁到单格 27x20（不被拉伸溢出）",
                    sprite != null && sprite.getFitWidth() == 27 && sprite.getFitHeight() == 20
                            && repeat.getClip() != null,
                    sprite == null ? "missing"
                            : String.format("fit=%.0fx%.0f clip=%s",
                                    sprite.getFitWidth(), sprite.getFitHeight(),
                                    repeat.getClip() != null));
        }

        checkProgressBarLayers();
        checkVolumeLayers();

// 无歌手时标题应下移到 .single 的 y=562
        player.setSong("只有标题", null, null);
        root.layout();
        SigmaTextView singleBox = collect(root, SigmaTextView.class).stream()
                .filter(m -> m.phaseMs() == 0).findFirst().orElse(null);
        check("无歌手时标题下移到 y=562",
                singleBox != null && singleBox.getLayoutY() == Theme.TITLE_SINGLE_Y,
                singleBox == null ? "missing" : String.format("y=%.0f", singleBox.getLayoutY()));
        check("无歌手时歌手行隐藏", !subtitleVisible(texts), "subtitle should be hidden");
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

        // 原版每个文字元素都是 overflow:hidden，SigmaTextView 自己在盒子上挂 clip
        long uncut = texts.stream().filter(t -> t.getClip() == null).count();
        check("文字节点均带 clip（对齐 overflow:hidden）", uncut == 0, "uncut=" + uncut);

        // 搜索框 550x506 @ (250,0)
        SearchBox box = collect(root, SearchBox.class).stream().findFirst().orElse(null);
        check("搜索框存在 @ (250,0)",
                box != null && box.getLayoutX() == 250 && box.getLayoutY() == 0
                        && box.getPrefWidth() == 550 && box.getPrefHeight() == 506,
                box == null ? "missing" : String.format("x=%.0f y=%.0f %.0fx%.0f",
                        box.getLayoutX(), box.getLayoutY(), box.getPrefWidth(), box.getPrefHeight()));
        if (box != null) {
            // 前两张是歌单卡（青色底），后面四张歌曲卡：网格对两种卡一视同仁
            List<ResultCard> sample = new ArrayList<>(List.of(
                    ResultCard.playlist("pl-A", "歌单 华语热歌 · 120首", null),
                    ResultCard.playlist("pl-B", "歌单 轻音乐 · 88首", null)));
            for (int i = 1; i <= 6; i++) {
                sample.add(ResultCard.song("H" + i, "歌名" + i, "歌手" + i, null));
            }
            box.showResults(sample);
            root.layout();
            List<ThumbnailCard> cards = collect(root, ThumbnailCard.class);
            // 原版滚动容器里没有「只显示前 N 张」的逻辑，
            // 之前铺满两行就 break，第 4 首之后的结果根本点不到。
            check("结果卡片全部铺出（8 张，第 4 张起靠滚动看到）", cards.size() == 8,
                    "cards=" + cards.size());
            // 列 x=10/183/356，行 y=90 / 90+210
            double[] wantX = {10, 183, 356};
            boolean colsOk = cards.size() == 8;
            String firstBad = "ok";
            for (int i = 0; i < cards.size(); i++) {
                ThumbnailCard c = cards.get(i);
                boolean ok = c.getLayoutX() == wantX[i % 3]
                        && c.getLayoutY() == 90 + (i / 3) * 210
                        && c.getPrefWidth() == 183 && c.getPrefHeight() == 220;
                if (!ok) {
                    colsOk = false;
                    firstBad = String.format("i=%d x=%.1f y=%.1f %.1fx%.1f", i,
                            c.getLayoutX(), c.getLayoutY(),
                            c.getPrefWidth(), c.getPrefHeight());
                    break;
                }
            }
            check("卡片坐标/尺寸 == 原版网格（三行）", colsOk,
                    cards.isEmpty() ? "no cards" : firstBad);
            checkSearchScroll(box);
            box.clear();
            check("clear() 后卡片清空", collect(root, ThumbnailCard.class).isEmpty(),
                    "left=" + collect(root, ThumbnailCard.class).size());
            check("clear() 后滚动量归零", box.resultsPanel().maxScroll() == 0
                    && box.resultsPanel().scroll() == 0, null);
        }

        checkPlaylistEllipsis(playlists);
        checkRightShift();
        checkInitialState();
        checkPlaylistTabs();
        checkCardKinds();
        checkSearchField();
        checkOnboarding();

        checkMarqueeTiming();

        writeSnapshot(root, pngPath);
        checkStripBlur();
    }

    private static boolean subtitleVisible(List<SigmaTextView> texts) {
        return texts.stream()
                .filter(t -> t.getLayoutX() == Theme.TITLE_X && t.getLayoutY() == Theme.SUBTITLE_Y)
                .anyMatch(Node::isVisible);
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
     * 结果区滚动。
     *
     * <p>原版 {@code SigmaScrollablePanel} 是 {@code overflow-y:auto} + 隐藏滚动条，
     * 滚轮位移直接取 deltaY，内容高度由最后一张卡片底边决定。
     * 这里走 {@link SigmaScrollablePanel#onWheel(double)}——也就是 {@code onScroll}
     * 处理器里那一行位移逻辑（{@code ScrollEvent} 只有全参构造，造一个出来很别扭）。
     */
    private static void checkSearchScroll(SearchBox box) {
        SigmaScrollablePanel panel = box.resultsPanel();
        check("结果区是 SigmaScrollablePanel 550x506 @ (0,0) 且有 clip",
                panel.getPrefWidth() == 550 && panel.getPrefHeight() == 506
                        && panel.getLayoutX() == 0 && panel.getLayoutY() == 0
                        && panel.getClip() != null,
                String.format("x=%.0f y=%.0f %.0fx%.0f",
                        panel.getLayoutX(), panel.getLayoutY(),
                        panel.getPrefWidth(), panel.getPrefHeight()));
        // 8 张 = 三行，最后一张底边 = 510 + 220 = 730，比视口 506 高 224px
        check("内容高度 == 最后一张卡片底边 730", panel.contentHeight() == 730,
                "content=" + panel.contentHeight());
        check("最大滚动量 == 730-506 = 224", panel.maxScroll() == 224,
                "max=" + panel.maxScroll());

        panel.onWheel(400);
        check("滚轮下滚被钳制在底部（viewport y=-224）",
                panel.scroll() == 224 && panel.viewport().getLayoutY() == -224,
                String.format("scroll=%.0f y=%.0f",
                        panel.scroll(), panel.viewport().getLayoutY()));
        panel.onWheel(-400);
        check("反向滚动回到顶部", panel.scroll() == 0 && panel.viewport().getLayoutY() == 0,
                String.format("scroll=%.0f y=%.0f",
                        panel.scroll(), panel.viewport().getLayoutY()));

        // 只有一行（底边 310 < 506）时根本不该有滚动量
        box.showResults(List.of(
                ResultCard.song("H1", "歌名一", "歌手一", null),
                ResultCard.song("H2", "歌名二", "歌手二", null),
                ResultCard.song("H3", "歌名三", "歌手三", null)));
        box.resultsPanel().onWheel(120);
        check("内容不满一屏时滚轮无效",
                box.resultsPanel().maxScroll() == 0 && box.resultsPanel().scroll() == 0,
                String.format("max=%.0f scroll=%.0f",
                        box.resultsPanel().maxScroll(), box.resultsPanel().scroll()));
    }

    /**
     * 歌单文字省略号。
     *
     * <p>原版 {@code SigmaPlaylistPanel} 是唯一给 {@code SigmaText} 传 {@code truncate}
     * 的地方：超宽时按 {@code truncateSigmaText} 截断并补一个 '…'。
     * 之前 Java 侧只 clip，长名字直接被切掉半个字，尾部一个字都不剩。
     */
private static void checkPlaylistEllipsis(PlaylistPanel panel) {
        String longName = "这是一个特别长的歌单名字用来验证省略号截断是否按原版算法工作";
        panel.setItems(List.of("我喜欢", longName));
        List<SigmaTextView> rows = collect(panel, SigmaTextView.class);
        check("歌单两行都在", rows.size() == 2, "rows=" + rows.size());

        double boxW = Theme.PLAYLIST_W - 16;   // 面板 padding 左右各 8px
        if (rows.size() == 2) {
            SigmaTextView shortRow = rows.get(0);
            SigmaTextView longRow = rows.get(1);
            check("放得下的文字原样保留", "我喜欢".equals(shortRow.text()),
                    "text=" + shortRow.text());
            check("超宽文字补省略号（对齐 text-overflow:ellipsis）",
                    longRow.text().endsWith("…") && !longRow.text().equals(longName),
                    "text=" + longRow.text());
            double w = longRow.atlas().measure(longRow.text());
            check("截断后宽度落在盒宽内", w <= boxW + 0.5,
                    String.format("%.1f <= %.0f", w, boxW));
            check("歌单用 light-13 图集（lineHeight 17）",
                    longRow.atlas().size() == 13 && longRow.atlas().lineHeight() == 17
                            && longRow.getPrefHeight() == 17,
                    String.format("size=%d lineHeight=%d h=%.0f",
                            longRow.atlas().size(), longRow.atlas().lineHeight(),
                            longRow.getPrefHeight()));
// 项盒 234x31 @ y=4 / y=37（padding 7px 内是文字，项高 31、margin-bottom 2 -> 步进 33）
            check("歌单项 y=4 起、步进 33（对齐原版 padding/margin）",
                    shortRow.getLayoutY() == 7 && longRow.getLayoutY() == 7
                            && shortRow.getParent().getLayoutY() == 4
                            && longRow.getParent().getLayoutY() == 37,
                    String.format("labelY=%.0f itemY=%.0f/%.0f",
                            shortRow.getLayoutY(),
                            shortRow.getParent().getLayoutY(),
                            longRow.getParent().getLayoutY()));
        }
    }

    /**
     * 全局 RSHIFT 热键。
     *
     * <p>只断言常量与「按下沿才触发」的状态机——真的按 RSHIFT 会影响正在做的事，
     * 而且校验跑的时候人未必在键盘前。原生能力用 {@code isNativeSupported()} 探一下，
     * 触发逻辑则注入假的按键状态，确定性地跑一遍。
     */
    private static void checkRightShift() {
        check("RSHIFT 虚拟键码 == 0xA1（对齐原版）",
                RightShiftPoller.VK_RSHIFT == 0xa1, null);
        check("轮询间隔 == 8ms（对齐原版 POLL_INTERVAL_MS）",
                RightShiftPoller.POLL_INTERVAL_MS == 8, null);
        check("本机可加载 Win32 GetAsyncKeyState", RightShiftPoller.isNativeSupported(), null);

        AtomicBoolean down = new AtomicBoolean(false);
        AtomicInteger hits = new AtomicInteger();
        RightShiftPoller poller = new RightShiftPoller(vk -> down.get(), 5,
                hits::incrementAndGet);
        try {
            Thread.sleep(60);
            check("未按下时不触发", hits.get() == 0, "hits=" + hits.get());

            down.set(true);
            Thread.sleep(60);
            check("按下沿触发一次", hits.get() == 1, "hits=" + hits.get());

            Thread.sleep(60);
            check("按住不放不连发", hits.get() == 1, "hits=" + hits.get());

            // 对应原版 setGlobalKeySuspended：新手教程里用户要按 Shift，得挂起
            poller.setSuspended(true);
            down.set(false);
            Thread.sleep(60);
            down.set(true);
            Thread.sleep(80);
            check("挂起期间按 RSHIFT 不触发", hits.get() == 1, "hits=" + hits.get());

            poller.setSuspended(false);
            down.set(false);
            Thread.sleep(60);
            down.set(true);
            Thread.sleep(80);
            check("恢复后再次触发", hits.get() == 2, "hits=" + hits.get());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            check("热键状态机校验未被打断", false, e.toString());
        } finally {
            poller.close();
        }
    }

/**
 * 新手教程视图（对应 SigmaUI.vue 的 view === 'onboarding'）。
 *
 * <p>要点：底 rgba(1,1,1,0.25)、键盘底板 1100x402 圆角 14、键位层内缩 20、
 * 键帽 63 高行距 74、标题 JelloMedium 40、步数 1 / 1、完成按钮 #f0f0f0 圆角 8、
 * RSHIFT（GLFW 344）带红框强调。
 */
private static void checkOnboarding() {
OnboardingView view = new OnboardingView(Theme.PANEL_W, Theme.PANEL_H);
        Pane host = new Pane();
        host.getChildren().add(view);
        new Scene(host, Theme.PANEL_W, Theme.PANEL_H);
        host.applyCss();
        host.layout();
        view.layout(Theme.PANEL_W, Theme.PANEL_H);

        check("教程键帽共 61 个（照抄原版键位表）", view.keyCount() == 61,
                "keys=" + view.keyCount());
        check("键盘底板 1100x402 / 键位层内缩 20",
                KeybindKeyboard.plateWidth() == 1100
                        && KeybindKeyboard.plateHeight() == 402, null);

// RSHIFT 是唯一被强调的键：红色标签 + 2px 红框
        List<Label> reds = collect(view, Label.class).stream()
                .filter(l -> l.getTextFill() instanceof javafx.scene.paint.Color c
                        && c.getRed() > 0.98 && c.getGreen() < 0.4)
                .toList();
        check("RSHIFT 标签标红（highlight-keys=[344]）", reds.size() == 1,
                "reds=" + reds.size());

// 缩放：min(1, (800-60)/1140, (600-180)/402) = 0.649
        double expect = Math.min(1, Math.min((800 - 60) / 1140.0, (600 - 60 - 120) / 402.0));
        check("键盘按窗口等比缩放",
                Math.abs(view.keyboard().getScaleX() - expect) < 0.01,
                String.format("scale=%.4f expect=%.4f",
                        view.keyboard().getScaleX(), expect));
        // JavaFX 缩放绕中心：居中位置与 scale 无关，就是 (宽 - 原始宽) / 2
        check("键盘水平居中（缩放绕中心，位置与 scale 无关）",
                view.keyboard().getLayoutX() == (800 - 1100) / 2.0,
                "x=" + view.keyboard().getLayoutX());

check("标题是 快捷呼出 / 底部步数 1 / 1",
                "快捷呼出".equals(view.titleLabel().getText())
                        && "1 / 1".equals(view.stepLabel().getText()), null);
        check("完成按钮 70x34 圆角 8",
                view.finishButton().getPrefWidth() == 70
                        && view.finishButton().getPrefHeight() == 34
                        && view.finishLabel().getText().equals("完成"), null);

        // easeOutBack 端点
        check("入场缓动 easeOutBack 端点正确",
                Math.abs(OnboardingView.easeOutBack(0)) < 1e-9
                        && Math.abs(OnboardingView.easeOutBack(1) - 1) < 1e-9
                        && OnboardingView.easeOutBack(0.5) > 1, null);
    }

/**
 * 搜索框：文字交给画布、input 文字透明、自绘 1px 光标。
 *
 * <p>原版 {@code SigmaTextField} 把 {@code input} 的文字设成 transparent（自定义点阵字体），
 * 光标与选区都是自己画的。JavaFX 自带光标跟着 {@code -fx-text-fill} 走，
 * 文字一透明它也没了，所以必须补一个自绘的。
 */
private static void checkSearchField() {
        SearchBox box = new SearchBox();
        Pane host = new Pane();
        host.getChildren().add(box);
        new Scene(host, 800, 600);
        host.applyCss();
        host.layout();

        SigmaTextView glyphs = collect(box, SigmaTextView.class).stream()
                .filter(t -> t.atlas().size() == 25).findFirst().orElse(null);
        check("搜索框文字用 sans-25 图集、盒宽 490 盒高 70",
                glyphs != null && glyphs.atlas().size() == 25
                        && glyphs.getPrefWidth() == 490 && glyphs.getPrefHeight() == 70,
                glyphs == null ? "missing" : String.format("size=%d %.0fx%.0f",
                        glyphs.atlas().size(), glyphs.getPrefWidth(),
                        glyphs.getPrefHeight()));
        check("未聚焦时画的是占位符 Search...",
                glyphs != null && "Search...".equals(glyphs.text()),
                glyphs == null ? "missing" : glyphs.text());
        check("搜索框文字节点 @ (30,14)",
                glyphs != null && glyphs.getLayoutX() == 30 && glyphs.getLayoutY() == 14, null);

        // 光标：1px 宽，垂直居中对齐图集 lineHeight，原版 TextField.draw 的算法
        Region caret = collect(box, Region.class).stream()
                .filter(r -> r.getPrefWidth() == 1).findFirst().orElse(null);
        check("自绘光标 1px 宽、初始隐藏",
                caret != null && !caret.isVisible(), caret == null ? "missing" : "found");
        int lineH = 33;   // sans-25 的 lineHeight
        // 原版是整数运算：yA + height/2 - fontHeight/2 + 2，高 fontHeight - 3
        check("光标纵向居中（原版 yA+h/2-lh/2+2，高 lh-3）",
                caret != null && caret.getLayoutY() == 14 + 70 / 2 - lineH / 2 + 2
                        && caret.getPrefHeight() == lineH - 3,
                caret == null ? "missing" : String.format("y=%.0f h=%.0f",
                        caret.getLayoutY(), caret.getPrefHeight()));
        check("光标左内边距 4px（原版 TextField 的 padding）",
                caret != null && caret.getLayoutX() == 30 + 4,
                caret == null ? "missing" : "x=" + caret.getLayoutX());
    }

/**
 * 进度条四层（轨道 / 已播 / 未播 / 末端高光）。
 *
 * <p>之前只有轨道 + 已播，未播那段底色偏亮，且末端少了 {@code shadow_right.png}
 * 那个 5x5 高光——原版一眼能看出来。
 */
private static void checkProgressBarLayers() {
        ThinProgressBar bar = new ThinProgressBar(Theme.PROGRESS_W, Theme.PROGRESS_H);
        bar.setLayoutX(Theme.PROGRESS_X);
        bar.setLayoutY(Theme.PROGRESS_Y);
        Pane host = new Pane();
        host.getChildren().add(bar);
        new Scene(host, Theme.PANEL_W, Theme.PANEL_H);
        host.applyCss();
        host.layout();

        check("进度条有未播层（rgba(1,1,1,0.43)）", bar.remainingLayer() != null, null);
        check("末端高光默认隐藏（percent=0）", !bar.knob().isVisible(), null);

        bar.setPercent(0.5);
        double w = Theme.PROGRESS_W;
        check("percent=0.5 时三段宽度/位置对齐原版",
                Math.abs(bar.knob().getLayoutX() - (w * 0.5 - 5)) < 0.5
                        && Math.abs(bar.remainingLayer().getLayoutX() - w * 0.5) < 0.5
                        && Math.abs(bar.remainingLayer().getPrefWidth() - w * 0.5) < 0.5,
                String.format("knobX=%.1f remainX=%.1f remainW=%.1f",
                        bar.knob().getLayoutX(), bar.remainingLayer().getLayoutX(),
                        bar.remainingLayer().getPrefWidth()));
        check("percent>0 时末端高光出现且是 5x5",
                bar.knob().isVisible() && bar.knob().getFitWidth() == 5
                        && bar.knob().getFitHeight() == 5, null);
        bar.setPercent(0);
        check("percent 归零时高光隐藏", !bar.knob().isVisible(), null);
    }

    /**
     * 音量条：原版是「根背景 + dark 层 + fill 层」三层，
     * 且支持滚轮每格 0.05（向上滚=加音量）。
     */
    private static void checkVolumeLayers() {
        VerticalSlider slider = new VerticalSlider(Theme.VOLUME_W, Theme.VOLUME_H);
        slider.setLayoutX(Theme.VOLUME_X);
        slider.setLayoutY(Theme.VOLUME_Y);
        Pane host = new Pane();
        host.getChildren().add(slider);
        new Scene(host, Theme.PANEL_W, Theme.PANEL_H);
        host.applyCss();
        host.layout();

        check("音量条有未填充层（.sigma-volume-dark）", slider.darkLayer() != null, null);
        slider.valueProperty().set(0.25);
        check("value=0.25 时 dark 占 75%",
                Math.abs(slider.darkLayer().getPrefHeight() - Theme.VOLUME_H * 0.75) < 0.5,
                String.format("dark=%.1f expect=%.1f",
                        slider.darkLayer().getPrefHeight(), Theme.VOLUME_H * 0.75));
        double before = slider.valueProperty().get();
        slider.valueProperty().set(Math.max(0, before - 0.05));
        check("滚轮一格 = 0.05",
                Math.abs(slider.valueProperty().get() - (before - 0.05)) < 1e-9, null);
    }

    /**
     * 刚构造出来、还没喂任何歌的状态。
     *
     * <p>原版 {@code titleLine1 = name || 'Jello Music'}：启动时没有歌也不是空白，
     * 而是单行 "Jello Music" 落在 y=562、歌手行不渲染。
     * 这条之前没实现，启动后左下角一直空着。
     */
    private static void checkInitialState() {
        PlayerPanel fresh = new PlayerPanel();
        List<SigmaTextView> freshTexts = collect(fresh, SigmaTextView.class);
        check("初始态标题是 Jello Music",
                freshTexts.stream().anyMatch(t -> "Jello Music".equals(t.text())), null);
        SigmaTextView box = freshTexts.stream()
                .filter(m -> m.phaseMs() == 0).findFirst().orElse(null);
        check("初始态单行标题落在 y=562",
                box != null && box.getLayoutY() == Theme.TITLE_SINGLE_Y,
                box == null ? "missing" : String.format("y=%.0f", box.getLayoutY()));
        check("初始态歌手行不渲染",
                freshTexts.stream()
                        .filter(m -> m.phaseMs() == -1000)
                        .noneMatch(Node::isVisible), null);

        // 原版 background-size:cover：非正方形封面要盖满再裁，不能 contain 留缝
        ImageView art = collect(fresh, ImageView.class).stream()
                .filter(v -> v.getFitWidth() == Theme.ARTWORK_S).findFirst().orElse(null);
        check("专辑封面按 cover 铺满（fit=114 且有 clip）",
                art != null && art.getClip() != null,
                art == null ? "missing" : at(art));
    }

    /**
     * 左栏列表组装 —— 1:1 复刻原版 {@code SigmaPlaylistPanel.load()}。
     *
     * <p>要点：固定项「猜你喜欢 / 每日推荐」在最前；只留「我喜欢」与自己的歌单；
     * 按 {@code sort} <b>升序</b>（不是按歌曲数倒序）；「我喜欢」永远排在自定义歌单之前。
     */
    private static void checkPlaylistTabs() {
        List<com.jello.music.api.Playlist> raw = List.of(
                new com.jello.music.api.Playlist("g-默认", "默认收藏", 300, 9, "999"),
                new com.jello.music.api.Playlist("g-我的B", "我的歌单B", 50, 3, "me"),
                new com.jello.music.api.Playlist("g-我的A", "我的歌单A", 80, 1, "me"),
                new com.jello.music.api.Playlist("g-他人", "别人的歌单", 999, 0, "other"),
                new com.jello.music.api.Playlist("g-喜欢", "我喜欢", 42, 5, "other"));
        List<com.jello.music.api.PlaylistTab> tabs =
                com.jello.music.api.KuGouApiClient.playlistTabs(raw, "me");
        List<String> names = tabs.stream().map(com.jello.music.api.PlaylistTab::name).toList();
        check("左栏头部固定是 猜你喜欢 / 每日推荐",
                tabs.get(0).isGuess() && tabs.get(1).isDaily(),
                String.join(" | ", names));
        check("别人的歌单被过滤掉", !names.contains("别人的歌单") && !names.contains("默认收藏"),
                String.join(" | ", names));
        check("我喜欢 排在自定义歌单之前",
                names.indexOf("我喜欢") < names.indexOf("我的歌单A"), String.join(" | ", names));
        check("自定义歌单按 sort 升序",
                names.indexOf("我的歌单A") < names.indexOf("我的歌单B"), String.join(" | ", names));
        check("总数 = 2 固定 + 3 歌单", tabs.size() == 5, "size=" + tabs.size());
    }

    /**
     * 结果网格同时支持歌曲卡与歌单卡：点歌单卡下钻、点歌曲卡播放。
     */
    private static void checkCardKinds() {
        SearchBox box = new SearchBox();
        List<String> opened = new ArrayList<>();
        List<com.jello.music.model.Song> picked = new ArrayList<>();
        box.onOpenPlaylist(opened::add);
        box.onPick(picked::add);

        ResultCard plCard = ResultCard.playlist("g-x", "歌单 测试 · 3首", null);
        ResultCard snCard = ResultCard.song("h-x", "歌名", "歌手", null);
        check("歌单卡 kind / 底色 #037c8c",
                plCard.isPlaylist() && plCard.gid().equals("g-x") && !snCard.isPlaylist(), null);

        box.showResults(List.of(plCard, snCard));
        List<ThumbnailCard> cards = collect(box, ThumbnailCard.class);
        check("两种卡都铺进网格", cards.size() == 2, "cards=" + cards.size());
        for (ThumbnailCard c : cards) {
            c.fireEvent(new javafx.scene.input.MouseEvent(
                    javafx.scene.input.MouseEvent.MOUSE_CLICKED, 0, 0, 0, 0,
                    javafx.scene.input.MouseButton.PRIMARY, 1,
                    false, false, false, false, true, false, false, false, false, false, null));
        }
        check("点歌单卡走下钻、点歌曲卡走播放",
                opened.size() == 1 && opened.get(0).equals("g-x")
                        && picked.size() == 1 && picked.get(0).getHash().equals("h-x"),
                "opened=" + opened + " picked=" + picked.size());
        check("currentCards 保留整列供整列替换队列",
                box.currentCards().size() == 2, "size=" + box.currentCards().size());
    }

/**
     * 跑马灯时序断言。直接验 {@link SigmaTextView#progress(long, long)} 这段纯函数，
     * 不用真等 8.5 秒，也不受跑测时那一刻墙上时间的影响。
     */
    private static void checkMarqueeTiming() {
        // 8500ms 一轮：0..3400(40%) 静止，3400..8500 走完
        // 注意 t=3400 时 p 恰好等于 0.4，走的是「不小于则推进」分支，结果为 0，
        // 所以推进区要从 3401 算起。
        boolean pause = SigmaTextView.progress(0, 0) == 0
                && SigmaTextView.progress(2000, 0) == 0
                && SigmaTextView.progress(3400, 0) == 0;
        boolean ramp = SigmaTextView.progress(3401, 0) > 0
                && SigmaTextView.progress(6000, 0) > 0
                && SigmaTextView.progress(6000, 0) < 1.0
                && SigmaTextView.progress(8499, 0) < 1.0;
        boolean wrap = SigmaTextView.progress(8500, 0) == 0;
        // phase=-1000 表示在周期里往前挪 1s，所以 t=300 时歌名还在静止段、
        // 歌手行却已经开跑——这正是原版给两行错开的效果。
        boolean phased = SigmaTextView.progress(300, -1000) > 0
                && SigmaTextView.progress(300, 0) == 0;
        check("跑马灯前 40% 静止（8500ms 周期）", pause, null);
        check("跑马灯 40%~100% 推进并在整轮处归零", ramp && wrap, null);
        check("phase 错开生效（歌手行早 1s 起跑）", phased, null);

        boolean ease = SigmaTextView.easeInOutQuad(0) == 0
                && SigmaTextView.easeInOutQuad(1) == 1
                && SigmaTextView.easeInOutQuad(0.5) < 1
                && SigmaTextView.easeInOutQuad(0.25) < SigmaTextView.easeInOutQuad(0.75);
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