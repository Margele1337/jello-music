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
    private final Label title = new Label();
    private final Label subtitle = new Label();
    private final Label timeLeft = new Label();
    private final Label timeRight = new Label();
    private final Label logo = new Label("Jello");
    private final Label logoSub = new Label("music");

    private final ImageView prevBtn;
    private final ImageView playBtn;
    private final ImageView nextBtn;
    private final SpectrumToggleButton spectrumBtn;
    private final RepeatButton repeatBtn;
    private final Region dockTrigger = new Region();
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

        // ---- 歌名 / 歌手 ----
        styleText(title, Theme.TITLE_X, Theme.TITLE_Y, Theme.TITLE_W, 14);
        title.setTextAlignment(javafx.scene.text.TextAlignment.CENTER);
        getChildren().add(title);
        styleText(subtitle, Theme.TITLE_X, Theme.SUBTITLE_Y, Theme.TITLE_W, 14);
        subtitle.setTextAlignment(javafx.scene.text.TextAlignment.CENTER);
        getChildren().add(subtitle);

        // ---- 时长 ----
        styleText(timeLeft, Theme.TIME_L_X, Theme.TIME_Y, 60, 14);
        getChildren().add(timeLeft);
        styleText(timeRight, Theme.TIME_R_X, Theme.TIME_Y, Theme.TIME_R_W, 14);
        timeRight.setTextAlignment(javafx.scene.text.TextAlignment.RIGHT);
        getChildren().add(timeRight);

        // ---- Logo ----
        styleText(logo, Theme.LOGO_X, Theme.LOGO_Y, 200, Theme.LOGO_SIZE);
        getChildren().add(logo);
        styleText(logoSub, Theme.LOGO_SUB_X, Theme.LOGO_SUB_Y, 200, Theme.LOGO_SUB_SIZE);
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
    }

    /** 收起态下点击 41px 触发条滑出。 */
    public void onDockTrigger(Runnable r) {
        dockTrigger.setOnMouseClicked(e -> r.run());
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

    private static void styleText(Label l, double x, double y, double w, double size) {
        l.setLayoutX(x);
        l.setLayoutY(y);
        l.setPrefWidth(w);
        // 必须给高度：Label 在 Pane 里不设 prefHeight 时尺寸算出来是 0，
        // 再叠加不渲染就直接看不见，歌名/时长整片消失，排查这个花了不少时间。
        l.setPrefHeight(size + 6);
        l.setMinHeight(size + 6);
        // 原版这四个文字都是 white-space: nowrap + overflow: hidden。
        // JavaFX 的 Label 默认会换行，长歌名会折成两行把布局顶歪；
        // 不换行的话文字又会溢出到右边的时间/按钮上，所以还要 clip 到框宽。
        l.setWrapText(false);
        l.setClip(new javafx.scene.shape.Rectangle(w, size + 6));
        l.setFont(Assets.light(size));
        l.setTextFill(Theme.TEXT);
    }

    private static ImageView iconButton(String icon, double x, double y, double size) {
        ImageView v = new ImageView(Assets.image(icon));
        v.setFitWidth(size);
        v.setFitHeight(size);
        v.setPreserveRatio(true);
        v.setLayoutX(x);
        v.setLayoutY(y);
        v.setPickOnBounds(true);
        // 原版 hover 时 brightness(0.94)
        v.setOnMouseEntered(e -> v.setOpacity(0.94));
        v.setOnMouseExited(e -> v.setOpacity(1.0));
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
        title.setText(titleText == null ? "" : titleText);
        boolean hasArtist = artist != null && !artist.isBlank();
        subtitle.setText(hasArtist ? artist : "");
        // 原版 .smp-title.single：无歌手时标题独占一行并下移到 y=562，歌手行不渲染
        subtitle.setVisible(hasArtist);
        title.setLayoutY(hasArtist ? Theme.TITLE_Y : Theme.TITLE_SINGLE_Y);
        title.setClip(new javafx.scene.shape.Rectangle(Theme.TITLE_W,
                hasArtist ? 20 : 16));
        // 原版：无歌手时标题单行居中（single 类），有歌手时两行
        if (coverUrl != null && !coverUrl.isBlank()) {
            try {
                artwork.setImage(new Image(coverUrl, Theme.ARTWORK_S, Theme.ARTWORK_S, true, true));
            } catch (Exception ex) {
                artwork.setImage(Assets.image("artwork.png"));
            }
        } else {
            artwork.setImage(Assets.image("artwork.png"));
        }
        timeLeft.setText("00:00");
        timeRight.setText("00:00");
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