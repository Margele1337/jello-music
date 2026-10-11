package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import javafx.geometry.Pos;
import javafx.scene.control.Label;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.media.MediaPlayer;
import javafx.scene.paint.Color;

/**
 * 播放界面 —— 严格按原 Vue 版 {@code SigmaMusicPlayer.vue} 的绝对定位坐标 1:1 复刻。
 *
 * <p>原版用 {@code position: absolute} + 写死的 left/top/width/height，
 * 这里改用 {@link Pane} + {@code setLayoutX/Y} + {@code setPrefSize}，语义完全对应。
 *
 * <p>坐标全部来自 {@link Theme}，与原 CSS 逐项对应，不做近似。
 */
public final class PlayerPanel extends Pane {

    private final ImageView artwork = new ImageView();
    // 原版全部走 SigmaText（字形图集逐字贴图），字号/盒高照抄：
    // title/subtitle/time 是 light-14 盒高 16，logo 是 light-40 盒高 44，logo-sub 是 light-20 盒高 22
    private final SigmaTextView title =
            new SigmaTextView("light", 14, Theme.TITLE_W, 16, SigmaTextView.Align.CENTER, 0);
    private final SigmaTextView subtitle =
            new SigmaTextView("light", 14, Theme.TITLE_W, 16, SigmaTextView.Align.CENTER, -1000);
    private final SigmaTextView timeLeft = new SigmaTextView("light", 14, 0, 16, SigmaTextView.Align.LEFT);
    private final SigmaTextView timeRight =
            new SigmaTextView("light", 14, Theme.TIME_R_W, 16, SigmaTextView.Align.RIGHT);
    private final SigmaTextView logo = new SigmaTextView("light", 40, 0, 44, SigmaTextView.Align.LEFT);
    private final SigmaTextView logoSub = new SigmaTextView("light", 20, 0, 22, SigmaTextView.Align.LEFT);
    private final RepeatButton repeatBtn;

    private final ImageView prevBtn;
    private final ImageView playBtn;
    private final ImageView nextBtn;
    private final SpectrumToggleButton spectrumBtn;
    private final Region dockTrigger = new Region();
    private final SearchBox search;
    private final VerticalSlider volume;
    private final ThinProgressBar progress;

    private MediaPlayer player;
    private AnimationTimer ticker;
    private javafx.beans.property.DoubleProperty volumeBoundTo;
    private Runnable onMediaEnd;
    private final CanvasStrip strip = new CanvasStrip(Theme.STRIP_W, Theme.STRIP_H);

    /** 换封面时同时更新专辑封面框与底部封面条。 */
    public void setCover(String coverUrl) {
        strip.setCover(coverUrl);
    }

