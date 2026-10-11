package com.jello.music.ui;

import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;
import javafx.scene.paint.Color;

import java.util.ArrayList;
import java.util.List;
import java.util.function.IntConsumer;

/**
 * 左栏歌单面板 —— 1:1 复刻原版 {@code SigmaPlaylistPanel.vue}：
 * 每项居中、JelloLight 13px、{@code rgba(254,254,254,0.55)}，
 * hover / 选中变 {@code #fefefe}，滚动条 3px、{@code rgba(254,254,254,0.18)}。
 *
 * <p><b>行高是照原版算出来的</b>，不是拍脑袋：项的 CSS 是
 * {@code padding: 7px 10px; margin-bottom: 2px}，里面的 SigmaText 画布高度
 * 取图集 lineHeight —— {@code light-13} 是 17。所以每项高 {@code 7 + 17 + 7 = 31}，
 * 步进 {@code 31 + 2 = 33}。之前按 30/32 排，每一行都比原版低 1px，
 * 到第五行就差出 4px 了。
 *
 * <p>文字超宽时按原版 {@code truncate} 截断并补 '…'
 * （CSS 的 {@code text-overflow: ellipsis}）。
 *
 * <p><b>为什么不用 ScrollPane</b>：JavaFX 模期样式给 {@code .scroll-pane > .viewport}
 * 设了白色背景，只写 {@code -fx-background-color: transparent} 管不到它，
 * 结果左栏整块被染成白色（正好是歌单面板所在位置，排查很久）。
 * 这里改成 Pane + 手动偏移 + 自己画滚动条，完全掌控外观。
 *
 * <p>继承 Pane 而非 Region：Region 的 getChildren() 是 protected，拿不到子节点句柄。
 */
public final class PlaylistPanel extends Pane {

    /** 原版图集 light-13 的 lineHeight。 */
    private static final double LINE_HEIGHT = 17;
    /** .sigma-playlist-item 的上下 padding。 */
    private static final double ITEM_PAD_Y = 7;
    /** 面板自身 padding-top（4px）与左右（8px）。 */
    private static final double PANEL_PAD_TOP = 4;
    private static final double PANEL_PAD_X = 8;
    /** margin-bottom: 2px。 */
    private static final double ITEM_GAP = 2;

    private static final double ITEM_H = ITEM_PAD_Y * 2 + LINE_HEIGHT;
    private static final double ITEM_STEP = ITEM_H + ITEM_GAP;

    /** 原版 alpha：非选中且非 hover 时 0.55，其余 1。 */
    private static final Color DIM = Color.color(254 / 255.0, 254 / 255.0, 254 / 255.0, 0.55);
    private static final Color BRIGHT = Color.web("#fefefe");

    private final Pane viewport = new Pane();
    private final List<String> backing = new ArrayList<>();
    private final List<Pane> rows = new ArrayList<>();
    private final List<SigmaTextView> labels = new ArrayList<>();
    private final Pane scrollTrack = new Pane();
    private final Region scrollThumb = new Region();
    private final Region topMask = new Region();
    private final Region bottomMask = new Region();

    private IntConsumer onSelect;
    private int selected = -1;
    private double scroll;

    public PlaylistPanel(double w, double h, IntConsumer onSelect) {
        this.onSelect = onSelect;
        setPrefSize(w, h);
        setMinSize(w, h);
        setMaxSize(w, h);
        // 面板本身透明，露出底下的左栏底色
        setBackground(javafx.scene.layout.Background.fill(javafx.scene.paint.Color.TRANSPARENT));

        viewport.setLayoutX(0);
        viewport.setLayoutY(0);
        viewport.setPrefWidth(w);
        // 内容高度随条目数增长，超出部分靠 topMask/bottomMask 裁剪模拟
        viewport.setClip(new javafx.scene.shape.Rectangle(w, h));

        // 上下遮罩：模拟 overflow，滚到边界时用同一底色盖住
        topMask.setLayoutX(0);
        topMask.setLayoutY(0);
        topMask.setPrefSize(w, 16);
        topMask.setMouseTransparent(true);
        bottomMask.setLayoutX(0);
        bottomMask.setPrefSize(w, 16);
        bottomMask.setMouseTransparent(true);

        // 滚动条 3px / rgba(254,254,254,0.18)
        scrollTrack.setLayoutX(w - 5);
        scrollTrack.setLayoutY(4);
        scrollTrack.setPrefWidth(3);
        scrollTrack.setPrefHeight(h - 8);
        scrollTrack.setBackground(javafx.scene.layout.Background.fill(
                javafx.scene.paint.Color.color(0.996, 0.996, 0.996, 0.06)));
        scrollTrack.setMouseTransparent(true);
        scrollThumb.setPrefWidth(3);
        scrollThumb.setBackground(javafx.scene.layout.Background.fill(
                javafx.scene.paint.Color.color(0.996, 0.996, 0.996, 0.18)));
        scrollThumb.setMouseTransparent(true);
        scrollTrack.getChildren().setAll(scrollThumb);

        getChildren().addAll(viewport, topMask, bottomMask, scrollTrack);

        setOnScroll(e -> {
            moveBy(e.getDeltaY() * 0.6);
            e.consume();
        });
    }

