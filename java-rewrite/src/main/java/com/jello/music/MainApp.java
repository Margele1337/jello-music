package com.jello.music;

import com.jello.music.api.KuGouApiClient;
import com.jello.music.model.KuGouCredentials;
import com.jello.music.player.SpectrumFeed;
import com.jello.music.ui.EdgeDock;
import com.jello.music.ui.ElasticReveal;
import com.jello.music.ui.PlayerPanel;
import com.jello.music.ui.SpectrumView;
import com.jello.music.ui.Theme;
import javafx.animation.AnimationTimer;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.canvas.Canvas;
import javafx.scene.control.Label;
import javafx.scene.input.KeyCode;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.StackPane;
import javafx.scene.layout.VBox;
import javafx.scene.media.Media;
import javafx.scene.media.MediaPlayer;
import javafx.scene.paint.Color;
import javafx.scene.text.Font;
import javafx.stage.Stage;
import javafx.stage.StageStyle;

import java.util.List;

/**
 * Jello Music Java 版入口。
 *
 * <p>对应原 Vue 版 Sigma 面板：800x600 透明无边框窗口、贴右收起/滑出、
 * 展开时的弹性缩放动画、可拖拽，壳层半透明深色。
 *
 * <p><b>核心设计</b>：播放与频谱是两条互不阻塞的路径——
 * {@link MediaPlayer} 负责出声，{@link SpectrumFeed}（后台线程 + JLayer + FFT）负责画频谱。
 * JavaFX 的 MediaPlayer 不吐 PCM，拿不到频谱数据，这是 Java 侧必须自己解决的部分。
 *
 * <p><b>快捷键</b>：RSHIFT 呼出/收起（全局热键尚未接入，这里先用窗口内 Shift+R 代替）。
 *
 * <p><b>已知限制</b>：JavaFX MediaPlayer 基于 GStreamer，<b>不支持 FLAC</b>。
 */
public class MainApp extends Application {

    private static final int FFT_SIZE = 2048;
    private static final int BAND_COUNT = 48;

    private MediaPlayer player;
    private SpectrumFeed feed;
    private SpectrumView spectrumView;
    private PlayerPanel playerPanel;
    private Label statusLabel;
    private EdgeDock dock;
    private ElasticReveal reveal;
    private String directUrl;

    @Override
    public void start(Stage stage) {
        directUrl = resolveDirectUrl();

        stage.initStyle(StageStyle.TRANSPARENT);
        stage.setTitle("Jello Music");
        stage.setWidth(Theme.PANEL_WIDTH);
        stage.setHeight(Theme.PANEL_HEIGHT);

        // ---- 频谱 ----
        feed = new SpectrumFeed(directUrl, FFT_SIZE, BAND_COUNT, 60);
        spectrumView = new SpectrumView(feed, BAND_COUNT, 640, 120);
        Canvas spectrumCanvas = spectrumView.canvas();
        spectrumView.start();

        // ---- 播放器 ----
        playerPanel = new PlayerPanel(
                ignore -> togglePlay(),
                () -> status("上一首（待接播放队列）"),
                () -> status("下一首（待接播放队列）"));

        statusLabel = new Label("初始化中…");
        statusLabel.setTextFill(Theme.TEXT_MUTED);
        statusLabel.setFont(Font.font("Consolas", 11));

        Label hint = new Label("拖动面板可移动 · 拖到最右侧自动收起 · Shift+R 呼出/收起");
        hint.setTextFill(Theme.TEXT_SECONDARY);
        hint.setFont(Font.font("Segoe UI", 11));

        VBox content = new VBox(12, spectrumCanvas, playerPanel, hint, statusLabel);
        content.setAlignment(Pos.CENTER);
        content.setPadding(new Insets(16));

        // 整个面板作为可拖拽区域（与原版一致：空白处拖动不误触控件）
        StackPane overlay = new StackPane(content);
        overlay.setPadding(new Insets(8));

        BorderPane root = new BorderPane(overlay);
        root.setStyle("-fx-background-color: transparent;");
        StackPane shell = new StackPane(root);
        shell.setStyle("-fx-background-color: rgba(6, 8, 12, 0.2);");

        // 弹性缩放作用在 overlay 上，shell 保持不变形
        reveal = new ElasticReveal(overlay);

        Scene scene = new Scene(shell, Theme.PANEL_WIDTH, Theme.PANEL_HEIGHT);
        scene.setFill(Color.TRANSPARENT);
        scene.setOnKeyPressed(e -> {
            if (e.getCode() == KeyCode.R && e.isShiftDown()) {
                toggleDock();
            }
        });
        stage.setScene(scene);
        stage.setAlwaysOnTop(true);

        dock = new EdgeDock(stage);
        installDragHandlers(overlay);

        // 冷启动直接展开，便于第一次打开就能看到界面；
        // 按 Shift+R 或拖到最右侧可收起，与原版一致的路径。
        dock.expand();
        reveal.expand(null);
        stage.show();

        if (directUrl == null) {
            status("未提供直链。运行 run.bat <直链>，或设置 JELLO_HASH 等环境变量。");
        } else {
            startPlayback(directUrl);
        }
    }

