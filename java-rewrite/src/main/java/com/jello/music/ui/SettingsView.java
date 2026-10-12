package com.jello.music.ui;

import com.jello.music.AppPrefs;
import com.jello.music.model.Settings;

import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Label;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Border;
import javafx.scene.layout.BorderStroke;
import javafx.scene.layout.BorderStrokeStyle;
import javafx.scene.layout.CornerRadii;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.layout.VBox;
import javafx.scene.paint.Color;
import javafx.scene.paint.Paint;
import javafx.scene.shape.Rectangle;
import javafx.scene.text.TextAlignment;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * 设置页（自研版，不是原版布局）。
 *
 * <p>原版是「220px 侧栏 + 卡片网格」，那是给浏览器整页用的；这里窗口只有 800x600，
 * 塞不下也没必要——所以改成<b>左侧分类栏 + 右侧紧凑行</b>：一行一个设置，
 * 左侧 180px 列分类，右侧可滚动，每类底部一个「重置本类」。
 *
 * <p>配色沿用面板既有的深色底与 #fefefe 文字，不用原版的卡片阴影，
 * 免得在 800x600 的小面板里显得脏。
 */
public final class SettingsView extends Pane {

    private static final double RAIL_W = 180;
    private static final double ROW_H = 46;
    private static final double PAD = 20;
    private static final double GAP = 10;

    // 沿用登录页的深色体系
    private static final Color BG = Color.web("#14161b");
    private static final Color CARD_BG = Color.color(1, 1, 1, 0.04);
    private static final Color CARD_BORDER = Color.color(1, 1, 1, 0.08);
    private static final Color TEXT = Color.web("#e6e3ee");
    private static final Color MUTED = Color.web("#9b96a8");
    private static final Color ACCENT = Color.web("#e18fa8");

    private final List<Settings.Section> sections = Settings.sections();
    private final Map<String, String> values = new LinkedHashMap<>(Settings.defaults());

    /** 每项当前值发生变化时回调（key, value）。 */
    private final Map<String, Consumer<String>> onChange = new LinkedHashMap<>();
    /** ACTION 项点击回调。 */
    private final Map<String, Runnable> actions = new LinkedHashMap<>();
    private Runnable onBack;

    private final VBox contentBox = new VBox();
    private final List<Label> railItems = new ArrayList<>();
    private int activeSection;

    // 行控件的引用，重置/切换时刷新
    private final Map<String, Region> rowValueNodes = new LinkedHashMap<>();

