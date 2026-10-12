package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import com.jello.music.model.ResultCard;
import com.jello.music.model.Song;
import javafx.geometry.Pos;
import javafx.scene.control.TextField;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;

import java.util.ArrayList;
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

    /** 输入框几何（原版 .sigma-search-box-field：left 30 / top 14 / 490x70）。 */
    private static final double FIELD_X = 30;
    private static final double FIELD_Y = 14;
    private static final double FIELD_W = 490;
    private static final double FIELD_H = 70;
    /** 原版 TextField 里文字的左内边距。 */
    private static final double FIELD_PAD_LEFT = 4;
    /** 光标闪烁周期，前半段暗、后半段亮。 */
    private static final long CARET_PERIOD_MS = 1000;

    /** 输入文字/占位符的三档透明度，对齐原版 SigmaTextField 的 alpha 公式。 */
    private static final double ALPHA_UNFOCUSED = 0.2;
    private static final double ALPHA_FOCUSED_EMPTY = 0.45;
    private static final double ALPHA_FOCUSED_TEXT = 0.9;

    private final SigmaScrollablePanel results = new SigmaScrollablePanel(W, H);
    private final TextField field = new TextField();
    /**
     * 原版的输入框是「透明 input 只负责输入/光标/输入法，文字由 canvas 画」
     * （见 SigmaTextField.vue 的注释：自定义点阵字体）。这里照抄：
     * input 的文字设为透明，文字全部交给图集画布。
     */
    private final SigmaTextView glyphs = new SigmaTextView("sans", 25, 490, 70,
            SigmaTextView.Align.LEFT).fieldBaseline(true);
    private final Region underline = new Region();
    private final Region caret = new Region();

    /** 输入框横向滚动：光标贴到右边界时把文字往回推。 */
    private double scrollX;
    private double scrollTarget;
    private long caretStartMs;
    private AnimationTimer caretTimer;

    private final List<ResultCard> cards = new ArrayList<>();
    private Consumer<String> onSubmit;
    private Consumer<Song> onPick;
    private Consumer<String> onOpenPlaylist;

    public SearchBox() {
        getStyleClass().add("sigma-search-box"); // 原版 CSS class，拖窗排除表要用（DragGate）
        setPrefSize(W, H);
        setMinSize(W, H);
        setMaxSize(W, H);
        setBackground(javafx.scene.layout.Background.fill(
                javafx.scene.paint.Color.TRANSPARENT));

        field.setLayoutX(FIELD_X);
        field.setLayoutY(FIELD_Y);
        field.setPrefSize(FIELD_W, FIELD_H);
        field.setPromptText("Search...");
        field.setFont(Assets.light(25));
        // 文字交给画布画，input 只留光标与选区（对应原版 color: transparent）。
        // 原版还把 ::selection 设成 transparent（选区自己用 rgba(254,254,254,0.22) 画），
        // 这里一并关掉 JavaFX 的蓝色原生选区。
        field.setStyle("-fx-background-color: transparent; -fx-text-fill: transparent;"
                + " -fx-prompt-text-fill: transparent; -fx-highlight-fill: transparent;");
        field.setPadding(new javafx.geometry.Insets(0, 0, 0, FIELD_PAD_LEFT));
        field.setAlignment(Pos.CENTER_LEFT);
        field.setOnAction(e -> {
            if (onSubmit != null) {
                onSubmit.accept(field.getText());
            }
        });
        field.textProperty().addListener((o, a, b) -> paintFieldText());
        getChildren().add(field);

        glyphs.setLayoutX(FIELD_X);
        glyphs.setLayoutY(FIELD_Y);
        glyphs.setMouseTransparent(true);
        getChildren().add(glyphs);

        // 自绘光标 1px：原版 input 文字是透明的，JavaFX 自带光标也跟着隐形了
        int lineH = glyphs.atlas().lineHeight();
        caret.setLayoutX(FIELD_X + FIELD_PAD_LEFT);
        caret.setLayoutY(FIELD_Y + FIELD_H / 2 - lineH / 2 + 2);
        caret.setPrefSize(1, lineH - 3);
        caret.setBackground(javafx.scene.layout.Background.fill(
                javafx.scene.paint.Color.web("#fefefe")));
        caret.setVisible(false);
        caret.setMouseTransparent(true);
        getChildren().add(caret);

        // 原版是 ::after 伪元素画的 2px 下划线，这里用一层 Region 代替
        underline.setLayoutX(FIELD_X);
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
            paintFieldText();
            if (b) {
                startCaretTimer();
            } else {
                stopCaretTimer();
                scrollX = 0;
                scrollTarget = 0;
            }
        });
        paintFieldText();

        results.setLayoutX(0);
        results.setLayoutY(0);
        // 层级：原版 .sigma-search-box-field 有 z-index:3、.sigma-search-box-results
        // 没有（SigmaSearchBox.vue:232-244），所以输入框压在结果列表<b>上面</b>。
        //
        // Pane 没有 z-index，靠 add 顺序决定叠放：<b>后加的在上</b>。
        // 这里 results 从 0,0 铺满 550x506，如果按原顺序最后加，
        // 它会盖住 y=14..84 的搜索框——搜索结果里「我喜欢」这类歌单卡片
        // 的标题就叠在 "Search..." 上，看起来像搜索框里有两个文字。
        // 所以要提到最前面先加，让 field/glyphs/caret/underline 压在它上面。
        getChildren().add(0, results);
    }

    /** 有内容画内容、否则画占位符，整串按当前焦点态的 alpha 上色。 */
    private void paintFieldText() {
        String value = field.getText();
        boolean hasValue = value != null && !value.isEmpty();
        glyphs.setText(hasValue ? value : "Search...");
        glyphs.setOffsetX(scrollX);
        boolean focused = field.isFocused();
        double alpha = !focused ? ALPHA_UNFOCUSED
                : hasValue ? ALPHA_FOCUSED_TEXT : ALPHA_FOCUSED_EMPTY;
        glyphs.setColor(javafx.scene.paint.Color.color(
                254 / 255.0, 254 / 255.0, 254 / 255.0, alpha));
    }

    /**
     * 输入光标。
     *
     * <p><b>为什么自己画</b>：原版把 {@code input} 的文字设成 transparent（自定义点阵字体），
     * 光标是自己用 {@code drawRoundedRect} 画的 1px 竖线。JavaFX 自带光标跟着
     * {@code -fx-text-fill} 走，文字透明它也跟着没了。这里照原版补回来。
     *
     * <p>参数 1:1 照抄 sigmarebase 的 {@code TextField.draw}：
     * <pre>
     *   周期 1000ms：前半段 alpha 0.1、后半段 0.8
     *   x  = xA + 4 + scrollX + textWidth  （有内容时左边界 -1，空内容时右边界 +1，即恒 1px 宽）
     *   y  = yA + height/2 - lineHeight/2 + 2 .. yA + height/2 + lineHeight/2 - 1
     * </pre>
     *
     * <p>顺带把原版的横向滚动也做了：光标跑到左右边界时把文字往回推，
     * 偏移量按每帧 {@code (target - current) / 2} 逼近（{@code field20746/field20747}）。
     */
    private void startCaretTimer() {
        if (caretTimer != null) {
            return;
        }
        caretStartMs = System.currentTimeMillis();
        caretTimer = new AnimationTimer() {
            @Override
            public void handle(long now) {
                long elapsed = (now / 1_000_000L) - caretStartMs;
long phase = elapsed % CARET_PERIOD_MS;
                caret.setOpacity(phase < CARET_PERIOD_MS / 2 ? 0.1 : 0.8);

                // 滚动：目标偏移保证光标落在 [4, 486] 内
                String value = field.getText() == null ? "" : field.getText();
                double tw = glyphs.atlas().measure(value);
                double caretRight = FIELD_PAD_LEFT + scrollX + tw;
                double maxScroll = FIELD_W - FIELD_PAD_LEFT * 2 - tw;
                double target = Math.max(0, Math.min(maxScroll, scrollX));
                if (caretRight > FIELD_W - FIELD_PAD_LEFT) {
                    target = Math.min(Math.max(0, maxScroll), caretRight - (FIELD_W - FIELD_PAD_LEFT));
                }
                scrollTarget = target;
                double next = scrollX + (scrollTarget - scrollX) / 2.0;
                if (Math.abs(next - scrollX) > 0.1) {
                    scrollX = next;
                    glyphs.setOffsetX(scrollX);
                    glyphs.renderNow();
                }
                caret.setLayoutX(FIELD_X + FIELD_PAD_LEFT + scrollX + tw
                        - (value.isEmpty() ? 0 : 1));
            }
        };
        caretTimer.start();
    }

    private void stopCaretTimer() {
        if (caretTimer != null) {
            caretTimer.stop();
            caretTimer = null;
        }
        caret.setVisible(false);
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

    public void onOpenPlaylist(Consumer<String> r) {
        this.onOpenPlaylist = r;
    }

    public void clear() {
        results.viewport().getChildren().clear();
        results.setContentHeight(0);
        cards.clear();
    }

    /**
     * 搜索结果区在子节点里的位置，供 UiProbe 断言层级顺序。
     *
     * <p>原版靠 {@code .sigma-search-box-field { z-index: 3 }} 把输入框压在
     * 结果列表之上（{@code SigmaSearchBox.vue:232-244}）。JavaFX 的 Pane 没有
     * z-index，靠 add 顺序决定，所以这个下标就是「谁在谁上面」的依据。
     */
    public int resultsLayerIndex() {
        return getChildren().indexOf(results);
    }

    /** 输入框在子节点里的位置，供 UiProbe 断言层级顺序。 */
    public int fieldLayerIndex() {
        return getChildren().indexOf(field);
    }

    /** 下划线在子节点里的位置，供 UiProbe 断言层级顺序。 */
    public int underlineLayerIndex() {
        return getChildren().indexOf(underline);
    }

    /** 搜索结果区的纵坐标（原版是 top:0，铺满整块）。 */
    public double resultsLayoutY() {
        return results.getLayoutY();
    }

    /** 结果区的滚动容器，外部（校验工具）需要查滚动状态时用。 */
    public SigmaScrollablePanel resultsPanel() {
        return results;
    }

    /** 当前铺在网格里的卡片，外部点歌时要用它整体替换队列。 */
    public List<ResultCard> currentCards() {
        return List.copyOf(cards);
    }

    /**
     * 铺搜索结果。
     *
     * <p>原版把卡片绝对定位在滚动容器里（{@code x=[10,183,356][i%3]}、
     * {@code y=90+floor(i/3)*210}），超出 506 高的部分靠 overflow-y:auto 滚动看到，
     * 没有任何「只显示前 N 张」的逻辑——之前的实现铺满两行就 break，
     * 于是第 4 首之后的结果根本点不到。现在全部铺出来，内容高度按最后一张卡片的底边算。
     *
     * <p>歌单卡（青色底）点一下是下钻该歌单，歌曲卡点一下是播放——
     * 与原版 {@code onCardClick} 一致。
     */
    public void showResults(List<ResultCard> list) {
        Pane viewport = results.viewport();
        viewport.getChildren().clear();
        cards.clear();
        double bottom = 0;
        for (int i = 0; i < list.size(); i++) {
            ResultCard rc = list.get(i);
            int col = i % 3;
            int row = i / 3;
            double x = COL_X[col];
            double y = ROW_Y0 + row * ROW_STEP;
            ThumbnailCard card = new ThumbnailCard(rc);
            card.setLayoutX(x);
            card.setLayoutY(y);
            card.onClick(() -> {
                if (rc.isPlaylist()) {
                    if (onOpenPlaylist != null) {
                        onOpenPlaylist.accept(rc.gid());
                    }
                } else if (onPick != null) {
                    onPick.accept(rc.toSong());
                }
            });
            viewport.getChildren().add(card);
            cards.add(rc);
            bottom = Math.max(bottom, y + CARD_H);
        }
        results.setContentHeight(bottom);
    }

    /** 右栏当前滚动偏移（px）。对应 mod 的 {@code field20852.getScrollBarOffset()}。 */
    public double resultScroll() {
        return results.scroll();
    }

    /** 右栏滚动上限（px）；内容不满一屏时为 0。 */
    public double resultMaxScroll() {
        return results.maxScroll();
    }
}