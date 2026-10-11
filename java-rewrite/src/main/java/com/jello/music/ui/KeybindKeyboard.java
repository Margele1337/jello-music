package com.jello.music.ui;

import javafx.geometry.Pos;
import javafx.scene.Node;
import javafx.scene.control.Label;
import javafx.scene.effect.DropShadow;
import javafx.scene.layout.Background;
import javafx.scene.layout.BackgroundFill;
import javafx.scene.layout.CornerRadii;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;
import javafx.scene.paint.Color;
import javafx.scene.shape.Circle;
import javafx.scene.shape.Polygon;
import javafx.scene.shape.Rectangle;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.IntConsumer;

/**
 * 键盘绑定选择器 —— 1:1 复刻原版 {@code SigmaKeybindManager.vue}
 * （对应 sigmarebase 的 {@code Keyboard.java} / {@code Keys.java} / {@code Child.java}）。
 *
 * <p>几何全是原版写死的常量：
 * <pre>
 *   底板  1100 x 402，圆角 14，#FEFEFE
 *   内阴影 inset 7，圆角 20，rgba(254,254,254,0.5)
 *   键位层 位于底板内 (20,20)，尺寸 1060 x 357
 *   键帽 63 高，行距 74；底 #D0D0D0（下移 5px、圆角 8），面 #F0F0F0（圆角 8）
 *   悬停/按下：底 -&gt; #DEDEDE，面/标签/图形/描边整体上抬 3px（0.1s 线性）
 *   标签 JelloLight 20px #010101 40%；已绑定换 JelloMedium 且 60%
 *   强调键（教程里的 RSHIFT）：标签 #FF4D4F + 2px 同色描边 + 3px 同色外发光
 * </pre>
 *
 * <p><b>这里不用字形图集</b>：原版的键帽标签是 CSS 字体
 * （{@code font-family: 'JelloLight'}），不是 {@code SigmaText} 的画布，
 * 所以 Java 侧也用 Label 走字体渲染。
 */
public final class KeybindKeyboard extends Pane {

    private static final double PLATE_W = 1100;
    private static final double PLATE_H = 402;
    private static final double KEYS_INSET = 20;
    private static final double KEY_H = 63;
    private static final double ROW_STEP = 74;

    private static final Color WHITE = Color.web("#fefefe");
    private static final Color CAP = Color.web("#f0f0f0");
    private static final Color BASE = Color.web("#d0d0d0");
    private static final Color BASE_HOVER = Color.web("#dedede");
    private static final Color LABEL = Color.color(1 / 255.0, 1 / 255.0, 1 / 255.0, 0.4);
    private static final Color LABEL_BOUND = Color.color(1 / 255.0, 1 / 255.0, 1 / 255.0, 0.6);
    private static final Color GLYPH = Color.color(1 / 255.0, 1 / 255.0, 1 / 255.0, 0.3);
    private static final Color GLYPH_BOUND = Color.color(1 / 255.0, 1 / 255.0, 1 / 255.0, 0.5);
    private static final Color HIGHLIGHT = Color.web("#ff4d4f");
    private static final Color CAPS_DOT = Color.web("#6dce27");

    /** 键位表：[x, 宽度, 标签, GLFW 键码, 行号]，原样照抄，不做任何推导。 */
    private static final Object[][] RAW = {
        {0, 63, "`", 96, 1}, {73, 63, "1", 49, 1}, {145, 63, "2", 50, 1},
        {218, 63, "3", 51, 1}, {290, 63, "4", 52, 1}, {363, 63, "5", 53, 1},
        {436, 63, "6", 54, 1}, {508, 63, "7", 55, 1}, {580, 63, "8", 56, 1},
        {653, 63, "9", 57, 1}, {726, 63, "0", 48, 1}, {798, 63, "-", 45, 1},
        {870, 63, "=", 61, 1}, {943, 117, "Back", 259, 1},
        {0, 99, "Tab", 258, 2}, {108, 63, "Q", 81, 2}, {181, 63, "W", 87, 2},
        {253, 63, "E", 69, 2}, {325, 63, "R", 82, 2}, {399, 63, "T", 84, 2},
        {471, 63, "Y", 89, 2}, {543, 63, "U", 85, 2}, {615, 63, "I", 73, 2},
        {689, 63, "O", 79, 2}, {761, 63, "P", 80, 2}, {833, 63, "[", 91, 2},
        {905, 63, "]", 93, 2}, {978, 82, "\\", 92, 2},
        {0, 116, "Caps Lock", 280, 3}, {127, 63, "A", 65, 3}, {199, 63, "S", 83, 3},
        {271, 63, "D", 68, 3}, {343, 63, "F", 70, 3}, {417, 63, "G", 71, 3},
        {489, 63, "H", 72, 3}, {561, 63, "J", 74, 3}, {633, 63, "K", 75, 3},
        {707, 63, "L", 76, 3}, {779, 63, ";", 59, 3}, {851, 63, "'", 39, 3},
        {924, 136, "Return", 257, 3},
        {0, 153, "Shift", 340, 4}, {164, 63, "Z", 90, 4}, {236, 63, "X", 88, 4},
        {308, 63, "C", 67, 4}, {381, 63, "V", 86, 4}, {454, 63, "B", 66, 4},
        {526, 63, "N", 78, 4}, {598, 63, "M", 77, 4}, {671, 63, ",", 44, 4},
        {744, 63, ".", 46, 4}, {816, 63, "/", 47, 4}, {888, 172, "Shift", 344, 4},
        {0, 97, "Ctrl", 341, 5}, {106, 63, "Meta", 343, 5}, {178, 103, "Alt", 342, 5},
        {290, 427, "Space", 32, 5}, {726, 97, "Alt Gr", 346, 5},
        {833, 63, "Meta", 347, 5}, {905, 63, "Menu", 348, 5}, {978, 82, "Ctrl", 345, 5},
    };

