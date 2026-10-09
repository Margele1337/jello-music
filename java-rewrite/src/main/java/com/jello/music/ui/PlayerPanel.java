package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import javafx.beans.binding.Bindings;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.ProgressBar;
import javafx.scene.control.Slider;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.layout.HBox;
import javafx.scene.layout.StackPane;
import javafx.scene.layout.VBox;
import javafx.scene.media.MediaPlayer;
import javafx.scene.paint.Color;
import javafx.scene.text.Font;

import java.util.function.Consumer;

/**
 * 播放主界面：封面、曲名/歌手、进度条、上一首/播放暂停/下一首、音量。
 *
 * <p>布局对齐原 Vue 版 {@code SigmaMusicPlayer} 的骨架，控件样式换成 JavaFX 等价物。
 *
 * <p>进度与时长用 {@link AnimationTimer} 轮询而不用属性绑定：
 * {@code Media.duration} 在媒体未就绪时是 {@code Duration.UNKNOWN}，
 * 绑定期内容易抛异常，而轮询写法更省事也更稳。
 */
public final class PlayerPanel extends StackPane {

    private static final double COVER = 260;

    private final ImageView coverView = new ImageView();
    private final Label titleLabel = new Label("未在播放");
    private final Label artistLabel = new Label("");
    private final Label elapsedLabel = new Label("0:00");
    private final Label durationLabel = new Label("0:00");
    private final ProgressBar progress = new ProgressBar(0);
    private final Button playPause = new Button("▶");
    private final Button prev = new Button("⏮");
    private final Button next = new Button("⏭");
    private final Slider volume = new Slider(0, 1, 0.8);
    private final Label volumeLabel = new Label("80%");

    private MediaPlayer player;

    public PlayerPanel(Consumer<Boolean> onPlayPause,
                       Runnable onPrev,
                       Runnable onNext) {
        playPause.setOnAction(e -> onPlayPause.accept(true));
        prev.setOnAction(e -> onPrev.run());
        next.setOnAction(e -> onNext.run());

        styleButton(playPause, 15);
        styleButton(prev, 13);
        styleButton(next, 13);

        // ---- 封面 ----
        coverView.setFitWidth(COVER);
        coverView.setFitHeight(COVER);
        coverView.setPreserveRatio(true);
        coverView.setStyle("-fx-background-color: rgba(255,255,255,0.05);"
                + "-fx-background-radius: 10;");
        StackPane coverBox = new StackPane(coverView);
        coverBox.setPadding(new Insets(6));
        coverBox.setMaxWidth(COVER + 12);
        coverBox.setAlignment(Pos.CENTER);

        // ---- 曲名 / 歌手 ----
        titleLabel.setTextFill(Theme.TEXT_PRIMARY);
        titleLabel.setFont(Font.font("Segoe UI", 17));
        titleLabel.setWrapText(true);
        titleLabel.setMaxWidth(360);
        artistLabel.setTextFill(Theme.TEXT_SECONDARY);
        artistLabel.setFont(Font.font("Segoe UI", 13));
        VBox info = new VBox(4, titleLabel, artistLabel);
        info.setAlignment(Pos.CENTER_LEFT);

        // ---- 进度条 ----
        progress.setMaxWidth(640);
        progress.setStyle("-fx-accent: #1a9aba;");
        elapsedLabel.setTextFill(Theme.TEXT_MUTED);
        durationLabel.setTextFill(Theme.TEXT_MUTED);
        elapsedLabel.setFont(Font.font("Consolas", 11));
        durationLabel.setFont(Font.font("Consolas", 11));
        HBox timeRow = new HBox(8, elapsedLabel, progress, durationLabel);
        timeRow.setAlignment(Pos.CENTER);

        // ---- 音量 ----
        volume.setMaxWidth(120);
        volume.setPrefWidth(120);
        volume.valueProperty().addListener((o, a, b) ->
                volumeLabel.setText(Math.round(b.doubleValue() * 100) + "%"));
        volumeLabel.setTextFill(Theme.TEXT_MUTED);
        volumeLabel.setFont(Font.font("Consolas", 11));
        Label volumeCaption = new Label("音量");
        volumeCaption.setTextFill(Theme.TEXT_SECONDARY);
        HBox volumeRow = new HBox(8, volumeCaption, volume, volumeLabel);
        volumeRow.setAlignment(Pos.CENTER);

        HBox transport = new HBox(18, prev, playPause, next);
        transport.setAlignment(Pos.CENTER);

        VBox content = new VBox(16, coverBox, info, timeRow, transport, volumeRow);
        content.setAlignment(Pos.CENTER);
        content.setPadding(new Insets(20));

        getChildren().add(content);
        setAlignment(Pos.CENTER);
    }

    private void styleButton(Button b, double size) {
        b.setFont(Font.font("Segoe UI Symbol", size));
        b.setPrefSize(size + 26, size + 26);
        b.setStyle("-fx-background-color: rgba(255,255,255,0.10);"
                + "-fx-background-radius: 999;"
                + "-fx-text-fill: " + toCss(Theme.TEXT_PRIMARY) + ";");
    }

    private static String toCss(Color c) {
        return String.format("#%02x%02x%02x",
                (int) Math.round(c.getRed() * 255),
                (int) Math.round(c.getGreen() * 255),
                (int) Math.round(c.getBlue() * 255));
    }

    // ---- 对外接口 ----

    public void setSong(String title, String artist, String coverUrl) {
        titleLabel.setText(title == null || title.isBlank() ? "未在播放" : title);
        artistLabel.setText(artist == null ? "" : artist);
        if (coverUrl != null && !coverUrl.isBlank()) {
            try {
                coverView.setImage(new Image(coverUrl, COVER, COVER, true, true));
            } catch (Exception e) {
                coverView.setImage(null);
            }
        } else {
            coverView.setImage(null);
        }
    }

    /** 绑定播放器：播放/暂停图标、进度、时长、音量双向同步。 */
    public void bindPlayer(MediaPlayer p) {
        this.player = p;
        playPause.textProperty().bind(Bindings.when(
                        Bindings.equal(p.statusProperty(), MediaPlayer.Status.PLAYING))
                .then("⏸").otherwise("▶"));
        volume.valueProperty().bindBidirectional(p.volumeProperty());

        new AnimationTimer() {
            @Override
            public void handle(long now) {
                if (p.getMedia() == null) {
                    return;
                }
                double dur = p.getMedia().getDuration().toSeconds();
                double cur = p.getCurrentTime().toSeconds();
                durationLabel.setText(format(dur));
                elapsedLabel.setText(format(cur));
                if (dur > 0 && !Double.isNaN(dur)) {
                    progress.setProgress(Math.max(0, Math.min(1, cur / dur)));
                }
            }
        }.start();
    }

    static String format(double seconds) {
        if (seconds <= 0 || Double.isNaN(seconds) || Double.isInfinite(seconds)) {
            return "0:00";
        }
        long s = (long) seconds;
        return String.format("%d:%02d", s / 60, s % 60);
    }
}