package com.jello.music.ui;

import javafx.geometry.Insets;
import javafx.scene.control.Label;
import javafx.scene.image.Image;
import javafx.scene.image.ImageView;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;

/**
 * 搜索结果卡片 183x220 —— 1:1 复刻原版 {@code SigmaThumbnailButton.vue}。
 *
 * <p>结构与原版一致：底色 {@code #010101}（歌单卡是 {@code #037c8c}）、
 * 153x153 封面 @ (15,15)、hover 时封面放大到 1.0654 并叠一层 blur(14px) 的同图，
 * 中央 50x50 播放图标从 0.5 缩放淡入，标题 y=181、歌手 y=194。
 */
public final class ThumbnailCard extends Pane {

    private static final double W = 183;
    private static final double H = 220;
    private static final double COVER = 153;
    private static final double COVER_INSET = 15;
    private static final double HOVER_SCALE = 1.0654;

    private final ImageView cover = new ImageView();
    private final ImageView coverBlur = new ImageView();
    private final ImageView playIcon = new ImageView();
    private final Label title = new Label();
    private final Label artist = new Label();

    public ThumbnailCard(String titleText, String artistText, String coverUrl, boolean playlist) {
        setPrefSize(W, H);
        setMinSize(W, H);
        setMaxSize(W, H);
        setBackground(javafx.scene.layout.Background.fill(
                playlist ? javafx.scene.paint.Color.web("#037c8c") : javafx.scene.paint.Color.web("#010101")));

        configureCover(cover, false);
        configureCover(coverBlur, true);
        getChildren().addAll(coverBlur, cover);

        playIcon.setImage(Assets.image("play.png"));
        playIcon.setFitWidth(50);
        playIcon.setFitHeight(50);
        playIcon.setPreserveRatio(true);
        playIcon.setLayoutX((W - 50) / 2);
        playIcon.setLayoutY((H - 50) / 2);
        playIcon.setOpacity(0);
        playIcon.setMouseTransparent(true);
        getChildren().add(playIcon);

        title.setText(titleText == null ? "" : titleText);
        artist.setText(artistText == null ? "" : artistText);
        boolean hasArtist = artistText != null && !artistText.isBlank();
        artist.setVisible(hasArtist);
        title.setLayoutY(hasArtist ? 181 : 187);
        styleLine(title, 181, hasArtist ? 181 : 187);
        styleLine(artist, 194, 194);
        getChildren().addAll(title, artist);

        applyCover(coverUrl);

        setOnMouseEntered(e -> {
            scaleCover(cover, HOVER_SCALE);
            scaleCover(coverBlur, HOVER_SCALE);
            coverBlur.setOpacity(1);
            playIcon.setOpacity(1);
        });
        setOnMouseExited(e -> {
            scaleCover(cover, 1);
            scaleCover(coverBlur, 1);
            coverBlur.setOpacity(0);
            playIcon.setOpacity(0);
        });
    }

    /** 载入封面；后台加载完成后在 FX 线程换上去。 */
    private void applyCover(String url) {
        if (url == null || url.isBlank()) {
            Image fallback = Assets.image("artwork.png");
            cover.setImage(fallback);
            coverBlur.setImage(fallback);
            return;
        }
        Image img = new Image(url, true);
        if (img.getProgress() < 1.0) {
            img.progressProperty().addListener((o, was, now) -> {
                if (now.doubleValue() >= 1.0) {
                    javafx.application.Platform.runLater(() -> swapCover(img));
                }
            });
            return;
        }
        swapCover(img);
    }

    private void swapCover(Image img) {
        Image ok = img.getException() == null ? img : Assets.image("artwork.png");
        cover.setImage(ok);
        coverBlur.setImage(ok);
    }

    public void onClick(Runnable r) {
        setOnMouseClicked((MouseEvent e) -> r.run());
    }

    private void configureCover(ImageView v, boolean blurred) {
        v.setFitWidth(COVER);
        v.setFitHeight(COVER);
        v.setPreserveRatio(false);
        v.setLayoutX(COVER_INSET);
        v.setLayoutY(COVER_INSET);
        v.setMouseTransparent(true);
        if (blurred) {
            v.setEffect(new javafx.scene.effect.GaussianBlur(14));
            v.setOpacity(0);
        }
    }

    /**
     * 绕中心放大。
     * <p>原版是 CSS {@code transform: scale(1.0654)}，默认绕元素中心；
     * JavaFX 的 {@code setScaleX/Y} 绕的是自身原点（会朝右下窜出去），
     * 而这个版本的 {@code Node} 又没暴露 {@code setPivotX}，所以改成
     * 「先按缩放比例把 layout 往回挪半个差值」，效果等价于绕中心缩放。
     */
    private void scaleCover(ImageView v, double s) {
        double d = COVER * (s - 1) / 2;
        v.setScaleX(s);
        v.setScaleY(s);
        v.setLayoutX(COVER_INSET - d);
        v.setLayoutY(COVER_INSET - d);
    }

    private static void styleLine(Label l, double x, double y) {
        l.setLayoutX(0);
        l.setLayoutY(y);
        l.setPrefWidth(W);
        l.setPrefHeight(16);
        l.setAlignment(javafx.geometry.Pos.CENTER);
        l.setFont(Assets.light(12));
        l.setTextFill(Theme.TEXT);
        l.setWrapText(false);
        l.setClip(new javafx.scene.shape.Rectangle(W, 16));
        l.setMouseTransparent(true);
    }
}