    public PlayerPanel() {
        // ---- 左右两块底板 ----
        // 用 Region + Background 对象上色，不用 CSS 字符串。
        // JavaFX CSS 的 rgba() 分量是 0..1，写 0..255 会被判为非法值直接忽略，
        // 节点就退回默认白色——这个坑踩过一次，底板整块变白。
        getChildren().add(rect(0, 0, Theme.LEFT_PANEL_W, Theme.UPPER_H, Theme.LEFT_PANEL));
        getChildren().add(rect(Theme.LEFT_PANEL_W, 0, Theme.RIGHT_PANEL_W,
                Theme.UPPER_H, Theme.RIGHT_PANEL));

// ---- 底部封面条 ----
        place(strip, Theme.STRIP_X, Theme.STRIP_Y, Theme.STRIP_W, Theme.STRIP_H);
        getChildren().add(strip);
        Region stripOverlay = rect(0, Theme.STRIP_Y, Theme.PANEL_W,
                Theme.STRIP_OVERLAY_H, Theme.STRIP_OVERLAY);
        getChildren().add(stripOverlay);
        Region stripOverlayBottom = rect(0, 595, Theme.LEFT_PANEL_W, 5, Theme.STRIP_OVERLAY);
        getChildren().add(stripOverlayBottom);

        // ---- 专辑封面 114x114 @ (68,430) ----
        // 用 Region 承载并居中 ImageView：StackPane 会把子节点拉伸铺满，
        // 导致这个方块把整个左栏都染白。
        artwork.setFitWidth(Theme.ARTWORK_S);
        artwork.setFitHeight(Theme.ARTWORK_S);
        artwork.setPreserveRatio(true);
        artwork.setMouseTransparent(true);
        Region artBox = new Region();
        artBox.setBackground(javafx.scene.layout.Background.fill(Theme.ARTWORK_BG));
        // 原版 box-shadow: inset 0 0 0 1px rgba(1,1,1,0.35)，
        // 是往里描的一像素边。JavaFX 没有 inset box-shadow，用带 1px padding 的
        // BackgroundFill 描一层内框模拟；顺序上后画的在上，所以底色在前、描边在后。
        // BackgroundFill 参数顺序是 (Paint, CornerRadii, Insets)，Insets 排最后；
        // Background 的静态工厂只有 fill(Paint)，要多层只能自己 new。
        // 按数组顺序绘制：底色先画，1px 内描边后画，正好压在上面。
        artBox.setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(Theme.ARTWORK_BG, null, null),
                new javafx.scene.layout.BackgroundFill(Theme.ARTWORK_INNER_BORDER,
                        null, new javafx.geometry.Insets(1))));
        artBox.setLayoutX(Theme.ARTWORK_X);
        artBox.setLayoutY(Theme.ARTWORK_Y);
        artBox.setPrefSize(Theme.ARTWORK_S, Theme.ARTWORK_S);
        artBox.setMinSize(Theme.ARTWORK_S, Theme.ARTWORK_S);
        artBox.setMaxSize(Theme.ARTWORK_S, Theme.ARTWORK_S);
        artBox.setMouseTransparent(true);
        getChildren().add(artBox);
        // 封面图叠在底色之上
        artwork.setLayoutX(Theme.ARTWORK_X);
        artwork.setLayoutY(Theme.ARTWORK_Y);
        artwork.setMouseTransparent(true);
        getChildren().add(artwork);

        // ---- 歌名 / 歌手（超框时走跑马灯，原版 scroll 属性）----
        // phase 分别是 0 / -1000，和原版一致：两行错开动，不会一起飘
        title.setLayoutX(Theme.TITLE_X);
        title.setLayoutY(Theme.TITLE_Y);
        title.setScrolling(true, 0);
        getChildren().add(title);

        subtitle.setLayoutX(Theme.TITLE_X);
        subtitle.setLayoutY(Theme.SUBTITLE_Y);
        subtitle.setScrolling(true, -1000);
        getChildren().add(subtitle);

        // ---- 时长 ----
        // 文字节点自己管盒子尺寸（Logo/左时间是 fluid，宽度随文字量出来），
        // 这里只摆位置，不要走 place()，否则会把盒高覆盖掉
        timeLeft.setLayoutX(Theme.TIME_L_X);
        timeLeft.setLayoutY(Theme.TIME_Y);
        getChildren().add(timeLeft);
        timeRight.setLayoutX(Theme.TIME_R_X);
        timeRight.setLayoutY(Theme.TIME_Y);
        getChildren().add(timeRight);

        // ---- Logo ----
        logo.setLayoutX(Theme.LOGO_X);
        logo.setLayoutY(Theme.LOGO_Y);
        logo.setText("Jello");
        getChildren().add(logo);
        logoSub.setLayoutX(Theme.LOGO_SUB_X);
        logoSub.setLayoutY(Theme.LOGO_SUB_Y);
        logoSub.setText("music");
        getChildren().add(logoSub);

        // ---- 控制按钮（原版用图标图，非文字符号）----
        prevBtn = iconButton("backwards.png", Theme.PREV_X, Theme.PREV_Y, Theme.PREV_S);
        nextBtn = iconButton("forwards.png", Theme.NEXT_X, Theme.NEXT_Y, Theme.NEXT_S);
        playBtn = iconButton("play.png", Theme.PLAY_X, Theme.PLAY_Y, Theme.PLAY_S);
        getChildren().addAll(prevBtn, playBtn, nextBtn);

        // ---- 频谱按钮 40x40 @ (15,460) ----
        spectrumBtn = new SpectrumToggleButton(Theme.SPECTRUM_S);
        place(spectrumBtn, Theme.SPECTRUM_X, Theme.SPECTRUM_Y, Theme.SPECTRUM_S, Theme.SPECTRUM_S);
        getChildren().add(spectrumBtn);

        // ---- 循环模式 27x20 @ (264,540) ----
        repeatBtn = new RepeatButton();
        place(repeatBtn, Theme.REPEAT_X, Theme.REPEAT_Y, 27, 20);
        getChildren().add(repeatBtn);

        // ---- 音量 4x40 @ (781,520) ----
        volume = new VerticalSlider(Theme.VOLUME_W, Theme.VOLUME_H);
        place(volume, Theme.VOLUME_X, Theme.VOLUME_Y, Theme.VOLUME_W, Theme.VOLUME_H);
        getChildren().add(volume);

        // ---- 进度条 550x5 @ (250,595) ----
        progress = new ThinProgressBar(Theme.PROGRESS_W, Theme.PROGRESS_H);
        place(progress, Theme.PROGRESS_X, Theme.PROGRESS_Y, Theme.PROGRESS_W, Theme.PROGRESS_H);
        getChildren().add(progress);

        // ---- 搜索框 550x506 @ (250,0)，z-index 2：压在左右底板之上 ----
        search = new SearchBox();
        search.setLayoutX(250);
        search.setLayoutY(0);
        getChildren().add(search);

        // ---- 贴边收起时的 41px 触发条 ----
        // 原版 .smp-dock-trigger 在面板 x=0..41 全高、z-index 50 且无背景色。
        // 收起态窗口只把这一条留在屏幕右缘，所以它既是触发区也是唯一的可见部分。
        // 必须最后 add：Pane 按加入顺序叠放，最后一个在最上层。
        dockTrigger.setLayoutX(0);
        dockTrigger.setLayoutY(0);
        dockTrigger.setPrefSize(Theme.EDGE_TRIGGER, Theme.PANEL_H);
        dockTrigger.setMinSize(Theme.EDGE_TRIGGER, Theme.PANEL_H);
        dockTrigger.setMaxSize(Theme.EDGE_TRIGGER, Theme.PANEL_H);
        // 展开时必须让鼠标穿透，否则这 41px 会挡住左栏歌单和频谱按钮
        dockTrigger.setMouseTransparent(true);
        getChildren().add(dockTrigger);

        // 原版初始态就是「没有歌」：标题行显示 "Jello Music"（单行，y=562），
        // 歌手行不渲染。不显式铺一次的话 Label 是空的，启动后左下角一片空白。
        setSong(null, null, null);
    }

    /** 收起态下点击 41px 触发条滑出。 */
    public void onDockTrigger(Runnable r) {
        dockTrigger.setOnMouseClicked(e -> r.run());
    }

    public SearchBox searchBox() {
        return search;
    }

    public void setDockTriggerActive(boolean active) {
        dockTrigger.setMouseTransparent(!active);
    }

    // ---------- 构造辅助 ----------

    /**
     * 生成一个纯色底板。
     * <p>注意：不要用 {@code setStyle("-fx-background-color: rgba(...)")} 来做半透明底板——
     * JavaFX CSS 的 rgba 分量是 0..1，写 0..255 会被当成非法值直接忽略，
     * 节点就退回默认白色。这里直接用 {@code setBackground} 传 Color 对象，
     * 不会有这个歧义。
     */
    private static Region rect(double x, double y, double w, double h, Color c) {
        Region r = new Region();
        r.setLayoutX(x);
        r.setLayoutY(y);
        r.setPrefSize(w, h);
        r.setMinSize(w, h);
        r.setMaxSize(w, h);
        r.setBackground(javafx.scene.layout.Background.fill(c));
        r.setMouseTransparent(true); // 底板不该吃掉拖拽事件
        return r;
    }

    private static void place(javafx.scene.layout.Region n, double x, double y, double w, double h) {
        n.setLayoutX(x);
        n.setLayoutY(y);
        n.setPrefSize(w, h);
    }

    private static ImageView iconButton(String icon, double x, double y, double size) {
        ImageView v = new ImageView(Assets.image(icon));
        v.setFitWidth(size);
        v.setFitHeight(size);
        v.setPreserveRatio(true);
        v.setLayoutX(x);
        v.setLayoutY(y);
        v.setPickOnBounds(true);
        // 原版 .sigma-small-image:hover { filter: brightness(0.94) }。
        // 用 ColorAdjust 等价实现，别用 setOpacity(0.94)——那会让按钮整体透出底色，
        // 而 brightness 是保持不透明地压暗。brightness(0.94) 对应 brightness = -0.06。
        // ColorAdjust 没有全参构造，只能逐个 setter。
        javafx.scene.effect.ColorAdjust dim = new javafx.scene.effect.ColorAdjust();
        dim.setBrightness(-0.06);
        v.setOnMouseEntered(e -> v.setEffect(dim));
        v.setOnMouseExited(e -> v.setEffect(null));
        return v;
    }

    /**
     * 生成 JavaFX CSS 的颜色串。
     * <p><b>坑</b>：JavaFX CSS 的 {@code rgba()} 分量取 0..1 浮点，不是 CSS 那样的 0..255。
     * 写成 {@code rgba(0,0,0,0.95)} 会被当成 rgb 全 0、alpha 0.95（接近全黑且半透明）；
     * 写 {@code rgba(38,38,38,0.8)} 会溢出成非法值被忽略，底板就变成默认白色。
     * 这里统一除以 255 输出 0..1。
     */
    static String css(Color c) {
        return String.format("rgba(%.4f,%.4f,%.4f,%.4f)",
                c.getRed(), c.getGreen(), c.getBlue(), c.getOpacity());
    }

    // ---------- 对外接口 ----------

    public void setSong(String titleText, String artist, String coverUrl) {
        // 原版 titleLine1 = name || 'Jello Music'：没有歌曲时不是空白，
        // 而是单行显示 "Jello Music"（.smp-title.single，y=562）
        String name = titleText == null || titleText.isBlank() ? "Jello Music" : titleText;
        title.setText(name);
        boolean hasArtist = artist != null && !artist.isBlank();
        subtitle.setText(hasArtist ? artist : "");
        // 原版 .smp-title.single：无歌手时标题独占一行并下移到 y=562，歌手行不渲染
        subtitle.setVisible(hasArtist);
        title.setLayoutY(hasArtist ? Theme.TITLE_Y : Theme.TITLE_SINGLE_Y);
        applyCover(coverUrl);
        timeLeft.setText("00:00");
        timeRight.setText("00:00");
    }

    /**
     * 铺专辑封面。
     *
     * <p>原版是 CSS {@code background-size: cover} + {@code background-position: center}：
     * 等比放大到盖满 114x114，再居中裁掉溢出部分。
     * {@code ImageView.setPreserveRatio(true)} 是「contain」——两边会留缝，
     * 非正方形的封面就对不上。这里自己按 cover 算 fit 尺寸，再用 clip 裁回 114x114。
     *
     * <p>clip 用的是<b>节点本地坐标</b>：图片为了盖满而向左/上挪了 {@code (114-fw)/2}，
     * 所以可见区要反过来挪回去，即 {@code (fw-114)/2}。
     */
    private void applyCover(String coverUrl) {
        Image fallback = Assets.image("artwork.png");
        if (coverUrl == null || coverUrl.isBlank()) {
            layoutCover(fallback);
            return;
        }
        // true = 后台加载：构造函数返回时宽高还是 0，算出来的比例是 NaN，什么都不画。
        // 所以等 progress 到 1 再回 FX 线程铺。
        Image img = new Image(coverUrl, true);
        if (img.getProgress() < 1.0) {
            img.progressProperty().addListener((o, was, now) -> {
                if (now.doubleValue() >= 1.0) {
                    javafx.application.Platform.runLater(() ->
                            layoutCover(img.getException() == null ? img : fallback));
                }
            });
            return;
        }
        layoutCover(img.getException() == null ? img : fallback);
    }

    private void layoutCover(Image img) {
        double s = Theme.ARTWORK_S;
        double ar = img.getWidth() / img.getHeight();
        double fw;
        double fh;
        if (ar > 1) {
            fh = s;
            fw = s * ar;
        } else {
            fw = s;
            fh = s / ar;
        }
        double dx = (s - fw) / 2;
        double dy = (s - fh) / 2;
        artwork.setPreserveRatio(false);
        artwork.setFitWidth(fw);
        artwork.setFitHeight(fh);
        artwork.setLayoutX(Theme.ARTWORK_X + dx);
        artwork.setLayoutY(Theme.ARTWORK_Y + dy);
        artwork.setClip(new javafx.scene.shape.Rectangle(-dx, -dy, s, s));
        artwork.setImage(img);
    }

    public void onPrev(Runnable r) {
        prevBtn.setOnMouseClicked((MouseEvent e) -> r.run());
    }

    public void onNext(Runnable r) {
        nextBtn.setOnMouseClicked((MouseEvent e) -> r.run());
    }

    public void onPlayToggle(Runnable r) {
        playBtn.setOnMouseClicked((MouseEvent e) -> r.run());
    }

    public void onSpectrumToggle(Runnable r) {
        spectrumBtn.setOnToggle(active -> r.run());
    }

    /** 音量滑块值变化（0..1）。换歌重建 MediaPlayer 时要靠它把音量带过去。 */
