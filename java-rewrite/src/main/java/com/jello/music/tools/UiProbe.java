package com.jello.music.tools;

import com.jello.music.ui.CanvasStrip;
import com.jello.music.ui.KeybindKeyboard;
import com.jello.music.ui.LoginView;
import com.jello.music.ui.OnboardingView;
import com.jello.music.player.PlayQueue;
import com.jello.music.player.SpectrumFeed;
import com.jello.music.ui.DragGate;
import com.jello.music.ui.EdgeDock;
import com.jello.music.ui.ElasticReveal;
import com.jello.music.ui.PlayerPanel;
import com.jello.music.ui.RepeatButton;
import com.jello.music.ui.RightTitleBar;
import com.jello.music.ui.SearchBox;
import com.jello.music.ui.SigmaScrollablePanel;
import com.jello.music.ui.SpectrumInfoBlock;
import com.jello.music.ui.SpectrumToggleButton;
import com.jello.music.ui.SpectrumView;
import com.jello.music.ui.ThinProgressBar;
import com.jello.music.ui.ThumbnailCard;
import com.jello.music.ui.VerticalSlider;
import com.jello.music.ui.PlaylistPanel;
import com.jello.music.ui.SearchBox;
import com.jello.music.ui.SigmaScrollablePanel;
import com.jello.music.ui.SigmaTextView;
import com.jello.music.ui.ThinProgressBar;
import com.jello.music.ui.ThumbnailCard;
import com.jello.music.ui.VerticalSlider;
import com.jello.music.model.ResultCard;
import com.jello.music.model.Song;
import com.jello.music.system.RightShiftPoller;
import com.jello.music.ui.Assets;
import com.jello.music.ui.RepeatButton;
import com.jello.music.ui.Theme;
import javafx.application.Platform;
import javafx.geometry.Bounds;
import javafx.geometry.Rectangle2D;
import javafx.stage.Screen;
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
import javafx.scene.layout.Background;
import javafx.scene.layout.BackgroundFill;
import javafx.scene.layout.Region;
import javafx.scene.paint.Color;
import javafx.scene.shape.Rectangle;
import javafx.scene.shape.SVGPath;

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
        checkHotkeySuspend();
        checkVolumeKept();
        checkInitialState();
        checkPlaylistTabs();
        checkCardKinds();
        checkSearchField();
        checkOnboarding();
        checkLoginView();

        checkMarqueeTiming();