    public SettingsView() {
        setPrefSize(Theme.PANEL_W, Theme.PANEL_H);
        setMinSize(Theme.PANEL_W, Theme.PANEL_H);
        setMaxSize(Theme.PANEL_W, Theme.PANEL_H);
        setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(BG, null, null)));

        Pane rail = buildRail();
        rail.setLayoutX(0);
        rail.setLayoutY(0);
        rail.setPrefSize(RAIL_W, Theme.PANEL_H);
        getChildren().add(rail);

        contentBox.setLayoutX(RAIL_W + PAD);
        contentBox.setLayoutY(PAD);
        contentBox.setPrefWidth(Theme.PANEL_W - RAIL_W - PAD * 2);
        contentBox.setSpacing(GAP);
        getChildren().add(contentBox);

        buildBackButton();
        rebuildContent();
    }

    // ================= 侧栏 =================

    private Pane buildRail() {
        Pane rail = new Pane();
        rail.setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(Color.color(0, 0, 0, 0.35), null, null)));
        Label title = new Label("设置");
        title.setFont(Assets.medium(18));
        title.setTextFill(TEXT);
        title.setLayoutX(PAD);
        title.setLayoutY(PAD);
        rail.getChildren().add(title);

        double y = PAD + 40;
        for (int i = 0; i < sections.size(); i++) {
            final int index = i;
            Label item = new Label(sections.get(i).title);
            item.setFont(Assets.medium(15));
            item.setPrefSize(RAIL_W - PAD * 2, 38);
            item.setAlignment(Pos.CENTER_LEFT);
            item.setLayoutX(PAD);
            item.setLayoutY(y);
            item.setStyle("-fx-padding: 0 12 0 12; -fx-background-radius: 8;");
            item.setOnMouseEntered(e -> paintRailItem(item, index, true));
            item.setOnMouseExited(e -> paintRailItem(item, index, false));
            item.setOnMouseClicked(e -> setActiveSection(index));
            rail.getChildren().add(item);
            railItems.add(item);
            y += 46;
        }
        return rail;
    }

    private void paintRailItem(Label item, int index, boolean hover) {
        if (index == activeSection) {
            item.setBackground(new javafx.scene.layout.Background(
                    new javafx.scene.layout.BackgroundFill(Color.color(1, 1, 1, 0.10),
                            new CornerRadii(8), null)));
            item.setTextFill(ACCENT);
        } else {
            item.setBackground(hover
                    ? new javafx.scene.layout.Background(new javafx.scene.layout.BackgroundFill(
                    Color.color(1, 1, 1, 0.05), new CornerRadii(8), null))
                    : null);
            item.setTextFill(TEXT);
        }
    }

    private void setActiveSection(int index) {
        activeSection = index;
        for (int i = 0; i < railItems.size(); i++) {
            railItems.get(i).setBackground(null);
            railItems.get(i).setTextFill(TEXT);
        }
        paintRailItem(railItems.get(index), index, false);
        rebuildContent();
    }

    // ================= 右侧内容 =================

    private void rebuildContent() {
        contentBox.getChildren().clear();
        rowValueNodes.clear();

        Settings.Section sec = sections.get(activeSection);
        Label head = new Label(sec.title);
        head.setFont(Assets.medium(20));
        head.setTextFill(TEXT);
        contentBox.getChildren().add(head);

        for (Settings.Item item : sec.items) {
            contentBox.getChildren().add(buildRow(item));
        }

        // 每类底部的「重置本类」
        Region reset = buildResetButton(sec);
        VBox.setMargin(reset, new Insets(GAP, 0, 0, 0));
        contentBox.getChildren().add(reset);

        Label footer = new Label("Jello Music · Java 版");
        footer.setFont(Assets.light(12));
        footer.setTextFill(MUTED);
        footer.setAlignment(Pos.CENTER);
        footer.setPrefWidth(contentBox.getPrefWidth());
        VBox.setMargin(footer, new Insets(16, 0, 0, 0));
        contentBox.getChildren().add(footer);
    }

    private Region buildRow(Settings.Item item) {
        // 注意用 Pane 而不是 Region：Parent.getChildren() 是 protected，
        // 只有声明成 Pane/StackPane 这类具体子类才拿得到可变列表
        Pane row = new Pane();
        row.setPrefSize(contentBox.getPrefWidth(), ROW_H);
        row.setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(CARD_BG, new CornerRadii(10), null)));
        row.setBorder(new Border(new BorderStroke(CARD_BORDER, BorderStrokeStyle.SOLID,
                new CornerRadii(10), BorderStroke.THIN, Insets.EMPTY)));

        Label label = new Label(item.label);
        label.setFont(Assets.light(14));
        label.setTextFill(TEXT);
        label.setLayoutX(16);
        label.setLayoutY(ROW_H / 2 - 9);
        row.getChildren().add(label);

        Region value = buildValueControl(item);
        value.setLayoutX(contentBox.getPrefWidth() - 200);
        value.setLayoutY((ROW_H - value.getPrefHeight()) / 2);
        row.getChildren().add(value);
        rowValueNodes.put(item.key, value);
        return row;
    }

    private Region buildValueControl(Settings.Item item) {
        return switch (item.kind) {
            case TOGGLE -> buildToggle(item);
            case CHOICE -> buildChoice(item);
            case SLIDER -> buildSlider(item);
            case ACTION -> buildActionButton(item);
            default -> new Region();
        };
    }

    private Region buildToggle(Settings.Item item) {
        StackPane sw = new StackPane();
        double w = 44;
        double h = 24;
        sw.setPrefSize(w, h);
        boolean on = "on".equals(valueOf(item));
        Region knob = new Region();
        knob.setPrefSize(18, 18);
        knob.setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(Color.web("#ffffff"),
                        new CornerRadii(9), null)));
        StackPane.setAlignment(knob, on ? Pos.CENTER_RIGHT : Pos.CENTER_LEFT);
        sw.setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(on ? ACCENT : Color.color(1, 1, 1, 0.18),
                        new CornerRadii(12), null)));
        Insets pad = new Insets(3, 3, 3, 3);
        sw.setPadding(pad);
        sw.getChildren().add(knob);
        sw.setOnMouseClicked(e -> {
            setValue(item.key, "on".equals(valueOf(item)) ? "off" : "on");
            refreshValue(item);
        });
        return sw;
    }

    private Region buildChoice(Settings.Item item) {
        HBox box = new HBox(8);
        box.setPrefSize(200, 30);
        box.setAlignment(Pos.CENTER_LEFT);
        Label text = new Label(currentDisplay(item));
        text.setFont(Assets.light(13));
        text.setTextFill(TEXT);
        box.getChildren().add(text);

        Label prev = arrow("‹");
        Label next = arrow("›");
        box.getChildren().addAll(prev, next);

        prev.setOnMouseClicked(e -> {
            int i = item.options.indexOf(valueOf(item));
            setValue(item.key, item.options.get((i - 1 + item.options.size()) % item.options.size()));
            refreshValue(item);
        });
        next.setOnMouseClicked(e -> {
            int i = item.options.indexOf(valueOf(item));
            setValue(item.key, item.options.get((i + 1) % item.options.size()));
            refreshValue(item);
        });
        return box;
    }

    private Label arrow(String s) {
        Label a = new Label(s);
        a.setFont(Assets.medium(18));
        a.setTextFill(MUTED);
        a.setPrefSize(24, 30);
        a.setAlignment(Pos.CENTER);
        a.setOnMouseEntered(e -> a.setTextFill(TEXT));
        a.setOnMouseExited(e -> a.setTextFill(MUTED));
        return a;
    }

    private Region buildSlider(Settings.Item item) {
        VBox box = new VBox(2);
        box.setPrefSize(200, 34);
        Label text = new Label(currentDisplay(item));
        text.setFont(Assets.light(12));
        text.setTextFill(MUTED);
        box.getChildren().add(text);

        Track track = new Track(item);
        track.setPrefSize(200, 6);
        box.getChildren().add(track);
        return box;
    }

    /** 一条简易滑块（自己画，省得跟原来的音量条耦合）。 */
    private final class Track extends Region {
        private final Settings.Item item;
        private final javafx.scene.shape.Rectangle fill = new javafx.scene.shape.Rectangle();

        Track(Settings.Item item) {
            this.item = item;
            fill.setArcWidth(6);
            fill.setArcHeight(6);
            fill.setFill(ACCENT);
            getChildren().add(fill);
            setBackground(new javafx.scene.layout.Background(
                    new javafx.scene.layout.BackgroundFill(Color.color(1, 1, 1, 0.15),
                            new CornerRadii(3), null)));
            setOnMouseDragged(e -> {
                double p = Math.max(0, Math.min(1, e.getX() / getWidth()));
                setValue(item.key, fmt(item, item.min + p * (item.max - item.min)));
                refreshValue(item);
            });
            setOnMouseClicked(e -> {
                double p = Math.max(0, Math.min(1, e.getX() / getWidth()));
                setValue(item.key, fmt(item, item.min + p * (item.max - item.min)));
                refreshValue(item);
            });
        }

        @Override
        protected void layoutChildren() {
            fill.setWidth(Math.max(6, getWidth() * progress()));
            fill.setHeight(getHeight());
            fill.setLayoutX(0);
            fill.setLayoutY(0);
        }

        private double progress() {
            double v = parse(valueOf(item));
            return Math.max(0, Math.min(1, (v - item.min) / (item.max - item.min)));
        }
    }

    private Region buildActionButton(Settings.Item item) {
        StackPane btn = new StackPane();
        btn.setPrefSize(84, 30);
        btn.setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(Color.color(1, 1, 1, 0.10),
                        new CornerRadii(8), null)));
        Label text = new Label(item.buttonText);
        text.setFont(Assets.light(13));
        text.setTextFill(TEXT);
        btn.getChildren().add(text);
        btn.setOnMouseEntered(e -> btn.setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(Color.color(1, 1, 1, 0.16),
                        new CornerRadii(8), null))));
        btn.setOnMouseClicked(e -> {
            Runnable r = actions.get(item.key);
            if (r != null) {
                r.run();
            }
        });
        return btn;
    }

    private Region buildResetButton(Settings.Section sec) {
        StackPane btn = new StackPane();
        btn.setPrefSize(160, 34);
        btn.setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(Color.color(0.95, 0.27, 0.21, 0.85),
                        new CornerRadii(8), null)));
        Label text = new Label("重置「" + sec.title + "」");
        text.setFont(Assets.light(13));
        text.setTextFill(Color.web("#ffffff"));
        btn.getChildren().add(text);
        btn.setOnMouseClicked(e -> {
            for (Settings.Item item : sec.items) {
                if (item.kind != Settings.Kind.ACTION && item.kind != Settings.Kind.DISABLED) {
                    setValue(item.key, item.defaultValue);
                    AppPrefs.setSetting(item.key, item.defaultValue);
                    Consumer<String> cb = onChange.get(item.key);
                    if (cb != null) {
                        cb.accept(item.defaultValue);
                    }
                }
            }
            rebuildContent();
        });
        return btn;
    }

    private void buildBackButton() {
        StackPane back = new StackPane();
        back.setPrefSize(32, 32);
        back.setLayoutX(RAIL_W + PAD - 8);
        back.setLayoutY(PAD - 6);
        back.setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(Color.color(1, 1, 1, 0.06),
                        new CornerRadii(8), null)));
        Label arrow = new Label("‹");
        arrow.setFont(Assets.medium(22));
        arrow.setTextFill(TEXT);
        arrow.setPrefSize(32, 32);
        arrow.setAlignment(Pos.CENTER);
        arrow.setMouseTransparent(true);
        back.getChildren().add(arrow);
        back.setOnMouseClicked(e -> {
            if (onBack != null) {
                onBack.run();
            }
        });
        getChildren().add(back);
    }

    // ================= 取值 / 赋值 =================

    private String valueOf(Settings.Item item) {
        String v = values.get(item.key);
        return v == null ? item.defaultValue : v;
    }

    private void setValue(String key, String value) {
        values.put(key, value);
        AppPrefs.setSetting(key, value);
        Consumer<String> cb = onChange.get(key);
        if (cb != null) {
            cb.accept(value);
        }
    }

    private void refreshValue(Settings.Item item) {
        Region old = rowValueNodes.get(item.key);
        if (old == null) {
            return;
        }
        Region fresh = buildValueControl(item);
        double y = old.getLayoutY();
        StackPane parent = (StackPane) old.getParent();
        int idx = parent.getChildren().indexOf(old);
        parent.getChildren().set(idx, fresh);
        fresh.setLayoutX(old.getLayoutX());
        fresh.setLayoutY(y);
        rowValueNodes.put(item.key, fresh);
    }

    private String currentDisplay(Settings.Item item) {
        if (item.kind == Settings.Kind.CHOICE) {
            int i = item.options.indexOf(valueOf(item));
            return i >= 0 ? displayFor(item, item.options.get(i)) : valueOf(item);
        }
        return valueOf(item) + (item.defaultDisplay != null
                && item.defaultDisplay.endsWith("x") ? "x" : "");
    }

    private String displayFor(Settings.Item item, String value) {
        return switch (value) {
            case "128" -> "标准音质 128K";
            case "320" -> "高品音质 320K";
            case "flac" -> "FLAC 无损";
            case "high" -> "Hi-Res 无损";
            case "viper_atmos" -> "蝰蛇全景";
            case "viper_clear" -> "蝰蛇超清";
            case "viper_tape" -> "蝰蛇母带";
            default -> value;
        };
    }

    private double parse(String v) {
        try {
            return Double.parseDouble(v);
        } catch (Exception e) {
            return 0;
        }
    }

    private String fmt(Settings.Item item, double v) {
        return String.valueOf(Math.round(v * 1000.0) / 1000.0);
    }

    // ================= 对外 =================

    public void onBack(Runnable r) {
        this.onBack = r;
    }

    public void onChange(String key, Consumer<String> cb) {
        onChange.put(key, cb);
    }

    public void onAction(String key, Runnable r) {
        actions.put(key, r);
    }

    /** 从 AppPrefs 读回所有设置（构造后调一次）。 */
    public void loadFromPrefs() {
        for (Settings.Item item : Settings.defaults().keySet().isEmpty()
                ? java.util.List.<Settings.Item>of() : allItems()) {
            values.put(item.key, AppPrefs.getSetting(item.key, item.defaultValue));
        }
        rebuildContent();
    }

    private List<Settings.Item> allItems() {
        List<Settings.Item> out = new ArrayList<>();
        for (Settings.Section s : sections) {
            out.addAll(s.items);
        }
        return out;
    }

    /** 供探针访问 */
    public List<Settings.Section> sections() {
        return sections;
    }

    /** 移除时清掉回调，免得 MainApp 那边握着已回收的视图。 */
    public void dispose() {
        onChange.clear();
        actions.clear();
        onBack = null;
    }

    public String value(String key) {
        Settings.Item i = Settings.find(key);
        return i == null ? null : valueOf(i);
    }
}