    /**
     * 拖拽：原版把整个面板当拖拽区，控件区域通过选择器排除。
     * JavaFX 里控件自己会消费事件，所以直接在 overlay 上监听即可，
     * 不必像 Web 版那样维护一份「不拖拽的 class 选择器」列表。
     */
    private void installDragHandlers(javafx.scene.Node overlay) {
        overlay.setOnMousePressed(e -> {
            if (dock.isDocked()) {
                return; // 收起态不接受拖拽
            }
            dock.beginDrag(e);
        });
        overlay.setOnMouseDragged(e -> dock.drag(e));
        overlay.setOnMouseReleased(e -> dock.endDrag());
    }

    /** 与原版一致：所有收起/展开入口共用这一条路径。 */
    private void toggleDock() {
        if (dock.isDocked()) {
            dock.expand();
            reveal.expand(null);
        } else {
            reveal.collapse(() -> dock.collapse());
        }
    }

    private void togglePlay() {
        if (player == null) {
            return;
        }
        if (player.getStatus() == MediaPlayer.Status.PLAYING) {
            player.pause();
        } else {
            player.play();
        }
    }

    private void startPlayback(String url) {
        try {
            Media media = new Media(url);
            player = new MediaPlayer(media);
            player.setOnReady(() -> status("就绪"));
            player.setOnError(() -> {
                MediaPlayer p = player;
                status("播放失败：" + (p == null ? "未知" : String.valueOf(p.getError()))
                        + "（MediaPlayer 不支持 FLAC，确认是 MP3）");
            });
            player.setVolume(0.8);
            player.play();
            playerPanel.bindPlayer(player);
            playerPanel.setSong("未命名曲目", "", null);

            new AnimationTimer() {
                @Override
                public void handle(long now) {
                    if (feed == null) {
                        return;
                    }
                    if (feed.error() != null) {
                        status("频谱不可用：" + feed.error());
                    } else if (player != null
                            && player.getStatus() == MediaPlayer.Status.PLAYING
                            && feed.sampleRate() > 0) {
                        status(String.format("播放中 · %d Hz · %d ch",
                                feed.sampleRate(), feed.channels()));
                    }
                }
            }.start();
        } catch (Exception e) {
            status("初始化播放失败：" + e.getMessage());
        }
    }

    /** 命令行直链优先；否则用环境变量凭据走 api 取一条。 */
    private String resolveDirectUrl() {
        List<String> args = getParameters().getRaw();
        if (!args.isEmpty() && args.get(0).startsWith("http")) {
            return args.get(0);
        }
        String hash = env("JELLO_HASH");
        if (hash == null) {
            return null;
        }
        KuGouCredentials cred = new KuGouCredentials();
        cred.setToken(env("JELLO_TOKEN"));
        cred.setUserid(env("JELLO_USERID"));
        cred.setDfid(env("JELLO_DFID"));
        try {
            return new KuGouApiClient(cred).songUrl(hash, 320);
        } catch (Exception e) {
            System.err.println("取直链失败: " + e.getMessage());
            return null;
        }
    }

    private static String env(String k) {
        String v = System.getenv(k);
        return (v == null || v.isBlank()) ? null : v;
    }

    private void status(String text) {
        if (statusLabel != null) {
            Platform.runLater(() -> statusLabel.setText(text));
        }
    }

    @Override
    public void stop() {
        if (spectrumView != null) {
            spectrumView.stop();
        }
        if (feed != null) {
            feed.close();
        }
        if (player != null) {
            player.dispose();
        }
    }

    public static void main(String[] args) {
        launch(args);
    }
}