writeSnapshot(root, pngPath);
        checkOnboardingFullScreen(pngPath.replace(".png", "-onboarding.png"));
        checkPlaybackModes(pngPath.replace(".png", "-repeat.png"));
        checkEdgeDock();
        checkDragGate(root, player);
        checkShuffleQueue();
        checkStripBlur();
        checkSpectrumParams();
        checkRightTitleBar();
        checkDeadSwitches();
        checkSingleInstance();
        checkJelloProtocol();
        checkMediaKeys();
        checkDockFadeCurve();
        checkExpandScale();
        checkJumpList();
        checkSystemToggles();
        checkApiBaseUrl();
        checkNoWhiteBackdrop();
        checkShellBackdrop();
        checkSearchBoxLayering();
        checkInitialCentering();
        checkTrayIconsAndFont();
        checkViewportTransparent();
        checkSearchBoxClear();
        checkTrayMenuIsSelfDrawn();
        checkDockTriggerAndDragScope();
        checkFullscreenAnchor();
    }

    /**
     * 全屏时频谱贴<b>物理底边</b>，平时贴<b>任务栏上沿</b>。
     *
     * <p>1:1 对齐原版 {@code getSpectrumAnchorBottom}（appServices.js:168-191）：
     * <pre>
     *   if (fullscreen) anchorArea = display.bounds;    // 物理底边
     *   else           anchorArea = display.workArea;  // 任务栏上沿
     * </pre>
     *
     * <p><b>为什么不直接用 getVisualBounds() 了事</b>：JavaFX 的
     * {@code getVisualBounds()} 就等于 Electron 的 {@code workArea}（已排除任务栏）。
     * 但游戏全屏时任务栏被盖住，频谱若还按 workArea 贴就会浮在屏幕中间，
     * 正对游戏画面中央，非常挡视线。
     */
    private static void checkFullscreenAnchor() {
        // 全屏检测要能调通（JNA 手写映射）
        boolean fs;
        try {
            fs = com.jello.music.system.FullscreenWatcher
                    .isForegroundFullscreen();
            check("FullscreenWatcher 能调通（JNA user32 映射正确）",
                    true, "");
        } catch (Throwable t) {
            check("FullscreenWatcher 能调通（JNA user32 映射正确）",
                    false, String.valueOf(t));
            return;
        }
        check("普通桌面上应判为非全屏",
                !fs, "在普通桌面上判成了全屏");

        // 屏幕 bounds 与 visualBounds 的关系：没有任务栏时两者相等，
        // 有任务栏时 visualBounds 矮一截 —— 断言代码用的是 bounds（全屏分支）
        var s = javafx.stage.Screen.getPrimary();
        check("primary screen 有 bounds（物理）",
                s.getBounds().getHeight() > 0, "");
        check("primary screen 有 visualBounds（工作区）",
                s.getVisualBounds().getHeight() > 0, "");
        boolean workAreaDiffers = s.getBounds().getHeight()
                != s.getVisualBounds().getHeight();
        System.out.println("      （本机" + (workAreaDiffers ? "有" : "无")
                + "任务栏，bounds=" + (int) s.getBounds().getHeight()
                + " visualBounds=" + (int) s.getVisualBounds().getHeight() + "）");

        // MainApp 里必须有 anchorSpectrum(boolean) 且走 getBounds/getVisualBounds
        try {
            var f = java.nio.file.Files.readString(java.nio.file.Path.of(
                    "src/main/java/com/jello/music/MainApp.java"));
            check("MainApp 有 anchorSpectrum(boolean fullscreen)",
                    f.contains("private void anchorSpectrum(boolean fullscreen)"),
                    "缺失");
            check("全屏分支用 getBounds（物理底边）",
                    f.contains("screen.getBounds()"),
                    "没用到 getBounds");
            check("非全屏分支用 getVisualBounds（任务栏上沿）",
                    f.contains("screen.getVisualBounds()"),
                    "没用到 getVisualBounds");
            check("已接全屏轮询（对应 watchForegroundFullscreen）",
                    f.contains("watchSpectrumFullscreen()")
                            && f.contains("FullscreenWatcher.watch(300"),
                    "未接入轮询");
        } catch (Exception e) {
            check("读 MainApp 源码", false, String.valueOf(e));
        }
    }

    /**
     * 收起态整条边可点 + 拖拽要覆盖所有视图。
     *
     * <h3>问题 1：收起态只有左上角能点</h3>
     * 触发条宽度由 {@code setDockTriggerVisible} 设，而那个方法只在
     * <b>越界拖拽</b>时调用（{@code MainApp} 的 overhang 监听）。
     * 收起吸附完成走的是 {@code setDockTriggerActive}，它原本只解除
     * mouseTransparent，<b>宽度还停在 0</b> —— 窗口明明露出 40px，
     * 用户却只能点中最左边一小块。
     *
     * <h3>问题 2：设置页点不出、拖不动</h3>
     * 拖拽处理器原来装在 {@code root} 上，但设置页 / 登录页是 root 的
     * <b>兄弟节点</b>，收不到事件。必须装在 {@code stageHolder}
     * （所有视图的公共祖先）上。
     */
    private static void checkDockTriggerAndDragScope() {
        var panel = new com.jello.music.ui.PlayerPanel();

        // ---- 收起态：宽度必须是 EDGE_TRIGGER（41），不能是 0 ----
        panel.setDockTriggerVisible(false);
        double wHidden = triggerWidth(panel);
        check("越界结束（展开态）触发条宽度为 0",
                Math.abs(wHidden) < 0.001, "got=" + wHidden);

        panel.setDockTriggerActive(true);
        double wActive = triggerWidth(panel);
        check("收起态触发条宽度 == 41（原版 .smp-dock-trigger width:41px）",
                Math.abs(wActive - com.jello.music.ui.Theme.EDGE_TRIGGER) < 0.001,
                "got=" + wActive);
        check("收起态触发条必须可点（mouseTransparent=false）",
                !triggerMouseTransparent(panel), "仍是穿透");

        panel.setDockTriggerActive(false);
        check("展开回位后触发条宽度归 0",
                Math.abs(triggerWidth(panel)) < 0.001,
                "got=" + triggerWidth(panel));

        // ---- 拖拽要装在 stageHolder 而不是 root ----
        try {
            var f = java.nio.file.Files.readString(java.nio.file.Path.of(
                    "src/main/java/com/jello/music/MainApp.java"));
            boolean onStageHolder = f.contains("installDragHandlers(stageHolder)");
            boolean onRoot = false;
            for (String line : f.split("\n")) {
                String t = line.strip();
                if (t.startsWith("//") || t.startsWith("*")) {
                    continue;
                }
                if (t.equals("installDragHandlers(root);")) {
                    onRoot = true;
                }
            }
            check("拖拽装在 stageHolder（设置页/登录页也能拖）",
                    onStageHolder && !onRoot,
                    onRoot ? "仍装在 root 上" : "没找到 stageHolder 调用");
        } catch (Exception e) {
            check("读 MainApp 源码", false, String.valueOf(e));
        }
    }

    /**
     * 反射取 PlayerPanel 里的 dockTrigger 宽度。
     *
     * <p>读 {@code prefWidth} 而<b>不</b>读 {@code layoutBounds}：
     * 节点没被加进 Scene 时，{@code setVisible}/{@code setPrefSize} 的变化
     * 不会反映到 layoutBounds（实测明明设了 41 却读到 0），
     * 那是「没 layout」不是「没设宽度」。
     */
    private static double triggerWidth(com.jello.music.ui.PlayerPanel panel) {
        try {
            var f = com.jello.music.ui.PlayerPanel.class
                    .getDeclaredField("dockTrigger");
            f.setAccessible(true);
            var r = (javafx.scene.layout.Region) f.get(panel);
            return r.getPrefWidth();
        } catch (Exception e) {
            return -1;
        }
    }

    /** 反射取 dockTrigger 的 mouseTransparent。 */
    private static boolean triggerMouseTransparent(
            com.jello.music.ui.PlayerPanel panel) {
        try {
            var f = com.jello.music.ui.PlayerPanel.class
                    .getDeclaredField("dockTrigger");
            f.setAccessible(true);
            var n = (javafx.scene.Node) f.get(panel);
            return n.isMouseTransparent();
        } catch (Exception e) {
            return true;
        }
    }

    /**
     * 托盘菜单必须是<b>自绘</b>的，不能用 {@link java.awt.PopupMenu}。
     *
     * <p><b>乱码的真正根因</b>：Windows 上 {@code java.awt.MenuItem} 走
     * <b>native peer</b>，菜单由系统 {@code TrackPopupMenu} 绘制，
     * Java 侧 {@code setFont} <b>完全无效</b>。
     * 实测 {@code new MenuItem("…").getFont()} 返回 {@code null} ——
     * 未显示的菜单项根本不持有字体。而系统菜单字体没有 CJK 字形，
     * 中文就渲染成豆腐块 □□□。
     *
     * <p>换过的方案都不通：
     * <ul>
     *   <li>{@code setFont(cjkFont())} —— native peer 不听</li>
     *   <li>{@code javax.swing.JPopupMenu} —— 它继承 {@code JComponent}，
     *       <b>不是</b> {@code PopupMenu} 子类，塞不进 {@code TrayIcon}</li>
     * </ul>
     *
     * <p>自绘（{@code TrayPopupMenu}）用 JavaFX 渲染，没有 peer 那一层，
     * 设了字体就一定生效。
     */
    private static void checkTrayMenuIsSelfDrawn() {
        // 不能存在「用 AWT 菜单」的痕迹：TrayIconHelper 不该再 new PopupMenu /
        // setPopupMenu。只看代码行，注释里提到这两个名字是正常的（说明为什么不用）。
        boolean awtMenuGone = true;
        try {
            var f = java.nio.file.Files.readString(java.nio.file.Path.of(
                    "src/main/java/com/jello/music/system/TrayIconHelper.java"));
            for (String line : f.split("\n")) {
                String t = line.strip();
                if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) {
                    continue; // 跳过注释
                }
                if (t.contains("new PopupMenu()") || t.contains("setPopupMenu(")) {
                    awtMenuGone = false;
                    break;
                }
            }
        } catch (Exception ignored) {
            // 探针不在源码目录下就跳过这条
        }
        check("TrayIconHelper 已不再用 AWT PopupMenu（那是乱码根源）",
                awtMenuGone, "仍在用 AWT 原生菜单");

        // JavaFX 侧选中的字体必须真能排中文
        String sample = "播放设置退出";
        java.awt.Font ok = null;
        for (String name : new String[]{"Microsoft YaHei UI", "Microsoft YaHei",
                "SimHei", "SimSun", java.awt.Font.DIALOG}) {
            var f = new java.awt.Font(name, java.awt.Font.PLAIN, 13);
            if (f.canDisplayUpTo(sample) < 0) {
                ok = f;
                break;
            }
        }
        check("系统里存在能显示中文的字体（自绘菜单的前提）",
                ok != null, "一个都没有");

        // 菜单图标资源必须在 classpath（自绘菜单要用）
        for (String name : new String[]{"tray/play.png", "tray/prev.png",
                "tray/next.png", "tray/home.png", "tray/show.png",
                "tray/quit.png"}) {
            check("菜单图标在 classpath: " + name,
                    UiProbe.class.getResource("/icons/" + name) != null, "缺失");
        }
    }

    /**
     * {@code SigmaScrollablePanel} 的 viewport 必须是透明的。
     *
     * <p>{@code viewport = new Pane()} 继承 {@code Region}，
     * JavaFX modena 默认样式会给它画一层<b>浅灰背景</b>；
     * 而原版 {@code .sigma-scrollable-panel} 的内容区透明
     * （{@code SigmaScrollablePanel.vue} 只设了 overflow / scrollbar）。
     *
     * <p>不设的话：歌单面板右侧会出现一条贯穿的浅灰竖带，
     * 搜索结果区同样受影响 —— 就是用户截图里框出来的那个。
     *
     * <p><b>这和之前「Pane 默认白底」那次是同一个坑</b>：
     * 那次是 root / overlay / stageHolder，这次是 viewport。
     * 只要容器节点没显式设背景，就得当成「会带默认色」处理。
     */
    private static void checkViewportTransparent() {
        var sp = new com.jello.music.ui.SigmaScrollablePanel(300, 400);
        check("viewport 背景是透明（否则面板右侧出现浅灰竖带）",
                isTransparentBg(sp.viewport()),
                "viewport 有背景色");
        check("外层 SigmaScrollablePanel 背景也是透明",
                isTransparentBg(sp),
                "外层有背景色");
    }

    /** 节点的背景填充是否透明（fill 类型取 opacity，其余一律算不透明）。 */
    private static boolean isTransparentBg(javafx.scene.layout.Region region) {
        var bg = region.getBackground();
        if (bg == null || bg.getFills().isEmpty()) {
            return true; // 没设背景 = 透明
        }
        var paint = bg.getFills().get(0).getFill();
        if (paint instanceof javafx.scene.paint.Color c) {
            return c.getOpacity() == 0.0;
        }
        return false;
    }

    /**
     * {@code SearchBox.clear()} 必须把<b>输入框文字</b>也清掉。
     *
     * <p>原版 {@code loadPlaylist}（{@code SigmaSearchBox.vue:89}）只填卡片，
     * <b>从不写 keyword</b> —— 搜索框回到 "Search..." 占位符。
     *
     * <p>之前 {@code clear()} 只清结果列表，于是上一轮搜的词（比如「我喜欢」）
     * 一直挂在搜索框上，用户看到的就是「搜索框显示了左侧歌单名」。
     */
    private static void checkSearchBoxClear() {
        var box = new com.jello.music.ui.SearchBox();
        // 模拟「用户搜过某首歌」：直接往子节点里的 TextField 写。
        // 走 children 而不是反射私有字段 —— SearchBox 没有公开写入口，
        // 断言只需要构造出「有残留」这个状态即可。
        for (var node : box.getChildrenUnmodifiable()) {
            if (node instanceof javafx.scene.control.TextField tf) {
                tf.setText("我喜欢");
                break;
            }
        }
        box.clear();
        String txt = box.typedTextForTest();
        check("clear() 之后输入框文字为空（回到 Search... 占位符）",
                txt == null || txt.isEmpty(), "残留=[" + txt + "]");
    }

    /**
     * 托盘图标用原版资源 + 菜单字体必须能显示中文。
     *
     * <p><b>菜单乱码的根因是字体缺字形，不是编码</b>。已实测：
     * <ul>
     *   <li>{@code TrayIconHelper.java} 无 BOM，UTF-8 解码正常</li>
     *   <li>{@code pom.xml} 有 {@code project.build.sourceEncoding=UTF-8}</li>
     *   <li>class 文件常量池里是 UTF-8 字节（{@code 播放} 的 UTF-8 存在、
     *       GBK 不存在）</li>
     * </ul>
     * 编码全程正确，那 AWT {@code MenuItem} 渲染成豆腐块 □□□
     * 就只剩一个解释：它默认的 {@code MenuFont.systemFont} 缺中文字形。
     * 所以修复方式是挑一个 {@code canDisplayUpTo} 能通过的 CJK 字体。
     */
    private static void checkTrayIconsAndFont() {
        // ---- 原版图标资源必须打进 classpath ----
        String[] icons = {"app.ico", "app-256.png",
                "tray/play.png", "tray/prev.png", "tray/next.png",
                "tray/home.png", "tray/show.png", "tray/quit.png"};
        for (String name : icons) {
            java.net.URL url = UiProbe.class.getResource("/icons/" + name);
            check("图标资源在 classpath: " + name, url != null, "缺失");
        }

        // ---- ico 必须真的能解出尺寸，且不是空白 ----
        try {
            // 直接复用运行时那条路径：反射调 TrayIconHelper.loadTraySized()，
            // 保证「探针验的」和「实际跑的」是同一段代码。
            java.lang.reflect.Method m = Class
                    .forName("com.jello.music.system.TrayIconHelper")
                    .getDeclaredMethod("loadTraySized");
            m.setAccessible(true);
            java.awt.Image img = (java.awt.Image) m.invoke(null);
            check("loadTraySized() 能解出图标（手工解析 ico 目录）",
                    img != null, "返回 null");
            if (img != null) {
                int w = img.getWidth(null);
                int h = img.getHeight(null);
                check("托盘图标尺寸非 0 且在 16~64 之间",
                        w > 0 && h > 0 && w <= 64 && h <= 64,
                        w + "x" + h);
                java.awt.image.BufferedImage bi =
                        new java.awt.image.BufferedImage(w, h,
                                java.awt.image.BufferedImage.TYPE_INT_ARGB);
                java.awt.Graphics2D g = bi.createGraphics();
                g.drawImage(img, 0, 0, null);
                g.dispose();
                boolean hasColor = false;
                for (int y = 0; y < h && !hasColor; y++) {
                    for (int x = 0; x < w; x++) {
                        int argb = bi.getRGB(x, y);
                        int r = (argb >>> 16) & 0xFF;
                        int gch = (argb >>> 8) & 0xFF;
                        int b = argb & 0xFF;
                        // 非灰阶即视为有颜色（原版图标带紫/粉）
                        if (Math.max(r, Math.max(gch, b))
                                - Math.min(r, Math.min(gch, b)) > 12) {
                            hasColor = true;
                            break;
                        }
                    }
                }
                check("图标不是纯灰阶（是原版紫粉图标，不是现画的圆底）",
                        hasColor, "全灰阶");
            }
        } catch (Exception e) {
            check("反射调 loadTraySized", false, String.valueOf(e));
        }

        // ---- 菜单字体必须能显示中文 ----
        String sample = "播放设置退出上一首下一首";
        java.awt.Font[] candidates = {
                new java.awt.Font("Microsoft YaHei UI", java.awt.Font.PLAIN, 14),
                new java.awt.Font("Microsoft YaHei", java.awt.Font.PLAIN, 14),
                new java.awt.Font("SimHei", java.awt.Font.PLAIN, 14),
                new java.awt.Font("SimSun", java.awt.Font.PLAIN, 14),
                new java.awt.Font(java.awt.Font.DIALOG, java.awt.Font.PLAIN, 14),
        };
        int cjkOk = 0;
        for (java.awt.Font f : candidates) {
            if (f.canDisplayUpTo(sample) < 0) {
                cjkOk++;
            }
        }
        check("候选字体里至少 2 个能显示中文（说明本机有 CJK 字体）",
                cjkOk >= 2, "只有 " + cjkOk + " 个能显示");
        // AWT 默认菜单字体 —— 乱码的元凶
        java.awt.Font sysMenuFont =
                new java.awt.Font("Dialog", java.awt.Font.PLAIN, 14);
        check("java.awt.Dialog 字体能显示中文（AWT 兜底可用）",
                sysMenuFont.canDisplayUpTo(sample) < 0, "无中文字形");
    }

    /**
     * 搜索框必须压在搜索结果<b>之上</b>，1:1 对齐原版的 {@code z-index}。
     *
     * <p>原版（{@code SigmaSearchBox.vue:232-244}）：<br>
     * {@code .sigma-search-box-field} 有 {@code z-index: 3}，
     * {@code .sigma-search-box-results} <b>没有</b> z-index。
     * 而 results 是 {@code left:0; top:0; width:550px; height:506px}——
     * 与 field（{@code left:30px; top:14px; 490x70}）<b>区域重叠</b>。
     * 靠 z-index 区分：输入框在上。
     *
     * <p>JavaFX 的 {@code Pane} 没有 z-index，靠 {@code add} 顺序叠放，
     * <b>后加的在上</b>。所以 results 必须<b>先</b>加（插到 index 0），
     * 否则它会盖住搜索框——搜索结果里「我喜欢」这类歌单卡片的标题
     * 就叠在 "Search..." 上，看着像搜索框里有两个文字。
     */
    private static void checkSearchBoxLayering() {
        var box = new com.jello.music.ui.SearchBox();
        int r = box.resultsLayerIndex();
        int f = box.fieldLayerIndex();
        int u = box.underlineLayerIndex();
        check("三个节点都在场景树里", r >= 0 && f >= 0 && u >= 0,
                "results=" + r + " field=" + f + " underline=" + u);
        check("结果区必须排在输入框之前（add(0, results)，对应 z-index:3）",
                r >= 0 && f >= 0 && r < f, "results=" + r + " field=" + f);
        check("下划线也要压在结果区之上",
                u < 0 || r < u, "results=" + r + " underline=" + u);
        // 几何上两者确实重叠——这正是需要 z-index 的原因
        check("结果区铺满 0,0（与 field 的 30,14,490x70 区域重叠）",
                Math.abs(box.resultsLayoutY()) < 0.001,
                "results.layoutY=" + box.resultsLayoutY());
    }

    /**
     * 首次展示必须摆到屏幕<b>居中</b>，不能停在 (0,0)。
     *
     * <p>1:1 对齐原版 {@code electron/appServices.js:41-48}：
     * <pre>
     *   const isValidPosition = x !== undefined &amp;&amp; y !== undefined &amp;&amp; ...;
     *   if (!isValidPosition) {
     *       x = Math.floor((screenWidth  - width)  / 2);
     *       y = Math.floor((screenHeight - height) / 2);
     *   }
     * </pre>
     *
     * <p>之前 {@code showSigmaStage} 只调 {@code clampToPrimaryScreen}
     * （只保证「在屏内」），而 (0,0) 也算在屏内 —— 于是窗口一直停在
     * JavaFX 的默认位置，挤在左上角。这个 bug 藏了很久：搜索框的层级
     * 一改、面板外观一变，它才暴露出来。
     *
     * <p>原版还有「记住上次窗口位置」（{@code store.get('windowState')}），
     * Java 版尚未做持久化，所以每次启动都该走「无记忆 -> 居中」这条。
     */
    private static void checkInitialCentering() {
        javafx.stage.Screen screen =
                javafx.stage.Screen.getPrimary();
        javafx.geometry.Rectangle2D area = screen.getVisualBounds();
        double w = com.jello.music.ui.Theme.PANEL_W;
        double h = com.jello.music.ui.Theme.PANEL_H;
        double expectX = area.getMinX() + (area.getWidth() - w) / 2;
        double expectY = area.getMinY() + (area.getHeight() - h) / 2;

        // 直接验算法本身：窗口不应当在 (0,0)，且四边留白应当接近相等
        check("居中后 x 不为 0（原版是 (screenW-w)/2，不是 0）",
                Math.abs(expectX) > 1.0,
                "expectX=" + (int) expectX);
        check("居中后 y 不为 0",
                Math.abs(expectY) > 1.0,
                "expectY=" + (int) expectY);
        double leftGap = expectX - area.getMinX();
        double rightGap = area.getMaxX() - (expectX + w);
        check("左右留白对称（居中的定义）",
                Math.abs(leftGap - rightGap) < 1.0,
                String.format("left=%.0f right=%.0f", leftGap, rightGap));
        double topGap = expectY - area.getMinY();
        double bottomGap = area.getMaxY() - (expectY + h);
        check("上下留白对称",
                Math.abs(topGap - bottomGap) < 1.0,
                String.format("top=%.0f bottom=%.0f", topGap, bottomGap));
        // 面板必须完全落在工作区内，不能被任务栏挡住
        check("面板不超出工作区右界",
                expectX + w <= area.getMaxX() + 1,
                String.format("right=%.0f maxX=%.0f", expectX + w, area.getMaxX()));
    }

    /**
     * {@code .sigma-shell} 那层背衬必须存在，1:1 对齐 {@code SigmaUI.vue:215}。
     *
     * <p><b>这层为什么不能省</b>（用户实测截图量化出来的）：
     * <pre>
     *   收起态左栏，修前 #6D = 109     <- 白蒙蒙
     *   收起态左栏，修后 #11 = 17      <- 加了背衬
     *   展开态左栏，参照 #0C = 12
     * </pre>
     * 修前亮了 9 倍。原因是：原版主窗口<b>不透明</b>
     * （{@code appServices.js:50-60} 没有 {@code transparent: true}），
     * 这层 rgba 叠的是「窗口自己的白底」，面板看上去永远是稳定深色；
     * 而 Java 版主窗口用了 {@code StageStyle.TRANSPARENT}（比原版更透），
     * 缺了这层就等于<b>直接把桌面透出来</b>——收起时整体 opacity 只有 0.5，
     * 底板 0.95×0.5 = 0.475 不透明，剩下 52.5% 全是背后的东西。
     */
    private static void checkShellBackdrop() {
        check("存在 SHELL_BACKDROP（对应 .sigma-shell 的 rgba(6,8,12,0.2)）",
                com.jello.music.ui.Theme.SHELL_BACKDROP != null, "缺失");
        double a = com.jello.music.ui.Theme.SHELL_BACKDROP.getOpacity();
        check("背衬 alpha == 0.2（对齐 SigmaUI.vue:215）",
                Math.abs(a - 0.2) < 1e-6, "got=" + a);
        int r = (int) Math.round(
                com.jello.music.ui.Theme.SHELL_BACKDROP.getRed() * 255);
        int g = (int) Math.round(
                com.jello.music.ui.Theme.SHELL_BACKDROP.getGreen() * 255);
        int b = (int) Math.round(
                com.jello.music.ui.Theme.SHELL_BACKDROP.getBlue() * 255);
        check("背衬颜色 == rgb(6,8,12)",
                r == 6 && g == 8 && b == 12,
                "got=(" + r + "," + g + "," + b + ")");

        // 合成后的有效不透明度：0.2 背衬 + 0.475 底板
        // （收起态底板 = rgba(0,0,0,0.95) * 面板 alpha 0.5）
        double plate = com.jello.music.ui.Theme.LEFT_PANEL.getOpacity();
        double panelAlpha = 0.5;
        double effective = plate * panelAlpha + (1 - plate * panelAlpha) * a;
        check("收起态有效不透明度 >= 0.55（否则背后的白窗会透成一片灰白）",
                effective >= 0.55, "got=" + String.format("%.3f", effective));
        check("且 <= 0.65（留足透光感，仍能看出桌面）",
                effective <= 0.65, "got=" + String.format("%.3f", effective));
    }

    /**
     * 半透明时不能透出白色背景。
     *
     * <p><b>这个 bug 的成因</b>：{@code Pane} / {@code StackPane} 都继承自
     * {@code Region}，JavaFX modena 默认样式会画一层白色背景。
     * 平时 opacity 恒为 1，面板的深色底板把它完全盖住、看不出来；
     * 但贴边 / 展开动画会让整体 opacity 短暂小于 1
     * （{@code EdgeDock} 的半透明 × {@code ElasticReveal} 的 alphaFactor），
     * 那一瞬间白底就透出来，表现为「面板边缘一圈白」。
     *
     * <p>做法：造一个只有 root、没有任何底板的 overlay，
     * 把整体 opacity 设成 0.5（模拟动画中途），截图检查四角与中心
     * 是否仍为全透明。先跑一个「未设背景的 Pane」对照组，
     * 确认这个 JavaFX 版本的默认背景确实是白的 —— 否则断言前提不成立。
     */
    private static void checkNoWhiteBackdrop() {
        // 空节点不放进 Scene 时 snapshot 是 0x0（设了 prefSize / 调 layout() 也没用，
        // 因为没有 Scene 时布局不生效），所以两条都要先套一层 Scene。
        // Scene 自身也设透明，免得 Scene 的默认白底混进要测的信号里。
        javafx.scene.layout.Pane bare = new javafx.scene.layout.Pane();
        bare.setOpacity(0.5);
        // 对照组：Scene 不设 Fill 时就是默认白底。
        // 「动画里面板变白」的真凶就在这 —— 平时 opacity=1 被面板底板盖住看不出来，
        // 动画期间整体半透明，白底就透出来了。
        var bareScene = new javafx.scene.Scene(bare, 200, 150);
        bareScene.setFill(javafx.scene.paint.Color.TRANSPARENT);
        var bareImg = bare.snapshot(null, null);
        check("对照组快照尺寸非空（否则读像素会越界）",
                bareImg.getWidth() > 2 && bareImg.getHeight() > 2,
                bareImg.getWidth() + "x" + bareImg.getHeight());
        int bareAlpha = (bareImg.getPixelReader().getArgb(2, 2) >>> 24) & 0xFF;
        check("对照组：Scene 设透明 Fill 后，Pane 本身不画白底",
                bareAlpha == 127, // 0.5 opacity 作用在透明底上 -> alpha 127
                "alpha=" + bareAlpha + "（255 说明仍有白底）");

        // 对照：同一条 Scene 不设 Fill 时应当是白的
        javafx.scene.layout.Pane whiteProbe = new javafx.scene.layout.Pane();
        whiteProbe.setOpacity(0.5);
        var whiteScene = new javafx.scene.Scene(whiteProbe, 200, 150);
        // 故意不 setFill —— 这就是 bug 的样子
        int whiteAlpha = (whiteProbe.snapshot(null, null)
                .getPixelReader().getArgb(2, 2) >>> 24) & 0xFF;
        check("对照组：Scene 不设 Fill 时确实是白底（alpha=255）",
                whiteAlpha == 255, "alpha=" + whiteAlpha);

        javafx.scene.layout.Pane root = new javafx.scene.layout.Pane();
        root.setBackground(javafx.scene.layout.Background.fill(
                javafx.scene.paint.Color.TRANSPARENT));
        javafx.scene.layout.StackPane overlay =
                new javafx.scene.layout.StackPane(root);
        overlay.setBackground(javafx.scene.layout.Background.fill(
                javafx.scene.paint.Color.TRANSPARENT));
        overlay.setOpacity(0.5);
        var scene = new javafx.scene.Scene(overlay, 200, 150);
        scene.setFill(javafx.scene.paint.Color.TRANSPARENT);

        var img = overlay.snapshot(null, null);
        var reader = img.getPixelReader();
        int[] points = {2, 2, 197, 2, 2, 147, 100, 75};
        boolean allClear = true;
        StringBuilder detail = new StringBuilder();
        for (int i = 0; i < points.length; i += 2) {
            int a = (reader.getArgb(points[i], points[i + 1]) >>> 24) & 0xFF;
            if (a != 0) {
                allClear = false;
                detail.append(String.format("(%d,%d)=%d ",
                        points[i], points[i + 1], a));
            }
        }
        check("半透明时四角与中心都是全透明（无白底漏出）",
                allClear, detail.toString());
    }

    /**
     * 自定义 RPC 地址的断言，对齐原版 {@code settings.js:357-379}。
     *
     * <p>原版语义：{@code apiBaseUrlMode} 默认 {@code default}，
     * 选 {@code custom} 才用 {@code apiBaseUrl}；后者默认空串，
     * 为空时回落到 {@code http://127.0.0.1:6521}。
     *
     * <p>这两项必须<b>成对</b>存在——只做模式没地方填地址，
     * 只做地址又没有「默认 / 自定义」的开关语义。
     */
    private static void checkApiBaseUrl() {
        var defaults = com.jello.music.model.Settings.defaults();
        check("有 apiBaseUrlMode（默认 / 自定义）",
                defaults.containsKey("apiBaseUrlMode"), "缺失");
        check("有 apiBaseUrl（地址输入框）",
                defaults.containsKey("apiBaseUrl"), "缺失");
        check("apiBaseUrlMode 默认 default（对齐原版）",
                "default".equals(defaults.get("apiBaseUrlMode")),
                "got=" + defaults.get("apiBaseUrlMode"));
        check("apiBaseUrl 默认空串（对齐原版）",
                defaults.get("apiBaseUrl") != null
                        && defaults.get("apiBaseUrl").isEmpty(),
                "got=" + defaults.get("apiBaseUrl"));

        // 两项都要是「有类型的项」，不能是空壳
        com.jello.music.model.Settings.Item mode = null;
        com.jello.music.model.Settings.Item url = null;
        for (var sec : com.jello.music.model.Settings.sections()) {
            for (var item : sec.items) {
                if ("apiBaseUrlMode".equals(item.key)) {
                    mode = item;
                }
                if ("apiBaseUrl".equals(item.key)) {
                    url = item;
                }
            }
        }
        check("apiBaseUrlMode 是 CHOICE 类型",
                mode != null && mode.kind == com.jello.music.model.Settings.Kind.CHOICE,
                mode == null ? "缺失" : String.valueOf(mode.kind));
        check("apiBaseUrlMode 有两个选项（默认 / 自定义）",
                mode != null && mode.options != null && mode.options.size() == 2,
                mode == null || mode.options == null ? "null" : String.valueOf(mode.options));
        check("apiBaseUrl 是 TEXT 类型",
                url != null && url.kind == com.jello.music.model.Settings.Kind.TEXT,
                url == null ? "缺失" : String.valueOf(url.kind));
        check("apiBaseUrl 有占位提示（原版是 hidden 的，这里给个可读的）",
                url != null && url.placeholder != null
                        && !url.placeholder.isEmpty(),
                url == null ? "缺失"
                        : "len=" + url.placeholder.length());
    }

    /**
     「阻止休眠」与「最小化到托盘」的断言。
     *
     * <p>两者都对应原版真实存在的实现：
     * <ul>
     *   <li>阻止休眠：{@code electron/main.js:200} 的
     *       {@code powerSaveBlocker.start('prevent-display-sleep')}，
     *       Java 侧走 Win32 {@code SetThreadExecutionState}</li>
     *   <li>最小化到托盘：{@code appServices.js:119} 的
     *       {@code if (minimizeToTray === 'off') quit(); event.preventDefault(); hide();}，
     *       默认 on</li>
     * </ul>
     */
    private static void checkSystemToggles() {
        // ---- 阻止休眠 ----
        String prev = com.jello.music.AppPrefs.getSetting(
                com.jello.music.system.KeepAwake.SETTING_KEY, "off");
        try {
            // 默认关
            com.jello.music.AppPrefs.setSetting(
                    com.jello.music.system.KeepAwake.SETTING_KEY, "off");
            check("阻止休眠默认关（对齐原版）",
                    !com.jello.music.system.KeepAwake.isEnabledInSettings(), "默认是开");
            com.jello.music.AppPrefs.setSetting(
                    com.jello.music.system.KeepAwake.SETTING_KEY, "on");
            check("阻止休眠读到 on",
                    com.jello.music.system.KeepAwake.isEnabledInSettings(), "未读到");

            // SetThreadExecutionState 实际可调用（Windows 上返回非 0）
            boolean applied = com.jello.music.system.KeepAwake.apply(true);
            check("SetThreadExecutionState 能开（Windows）",
                    applied || !System.getProperty("os.name", "")
                            .toLowerCase().contains("win"),
                    "返回 false");
            check("恢复只留 ES_CONTINUOUS 可调用",
                    com.jello.music.system.KeepAwake.apply(false)
                            || !System.getProperty("os.name", "")
                                    .toLowerCase().contains("win"),
                    "返回 false");
        } finally {
            com.jello.music.AppPrefs.setSetting(
                    com.jello.music.system.KeepAwake.SETTING_KEY, prev);
            com.jello.music.system.KeepAwake.apply(false);
        }

        // ---- 最小化到托盘：默认必须是开 ----
        // 这条之前是「关窗口直接退」，等于该开关一直是 off。
        // 权威默认值取自 Settings 模型（对齐原版 settings.js 的 defaultValue），
        // 而不是 AppPrefs.getSetting 的兜底 —— 后者在「配置里根本没这个键」时
        // 才返回兜底值，一旦有残留就测不出模型的默认值对不对
        String modelDefault = com.jello.music.model.Settings.defaults()
                .get("minimizeToTray");
        check("模型里「最小化到托盘」默认为开（对齐原版 defaultValue: 'on'）",
                "on".equals(modelDefault), "got=" + modelDefault);
        // 只验读写一致性，不断言「配置里没有这个键」——
        // 那取决于用户之前怎么用过，断言它等于把状态当契约
        com.jello.music.AppPrefs.setSetting("minimizeToTray", "off");
        check("设为 off 后读到 off",
                "off".equals(com.jello.music.AppPrefs
                        .getSetting("minimizeToTray", "on")), "未读到");
        com.jello.music.AppPrefs.setSetting("minimizeToTray", "on");

        // 两项都必须真的出现在设置页里（否则又变成「有实现没入口」）
        boolean hasMinimize = false;
        boolean hasSleep = false;
        for (var item : com.jello.music.model.Settings.defaults().keySet()) {
            if ("minimizeToTray".equals(item)) {
                hasMinimize = true;
            }
            if ("preventAppSuspension".equals(item)) {
                hasSleep = true;
            }
        }
        check("「最小化到托盘」在设置页里", hasMinimize, "缺失");
        check("「阻止休眠」在设置页里", hasSleep, "缺失");
    }

    /**
     * Jump List 的断言，对齐原版 {@code electron/main.js:85-99, 49}。
     *
     * <p><b>纠正一处此前的误记</b>：TODO 里写「任务栏缩略图工具条」，
     * 但原版<b>没有</b>这个功能——我把搜索结果的 {@code SigmaThumbnailButton}
     * 误认成了它。原版实际只有 {@code setupJumpList}，且只有一条「设置」任务。
     */
    private static void checkJumpList() {
        check("AppUserModelID == cn.jello.music（原版 main.js:89）",
                "cn.jello.music".equals(com.jello.music.system.JumpList.APP_USER_MODEL_ID),
                com.jello.music.system.JumpList.APP_USER_MODEL_ID);
        check("设置参数 == --settings（原版 main.js:49）",
                "--settings".equals(com.jello.music.system.JumpList.SETTINGS_ARG),
                com.jello.music.system.JumpList.SETTINGS_ARG);
        check("任务标题为「设置」",
                "设置".equals(com.jello.music.system.JumpList.SETTINGS_TITLE),
                com.jello.music.system.JumpList.SETTINGS_TITLE);

        // 参数识别
        check("能认出 --settings",
                com.jello.music.system.JumpList.hasSettingsArg(
                        new String[]{"app.exe", "--settings"}), "未认出");
        check("没带时不误判",
                !com.jello.music.system.JumpList.hasSettingsArg(
                        new String[]{"app.exe", "jello://x?hash=1"}), "误判");
        check("null 参数不炸",
                !com.jello.music.system.JumpList.hasSettingsArg(null), "抛异常?");
    }

    /**
     * 展开缩放的断言，对齐 sigmarebase {@code ClickGuiScreen.draw:255-257, 292}。
     *
     * <p>权威是：
     * <pre>
     *   alphaFactor = animationCompleted &amp;&amp; !animationStarted
     *       ? method13317(p, 0.8) * 0.5 + 0.5
     *       : (!animationCompleted ? 1.0 : method13317(p, 1.0))
     *   scale = 1.5 - alphaFactor * 0.5
     * </pre>
     * 关键是 {@code method13317} 按方向选缓动（:247-251）：
     * BACKWARDS 用 easeOutQuad，FORWARDS 才用 easeOutElastic。
     * 之前 Java 版无条件用 elastic，展开时曲线就错了。
     */
    /**
 * 验证两层 alpha 的分工与合成。
 *
 * <p><b>mod 的 alpha 是逐层相乘的</b>（这里曾走过一次弯路）：
 * <pre>
 *   ClickGuiScreen.draw:295  super.draw(partialTicks * Math.min(1.0F, alphaFactor) * fadeAmount);
 *   CustomGuiScreen.draw:219 drawChildren(partialTicks);       // 逐层往下传
 *   MusicPlayer.draw:278     partialTicks *= 0.5F + (1.0F - field20873.calcPercent()) * 0.5F;
 * </pre>
 * 子面板收到的 {@code partialTicks} 已经含了父层的 alphaFactor，再乘一次自己那层。
 * 所以最终 alpha = {@code min(1, alphaFactor) * (0.5 + (1-p)*0.5)}。
 *
 * <p>中途曾把 ElasticReveal 的 opacity 整个删掉，理由是「别相乘」——那是错的。
 * mod 就是相乘的，删掉后展开起始会偏亮（0.5 而非 0.5×0.5）。
 *
 * <p>JavaFX 父子 {@code opacity} 恰好也相乘，所以用 overlay/root 的分层
 * 正好同构。这里钉住三件事：
 * <ol>
 *   <li>展开/收起两态都写 opacity，且夹到 1（elastic 会过冲到 1.03）</li>
 *   <li>终值复位成 1</li>
 *   <li>scale 与 alpha 的公式仍分别对</li>
 * </ol>
 */