    /** 一个键帽：底不抬、面/标签/图形/描边抬 3px。 */
    private static final class Cap {
        private final Pane root;
        private final Region base;
        private final List<Node> movers = new ArrayList<>();
        private final Map<Node, Double> baseY = new HashMap<>();
        private final List<Node> glyphs = new ArrayList<>();
        private Label label;
        private Circle capsDot;
        private final Rectangle ring;
        private final int code;
        private final boolean bound;
        private final boolean highlighted;
        private boolean lifted;
        private boolean selected;

        private Cap(Pane root, Region base, Rectangle ring, int code,
                    boolean bound, boolean highlighted) {
            this.root = root;
            this.base = base;
            this.ring = ring;
            this.code = code;
            this.bound = bound;
            this.highlighted = highlighted;
        }

        private void lift(Node n) {
            movers.add(n);
            baseY.put(n, n.getLayoutY());
        }

        private void restyle() {
            boolean up = lifted || selected;
            base.setBackground(new Background(new BackgroundFill(
                    up ? BASE_HOVER : BASE, new CornerRadii(8), null)));
            for (Node n : movers) {
                n.setLayoutY(baseY.get(n) - (up ? 3 : 0));
            }
            Color textColor = highlighted ? HIGHLIGHT : bound ? LABEL_BOUND : LABEL;
            if (label != null) {
                label.setTextFill(textColor);
            }
            for (Node g : glyphs) {
                if (g instanceof javafx.scene.shape.Shape s) {
                    s.setFill(bound ? GLYPH_BOUND : GLYPH);
                }
            }
            if (capsDot != null) {
                capsDot.setFill(up ? CAPS_DOT : Color.TRANSPARENT);
            }
        }
    }

    private final List<Cap> caps = new ArrayList<>();
    private final Set<Integer> highlight;
    private IntConsumer onSelect;

    public KeybindKeyboard(Set<Integer> boundKeys, Set<Integer> highlightKeys) {
        this.highlight = highlightKeys == null ? Set.of() : highlightKeys;
        Set<Integer> bound = boundKeys == null ? Set.of() : boundKeys;

        // 底板：底色 + 7px 内缩的 rgba(254,254,254,0.5) 圆角阴影层
        Region plate = new Region();
        plate.setPrefSize(PLATE_W, PLATE_H);
        plate.setBackground(new Background(
                new BackgroundFill(WHITE, new CornerRadii(14), null),
                new BackgroundFill(Color.color(254 / 255.0, 254 / 255.0, 254 / 255.0, 0.5),
                        new CornerRadii(20), new javafx.geometry.Insets(7))));
        plate.setMouseTransparent(true);
        getChildren().add(plate);

        Pane layer = new Pane();
        layer.setLayoutX(KEYS_INSET);
        layer.setLayoutY(KEYS_INSET);
        getChildren().add(layer);

        for (Object[] row : RAW) {
            caps.add(buildKey(layer, (int) row[0], (int) row[1], (String) row[2],
                    (int) row[3], (int) row[4], bound));
        }
        for (Cap c : caps) {
            c.restyle();
        }
    }

