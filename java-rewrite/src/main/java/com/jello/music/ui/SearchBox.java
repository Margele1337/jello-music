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
 * hover/聚焦时变不透明。结果区是 {@link SigmaScrollablePanel}（550x506，滚动条隐藏），
 * 卡片 183x220，x=10/183/356，y=90+row*210，超出一屏的部分靠滚轮往下翻。
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

    /** 输入文字/占位符的三档透明度，对齐原版 SigmaTextField 的 alpha 公式。 */
    private static final String FIELD_ALPHA_UNFOCUSED = "rgba(254,254,254,0.2)";
    private static final String FIELD_ALPHA_FOCUSED_EMPTY = "rgba(254,254,254,0.45)";
    private static final String FIELD_ALPHA_FOCUSED_TEXT = "rgba(254,254,254,0.9)";

    private final SigmaScrollablePanel results = new SigmaScrollablePanel(W, H);
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
        // TextField 不是 Labeled，没有 setTextFill，文字颜色只能走 CSS。
        // 原版 SigmaTextField 的 alpha 是 (field20744/2 + 0.4) * (聚焦且有内容 ? 1 : 0.5)，
        // 即未聚焦 0.2 / 聚焦空 0.45 / 聚焦有内容 0.9。JavaFX 的 prompt 默认是灰的，
        // 比原版亮一大截，这里全部自己算。
        field.setStyle("-fx-background-color: transparent; -fx-text-fill: "
                + FIELD_ALPHA_UNFOCUSED + "; -fx-prompt-text-fill: " + FIELD_ALPHA_UNFOCUSED + ";");
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

        // 聚焦时文字提亮：原版 (聚焦且有内容 ? 1 : 0.5) 决定 alpha，
        // 即聚焦有内容 0.9、聚焦空 0.45，未聚焦一律 0.2
        field.focusedProperty().addListener((o, a, b) -> {
            underline.setBackground(javafx.scene.layout.Background.fill(
                    underlinePaint(b ? 1.0 : 0.5)));
            boolean hasValue = field.getText() != null && !field.getText().isEmpty();
            String alpha = !b ? FIELD_ALPHA_UNFOCUSED
                    : hasValue ? FIELD_ALPHA_FOCUSED_TEXT : FIELD_ALPHA_FOCUSED_EMPTY;
            field.setStyle("-fx-background-color: transparent; -fx-text-fill: " + alpha
                    + "; -fx-prompt-text-fill: " + alpha + ";");
        });

        results.setLayoutX(0);
        results.setLayoutY(0);
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
        results.viewport().getChildren().clear();
        results.setContentHeight(0);
    }

    /** 结果区的滚动容器，外部（校验工具）需要查滚动状态时用。 */
    public SigmaScrollablePanel resultsPanel() {
        return results;
    }

    /**
     * 铺搜索结果。
     *
     * <p>原版把卡片绝对定位在滚动容器里（{@code x=[10,183,356][i%3]}、
     * {@code y=90+floor(i/3)*210}），超出 506 高的部分靠 overflow-y:auto 滚动看到，
     * 没有任何「只显示前 N 张」的逻辑——之前的实现铺满两行就 break，
     * 于是第 4 首之后的结果根本点不到。现在全部铺出来，内容高度按最后一张卡片的底边算。
     */
    public void showResults(List<Song> songs) {
        Pane viewport = results.viewport();
        viewport.getChildren().clear();
        double bottom = 0;
        for (int i = 0; i < songs.size(); i++) {
            Song s = songs.get(i);
            int col = i % 3;
            int row = i / 3;
            double x = COL_X[col];
            double y = ROW_Y0 + row * ROW_STEP;
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
            viewport.getChildren().add(card);
            bottom = Math.max(bottom, y + CARD_H);
        }
        results.setContentHeight(bottom);
    }
}