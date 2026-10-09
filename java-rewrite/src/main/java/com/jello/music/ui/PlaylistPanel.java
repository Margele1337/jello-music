package com.jello.music.ui;

import javafx.scene.control.Label;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;

import java.util.ArrayList;
import java.util.List;
import java.util.function.IntConsumer;

/**
 * 左栏歌单面板 —— 1:1 复刻原版 {@code SigmaPlaylistPanel.vue}：
 * 每项居中、JelloLight 13px、rgba(254,254,254,0.55)，
 * hover / 选中变 #fefefe，滚动条 3px、rgba(254,254,254,0.18)。
 *
 * <p><b>为什么不用 ScrollPane</b>：JavaFX 模期样式给 {@code .scroll-pane > .viewport}
 * 设了白色背景，只写 {@code -fx-background-color: transparent} 管不到它，
 * 结果左栏整块被染成白色（正好是歌单面板所在位置，排查很久）。
 * 这里改成 Pane + 手动偏移 + 自己画滚动条，完全掌控外观。
 *
 * <p>继承 Pane 而非 Region：Region 的 getChildren() 是 protected，拿不到子节点句柄。
 */
public final class PlaylistPanel extends Pane {

    private final Pane viewport = new Pane();
    private final List<String> backing = new ArrayList<>();
    private final List<Label> rows = new ArrayList<>();
    private final Pane scrollTrack = new Pane();
    private final Region scrollThumb = new Region();
    private final Region topMask = new Region();
    private final Region bottomMask = new Region();

    private IntConsumer onSelect;
    private int selected = -1;
    private double scroll = 0;

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
        viewport.getChildren().clear();
        double y = 4;
        for (String t : titles) {
            Label l = new Label(t);
            l.setFont(Assets.light(13));
            l.setTextFill(Theme.TEXT_DIM);
            l.setMaxWidth(Double.MAX_VALUE);
            l.setAlignment(javafx.geometry.Pos.CENTER);
            l.setLayoutX(8);
            l.setLayoutY(y);
            l.setPrefWidth(getPrefWidth() - 16);
            l.setPrefHeight(30);   // 7px padding + 13px 文字 + 余量
            l.setPickOnBounds(true);

            final int idx = backing.size();
            backing.add(t);
            rows.add(l);
            l.setOnMouseClicked(e -> {
                select(idx);
                if (onSelect != null) {
                    onSelect.accept(idx);
                }
            });
            l.setOnMouseEntered(e -> l.setTextFill(Theme.TEXT));
            l.setOnMouseExited(e -> l.setTextFill(
                    idx == selected ? Theme.TEXT : Theme.TEXT_DIM));
            viewport.getChildren().add(l);
            y += 32;              // 30 + margin-bottom 2，与原版一致
        }
        viewport.setPrefHeight(Math.max(getPrefHeight(), y + 4));
        scroll = 0;
        viewport.setLayoutY(-scroll);
        layoutBottomMask();
        updateScrollThumb();
    }

    private void select(int idx) {
        selected = idx;
        for (int i = 0; i < rows.size(); i++) {
            rows.get(i).setTextFill(i == idx ? Theme.TEXT : Theme.TEXT_DIM);
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