    /** 载入歌单条目。 */
    public void setItems(List<String> titles) {
        backing.clear();
        rows.clear();
        labels.clear();
        viewport.getChildren().clear();
        double textW = getPrefWidth() - PANEL_PAD_X * 2;
        double y = PANEL_PAD_TOP;
        for (String t : titles) {
            // 一项 = 一个 234x31 的点击区（对应原版 <button> 的 padding 盒），
            // 文字画在它内侧 7px 处
            Pane item = new Pane();
            item.setLayoutX(PANEL_PAD_X);
            item.setLayoutY(y);
            item.setPrefSize(textW, ITEM_H);
            item.setMinSize(textW, ITEM_H);
            item.setMaxSize(textW, ITEM_H);
            item.setBackground(javafx.scene.layout.Background.fill(
                    javafx.scene.paint.Color.TRANSPARENT));

            SigmaTextView label = new SigmaTextView("light", 13, textW, LINE_HEIGHT,
                    SigmaTextView.Align.CENTER);
            // 原版 truncate：超宽按图集 advance 截到放得下为止再补 '…'
            label.setText(label.truncate(t, textW));
            label.setLayoutX(0);
            label.setLayoutY(ITEM_PAD_Y);
            label.setColor(DIM);
            item.getChildren().add(label);

            final int idx = backing.size();
            backing.add(t);
            rows.add(item);
            labels.add(label);
            item.setOnMouseClicked(e -> {
                select(idx);
                if (onSelect != null) {
                    onSelect.accept(idx);
                }
            });
            item.setOnMouseEntered(e -> label.setColor(BRIGHT));
            item.setOnMouseExited(e ->
                    label.setColor(idx == selected ? BRIGHT : DIM));
            viewport.getChildren().add(item);
            y += ITEM_STEP;
        }
        viewport.setPrefHeight(Math.max(getPrefHeight(), y - ITEM_GAP));
        scroll = 0;
        viewport.setLayoutY(-scroll);
        layoutBottomMask();
        updateScrollThumb();
    }

    private void select(int idx) {
        selected = idx;
        for (int i = 0; i < labels.size(); i++) {
            labels.get(i).setColor(i == idx ? BRIGHT : DIM);
        }
    }

    /** 选中项的高亮色要跟着 hover 走，原版是「选中 || hover」。 */
    void setHover(int idx, boolean hover) {
        if (idx >= 0 && idx < labels.size()) {
            labels.get(idx).setColor(hover || idx == selected ? BRIGHT : DIM);
        }
    }

    private double contentHeight() {
        return Math.max(getPrefHeight(), viewport.getPrefHeight());
    }

    private double maxScroll() {
        return Math.max(0, contentHeight() - getPrefHeight());
    }

    private void moveBy(double dy) {
        scroll = Math.max(0, Math.min(maxScroll(), scroll + dy));
        viewport.setLayoutY(-scroll);
        layoutBottomMask();
        updateScrollThumb();
    }

    /** 滚到底时把下遮罩藏起来，露出最后一条。 */
    private void layoutBottomMask() {
        double h = getPrefHeight();
        boolean atBottom = scroll >= maxScroll() - 0.5;
        if (atBottom) {
            bottomMask.setLayoutY(h);
        } else {
            bottomMask.setLayoutY(h - bottomMask.getPrefHeight());
            bottomMask.setBackground(javafx.scene.layout.Background.fill(
                    Theme.LEFT_PANEL));
        }
    }

    private void updateScrollThumb() {
        double viewH = getPrefHeight();
        double total = contentHeight();
        double trackH = scrollTrack.getPrefHeight();
        if (total <= viewH || total <= 0) {
            scrollThumb.setPrefHeight(0);
            return;
        }
        double ratio = viewH / total;
        double thumbH = Math.max(24, trackH * ratio);
        double maxScroll = maxScroll();
        double t = maxScroll <= 0 ? 0 : scroll / maxScroll;
        scrollThumb.setPrefHeight(thumbH);
        scrollThumb.setLayoutY((trackH - thumbH) * t);
    }
}