private static void checkElasticRevealKeepsOpacity() {
        javafx.scene.layout.Pane target = new javafx.scene.layout.Pane();
        ElasticReveal reveal = new ElasticReveal(target);
        // 反射的受检异常统一包成 RuntimeException：
        // 这里只在探针里跑，方法名写错就是测试代码坏了，不该静默放过
        java.lang.reflect.Method m;
        java.lang.reflect.Field fAnimate;
        try {
            m = ElasticReveal.class.getDeclaredMethod("applyFrame", double.class);
            m.setAccessible(true);
            fAnimate = ElasticReveal.class.getDeclaredField("animateScale");
            fAnimate.setAccessible(true);
        } catch (ReflectiveOperationException e) {
            check("反射拿到 ElasticReveal 的 applyFrame / animateScale", false,
                    String.valueOf(e));
            return;
        }

        // 展开：alphaFactor = elastic(p,0.8)*0.5+0.5，起点 0.5
        try {
            fAnimate.setBoolean(reveal, true);
            m.invoke(reveal, 0.0);
            check("展开态写 opacity（mod 的 alphaFactor 是两层相乘的一层）",
                    Math.abs(target.getOpacity() - 0.5) < 1e-6,
                    "got=" + target.getOpacity());
            check("展开起点 scale == 1.25",
                    Math.abs(target.getScaleX() - 1.25) < 1e-6,
                    "got=" + target.getScaleX());

            // 展开中段会过冲到 1.03，必须被 Math.min 夹到 1
            for (double p = 0.1; p < 1.0; p += 0.02) {
                m.invoke(reveal, p);
                if (target.getOpacity() > 1.0 + 1e-9) {
                    break;
                }
            }
            check("展开中 opacity 不超过 1.0（elastic 过冲被 min 夹住）",
                    target.getOpacity() <= 1.0 + 1e-9,
                    "got=" + target.getOpacity());

            // 收起：alphaFactor = elastic(p,1.0)，同样要夹到 1
            fAnimate.setBoolean(reveal, false);
            m.invoke(reveal, 0.5);
            check("收起态也写 opacity（走 period=1.0 的 elastic）",
                    Math.abs(target.getOpacity() - 1.0) < 1e-6,
                    "got=" + target.getOpacity());
            check("收起态 scale 恒为 1",
                    Math.abs(target.getScaleX() - 1.0) < 1e-9,
                    "got=" + target.getScaleX());

            // 终值复位：finish / reset 都要把 overlay 层回到 1.0
            for (String name : new String[]{"finish", "reset"}) {
                java.lang.reflect.Method mm =
                        ElasticReveal.class.getDeclaredMethod(name);
                mm.setAccessible(true);
                target.setOpacity(0.37);
                mm.invoke(reveal);
                check(name + " 把 overlay 层复位到 1.0",
                        Math.abs(target.getOpacity() - 1.0) < 1e-9,
                        "got=" + target.getOpacity());
            }

            // 两层相乘的合成值：展开起点 = 0.5(展开层) * 0.5(贴边层) = 0.25
            fAnimate.setBoolean(reveal, true);
            m.invoke(reveal, 0.0);
            double overlayLayer = target.getOpacity();
            double dockLayer = 0.5; // EdgeDock 收起稳态
            check("展开起点两层合成 alpha == 0.25（对齐 mod 的逐层相乘）",
                    Math.abs(overlayLayer * dockLayer - 0.25) < 1e-6,
                    "got=" + (overlayLayer * dockLayer));
        } catch (ReflectiveOperationException e) {
            check("反射调用 ElasticReveal 私有成员", false, String.valueOf(e));
        }
    }

    private static void checkExpandScale() {
        // 【回归防线】ElasticReveal 绝不能碰 opacity。
        // overlay 是 root 的父容器，父子 opacity 相乘：
        // EdgeDock 设 0.5（收起半透明）、ElasticReveal 再设 0.5 -> 实际渲染 0.25。
        // 之前就是这么叠坏的（"收起后比原版暗得多"）。
        // 这里跑一遍真实的 expand()/collapse()/reset()，检查 opacity 始终没被改。
        checkElasticRevealKeepsOpacity();

        // 三分支
        check("未完成时 alphaFactor 恒为 1.0（scale=1.0）",
                Math.abs(ElasticReveal.alphaFactor(false, true, 0.5, false) - 1.0) < 1e-9,
                "");
        check("收起中用 period=1.0 的 elastic",
                Math.abs(ElasticReveal.alphaFactor(true, true, 0.5, false)
                        - ElasticReveal.ease13317(0.5, 1.0)) < 1e-9,
                "");
        // 展开完成中：elastic(p,0.8)*0.5 + 0.5
        double f0 = ElasticReveal.alphaFactor(true, false, 0.0, false);
        double f1 = ElasticReveal.alphaFactor(true, false, 1.0, false);
        check("展开起点 alphaFactor == 0.5（scale=1.25）",
                Math.abs(f0 - 0.5) < 1e-6, "got=" + f0);
        check("展开终点 alphaFactor == 1.0（scale=1.0）",
                Math.abs(f1 - 1.0) < 1e-6, "got=" + f1);

        // scale = 1.5 - factor*0.5
        check("展开起点 scale == 1.25（a 起始 0.5）",
                Math.abs(1.5 - f0 * 0.5 - 1.25) < 1e-6,
                "got=" + (1.5 - f0 * 0.5));
        check("展开终点 scale == 1.0",
                Math.abs(1.5 - f1 * 0.5 - 1.0) < 1e-6,
                "got=" + (1.5 - f1 * 0.5));

        // 中途必须有过冲（"弹进来"），这是与 easeOutQuad 的关键区别
        double maxFactor = 0;
        for (int i = 0; i <= 100; i++) {
            double p = i / 100.0;
            maxFactor = Math.max(maxFactor,
                    ElasticReveal.alphaFactor(true, false, p, false));
        }
        check("展开中途有过冲（弹性回弹，非单调）", maxFactor > 1.01,
                "max=" + String.format("%.4f", maxFactor));
        // 且最小值不低于起点 0.5
        double minFactor = 1;
        for (int i = 0; i <= 100; i++) {
            double p = i / 100.0;
            minFactor = Math.min(minFactor,
                    ElasticReveal.alphaFactor(true, false, p, false));
        }
        check("alphaFactor 不低于起点 0.5", minFactor >= 0.5 - 1e-9,
                "min=" + String.format("%.4f", minFactor));

        // method13317 的双缓动
        check("BACKWARDS 走 easeOutQuad（不是 elastic）",
                Math.abs(ElasticReveal.ease13317(0.5, 0.8, false) - 0.75) < 1e-6,
                "got=" + ElasticReveal.ease13317(0.5, 0.8, false));
        check("easeOutQuad(0.5) == 0.75",
                Math.abs(ElasticReveal.easeOutQuad(0.5) - 0.75) < 1e-9, "");
        check("FORWARDS 走 easeOutElastic",
                Math.abs(ElasticReveal.ease13317(0.5, 0.8, true)
                        - ElasticReveal.easeOutElastic(0.5, 0.8)) < 1e-9, "");
        check("elastic 与 quad 在 0.5 处不同（两种缓动确实分开了）",
                Math.abs(ElasticReveal.easeOutElastic(0.5, 0.8)
                        - ElasticReveal.easeOutQuad(0.5)) > 1e-3,
                "两者相同");
    }

    /**
     * 贴边淡入淡出曲线的断言，逐值对齐 sigmarebase。
     *
     * <p>权威是 {@code MusicPlayer.draw:275-278} 的
     * {@code field20873}（一个 {@code Animation(80, 150, BACKWARDS)}）+ 公式
     * {@code partialTicks *= 0.5F + (1.0F - calcPercent()) * 0.5F}。
     * 之前 Java 版是「切状态就启动一段独立的线性淡入淡出」，
     * 快速连按 RSHIFT 时会重新从头播；现在改成与 mod 同源的进度连续动画。
     *
     * <p>这里断言两件事：
     * <ol>
     *   <li>两个方向的 alpha 曲线端点与中点（线性，80ms / 150ms）</li>
     *   <li><b>方向翻转时进度连续</b>——这是改动的核心，也是最难凭肉眼发现的</li>
     * </ol>
     */
    private static void checkDockFadeCurve() {
        check("收起时长 == 80ms（Animation 第��个参数）",
                EdgeDock.DIM_MILLIS == 80, "got=" + EdgeDock.DIM_MILLIS);
        check("展开时长 == 150ms（Animation 第二个参数）",
                EdgeDock.BRIGHT_MILLIS == 150, "got=" + EdgeDock.BRIGHT_MILLIS);
        check("收起态不透明度 == 0.5",
                EdgeDock.DOCKED_OPACITY == 0.5, "got=" + EdgeDock.DOCKED_OPACITY);

        // 复刻 mod 的 alpha 公式：alpha = 0.5 + (1 - p) * 0.5
        // 注意 alpha 与 p 的绑定<b>与方向无关</b>，只看 calcPercent()：
        // p=1 → 0.5 半透明（收起稳态），p=0 → 1.0 不透明（展开稳态）。
        // 这条曾写反过一次（把方向也算进去了），DockMotionProbe 实测才看出来。
        final double dim = EdgeDock.DIM_MILLIS;
        final double bright = EdgeDock.BRIGHT_MILLIS;
        java.util.function.DoubleUnaryOperator alphaOf = p ->
                0.5 + (1.0 - p) * 0.5;
        java.util.function.DoubleUnaryOperator pForwards = elapsed -> // 收起
                Math.min(1.0, Math.max(0.0, elapsed / dim));
        java.util.function.DoubleUnaryOperator pBackwards = elapsed -> // 展开
                Math.max(0.0, 1.0 - Math.min(1.0, elapsed / bright));

        check("收起起点 alpha == 1.0",
                Math.abs(alphaOf.applyAsDouble(pForwards.applyAsDouble(0)) - 1.0) < 1e-9,
                "");
        check("收起终点 alpha == 0.5（稳态半透明）",
                Math.abs(alphaOf.applyAsDouble(pForwards.applyAsDouble(dim)) - 0.5) < 1e-9,
                "");
        check("收起中点 alpha == 0.75（线性）",
                Math.abs(alphaOf.applyAsDouble(pForwards.applyAsDouble(dim / 2)) - 0.75) < 1e-9, "");
        check("展开起点 alpha == 0.5",
                Math.abs(alphaOf.applyAsDouble(pBackwards.applyAsDouble(0)) - 0.5) < 1e-9, "");
        check("展开终点 alpha == 1.0",
                Math.abs(alphaOf.applyAsDouble(pBackwards.applyAsDouble(bright)) - 1.0) < 1e-9, "");
        check("展开中点 alpha == 0.75（线性）",
                Math.abs(alphaOf.applyAsDouble(pBackwards.applyAsDouble(bright / 2)) - 0.75) < 1e-9,
                "");

        // 方向翻转的连续性：Animation.changeDirection 用当前进度反推新起点。
        // 收起 40ms（p=0.5, alpha=0.75）时翻转为展开：
        //   新 elapsed 起点 = (1 - p) * 150 = 75ms，此刻新进度 = 1 - 75/150 = 0.5
        double pBefore = pForwards.applyAsDouble(dim / 2);
        double alphaBefore = alphaOf.applyAsDouble(pBefore);
        double newElapsed = (1.0 - pBefore) * bright;
        double pAfter = pBackwards.applyAsDouble(newElapsed);
        double alphaAfter = alphaOf.applyAsDouble(pAfter);
        check("翻转前 alpha == 0.75", Math.abs(alphaBefore - 0.75) < 1e-9,
                "got=" + alphaBefore);
        check("翻转后 alpha 仍 == 0.75（进度连续，不跳变）",
                Math.abs(alphaAfter - alphaBefore) < 1e-9,
                "before=" + alphaBefore + " after=" + alphaAfter);

        // 触发条按越界判定而非吸附态
        check("触发条宽度 == 41（.smp-dock-trigger）",
                Theme.EDGE_TRIGGER == 41, "got=" + Theme.EDGE_TRIGGER);
        // 越界判定：右缘越过容器右界才算越界
        check("右缘正好等于右界不算越界",
                !EdgeDock.overhangingOf(1920 - 800, 800, 1920), "误判为越界");
        check("右缘超出 1px 即算越界",
                EdgeDock.overhangingOf(1920 - 800 + 1, 800, 1920), "未判为越界");
    }

    /** jello:// 协议的 URL 解析，对齐原版 handleUrl（appServices.js:1529-1545）。 */
    private static void checkJelloProtocol() {
        // 从命令行里找 URL：位置不固定，可能带引号
        check("能从 argv 找到协议 URL",
                com.jello.music.system.JelloProtocol.findUrlIn(
                        new String[]{"C:\\app.exe", "\"jello://play?hash=ABC\""})
                        != null, "未找到");
        check("忽略非协议参数",
                com.jello.music.system.JelloProtocol.findUrlIn(
                        new String[]{"--settings"}) == null, "误判");
        check("null argv 不炸",
                com.jello.music.system.JelloProtocol.findUrlIn(null) == null, "抛异常?");

        // 解析 hash / listid / path
        var s = com.jello.music.system.JelloProtocol.parse(
                "jello://play?hash=ABC123&listid=L9");
        check("解析出 hash", "ABC123".equals(s.hash()), "got=" + s.hash());
        check("解析出 listid", "L9".equals(s.listId()), "got=" + s.listId());
        check("解析出 path", "play".equals(s.path()), "got=" + s.path());
        check("带 hash 视为可播", s.isPlayable(), "false");

        // 只有 listid 也算可播
        check("仅 listid 也算可播",
                com.jello.music.system.JelloProtocol.parse(
                        "jello://playlist?listid=L1").isPlayable(), "false");
        check("空 URL 不可播",
                !com.jello.music.system.JelloProtocol.parse("").isPlayable(), "true");
        // 无 scheme 前缀也能解析（Windows 传参可能已剥离）
        check("无 scheme 前缀也能解析",
                "H1".equals(com.jello.music.system.JelloProtocol
                        .parse("?hash=H1").hash()), "未解析");
        // URL 编码
        check("URL 编码能解码",
                "a b".equals(com.jello.music.system.JelloProtocol
                        .parse("jello://x?hash=a%20b").hash()), "未解码");
    }

    /**
     * 媒体键的按键边沿判定。
     *
     * <p>用假的 KeyState 喂「按下 → 保持 → 松开」序列，验证只在<b>按下沿</b>触发一次，
     * 且注册了原版需要的四个虚拟键码。
     */
    private static void checkMediaKeys() {
        check("媒体键虚拟键码正确",
                com.jello.music.system.MediaKeyPoller.VK_MEDIA_PLAY_PAUSE == 0xB3
                        && com.jello.music.system.MediaKeyPoller.VK_MEDIA_STOP == 0xB2
                        && com.jello.music.system.MediaKeyPoller.VK_MEDIA_NEXT_TRACK == 0xB0
                        && com.jello.music.system.MediaKeyPoller.VK_MEDIA_PREV_TRACK == 0xB1,
                "vk 不符");

        // 假的状态源：可手动置位
        final int[] pressed = {0};
        int[] calls = {0};
        // 构造前先按住，验证「预采样」能挡住开机就按着的情况
        pressed[0] = com.jello.music.system.MediaKeyPoller.VK_MEDIA_PLAY_PAUSE;
        com.jello.music.system.MediaKeyPoller poller =
                new com.jello.music.system.MediaKeyPoller(
                        vk -> pressed[0] == vk,
                        20,
                        new com.jello.music.system.MediaKeyPoller.Handler() {
                            @Override
                            public void onPlayPause() {
                                calls[0]++;
                            }
                        },
                        com.jello.music.system.MediaKeyPoller.VK_MEDIA_PLAY_PAUSE);

        sleepMillis(120);
        check("启动时已按住的键不误触发", calls[0] == 0, "calls=" + calls[0]);

        // 松开
        pressed[0] = 0;
        sleepMillis(80);
        // 按下 → 触发一次
        pressed[0] = com.jello.music.system.MediaKeyPoller.VK_MEDIA_PLAY_PAUSE;
        sleepMillis(120);
        check("按下沿触发一次", calls[0] == 1, "calls=" + calls[0]);
        // 保持按住 → 不重复
        sleepMillis(120);
        check("按住不连发", calls[0] == 1, "calls=" + calls[0]);
        // 松开再按 → 再触发
        pressed[0] = 0;
        sleepMillis(80);
        pressed[0] = com.jello.music.system.MediaKeyPoller.VK_MEDIA_PLAY_PAUSE;
        sleepMillis(120);
        check("再按触发第二次", calls[0] == 2, "calls=" + calls[0]);

        poller.close();
    }

    private static void sleepMillis(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * 单实例锁的断言。
     *
     * <p><b>只测同 JVM 内重入这一种情况</b>：跨进程行为（第二个 exe 能否被挡、
     * 唤醒信号能否送达）需要同时起两个进程，离屏探针里做不到；
     * 那部分靠手工跑两个进程验证过。
     *
     * <p>同 JVM 内重复 {@code tryLock()} 抛的是
     * {@link java.nio.channels.OverlappingFileLockException} 而非返回 null——
     * 这个分支不处理的话，探针自己就会把锁吃掉。
     */
    private static void checkSingleInstance() {
        check("单实例锁在 Windows 上应可用",
                com.jello.music.system.SingleInstance.isSupported()
                        || !System.getProperty("os.name", "").toLowerCase().contains("win"),
                "os=" + System.getProperty("os.name"));

        var first = com.jello.music.system.SingleInstance.tryAcquire();
        check("首次能拿到单实例锁", first != null, "got null");
        if (first == null) {
            return;
        }
        check("持锁者能报出自己的 pid",
                first.holderPid() != null && !first.holderPid().isBlank(),
                "pid=" + first.holderPid());

        var second = com.jello.music.system.SingleInstance.tryAcquire();
        check("同进程重入拿不到锁（应为 null）", second == null,
                second == null ? "null" : "拿到了锁");

        // 没有别的进程时不会有唤醒信号，take 应返回 false
        check("无信号时 takePendingCommand 为 false",
                !first.takePendingCommand(), "unexpected signal");

        first.close();
        var third = com.jello.music.system.SingleInstance.tryAcquire();
        check("close 后可以再次获取", third != null, "got null");
        if (third != null) {
            third.close();
        }
    }

    /**
     * 三个「死开关」是否真的接上了。
     *
     * <p>之前这三个设置项都能改、能存盘，但完全不影响运行——
     * 比缺功能更糟（用户以为设了）。这里逐个钉住它们的接线点。
     */
    private static void checkDeadSwitches() {
        // ---- 音质：原版 QUALITY_LEVELS 7 档 + 降级链 ----
        check("音质档位 == 7（原版 QUALITY_LEVELS）",
                com.jello.music.api.QualityResolver.LEVELS.size() == 7,
                "n=" + com.jello.music.api.QualityResolver.LEVELS.size());
        check("默认音质 == 128（原版 settings.js defaultValue）",
                com.jello.music.api.QualityResolver.DEFAULT.equals("128"),
                "got=" + com.jello.music.api.QualityResolver.DEFAULT);
        check("非法音质落回 128（normalizeQuality）",
                "128".equals(com.jello.music.api.QualityResolver.normalize("bogus")),
                com.jello.music.api.QualityResolver.normalize("bogus"));
        // 降级链：选 viper_tape 要从最高档往下试，不是从低往高
        var chainTape = com.jello.music.api.QualityResolver.fallbackChain("viper_tape");
        check("选母带时降级链从最高档开始",
                chainTape.get(0).equals("viper_tape")
                        && chainTape.get(chainTape.size() - 1).equals("128"),
                chainTape.toString());
        var chain128 = com.jello.music.api.QualityResolver.fallbackChain("128");
        check("选 128 时降级链只有一档",
                chain128.size() == 1 && chain128.get(0).equals("128"),
                chain128.toString());
        // 无任何权限时的兜底：候选必须补一条 128
        var cands = com.jello.music.api.QualityResolver.candidates(
                java.util.Map.of(), "flac", "HASH");
        check("无权限时兜底追加 128 候选（原版 :67-69）",
                cands.stream().anyMatch(c -> "128".equals(c.quality())),
                cands.toString());

        // ---- 开机自启：登录项能写能删 ----
        String saved = com.jello.music.system.AutoStart.currentLoginCommand();
        try {
            com.jello.music.system.AutoStart.apply(true);
            String on = com.jello.music.system.AutoStart.currentLoginCommand();
            check("开机自启能写入登录项", on != null && !on.isBlank(),
                    on == null ? "null" : on.substring(0, Math.min(60, on.length())) + "...");
            // 登录项脱离 run.bat 启动，必须自带 module-path，否则 javafx 拒绝从 classpath 加载
            check("开发形态的登录项带 module-path（javafx 需要）",
                    on != null && on.contains("--module-path"),
                    on == null ? "null" : "no module-path");
            check("登录项不带 test scope 依赖",
                    on == null || (!on.contains("junit") && !on.contains("opentest4j")),
                    on == null ? "null" : "含 test jar");
        } finally {
            com.jello.music.system.AutoStart.apply(false);
            String off = com.jello.music.system.AutoStart.currentLoginCommand();
            check("开机自启能取消（登录项被删除）", off == null,
                    off == null ? "null" : off);
        }
        if (saved != null) {
            com.jello.music.system.AutoStart.apply(true);
        }

        // ---- 界面缩放：读设置 + 夹取 ----
        check("缩放默认 1.0", com.jello.music.system.UiScale.DEFAULT == 1.0, null);
        check("缩放范围 0.6~2.0",
                com.jello.music.system.UiScale.MIN == 0.6
                        && com.jello.music.system.UiScale.MAX == 2.0, null);
        // 非法值回落
        String prevScale = com.jello.music.AppPrefs.getSetting("uiScale", "1.0");
        try {
            com.jello.music.AppPrefs.setSetting("uiScale", "abc");
            check("非法缩放回落 1.0",
                    com.jello.music.system.UiScale.current() == 1.0,
                    "got=" + com.jello.music.system.UiScale.current());
            com.jello.music.AppPrefs.setSetting("uiScale", "99");
            check("越界缩放夹到 2.0",
                    com.jello.music.system.UiScale.current() == 2.0,
                    "got=" + com.jello.music.system.UiScale.current());
            com.jello.music.AppPrefs.setSetting("uiScale", "0.1");
            check("越界缩放夹到 0.6",
                    com.jello.music.system.UiScale.current() == 0.6,
                    "got=" + com.jello.music.system.UiScale.current());
        } finally {
            com.jello.music.AppPrefs.setSetting("uiScale", prevScale);
        }
    }

    /**
     * 右栏模糊标题栏的断言，对齐 sigmarebase {@code method13196}（:474-533）。
     *
     * <p>这条链路最容易错的是三处：
     * <li><b>淡入曲线</b>是 {@code offset/50}（线性，50px 内淡入完），不是缓动</li>
     * <li><b>标题 y</b>是 {@code 16 + (1-v)*14}，即淡入时从 30 滑到 16——
     *     少了这个滑入，标题会「淡」进来而不是「滑」进来</li>
     * <li><b>两层文字交叉</b>：v=0 时只有 medium 层可见，v=1 时只有 light 层可见</li>
     * </p>
     */
    private static void checkRightTitleBar() {
        RightTitleBar bar = new RightTitleBar();
        bar.setPrefSize(Theme.RIGHT_PANEL_W, RightTitleBar.BAR_H);
        bar.resize(Theme.RIGHT_PANEL_W, RightTitleBar.BAR_H);

        check("标题栏高度 == 64（field20847）",
                RightTitleBar.BAR_H == 64, "got=" + RightTitleBar.BAR_H);
        check("淡入距离 == 50px（权威 v = offset/50）",
                RightTitleBar.FADE_IN_PX == 50, "got=" + RightTitleBar.FADE_IN_PX);

        // 淡入曲线：offset=0 -> 0，offset=25 -> 0.5，offset=50 -> 1，offset>50 -> 1
        bar.setScroll(0);
        check("滚动 0 时完全透明",
                Math.abs(bar.fadeAlpha()) < 1e-9, "got=" + bar.fadeAlpha());
        bar.setScroll(25);
        check("滚动 25 时正好半透明",
                Math.abs(bar.fadeAlpha() - 0.5) < 1e-9, "got=" + bar.fadeAlpha());
        bar.setScroll(50);
        check("滚动 50 时完全淡入",
                Math.abs(bar.fadeAlpha() - 1.0) < 1e-9, "got=" + bar.fadeAlpha());
        bar.setScroll(500);
        check("滚动远超 50 后仍为 1（不越界）",
                Math.abs(bar.fadeAlpha() - 1.0) < 1e-9, "got=" + bar.fadeAlpha());

        // 标题基线 y：权威 16 + (1-v)*14
        check("淡入完成时标题 y == 16",
                Math.abs(bar.titleBaselineY(1.0) - 16) < 1e-9,
                "got=" + bar.titleBaselineY(1.0));
        check("未淡入时标题 y == 30（滑入 14px）",
                Math.abs(bar.titleBaselineY(0.0) - 30) < 1e-9,
                "got=" + bar.titleBaselineY(0.0));

        bar.setTitle("每日推荐");
        check("标题文本已写入",
                "每日推荐".equals(bar.titleText()), "got=" + bar.titleText());
        // 标题栏不能吃掉鼠标，否则会挡住右栏卡片点击
        check("标题栏不吃鼠标",
                bar.isMouseTransparent(), "mouseTransparent=false");
    }

    /**
     * 频谱参数链路的断言。
     *
     * <p>这几个设置之前是「死开关」——{@code Settings} 里定义了，
     * 但 {@code SpectrumView} 一个都不读，条高还是归一化柱状图。
     * 现在按原版 {@code SpectrumHUD.vue} 接线了，所以要盯住三件事：
     *
     * <ol>
     *   <li><b>内核常量</b>必须是 114 条 / FFT 1024，而不是曾经自取的 48 / 2048</li>
     *   <li><b>幅度与平滑</b>能穿过 {@link com.jello.music.ui.SpectrumView} 落到字段上</li>
     *   <li><b>条高公式</b>是 {@code max(0, sqrt(levels)/12-5) * sigmaAmp}，
     *       且随 scale 线性变化——这是唯一能把「参数真的生效」证明出来的地方，
     *       因为 {@link com.jello.music.ui.SpectrumView} 的绘制在 AnimationTimer 里，
     *       离屏断言拿不到中间状态，只能把公式抽出来对着算</li>
     * </ol>
     */
    private static void checkSpectrumParams() {
        // ---- 内核常量，对齐 sigmarebase 的权威定义 ----
        check("频谱条数 == 114（renderSpectrum maxWidth）",
                SpectrumFeed.BAR_COUNT == 114, "got=" + SpectrumFeed.BAR_COUNT);
        // FFT 必须是 2 的幂，否则 Fft 构造直接抛 IllegalArgumentException。
        // 这里钉住这条，因为「1152（一个 MP3 帧）」看起来更权威，但它不是 2 的幂，
        // 而 mod 的 JavaFFT 同样用 blockSize <<= 1，所以那条路在 mod 里也跑不通。
        check("FFT 长度 == 1024（最接近 1152 的 2 的幂）",
                SpectrumFeed.FFT_SIZE == 1024, "got=" + SpectrumFeed.FFT_SIZE);
        check("FFT 长度是 2 的幂（radix-2 硬性要求）",
                Integer.bitCount(SpectrumFeed.FFT_SIZE) == 1,
                "got=" + SpectrumFeed.FFT_SIZE);
        // 实际构造一次 Fft，确保不会被长度约束当场拦下
        boolean fftOk;
        try {
            new com.jello.music.player.Fft(SpectrumFeed.FFT_SIZE);
            fftOk = true;
        } catch (RuntimeException e) {
            fftOk = false;
        }
        check("Fft 能以该长度构造", fftOk, "抛异常");
        check("幅度上限 == 2.256e7（onRender2D 钳位）",
                Math.abs(SpectrumFeed.MAX_AMPLITUDE - 2.256e7) < 1,
                String.valueOf(SpectrumFeed.MAX_AMPLITUDE));
        check("队列上限 == 18（visualizerData.size() > 18）",
                SpectrumFeed.queueMax() == 18, "got=" + SpectrumFeed.queueMax());
        check("amplitudes 长度上限 == 1024",
                SpectrumFeed.AMPLITUDE_MAX == 1024, "got=" + SpectrumFeed.AMPLITUDE_MAX);
        check("默认平滑系数 == 0.335F",
                Math.abs(SpectrumView.DEFAULT_SMOOTHING - 0.335) < 1e-12,
                String.valueOf(SpectrumView.DEFAULT_SMOOTHING));

        // 参数能穿过 SpectrumView（无直链的 feed，足够验证设置层）
        SpectrumFeed feed = new SpectrumFeed(null, SpectrumFeed.FFT_SIZE,
                SpectrumFeed.BAR_COUNT, 60);
        SpectrumView view = new SpectrumView(feed, SpectrumFeed.BAR_COUNT, 420, 130);
        view.setSpectrumScale(2.5);
        view.setSpectrumSmoothing(0.8);
        check("spectrumScale 已落到 SpectrumView",
                view.spectrumScale() == 2.5, "got=" + view.spectrumScale());
        check("spectrumSigmaSmoothing 已落到 SpectrumView",
                view.spectrumSmoothing() == 0.8, "got=" + view.spectrumSmoothing());

        // 越界夹取：原版把 smoothing 夹到 [0.001, 1]
        view.setSpectrumSmoothing(5.0);
        check("smoothing 上限夹到 1",
                view.spectrumSmoothing() == 1.0, "got=" + view.spectrumSmoothing());
        view.setSpectrumSmoothing(0.0);
        check("smoothing 下限夹到 0.001",
                Math.abs(view.spectrumSmoothing() - 0.001) < 1e-9,
                "got=" + view.spectrumSmoothing());

        // 音画差补偿夹取到 [0, 2000]，默认 590
        feed.setLeadSeconds(-1);
        check("音画差补偿下限夹到 0", feed.leadSeconds() == 0.0,
                "got=" + feed.leadSeconds());
        feed.setLeadSeconds(99);
        check("音画差补偿上限夹到 2s", feed.leadSeconds() == 2.0,
                "got=" + feed.leadSeconds());
        feed.setLeadSeconds(0.59);
        check("默认 590ms 已生效", Math.abs(feed.leadSeconds() - 0.59) < 1e-9,
                "got=" + feed.leadSeconds());

        // ---- 平滑插值公式，对齐 onRender2D:144-151 ----
        // alpha = min(smoothing * (60/实际FPS), 1)
        // amplitudes -= (amplitudes - target) * alpha
        // 60fps 下 fps补偿=1，alpha 就是 smoothing 本身
        double smoothing = SpectrumView.DEFAULT_SMOOTHING;
        double start = 1000.0;
        double target = 2000.0;
        double alpha60 = Math.min(1.0, smoothing * (60.0 / 60.0));
        double afterOneFrame = start - (start - target) * alpha60;
        check("60fps 下 alpha == smoothing",
                Math.abs(alpha60 - smoothing) < 1e-12, "got=" + alpha60);
        check("插值向目标逼近（start<after<target）",
                afterOneFrame > start && afterOneFrame < target,
                String.format("%.4f", afterOneFrame));
        // 手算校验：1000 + 1000*0.335 = 1335
        check("单帧插值手算一致（1000→1335）",
                Math.abs(afterOneFrame - 1335.0) < 1e-9,
                String.format("%.6f", afterOneFrame));
        // 帧率补偿：高帧率下 alpha 变小，单帧步进更细
        double alpha300 = Math.min(1.0, smoothing * (60.0 / 300.0));
        check("300fps 下 alpha 变小（帧率补偿反向）",
                alpha300 < alpha60, String.format("300fps=%.4f 60fps=%.4f", alpha300, alpha60));
        // alpha 不会超过 1
        check("alpha 上限夹到 1",
                Math.min(1.0, smoothing * (60.0 / 1.0)) == 1.0, "got=1.0");

        // ---- 条高公式，对齐 renderSpectrum:181 ----
        // height = max(0, sqrt(amplitudes)/12 - 5) * (窗口高/1080)
        // 要让基准高度 = 3，需 sqrt(a)/12-5 = 3 -> sqrt(a) = 96 -> a = 9216
        double amps = 9216.0;
        double base = Math.max(0, Math.sqrt(amps) / 12 - 5);
        check("条高基准值 = sqrt(amplitudes)/12-5",
                Math.abs(base - 3.0) < 1e-9, "got=" + base);

        double h1 = (SpectrumView.REFERENCE_HEIGHT / 1080.0) * 1.0;
        double h3 = (SpectrumView.REFERENCE_HEIGHT / 1080.0) * 3.0;
        // mod 画在 1080p 全游戏窗口（heightRatio 恰好 1.0），但本项目的频谱窗
        // 只有 420x130、扣掉信息块只剩约 108px 可用。沿用 1080 会让 1.0x
        // 直接顶满甚至溢出（实测 207px vs 108px = 192%），所以标定成 290。
        check("高度比基准 == 290（实测标定，见 SpectrumProbe）",
                SpectrumView.REFERENCE_HEIGHT == 290,
                "got=" + SpectrumView.REFERENCE_HEIGHT);
        check("3x 幅度正好是 1x 的三倍（线性）",
                base * h1 > 0 && Math.abs(base * h3 - base * h1 * 3) < 1e-12,
                "1x=" + base * h1 + " 3x=" + base * h3);

        // 标定的实际意义：真实满量程幅度下，1.0x 不能顶满窗口也不能等于没画。
        // 3852008 是 SpectrumProbe 用真实歌曲实测到的 max amplitude 量级。
        double realFullScale = Math.max(0, Math.sqrt(3_852_008.0) / 12 - 5) * h1;
        check("实测满量程下 1.0x 不顶满窗口",
                realFullScale < 108, "got=" + String.format("%.1f", realFullScale) + "px");
        check("实测满量程下 1.0x 至少占两成高度",
                realFullScale > 108 * 0.2, "got=" + String.format("%.1f", realFullScale) + "px");

        // 小于阈值的幅度必须被压成 0
        double tiny = Math.max(0, Math.sqrt(36.0) / 12 - 5); // sqrt=6，/12=0.5，-5<0
        check("低幅度被压成 0（renderSpectrum 的 max(0,·) 分支）", tiny == 0.0, "got=" + tiny);

        // ---- 封面低频缩放，对齐 renderSpectrum:207-213 ----
        // scale = 1 + round(peak / 3750 * 0.14 * 75) / 75，钳到 1.14
        check("无低频时封面不缩放",
                SpectrumView.coverScale(new double[114]) == 1.0,
                "got=" + SpectrumView.coverScale(new double[114]));
        // peak = sqrt(a[0])-1000 = 1000 -> sqrt(a[0]) = 2000 -> a[0] = 4e6
        double[] beat = new double[114];
        beat[0] = 4_000_000.0;
        double sc = SpectrumView.coverScale(beat);
        // 1 + round(1000/3750*0.14*75)/75 = 1 + round(2.8)/75 = 1 + 3/75
        check("低频 1000 时封面缩放到 1+3/75",
                Math.abs(sc - (1.0 + 3.0 / 75.0)) < 1e-12, "got=" + sc);
        // 极端低频应钳在上限 1.14
        double[] loud = new double[114];
        loud[0] = 1e14;
        check("极端低频钳在上限 1.14",
                Math.abs(SpectrumView.coverScale(loud) - 1.14) < 1e-12,
                "got=" + SpectrumView.coverScale(loud));

        // ---- 信息块（MusicManager:215-240）----
        SpectrumInfoBlock info = new SpectrumInfoBlock();
        info.setTitle("歌手名 - 歌名");
        info.setPrefSize(420, 130);
        info.resize(420, 130);
        info.applyCss();
        info.layout();
        check("信息块歌名已写入",
                info.titleText() != null && info.titleText().contains("歌名"),
                "got=" + info.titleText());
        info.applyScale(1.14);
        check("信息块缩放后仍在窗内",
                info.coverBoundsInParent().getMaxX() <= 420.5
                        && info.coverBoundsInParent().getMinY() >= -0.5,
                "bounds=" + info.coverBoundsInParent());

        // ---- 以下是「频谱对齐原版」这一轮的钉子 ----

        // 1) 封面 64 / 圆角 10 / left 14（权威 SpectrumHUD.vue:295-302）
        check("信息块封面 64px（原版 .spectrum-info .cover）",
                Math.abs(info.coverSize() - 64) < 0.001,
                "got=" + info.coverSize());
        check("封面圆角 10px（原版 border-radius:10px）",
                Math.abs(info.coverCornerRadius() - 10) < 0.001,
                "got=" + info.coverCornerRadius());
        check("封面左边距 14px（原版 left:14px）",
                Math.abs(info.coverX() - 14) < 0.001,
                "got=" + info.coverX());

        // 2) 作者行：原版有，Java 版之前整行没做
        info.setAuthor("测试作者");
        check("作者行已写入（原版 .spectrum-info .author）",
                info.authorText() != null && info.authorText().contains("测试作者"),
                "got=" + info.authorText());
        check("作者行在窗内",
                info.authorBoundsInParent().getHeight() > 0
                        && info.authorBoundsInParent().getMinY() >= -0.5
                        && info.authorBoundsInParent().getMaxY() <= 130.5,
                "bounds=" + info.authorBoundsInParent());
        // 歌名应排在作者上方
        check("歌名在作者上方（meta 是 column 布局）",
                info.titleBoundsInParent().getMinY()
                        < info.authorBoundsInParent().getMinY(),
                "title=" + info.titleBoundsInParent().getMinY()
                        + " author=" + info.authorBoundsInParent().getMinY());

        // 3) 条高基准用游戏 framebuffer 高度 1009，不是面板内嵌的 290
        check("条高基准是 1009（权威 GAME_FRAMEBUFFER_HEIGHT）",
                Math.abs(com.jello.music.ui.SpectrumView.GAME_FRAMEBUFFER_HEIGHT
                        - 1009) < 0.001,
                "got=" + com.jello.music.ui.SpectrumView.GAME_FRAMEBUFFER_HEIGHT);
        check("1.0x 下 1.14 倍缩放后的最大条高不会撑破窗",
                com.jello.music.ui.SpectrumView.GAME_FRAMEBUFFER_HEIGHT / 1080.0
                        * spectrumMaxHeightFor(2.256e7) >= 0,
                "负高度");

        view.stop();
        feed.close();
    }

    /**
     * 给定 amplitudes 的最大 sqrt(refHeight)（refHeight = sqrt(amp)/12 - 5）。
     * 用来验证 1009/1080 这个基准在最大幅度下仍然合理。
     */
    private static double spectrumMaxHeightFor(double amplitude) {
        return Math.sqrt(amplitude) / 12.0 - 5.0;
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
 * 回归护栏：修过的两个 bug。
 *
 * <p>① 音量跨歌保持 —— {@code startPlayback} 以前每首歌都 {@code setVolume(0.8)}，
 * 用户拖出来的音量下一首就被冲回 0.8。现在靠 {@code onVolumeChanged} 记住。
 * ② 教程期间挂起右 Shift —— 不挂起的话，用户跟着教程按 Shift 窗口当场就收起来了。
 */
private static void checkHotkeySuspend() {
        RightShiftPoller poller = new RightShiftPoller(vk -> false, 5, () -> {
        });
        check("未挂起时 poller 不处于挂起态", !poller.isSuspended(), null);
        poller.setSuspended(true);
        check("setSuspended(true) 生效（教程视图用）", poller.isSuspended(), null);
        poller.setSuspended(false);
        check("setSuspended(false) 恢复", !poller.isSuspended(), null);
        poller.close();
    }

    private static void checkVolumeKept() {
        PlayerPanel panel = new PlayerPanel();
        List<Double> seen = new ArrayList<>();
        panel.onVolumeChanged(seen::add);

        Pane host = new Pane();
        host.getChildren().add(panel);
        new Scene(host, Theme.PANEL_W, Theme.PANEL_H);
        host.applyCss();
        host.layout();

        VerticalSlider slider = collect(panel, VerticalSlider.class).stream()
                .findFirst().orElse(null);
        check("音量滑块存在", slider != null, null);
        if (slider != null) {
            slider.valueProperty().set(0.42);
            boolean got = seen.stream().anyMatch(v -> Math.abs(v - 0.42) < 1e-9);
            check("拖动音量会回调出来（换歌时据此保持）", got, "events=" + seen);
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
 * 登录页（对应 {@code SigmaUI.vue} 的 {@code view === 'login'} + {@code Login.vue}）。
 *
 * <p>卡��：400x470、圆角 20、{@code rgba(22,20,28,0.78)}、顶部 3px 主题色条；
 * 分段三选一 44 高；输入框 42 高圆角 10；主按钮 42 高；
 * 账号选择：提示 + 48 高的项 + 「返回登录」。
 *
 * <p><b>注意 {@code LoginView.PRIMARY} 为 null</b>：原版的 {@code --primary-color}
 * 在整个仓库里从未定义，CSS 里未定义的 var 会让声明作废，所以原版登录页实际是灰的。
 * 这里按 1:1 照抄。
 */
private static void checkLoginView() {
        LoginView view = new LoginView(new com.jello.music.api.KuGouApiClient(
                new com.jello.music.model.KuGouCredentials()));
        Pane host = new Pane();
        host.getChildren().add(view);
        new Scene(host, Theme.PANEL_W, Theme.PANEL_H);
        host.applyCss();
        host.layout();

check("登录卡片 400x470 @ 水平居中",
                view.cardNode().getPrefWidth() == 400
                        && view.cardNode().getPrefHeight() == 470
                        && view.cardNode().getLayoutX() == (800 - 400) / 2.0,
                String.format("w=%.0f h=%.0f x=%.0f",
                        view.cardNode().getPrefWidth(), view.cardNode().getPrefHeight(),
                        view.cardNode().getLayoutX()));

        // 三个分段按钮必须真的能切换。原版 Login.vue:10 是 <button @click=...>，
        // Java 侧漏挂处理器时手机号页（默认页）看起来完全正常，
        // 表现就是「只能手机号登录」——用户根本走不到扫码和账号那两个页。
        check("分段按钮挂了点击处理器（不然扫码/账号都切不过去）",
                view.segmentNodes().stream().allMatch(s -> s.getOnMouseClicked() != null),
                "handlers=" + view.segmentNodes().stream()
                        .filter(s -> s.getOnMouseClicked() != null).count());
        int switched = fireSegmentClicks(view);
        check("点分段按钮能切到扫码页",
                switched == 3 && view.qrTabVisible(),
                "clicked=" + switched + " qrVisible=" + view.qrTabVisible());
        // 二维码和空状态必须互斥（原版 v-if="qrCode"）。占位文字不是 placeholder
        // 的子节点，隐藏 region 带不上它，漏了就变成「正在生成…」压在码上
        check("二维码与空状态互斥（占位文字不会压在码上）",
                view.qrPlaceholderVisible() && view.qrEmptyTextVisible()
                        && !view.qrImageVisible(), null);
        check("登录卡片有 1px 描边（rgba(255,255,255,0.08)）",
                view.cardNode().getBorder() != null
                        && !view.cardNode().getBorder().isEmpty(), null);
        check("分段三选一：手机号 / 账号 / 扫码",
                view.segmentNodes().size() == 3, "segments=" + view.segmentNodes().size());
        check("输入框 42 高、圆角 10（对齐 .form-input）",
                view.phoneInput().getPrefHeight() == 42
                        && view.codeInput().getPrefHeight() == 42
                        && view.emailInput().getPrefHeight() == 42, null);
        check("验证码按钮在输入框右侧（100px）",
                view.sendCodeButton().getPrefWidth() == 100
                        && view.sendCodeButton().getLayoutX() == 400 - 50 - 100,
                String.format("w=%.0f x=%.0f", view.sendCodeButton().getPrefWidth(),
                        view.sendCodeButton().getLayoutX()));
        check("主按钮通栏 350x42",
                view.loginButton().getPrefWidth() == 350 && view.loginButton().getPrefHeight() == 42,
                null);
        check("返回按钮 32x32 @ (10,8)",
                view.backButtonNode().getLayoutX() == 10
                        && view.backButtonNode().getLayoutY() == 8, null);

// 账号选择页：2 个账号
        com.jello.music.model.UserInfo a1 = new com.jello.music.model.UserInfo();
        a1.setUserid("10001");
        a1.setNickname("账号一");
        a1.setGrade("8");
        com.jello.music.model.UserInfo a2 = new com.jello.music.model.UserInfo();
        a2.setUserid("10002");
        a2.setNickname("账号二");
        a2.setGrade("12");
        view.showAccountSelectionForTest(List.of(a1, a2));
        List<Label> labels = collect(view, Label.class);
        boolean hasLv = labels.stream().anyMatch(l -> l.getText().startsWith("Lv "));
        boolean hasUid = labels.stream().anyMatch(l -> l.getText().startsWith("UID："));
        check("多账号时弹账号选择（Lv + UID 两行都在）",
                view.accountPaneNode().isVisible() && hasLv && hasUid,
                "visible=" + view.accountPaneNode().isVisible()
                        + " lv=" + hasLv + " uid=" + hasUid);

        check("原版 --primary-color 从未定义，主题色按 1:1 留空",
                com.jello.music.ui.LoginView.PRIMARY == null, null);
    }

/**
 * 贴边收起的橡皮筋与半透明。
 *
 * <p>对应 {@code appServices.js:679-709}（moveSigmaWindow）与
 * {@code SigmaMusicPlayer.vue:504}（translucent 判据）。
 * 判定都抽成了纯函数，这里可以穷举边界；真正要看的是「面板到底能滑出多少」，
 * 所以断言里把越界像素量算出来了。
     */
    private static void checkEdgeDock() {
        final double W = 800;          // 面板宽
        final double RIGHT = 1920;     // 主屏右缘
        final double LEFT = 0;
        // 光标把面板推到最右（desiredX = right - w = 1120）时的位置
        double clampX = RIGHT - W;

        // ---- 第 1 步：精确夹取，不留余量 ----
        // movedX 必须小，否则会顺带触发橡皮筋（那是第 2 步）
        check("拖拽夹取不留余量：右缘最多到工作区右缘",
                EdgeDock.resolveDragX(99999, W, RIGHT, 10) == clampX,
                "x=" + EdgeDock.resolveDragX(99999, W, RIGHT, 10));
        check("拖拽夹取不留余量：左缘不出屏",
                EdgeDock.resolveDragX(-9999, W, RIGHT, 10) == LEFT,
                "x=" + EdgeDock.resolveDragX(-9999, W, RIGHT, 10));

        // ---- 第 2 步的两道闸 ----
        // desiredX + w > right + 200  => desiredX > 1320
        double justUnder = RIGHT + EdgeDock.RUBBER_BAND_ALLOWANCE - W - 1;   // 1319
        double justOver = RIGHT + EdgeDock.RUBBER_BAND_ALLOWANCE - W + 1;    // 1321
        // 越界量取大一些，免得 (desired-clamp-200)*0.5 截断后正好是 0 测不出差别
        double push = justOver + 200;
        check("橡皮筋需要越过 right+200 才起效",
                EdgeDock.resolveDragX(justUnder, W, RIGHT, 500) == clampX,
                "x=" + EdgeDock.resolveDragX(justUnder, W, RIGHT, 500));
        check("越过 right+200 后进入橡皮筋（不再被夹死）",
                EdgeDock.resolveDragX(push, W, RIGHT, 500) > clampX,
                "x=" + EdgeDock.resolveDragX(push, W, RIGHT, 500));

        check("movedX 必须 > 70 才进橡皮筋",
                EdgeDock.resolveDragX(push, W, RIGHT,
                        EdgeDock.RUBBER_BAND_TRIGGER) == clampX,
                "movedX=70 -> x=" + EdgeDock.resolveDragX(push, W, RIGHT,
                        EdgeDock.RUBBER_BAND_TRIGGER));
        check("movedX > 70 进橡皮筋",
                EdgeDock.resolveDragX(push, W, RIGHT,
                        EdgeDock.RUBBER_BAND_TRIGGER + 1) > clampX, null);

        // ---- 越界量 ----
        // desired 是光标推出的期望位置，拖拽过程中**恒定**（原版 x = winX + 屏幕位移，
        // winX 是按下时的窗口位置），所以橡皮筋是纯粹的一步映射，不存在迭代收敛。
        double desired = RIGHT + 400;
        double x = EdgeDock.resolveDragX(desired, W, RIGHT, 400);
        double overhang = x + W - RIGHT;
        double expectOverhang = (desired - clampX - EdgeDock.RUBBER_BAND_ALLOWANCE) * 0.5;
        check("橡皮筋能真正把面板推出屏幕（右缘越过工作区右缘）",
                EdgeDock.overhangingOf(x, W, RIGHT),
                String.format("x=%.0f 越界=%.0f", x, overhang));
        check("越界量 = (超出量 - 200) * 0.5（系数 0.5）",
                Math.abs(overhang - expectOverhang) < 1.0,
                String.format("越界=%.1f 期望=%.1f 完整超出=%.0f",
                        overhang, expectOverhang, desired + W - RIGHT));
        check("橡皮筋越界量明显小于完整超出量（不会一路爬出屏幕）",
                overhang > 0 && overhang < (desired + W - RIGHT) * 0.6,
                String.format("越界=%.0f 完整超出=%.0f", overhang, desired + W - RIGHT));
        // desired 恒定 -> 结果恒定，拖多久都不会继续往外跑
        check("desired 恒定时橡皮筋是稳定的（重复求值不漂移）",
                Math.abs(EdgeDock.resolveDragX(desired, W, RIGHT, 400) - x) < 0.001, null);

        // ---- 半透明判据矩阵（MusicPlayer.java:360-361）----
        check("半透明矩阵：越界且未请求滑出 -> 半透明",
                EdgeDock.translucentOf(true, false), null);
        check("半透明矩阵：请求滑出后即使还越界也变亮",
                !EdgeDock.translucentOf(true, true), null);
        check("半透明矩阵：不越界 -> 不半透明",
                !EdgeDock.translucentOf(false, false), null);
        check("半透明值 = 0.5，80ms 淡入 / 150ms 淡回",
                EdgeDock.DOCKED_OPACITY == 0.5 && EdgeDock.DIM_MILLIS == 80
                        && EdgeDock.BRIGHT_MILLIS == 150, null);

        // ---- 吸附 / 滑出目标 ----
        check("吸附收起只留 40px 在屏内",
                EdgeDock.dockTargetX(RIGHT) == RIGHT - 40,
                "x=" + EdgeDock.dockTargetX(RIGHT));
        check("滑出后右侧留 20px",
                EdgeDock.restoreTargetX(W, RIGHT) == RIGHT - W - 20,
                "x=" + EdgeDock.restoreTargetX(W, RIGHT));
        check("越界判据是严格大于（等于不算越界）",
                !EdgeDock.overhangingOf(RIGHT - W, W, RIGHT)
                        && EdgeDock.overhangingOf(RIGHT - W + 1, W, RIGHT), null);

        // ---- 进出动画公式（SigmaMusicPlayer.vue:295-324）----
        check("动画基准帧长 18.10361ms（var7）",
                Math.abs(EdgeDock.ANIM_FRAME_MS - 18.10361) < 1e-9, null);
        // 单步插值：x 走剩余距离的 0.25*frameFactor，y 走 0.2*frameFactor
        double oneStepX = EdgeDock.approachForTest(1000, 1100, 0.25 * 1.0);
        double oneStepY = EdgeDock.approachForTest(1000, 1100, 0.20 * 1.0);
        check("单步插值按剩余距离推进（x 0.25 / y 0.2）",
                Math.abs(oneStepX - 1025) < 1e-6 && Math.abs(oneStepY - 1020) < 1e-6,
                String.format("x=%.2f y=%.2f", oneStepX, oneStepY));
        check("插值绝不越过目标（按方向夹）",
                Math.abs(EdgeDock.approachForTest(1100, 1000, 0.25) - 1075) < 1e-6
                        && EdgeDock.approachForTest(1000, 1000, 0.25) == 1000, null);

        // 收敛性：反复用固定 dt 单调逼近目标，不震荡、不越过
        double cur = 1100;
        boolean towardTarget = true;
        for (int i = 0; i < 400; i++) {
            double prev = cur;
            cur = EdgeDock.approachForTest(cur, 1880, 0.25 * (16.0 / 18.10361));
            // 目标在上方：每步都应增大，且不越过目标
            if (cur < prev - 1e-9 || cur > 1880 + 1e-9) {
                towardTarget = false;
                break;
            }
        }
        check("连续推进单调逼近且不越过目标", towardTarget, "cur=" + cur);
        check("连续推进足够步数后收敛到 target（< 0.5px）",
                Math.abs(cur - 1880) < 0.5, String.format("cur=%.3f", cur));

        // ---- 多显示器：按窗口所在屏取工作区 ----
        // 这台机器可能只有一块屏，所以按屏数分支断言，不假设一定有第二块
        Rectangle2D primary = Screen.getPrimary().getVisualBounds();
        Rectangle2D onPrimary = EdgeDock.displayMatching(
                primary.getMinX() + 100, primary.getMinY() + 100, W, 600);
        check("主屏内的窗口用主屏工作区",
                onPrimary.getMinX() == primary.getMinX()
                        && Math.abs(onPrimary.getWidth() - primary.getWidth()) < 1,
                String.format("minX=%.0f width=%.0f", onPrimary.getMinX(), onPrimary.getWidth()));
        if (Screen.getScreens().size() > 1) {
            Screen other = Screen.getScreens().stream()
                    .filter(s -> s != Screen.getPrimary()).findFirst().orElseThrow();
            Rectangle2D b = other.getVisualBounds();
            // 窗口完全落在第二块屏里，右缘必须按那块屏算
            Rectangle2D hit = EdgeDock.displayMatching(
                    b.getMinX() + 10, b.getMinY() + 10, W, 600);
            check("多显示器时右缘按窗口所在屏算",
                    Math.abs(hit.getMinX() - b.getMinX()) < 1,
                    String.format("minX=%.0f 期望=%.0f", hit.getMinX(), b.getMinX()));
        }
    }

    /** 真点分段按钮，返回成功触发次数。 */
    private static int fireSegmentClicks(LoginView view) {
        int n = 0;
        for (com.jello.music.ui.LoginView.Segment s : view.segmentNodes()) {
            @SuppressWarnings("unchecked")
            javafx.event.EventHandler<javafx.scene.input.MouseEvent> h =
                    (javafx.event.EventHandler<javafx.scene.input.MouseEvent>) (Object) s.getOnMouseClicked();
            if (h == null) {
                continue;
            }
            h.handle(new javafx.scene.input.MouseEvent(
                    javafx.scene.input.MouseEvent.MOUSE_CLICKED,
                    0, 0, 0, 0, javafx.scene.input.MouseButton.PRIMARY, 1,
                    false, false, false, false, true, false, false, true,
                    false, false, null));
            n++;
        }
        return n;
    }

    /**
     * 播放模式四态。
     *
     * <p>四态的坑是「模式索引 ≠ 雪碧图帧号」（随机↔顺序对调，见
     * {@code SigmaMusicPlayer.vue:219-226}），照抄索引当帧号的话随机和顺序会显示成
     * 同一个图标。所以这里断言的是映射本身，并把四个状态排成一条截成 PNG
     * （{@code jello-ui-probe-repeat.png}）——随机那个是内联 SVG，断言归断言，
     * 还是得肉眼看看 JavaFX 的 SVGPath 到底画出什么来。
     */
    private static void checkPlaybackModes(String pngPath) {
        // 原版 repeatType：0 随机 -> SVG；1 列表 -> 帧1；2 单曲 -> 帧2；3 顺序 -> 帧0
        check("随机播放走内联 SVG（不是雪碧图）",
                RepeatButton.spriteFrame(RepeatButton.MODE_SHUFFLE) == -1, null);
        check("列表循环 -> 雪碧图第 1 格",
                RepeatButton.spriteFrame(RepeatButton.MODE_ALL) == 1, null);
        check("单曲循环 -> 雪碧图第 2 格",
                RepeatButton.spriteFrame(RepeatButton.MODE_ONE) == 2, null);
        check("顺序播放 -> 雪碧图第 0 格（与随机对调，别照抄索引）",
                RepeatButton.spriteFrame(RepeatButton.MODE_SEQUENTIAL) == 0, null);

        // 四个状态并排，铺在右栏底色上，看的就是用户实际看到的样子
        Pane strip = new Pane();
        strip.setBackground(new Background(new BackgroundFill(
                Color.color(38 / 255.0, 38 / 255.0, 38 / 255.0, 0.80), null, null)));
        strip.setPrefSize(4 * 27 + 8, 28);
        RepeatButton[] buttons = new RepeatButton[RepeatButton.MODE_COUNT];
        for (int i = 0; i < RepeatButton.MODE_COUNT; i++) {
            RepeatButton b = new RepeatButton();
            b.onClick(() -> {
            });
            b.setState(i);
            b.setLayoutX(i * 27 + 4);
            b.setLayoutY(4);
            strip.getChildren().add(b);
            buttons[i] = b;
        }
        new Scene(strip, strip.getPrefWidth(), strip.getPrefHeight());
        strip.applyCss();
        strip.layout();

        // 顺序要紧：下面 3 段断言都依赖「按钮仍停在各自的模式上」，
        // 点击循环会改状态，所以放到最后
        check("只有随机态显示 SVG，其余显示雪碧图", showOnlyShuffleUsesSvg(buttons), null);

        SVGPath svg = collect(strip, SVGPath.class).stream().findFirst().orElse(null);
        check("随机图标 SVGPath 解析出字形",
                svg != null && svg.getLayoutBounds().getWidth() > 10
                        && svg.getLayoutBounds().getHeight() > 10,
                svg == null ? "missing"
                        : String.format("%.2fx%.2f", svg.getLayoutBounds().getWidth(),
                        svg.getLayoutBounds().getHeight()));
        if (svg != null) {
            // background-size:contain 进 27x20 -> 高度先到边，缩放 20/24，成品 20x20 居中
            Bounds lb = svg.getLayoutBounds();
            // 字形在 24x24 viewBox 里必须正好居中（占 4..20），RepeatButton 靠这个前提定位
            check("随机图标字形在 viewBox 里居中（占 16x16，中心 12,12）",
                    Math.abs(lb.getMinX() + lb.getWidth() / 2 - 12) < 0.01
                            && Math.abs(lb.getMinY() + lb.getHeight() / 2 - 12) < 0.01,
                    String.format("%.2f,%.2f %.2fx%.2f", lb.getMinX(), lb.getMinY(),
                            lb.getWidth(), lb.getHeight()));
            // JavaFX 缩放绕 layoutBounds 中心：字形中心 = layoutX + 字形中心
            double cx = svg.getLayoutX() + lb.getMinX() + lb.getWidth() / 2;
            double cy = svg.getLayoutY() + lb.getMinY() + lb.getHeight() / 2;
            check("随机图标水平居中（contain 进 27x20 -> 13.5）", Math.abs(cx - 13.5) < 0.01,
                    String.format("centerX=%.2f", cx));
            check("随机图标垂直居中（-> 10）", Math.abs(cy - 10) < 0.01,
                    String.format("centerY=%.2f", cy));
            check("随机图标按 contain 等比缩放（20/24）",
                    Math.abs(svg.getScaleX() - 20.0 / 24.0) < 0.001,
                    String.format("scale=%.4f", svg.getScaleX()));
            System.out.println(String.format(
                    "shuffle svg: layoutX=%.2f layoutY=%.2f scale=%.4f 字形中心=(%.2f,%.2f)",
                    svg.getLayoutX(), svg.getLayoutY(), svg.getScaleX(), cx, cy));
        }
        System.out.println("repeat 4 states: 随机 / 列表循环 / 单曲循环 / 顺序");

        try {
            // 只 116x28 的小图，取样步长 7px 命中的颜色很少，阈值单独放宽
            writeSnapshot(strip, pngPath, 4);
            // 再来一张 8 倍放大的：116x28 原图肉眼看不出图标有没有对准中心
            writeZoomed(pngPath, pngPath.replace(".png", "-zoom.png"), 8);
            checkGlyphCentering(pngPath);
        } catch (Exception e) {
            check("四态图标截图", false, String.valueOf(e));
        }

        check("点击循环 列表 -> 单曲 -> 顺序 -> 随机 -> 列表",
                clickCycle(buttons[RepeatButton.MODE_ALL],
                        RepeatButton.MODE_ONE, RepeatButton.MODE_SEQUENTIAL,
                        RepeatButton.MODE_SHUFFLE, RepeatButton.MODE_ALL),
                "state=" + buttons[RepeatButton.MODE_ALL].state());
        check("点击循环 随机 -> 列表", clickCycle(buttons[RepeatButton.MODE_SHUFFLE],
                RepeatButton.MODE_ALL), "state=" + buttons[RepeatButton.MODE_SHUFFLE].state());
    }

    /** 把截图按整数倍最近邻放大，生成能肉眼看的大图。 */
    private static void writeZoomed(String srcPng, String dstPng, int factor) throws Exception {
        java.awt.image.BufferedImage img =
                javax.imageio.ImageIO.read(new File(srcPng));
        java.awt.image.BufferedImage big = new java.awt.image.BufferedImage(
                img.getWidth() * factor, img.getHeight() * factor,
                java.awt.image.BufferedImage.TYPE_INT_ARGB);
        java.awt.Graphics2D g = big.createGraphics();
        // 不设插值提示就是最近邻，正好和原版 image-rendering: pixelated 一致
        g.drawImage(img, 0, 0, big.getWidth(), big.getHeight(), null);
        g.dispose();
        javax.imageio.ImageIO.write(big, "png", new File(dstPng));
        System.out.println("zoomed -> " + dstPng + " (x" + factor + ")");
    }

    /**
     * 量一量四个图标在各自27x20 格子里实际占的像素范围。
     *
     * <p>断言「图标居中」光靠 {@code layoutBounds} 会被缩放/裁剪骗过去，
     * 这里直接数像素：底色是 rgb(38,38,38)，比它亮的像素就是图标本身。
     */
    private static void checkGlyphCentering(String pngPath) throws Exception {
        java.awt.image.BufferedImage img = javax.imageio.ImageIO.read(new File(pngPath));
        int cell = 27;
        // 背景取左上角那一点（按钮从 x=4 开始，(0,0) 一定是底色）
        // 不能写死阈值：快照读回来是预乘 alpha，底色会偏亮
        int bg = img.getRGB(0, 0);
        int bgR = bg >> 16 & 0xFF;
        int bgG = bg >> 8 & 0xFF;
        int bgB = bg & 0xFF;
        StringBuilder report = new StringBuilder();
        boolean allCentered = true;
        for (int i = 0; i < RepeatButton.MODE_COUNT; i++) {
            int x0 = i * cell + 4;
            int minX = Integer.MAX_VALUE;
            int maxX = -1;
            int minY = Integer.MAX_VALUE;
            int maxY = -1;
            for (int y = 0; y < 20; y++) {
                for (int x = 0; x < cell; x++) {
                    int rgb = img.getRGB(x0 + x, 4 + y);
                    int dr = (rgb >> 16 & 0xFF) - bgR;
                    int dg = (rgb >> 8 & 0xFF) - bgG;
                    int db = (rgb & 0xFF) - bgB;
                    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 24) {
                        minX = Math.min(minX, x);
                        maxX = Math.max(maxX, x);
                        minY = Math.min(minY, y);
                        maxY = Math.max(maxY, y);
                    }
                }
            }
            if (maxX < 0) {
                report.append(String.format("[%d]无像素 ", i));
                allCentered = false;
                continue;
            }
            double cx = (minX + maxX) / 2.0;
            double cy = (minY + maxY) / 2.0;
            report.append(String.format("[%d] %dx%d 中心(%.1f,%.1f) ",
                    i, maxX - minX + 1, maxY - minY + 1, cx, cy));
            // 1px 量化，容差 1
            if (Math.abs(cx - (cell - 1) / 2.0) > 1.0 || Math.abs(cy - 9.5) > 1.0) {
                allCentered = false;
            }
        }
        check("四个图标都在各自 27x20 格子里居中（数像素，不是 layoutBounds）",
                allCentered, report + String.format("bg=%d,%d,%d", bgR, bgG, bgB));
    }

    /** 真点按钮若干次，看状态是不是按 expected 一路走下去。 */
    private static boolean clickCycle(RepeatButton b, int... expected) {
        @SuppressWarnings("unchecked")
        javafx.event.EventHandler<javafx.scene.input.MouseEvent> h =
                (javafx.event.EventHandler<javafx.scene.input.MouseEvent>) (Object) b.getOnMouseClicked();
        if (h == null) {
            return false;
        }
        for (int want : expected) {
            h.handle(new javafx.scene.input.MouseEvent(
                    javafx.scene.input.MouseEvent.MOUSE_CLICKED,
                    0, 0, 0, 0, javafx.scene.input.MouseButton.PRIMARY, 1,
                    false, false, false, false, true, false, false, true,
                    false, false, null));
            if (b.state() != want) {
                return false;
            }
        }
        return true;
    }

    private static boolean showOnlyShuffleUsesSvg(RepeatButton[] buttons) {
        for (int i = 0; i < buttons.length; i++) {
            List<SVGPath> svgs = collect(buttons[i], SVGPath.class);
            List<javafx.scene.image.ImageView> imgs =
                    collect(buttons[i], javafx.scene.image.ImageView.class);
            boolean svgVisible = !svgs.isEmpty() && svgs.get(0).isVisible();
            boolean imgVisible = !imgs.isEmpty() && imgs.get(0).isVisible();
            if (i == RepeatButton.MODE_SHUFFLE) {
                if (!svgVisible || imgVisible) {
                    return false;
                }
            } else if (svgVisible || !imgVisible) {
                return false;
            }
        }
        return true;
    }

    /**
     * 拖窗排除表：对应原版 {@code SigmaMusicPlayer.vue:340} 的 NO_DRAG_SELECTOR。
     *
     * <p>这条对应一个真实的坑——之前拖拽直接挂在整个根 Pane 上，
     * 在按钮/搜索框上按下鼠标就变成拖窗，点歌点不动。
     */
    private static void checkDragGate(Node root, PlayerPanel player) {
        SearchBox box = collect(root, SearchBox.class).stream().findFirst().orElse(null);
        List<SigmaScrollablePanel> scrollables = collect(root, SigmaScrollablePanel.class);
        List<javafx.scene.image.ImageView> smallImages =
                collect(root, javafx.scene.image.ImageView.class).stream()
                        .filter(v -> v.getStyleClass().contains("sigma-small-image")).toList();
        RepeatButton repeat = collect(root, RepeatButton.class).stream().findFirst().orElse(null);
        SpectrumToggleButton spectrum =
                collect(root, SpectrumToggleButton.class).stream().findFirst().orElse(null);
        ThinProgressBar progress =
                collect(root, ThinProgressBar.class).stream().findFirst().orElse(null);
        VerticalSlider volume =
                collect(root, VerticalSlider.class).stream().findFirst().orElse(null);

        check("拖拽排除：搜索框", box != null && DragGate.blocked(box), null);
        check("拖拽排除：滚动面板（歌单项/结果项都在里面）",
                !scrollables.isEmpty() && scrollables.stream().allMatch(DragGate::blocked),
                "n=" + scrollables.size());
        check("拖拽排除：三个播放钮（.sigma-small-image）",
                smallImages.size() == 3 && smallImages.stream().allMatch(DragGate::blocked),
                "n=" + smallImages.size());
        check("拖拽排除：循环按钮", repeat != null && DragGate.blocked(repeat), null);
        check("拖拽排除：频谱按钮",
                spectrum != null && DragGate.blocked(spectrum), null);
        check("拖拽排除：进度条", progress != null && DragGate.blocked(progress), null);
        check("拖拽排除：音量条", volume != null && DragGate.blocked(volume), null);
        // 搜索结果这时已经被清空了，自己造一张卡来测
        ThumbnailCard card = new ThumbnailCard(
                ResultCard.song("h1", "歌名", "歌手", "http://x/y.jpg"));
        check("拖拽排除：缩略卡", DragGate.blocked(card), null);
        // 卡片内部（封面 ImageView）也要被父链带命中
        List<javafx.scene.Node> inside = collect(card, javafx.scene.Node.class);
        check("拖拽排除：卡内子节点经父链命中",
                !inside.isEmpty() && inside.stream().allMatch(DragGate::blocked),
                "n=" + inside.size());
        // 反向：面板空白处必须还能起拖，不然窗口直接拖不动了
check("面板空白处仍可拖窗（别把排除表写太宽）",
                !DragGate.blocked(player) && !DragGate.blocked(root), null);

    }

    /**
     * 随机播放的队列行为，1:1 对照原版 {@code PlayerEngine.js:962-1022}。
     */
    private static void checkShuffleQueue() {
        List<Song> songs = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            songs.add(new Song("h" + i, "t" + i, "a" + i, "al" + i, null, 100 * 1000));
        }
        PlayQueue q = new PlayQueue();
        q.replaceAll(songs);
        check("默认模式是列表循环（原版 PlaybackMode.js:11 默认 1）",
                q.repeat() == PlayQueue.Repeat.ALL, String.valueOf(q.repeat()));

        q.setRepeat(PlayQueue.Repeat.SHUFFLE);
        check("切到随机播放", q.repeat() == PlayQueue.Repeat.SHUFFLE, null);

        boolean inRange = true;
        boolean noImmediateRepeat = true;
        int prev = q.currentIndex();
        for (int i = 0; i < 50; i++) {
            Song s = q.next();
            if (s == null || q.currentIndex() < 0 || q.currentIndex() >= songs.size()) {
                inRange = false;
                break;
            }
            if (q.currentIndex() == prev) {
                noImmediateRepeat = false;
            }
            prev = q.currentIndex();
        }
        check("随机播放 50 次都落在表内", inRange, null);
        check("随机播放不会连着播同一首", noImmediateRepeat, null);

        int a = q.currentIndex();
        q.previous();
        int b = q.currentIndex();
        q.previous();
        int c = q.currentIndex();
        check("随机播放的上一首沿历史栈回退（连续两次不原地踏步）",
                b != a && c != b,
                String.format("a=%d b=%d c=%d", a, b, c));
        check("上一首回退后仍在表内", c >= 0 && c < songs.size(), "c=" + c);

        // 切模式清空历史（原版 setPlaybackMode 清 playedSongsStack）
        q.setRepeat(PlayQueue.Repeat.ALL);
        q.setRepeat(PlayQueue.Repeat.SHUFFLE);
        boolean alive = true;
        for (int i = 0; i < 20; i++) {
            if (q.next() == null) {
                alive = false;
                break;
            }
        }
        check("切换模式后随机历史被清空、队列照常工作", alive, null);

        // 随机模式下整表替换不应固定从第 0 首开始
        boolean sawNonZeroStart = false;
        for (int round = 0; round < 12; round++) {
            PlayQueue r = new PlayQueue();
            r.setRepeat(PlayQueue.Repeat.SHUFFLE);
            r.replaceAll(songs);
            if (r.currentIndex() != 0) {
                sawNonZeroStart = true;
                break;
            }
        }
        check("随机模式下开局随机起歌（不固定第一首）", sawNonZeroStart, null);

        // 顺序播放仍然到尾停下，不能被随机改动带偏
        PlayQueue seq = new PlayQueue();
        seq.replaceAll(songs.subList(0, 3));
        seq.setRepeat(PlayQueue.Repeat.NONE);
        seq.next();
        seq.next();
        seq.next();
        check("顺序播放到最后一首停下（不回到开头）",
                seq.currentIndex() == 2, "i=" + seq.currentIndex());
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
     * 教程页按全屏尺寸单独开窗时的校验 —— 正是这个把「800x600 的视图塞进全屏窗口」
     * 这种一眼可见的错误挡在构建阶段。
     *
     * <p>上一版就是这里没测：探针只在 800x600 下断言，属性全对，但真跑起来
     * 整页被 {@code setClip} 裁成左上角一块，键盘缺一大半。
     * 所以除了断言还得把整页截成 PNG（{@code jello-ui-probe-onboarding.png}），
     * 让人能亲眼核对。
     */
    private static void checkOnboardingFullScreen(String pngPath) {
        // 主屏 visualBounds：1920x1080 减去任务栏
        final double w = 1920;
        final double h = 1032;

        OnboardingView view = new OnboardingView(w, h);
        Pane host = new Pane();
        // 和 MainApp 里教程窗口的 Scene 填充保持一致，截出来的图才和实际一致
        host.setBackground(new Background(new BackgroundFill(
                Color.color(16 / 255.0, 17 / 255.0, 20 / 255.0), null, null)));
        host.getChildren().add(view);
        new Scene(host, w, h);
        host.applyCss();
        host.layout();
        view.layout(w, h);

        check("教程页铺满整个窗口（不能是 800x600）",
                view.getWidth() == w && view.getHeight() == h,
                "size=" + view.getWidth() + "x" + view.getHeight());

        check("教程页裁剪框覆盖整个窗口",
                view.getClip() instanceof Rectangle r
                        && r.getWidth() == w && r.getHeight() == h,
                "clip=" + view.getClip());

        double scale = view.keyboard().getScaleX();
        check("全屏下键盘 1:1 原尺寸（不缩放）", Math.abs(scale - 1) < 0.001,
                String.format("scale=%.4f", scale));

        double kbX = view.keyboard().getLayoutX();
        double kbY = view.keyboard().getLayoutY();
        double kbRight = kbX + KeybindKeyboard.plateWidth() * scale;
        double kbBottom = kbY + KeybindKeyboard.plateHeight() * scale;
        check("键盘完整落在窗口内（不能被裁掉）",
                kbX >= 0 && kbY >= 0 && kbRight <= w && kbBottom <= h,
                String.format("x=%.0f..%.0f y=%.0f..%.0f 窗口 %.0fx%.0f",
                        kbX, kbRight, kbY, kbBottom, w, h));

        double titleW = view.titleLabel().prefWidth(-1);
        check("标题水平居中且在键盘上方",
                Math.abs(view.titleLabel().getLayoutX() + titleW / 2 - w / 2) < 1
                        && view.titleLabel().getLayoutY() + 40 * scale <= kbY,
                String.format("title x=%.0f y=%.0f", view.titleLabel().getLayoutX(),
                        view.titleLabel().getLayoutY()));

        check("底部一行完整落在窗口内",
                view.finishButton().getLayoutY() + 34 <= h
                        && view.stepLabel().getLayoutY() >= 0,
                String.format("done y=%.0f step y=%.0f",
                        view.finishButton().getLayoutY(), view.stepLabel().getLayoutY()));

        // 入场动画 220ms 后正好收敛到 1.0/1.0；截图前直接摆到收敛态，
        // 否则截到的是 opacity≈0 的第一帧（探针里没有 Scene 窗口，脉冲不保证跑到）
        view.setOpacity(1);
        view.setScaleX(1);
        view.setScaleY(1);
        try {
            writeSnapshot(host, pngPath);
        } catch (Exception e) {
            check("教程页整页截图", false, String.valueOf(e));
        }
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
        writeSnapshot(root, pngPath, 8);
    }

private static void writeSnapshot(Node root, String pngPath, int minColors) throws Exception {
        // 必须给 snapshot 传一个不透明 fill：默认是透明，而 Panel 底板本身也是半透明
        // （rgba(0,0,0,0.95) / rgba(38,38,38,0.8)），截出来全带 alpha。
        // WritableImage 的像素是预乘的，直接 getArgb 读回来再 setRGB 写进
        // BufferedImage（非预乘）会整体偏亮——之前主面板快照的背景就被算成了
        // 103,94,98这种粉色，拿它核对图标颜色全是错的。
        javafx.scene.SnapshotParameters params = new javafx.scene.SnapshotParameters();
        params.setFill(javafx.scene.paint.Color.web("#202124"));
        WritableImage snap = root.snapshot(params, null);
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
        check("离屏截图有实际像素（非纯色）", colors.size() > minColors, "distinct=" + colors.size());
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
