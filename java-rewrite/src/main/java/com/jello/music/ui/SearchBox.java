package com.jello.music.ui;

import com.jello.music.model.Song;
import javafx.geometry.Pos;
import javafx.scene.control.TextField;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;

import java.util.List;
import java.util.function.Consumer;

/**
 * 搜索框 —— 1:1 复刻原版 {@code SigmaSearchBox.vue}。
 *
 * <p>容器 550x506 贴在右栏 (250,0)，z-index 2（在左右底板之上、41px 触发条之下）。
 * 输入框 490x70 @ (30,14)，底部一条 2px 的 rgba(254,254,254,0.5) 下划线，
 * hover/聚焦时变不透明。��果卡片 183x220，x=10/183/356，y=90+row*210。
 *
 * <p><b>与原版的唯一取舍</b>：原版输入框的字符是「先渲染进 canvas 再把 input 文字设为
 * transparent」的绕法（为了自定义点阵字体）。Java 侧直接用带字体的 TextField，
 * 视觉一致，只是少一层画布中转。
 */
public final class SearchBox extends Pane {

    private static final double W = 550;
    private static final double H = 506;

    /** 卡片 183x220，横纵间距见原版。 */
    private static final double CARD_W = 183;
    private static final double CARD_H = 220;
    /**
     * 原版是写死的三列 {@code [10, 183, 356][index % 3]}，不是等差数列。
     * 按「10 + col * 183」推会算成 10/193/376，整排错位 10px，所以照抄这张表。
     */
    private static final double[] COL_X = {10, 183, 356};
    private static final double ROW_Y0 = 90;
    private static final double ROW_STEP = 210;

    private final Pane results = new Pane();
    private final TextField field = new TextField();
    private final Region underline = new Region();

    private Consumer<String> onSubmit;
    private Consumer<Song> onPick;

    public SearchBox() {
        setPrefSize(W, H);
        setMinSize(W, H);
        setMaxSize(W, H);
        setBackground(javafx.scene.layout.Background.fill(
                javafx.scene.paint.Color.TRANSPARENT));

        field.setLayoutX(30);
        field.setLayoutY(14);
        field.setPrefSize(490, 70);
        field.setPromptText("Search...");
        field.setFont(Assets.light(25));
        // TextField 不是 Labeled，没有 setTextFill，文字颜色只能走 CSS
        field.setStyle("-fx-background-color: transparent; -fx-text-fill: #fefefe;");
        field.setPadding(new javafx.geometry.Insets(0, 0, 0, 4));
        field.setAlignment(Pos.CENTER_LEFT);
        field.setOnAction(e -> {
            if (onSubmit != null) {
                onSubmit.accept(field.getText());
            }
        });
        getChildren().add(field);

        // 原版是 ::after 伪元素画的 2px 下划线，这里用一层 Region 代替
        underline.setLayoutX(30);
        underline.setLayoutY(12 + 70);
        underline.setPrefSize(490, 2);
        underline.setMouseTransparent(true);
        underline.setBackground(javafx.scene.layout.Background.fill(underlinePaint(0.5)));
        getChildren().add(underline);

        // 聚焦时下划线变不透明；hover 同理，但这个版本的 Node 没有 hovered
        // 属性可监听，只保留聚焦态。
        field.focusedProperty().addListener((o, a, b) ->
                underline.setBackground(javafx.scene.layout.Background.fill(
                        underlinePaint(b ? 1.0 : 0.5))));

        results.setLayoutX(0);
        results.setLayoutY(0);
        results.setPrefSize(W, H);
        // 结果区不能溢出到下方的封面条上，原版由 overflow 管着
        results.setClip(new javafx.scene.shape.Rectangle(W, H - 90));
        getChildren().add(results);
    }

    /** 原版下划线是 rgba(254,254,254,0.5)，聚焦时 alpha 拉到 1。 */
    private static javafx.scene.paint.Paint underlinePaint(double alpha) {
        return javafx.scene.paint.Color.color(254 / 255.0, 254 / 255.0, 254 / 255.0, alpha);
    }

    public void onSubmit(Consumer<String> r) {
        this.onSubmit = r;
    }

    public void onPick(Consumer<Song> r) {
        this.onPick = r;
    }

    public void clear() {
        results.getChildren().clear();
    }

    /** 铺一排搜索结果（只铺前两行，超出的先留着但不显示，等做滚动区）。 */
    public void showResults(List<Song> songs) {
        results.getChildren().clear();
        for (int i = 0; i < songs.size(); i++) {
            Song s = songs.get(i);
            int col = i % 3;
            int row = i / 3;
            double x = COL_X[col];
            double y = ROW_Y0 + row * ROW_STEP;
            if (y + CARD_H > H) {
                break;
            }
            ThumbnailCard card = new ThumbnailCard(
                    s.getTitle(), s.getArtist(), s.getCoverUrl(), false);
            card.setLayoutX(x);
            card.setLayoutY(y);
            final Song picked = s;
            card.onClick(() -> {
                if (onPick != null) {
                    onPick.accept(picked);
                }
            });
            results.getChildren().add(card);
        }
    }
}