    private Cap buildKey(Pane layer, int x, int width, String text, int code, int row,
                         Set<Integer> bound) {
        boolean isBound = bound.contains(code);
        boolean isHighlight = highlight.contains(code);

        Pane root = new Pane();
        root.setLayoutX(x);
        root.setLayoutY((row - 1) * ROW_STEP);
        root.setPrefSize(width, KEY_H);
        root.setMinSize(width, KEY_H);
        root.setMaxSize(width, KEY_H);
        root.setBackground(javafx.scene.layout.Background.fill(Color.TRANSPARENT));

        // 底：top 5px、bottom 0，所以高 58
        Region base = round(0, 5, width, KEY_H - 5, 8, BASE);
        root.getChildren().add(base);

        Rectangle ring = null;
        Cap cap = new Cap(root, base, null, code, isBound, isHighlight);

        // 面
        cap.lift(round(0, 0, width, KEY_H, 8, CAP));

        switch (text) {
            case "Space" -> {
                // 原版 .kbm-glyph 对 Space 是空的
            }
            case "Meta" -> cap.glyphs.add(glyphDot(18, 18, 28));
            case "Menu" -> {
                for (int i = 0; i < 4; i++) {
                    cap.glyphs.add(round(25, 25 + i * 4, 14, 3, 2, GLYPH));
                }
            }
            case "Back" -> {
                Polygon arrow = new Polygon(43, 30, 49, 33.5, 43, 37);
                arrow.setFill(GLYPH);
                arrow.setMouseTransparent(true);
                cap.glyphs.add(arrow);
                cap.glyphs.add(round(49, 32, 21, 2, 0, GLYPH));
            }
            case "Return" -> {
                cap.glyphs.add(round(56, 32, 21, 2, 0, GLYPH));
                cap.glyphs.add(round(75, 25, 2, 8, 0, GLYPH));
            }
            default -> {
                Label l = new Label(text);
                l.setFont(isBound ? Assets.medium(20) : Assets.light(20));
                l.setLayoutX(0);
                l.setLayoutY(19);
                l.setPrefWidth(width);
                l.setPrefHeight(22);
                l.setAlignment(Pos.CENTER);
                l.setMouseTransparent(true);
                cap.lift(l);
                cap.label = l;
            }
        }
        for (Node g : cap.glyphs) {
            cap.lift(g);
        }

        if ("Caps Lock".equals(text)) {
            Circle dot = new Circle(14, 11, 10);
            dot.setFill(Color.TRANSPARENT);
            dot.setMouseTransparent(true);
            cap.capsDot = dot;
        }

        if (isHighlight) {
            ring = new Rectangle(width + 4, KEY_H + 4);
            ring.setLayoutX(-2);
            ring.setLayoutY(-2);
            ring.setArcWidth(20);
            ring.setArcHeight(20);
            ring.setFill(Color.TRANSPARENT);
            ring.setStroke(HIGHLIGHT);
            ring.setStrokeWidth(2);
            // 对应 box-shadow: 0 0 0 3px rgba(255,77,79,0.18)
            ring.setEffect(new DropShadow(3, 0, 0,
                    Color.color(HIGHLIGHT.getRed(), HIGHLIGHT.getGreen(),
                            HIGHLIGHT.getBlue(), 0.18)));
            cap.lift(ring);
        }

        // 组装顺序：底 -> 面/文字/图形/描边（描边已在 movers 里，强调键自然压在最上层）
        root.getChildren().addAll(cap.movers);
        if (cap.capsDot != null) {
            root.getChildren().add(cap.capsDot);
        }

        root.setOnMouseEntered(e -> {
            cap.lifted = true;
            cap.restyle();
        });
        root.setOnMouseExited(e -> {
            cap.lifted = false;
            cap.restyle();
        });
        root.setOnMousePressed(e -> {
            for (Cap c : caps) {
                c.selected = c.code == code;
            }
            for (Cap c : caps) {
                c.restyle();
            }
            if (onSelect != null) {
                onSelect.accept(code);
            }
        });

        layer.getChildren().add(root);
        return cap;
    }

    private static Circle glyphDot(double x, double y, double size) {
        Circle c = new Circle(x + size / 2, y + size / 2, size / 2);
        c.setFill(GLYPH);
        c.setMouseTransparent(true);
        return c;
    }

    private static Region round(double x, double y, double w, double h, double r, Color c) {
        Region region = new Region();
        region.setLayoutX(x);
        region.setLayoutY(y);
        region.setPrefSize(w, h);
        region.setBackground(new Background(
                new BackgroundFill(c, new CornerRadii(r), null)));
        region.setMouseTransparent(true);
        return region;
    }

    public void onSelect(IntConsumer c) {
        this.onSelect = c;
    }

    /** 当前按下的键码（GLFW）。 */
    public int selected() {
        return caps.stream().filter(c -> c.selected).findFirst().map(c -> c.code).orElse(-1);
    }

    /** 键帽总数，供离屏校验用。 */
    public int keyCount() {
        return caps.size();
    }

    public static double plateWidth() {
        return PLATE_W;
    }

    public static double plateHeight() {
        return PLATE_H;
    }
}