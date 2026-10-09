package com.jello.music;

import com.jello.music.api.KuGouApiClient;
import com.jello.music.model.KuGouCredentials;
import com.jello.music.player.SpectrumFeed;
import com.jello.music.ui.SpectrumView;
import javafx.animation.AnimationTimer;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.Scene;
import javafx.scene.canvas.Canvas;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.ProgressBar;
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
import javafx.util.Duration;

import java.util.List;

/**
 * Jello Music Java 版入口。
 *
 * <p>对应原 Vue 版 Sigma 面板的形态：800x600 透明无边框窗口，壳层半透明深色，
 * 底部绘制频谱，控件可直接交互。
 *
 * <p><b>核心设计</b>：播放与频谱是两条互不阻塞的路径——
 * {@link MediaPlayer} 负责出声，{@link SpectrumFeed}（后台线程 + JLayer + FFT）负责画频谱。
 * 这正是 Java 侧必须自己解决的问题：JavaFX 的 MediaPlayer 不吐 PCM，拿不到频谱数据。
 *
 * <p><b>已知限制</b>：JavaFX {@code MediaPlayer} 基于 GStreamer，<b>不支持 FLAC</b>。
 * 酷狗在部分音质下会返回 FLAC 直链，那种情况需显式指定 MP3 音质。
 */
public class MainApp extends Application {

    private static final double PANEL_WIDTH = 800;
    private static final double PANEL_HEIGHT = 600;
    private static final int FFT_SIZE = 2048;
    private static final int BAND_COUNT = 48;

    private MediaPlayer player;
    private SpectrumFeed feed;
    private SpectrumView spectrumView;
    private Label statusLabel;
    private ProgressBar progressBar;
    private Button playPauseButton;
    private String directUrl;

    @Override
    public void start(Stage stage) {
        directUrl = resolveDirectUrl();

        // ---- 透明无边框窗口，与原 Sigma 面板一致 ----
        stage.initStyle(StageStyle.TRANSPARENT);
        stage.setTitle("Jello Music");

        Label title = new Label("Jello Music · Java 版");
        title.setTextFill(Color.WHITE);
        title.setFont(Font.font("Segoe UI", 22));

        Label sub = new Label("JavaFX 透明窗 + MediaPlayer 播放直链 + 纯 Java 频谱");
        sub.setTextFill(Color.web("#9fd8e6"));
        sub.setFont(Font.font("Segoe UI", 12));

        // 频谱：无直链时传 null，Feed 会记录错误并在状态栏提示
        feed = new SpectrumFeed(directUrl, FFT_SIZE, BAND_COUNT, 60);
        spectrumView = new SpectrumView(feed, BAND_COUNT, 640, 140);
        Canvas spectrumCanvas = spectrumView.canvas();
        spectrumView.start();

        playPauseButton = new Button("播放");
        playPauseButton.setOnAction(e -> togglePlay());
        Button stopButton = new Button("停止");
        stopButton.setOnAction(e -> {
            if (player != null) {
                player.stop();
                player.seek(Duration.ZERO);
                progressBar.setProgress(0);
            }
        });
        HBox controls = new HBox(10, playPauseButton, stopButton);
        controls.setAlignment(Pos.CENTER);

        statusLabel = new Label("初始化中…");
        statusLabel.setTextFill(Color.web("#cfd8dc"));
        statusLabel.setFont(Font.font("Consolas", 11));

        progressBar = new ProgressBar(0);
        progressBar.setMaxWidth(560);
        progressBar.setVisible(false);

        VBox content = new VBox(14, title, sub, spectrumCanvas, controls, statusLabel, progressBar);
        content.setAlignment(Pos.CENTER);
        content.setPadding(new Insets(24));

        BorderPane root = new BorderPane(new StackPane(content));
        root.setStyle("-fx-background-color: transparent;");
        // 壳层半透明深色，等价于原版 rgba(6, 8, 12, 0.2)
        StackPane shell = new StackPane(root);
        shell.setStyle("-fx-background-color: rgba(6, 8, 12, 0.2);");

        Scene scene = new Scene(shell, PANEL_WIDTH, PANEL_HEIGHT);
        scene.setFill(Color.TRANSPARENT);
        stage.setScene(scene);
        stage.setAlwaysOnTop(true);
        stage.show();

        if (directUrl == null) {
            setStatus("未提供直链。\n用法：把直链作为第一个参数传入，"
                    + "或设置环境变量 JELLO_HASH / JELLO_TOKEN / JELLO_USERID / JELLO_DFID。");
            playPauseButton.setDisable(true);
            stopButton.setDisable(true);
            return;
        }
        startPlayback(directUrl);
    }

    /** 命令行直链优先；否则用环境变量凭据走 api 取一条。 */
    private String resolveDirectUrl() {
        // getRaw() 返回 List，不是数组
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

    private void startPlayback(String url) {
        try {
            Media media = new Media(url);
            player = new MediaPlayer(media);

            player.setOnReady(() -> setStatus("就绪：" + media.getSource()));
            player.setOnError(() -> {
                MediaPlayer p = player;
                String msg = p == null ? "未知错误" : String.valueOf(p.getError());
                setStatus("播放失败：" + msg
                        + "\n提示：JavaFX MediaPlayer 不支持 FLAC，确认直链为 MP3。");
            });
            player.play();
            progressBar.setVisible(true);

            // 一个 AnimationTimer 同时驱动进度条与状态刷新
            new AnimationTimer() {
                @Override
                public void handle(long now) {
                    if (player == null) {
                        return;
                    }
                    Duration dur = player.getMedia().getDuration();
                    if (dur != null && !dur.isUnknown() && dur.toSeconds() > 0
                            && player.getStatus() == MediaPlayer.Status.PLAYING) {
                        progressBar.setProgress(player.getCurrentTime().toSeconds() / dur.toSeconds());
                    }
                    if (feed != null && feed.error() != null) {
                        setStatus("频谱不可用：" + feed.error());
                    } else if (feed != null && feed.sampleRate() > 0
                            && player.getStatus() == MediaPlayer.Status.PLAYING) {
                        setStatus(String.format("播放中 · %d Hz · %d ch",
                                feed.sampleRate(), feed.channels()));
                    }
                }
            }.start();
        } catch (Exception e) {
            setStatus("初始化播放失败：" + e.getMessage());
        }
    }

    private void togglePlay() {
        if (player == null) {
            return;
        }
        if (player.getStatus() == MediaPlayer.Status.PLAYING) {
            player.pause();
            playPauseButton.setText("播放");
        } else {
            player.play();
            playPauseButton.setText("暂停");
        }
    }

    private void setStatus(String text) {
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