public void onVolumeChanged(java.util.function.Consumer<Double> handler) {
        volume.valueProperty().addListener((o, a, b) ->
                handler.accept(b.doubleValue()));
    }

    /** 循环模式按钮：点击切换，并回传新的 0/1/2 状态。 */
    public void onRepeatToggle(java.util.function.IntConsumer r) {
        repeatBtn.onClick(() -> r.accept(repeatBtn.state()));
    }

    public void setRepeatState(int s) {
        repeatBtn.setState(s);
    }

    public void setSpectrumActive(boolean active) {
        spectrumBtn.setActiveStyle(active);
    }

    /**
     * 绑定播放器。
     *
     * <p>这里踩过两个坑，都跟「同一套控件被反复复用」有关：
     * <ul>
     *   <li>每首歌都 {@code new AnimationTimer()} 会越攒越多。旧 timer 还活着，
     *       继续拿<em>已 dispose 的</em> player 读时间，于是时间/进度显示会莫名其妙
     *       跳到整首歌长度（getCurrentTime 在 dispose 后返回 duration）。改成复用同一个 ticker。</li>
     *   <li>{@code bindBidirectional} 对已经绑定过的属性再绑一次会直接抛
     *       IllegalArgumentException，表现为「第一首能播，第二首起就报初始化失败」。
     *       所以换歌时先把上一个 player 的双向绑定解开。</li>
     * </ul>
     */
    public void bindPlayer(MediaPlayer p) {
        if (ticker != null) {
            ticker.stop();
            ticker = null;
        }
        this.player = p;
        if (volumeBoundTo != null) {
            volume.valueProperty().unbindBidirectional(volumeBoundTo);
        }
        volume.valueProperty().bindBidirectional(p.volumeProperty());
        volumeBoundTo = p.volumeProperty();

        p.statusProperty().addListener((o, a, b) -> {
            if (b == MediaPlayer.Status.PLAYING) {
                playBtn.setImage(Assets.image("pause.png"));
            } else {
                playBtn.setImage(Assets.image("play.png"));
            }
        });
        p.setOnEndOfMedia(() -> {
            if (onMediaEnd != null) {
                onMediaEnd.run();
            }
        });

        ticker = new AnimationTimer() {
            @Override
            public void handle(long now) {
                if (p.getMedia() == null) {
                    return;
                }
                double dur = p.getMedia().getDuration().toSeconds();
                double cur = p.getCurrentTime().toSeconds();
                if (Double.isNaN(dur) || dur <= 0) {
                    return;
                }
                timeLeft.setText(fmt(cur));
                timeRight.setText(fmt(dur));
                progress.setPercent(Math.max(0, Math.min(1, cur / dur)));
            }
        };
        ticker.start();
    }

    /** 播放结束回调（用于自动切下一首）。 */
    public void onMediaEnd(Runnable r) {
        this.onMediaEnd = r;
    }

    /** 进度条点击/拖拽定位，回调带 0..1 的比例。 */
    public void onSeek(java.util.function.Consumer<Double> handler) {
        progress.setOnSeek(handler);
    }

    static String fmt(double sec) {
        if (sec <= 0 || Double.isNaN(sec) || Double.isInfinite(sec)) {
            return "00:00";
        }
        long s = (long) sec;
        return String.format("%02d:%02d", s / 60, s % 60);
    }


    MediaPlayer player() {
        return player;
    }
}
