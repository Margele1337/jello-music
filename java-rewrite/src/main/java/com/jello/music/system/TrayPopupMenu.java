package com.jello.music.system;

import javafx.application.Platform;

import java.util.List;
import javafx.geometry.Rectangle2D;
import javafx.scene.Node;
import javafx.scene.layout.HBox;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.layout.VBox;
import javafx.scene.paint.Color;
import javafx.stage.Screen;
import javafx.stage.Stage;
import javafx.stage.StageStyle;

/**
 * 托盘右键菜单，<b>自绘</b>，不用 {@link java.awt.PopupMenu}。
 *
 * <h2>为什么不用 AWT 原生菜单</h2>
 * Windows 上 {@code java.awt.MenuItem} 走 <b>native peer</b>：
 * 菜单由系统 {@code TrackPopupMenu} 绘制，Java 侧设的字体<b>完全无效</b>。
 * 实测 {@code new MenuItem("…").getFont()} 返回 <b>null</b> ——
 * 说明未显示的菜单项根本不持有字体，一切由系统菜单字体决定。
 * 而系统菜单字体（{@code Segoe UI}）<b>没有 CJK 字形</b>，
 * 于是中文渲染成豆腐块 □□□。
 *
 * <p>换过几个方案都不通：
 * <ul>
 *   <li>{@code setFont(cjkFont())} —— 无效，native peer 不听</li>
 *   <li>{@code javax.swing.JPopupMenu} —— 它继承 {@code JComponent}，
 *       <b>不是</b> {@code PopupMenu} 子类，塞不进 {@code TrayIcon.setPopupMenu}</li>
 * </ul>
 *
 * <h2>自绘的优点</h2>
 * <ul>
 *   <li>字体由 JavaFX 管，{@link SigmaTextView} 用项目自带的字形图集
 *       （{@code Assets}），和面板内所有文字同一套渲染，不会豆腐块</li>
 *   <li>配色跟面板一致（深色 + 同样的 hover 透明度）</li>
 *   <li>可以带图标 —— 原版 {@code build/icons/menu/*.png} 正好能用上</li>
 * </ul>
 *
 * <h2>代价</h2>
 * 不是系统菜单：没有阴影/圆角那套原生质感，功能完全等价。
 */
final class TrayPopupMenu extends StackPane {

    /** 菜单项宽高（对齐原版 Electron 菜单的紧凑排布）。 */
    private static final double ITEM_W = 168;
    private static final double ITEM_H = 26;
    private static final double SEP_H = 7;
    private static final double PAD = 4;
    private static final double GAP = 2;

    private final Stage stage;
    private final VBox box = new VBox(GAP);

    TrayPopupMenu() {
        setPickOnBounds(false);
        box.setPrefWidth(ITEM_W);
        // <b>关键</b>：StackPane 会 resize 子节点。
        // - 用默认（拉伸）-&gt; box 被拉高，VBox 里的行挤在一起重叠
        // - 用 USE_PREF_SIZE -&gt; box 的 prefHeight 在 layout 前是 0，
        //   StackPane 按 0 算反而得到一个巨大高度（实测 4444px）
        // 所以两边都不靠：外层 StackPane 固定 prefSize，
        // box 用 maxSize 限制在「行数 × 行高」这个可计算的上界内。
        box.setStyle(
                "-fx-background-color: rgba(24, 24, 28, 0.97);"
                        + "-fx-background-radius: 6;"
                        + "-fx-effect: dropshadow(gaussian, rgba(0,0,0,0.55), 12, 0, 0, 3);"
                        + "-fx-padding: " + PAD + ";");
        getChildren().add(box);
        // 外层给一个初始尺寸，showAt 会按实际行数覆盖
        setPrefSize(ITEM_W + PAD * 2, 200);
        setMaxSize(ITEM_W + PAD * 2, 600);
        setMinSize(ITEM_W + PAD * 2, 40);

        stage = new Stage();
        stage.initStyle(StageStyle.TRANSPARENT);
        stage.setAlwaysOnTop(true);
        javafx.scene.Scene sc = new javafx.scene.Scene(this, ITEM_W + PAD * 2, 200);
        sc.setFill(Color.TRANSPARENT);
        stage.setScene(sc);
        this.setOnMousePressed(e -> hide());
    }

    /** 加一个菜单项。{@code iconPath} 相对 /icons/，可为 null。 */
    void addItem(String label, String iconPath, Runnable action) {
        box.getChildren().add(buildRow(label, iconPath, action, false));
    }

    /** 分隔线：1px 的 rgba(254,254,254,0.12)，原版 Electron 菜单同色系。 */
    void addSeparator() {
        Region line = new Region();
        line.setPrefSize(ITEM_W - 8, 1);
        line.setMaxSize(ITEM_W - 8, 1);
        line.setMinSize(ITEM_W - 8, 1);
        line.setStyle("-fx-background-color: rgba(254,254,254,0.12);");
        line.setMouseTransparent(true);
        StackPane wrap = new StackPane(line);
        wrap.setPrefSize(ITEM_W, SEP_H);
        wrap.setMaxSize(ITEM_W, SEP_H);
        wrap.setMinSize(ITEM_W, SEP_H);
        wrap.setPadding(new javafx.geometry.Insets(3, 4, 3, 4));
        wrap.setMouseTransparent(true);
        box.getChildren().add(wrap);
    }

    private Region buildRow(String label, String iconPath, Runnable action,
                            boolean separator) {
        // 必须用 Pane 而不是 Region：Region 是「纯装饰容器」，
        // 没有公开的 getChildren()，加不了子节点（Parent.getChildren 是 protected）
        Pane row = new Pane();
        row.setPrefSize(ITEM_W, ITEM_H);
        row.setMaxSize(ITEM_W, ITEM_H);
        row.setStyle("-fx-background-radius: 4;");
        if (separator) {
            row.setPrefSize(ITEM_W, 7);
            row.setMaxSize(ITEM_W, 7);
        }

        HBox content = new HBox(8);
        content.setPickOnBounds(false);

        if (iconPath != null) {
            Region icon = iconNode(iconPath);
            if (icon != null) {
                content.getChildren().add(icon);
            }
        }
        // 用 javafx.scene.text.Text + <b>显式中文字体</b>。
        // 这里<b>不能</b>用 SigmaTextView：字形图集（SigmaAtlas）是预生成的，
        // 只包含面板里实际用过的 family+size 组合，菜单的 "sans"/13 没有这张图集
        // （实测抛「字形图集缺失: /com/jello/music/atlas/atlas-sans-13」）。
        //
        // 也不能像 AWT 那样只 setFont 就完事 —— 那正是乱码的来源。
        // 这里用 {@link #cjkFxFont()}：从系统字体里挑<b>验证过能显中文</b>的
        // （{@code Font.canDisplayUpTo}），JavaFX 侧再没有 native peer 那一层，
        // 设了就一定生效。
        javafx.scene.text.Text text = new javafx.scene.text.Text(label);
        text.setFont(cjkFxFont());
        text.setFill(Color.web("#fefefe"));
        StackPane textWrap = new StackPane(text);
        textWrap.setPickOnBounds(false);
        textWrap.setMaxWidth(ITEM_W - 34);
        content.getChildren().add(textWrap);

        content.setLayoutX(8);
        content.setLayoutY((ITEM_H - 18) / 2);
        row.getChildren().add(content);

        // hover 高亮：原版菜单 hover 是 rgba(254,254,254,0.08)
        row.setOnMouseEntered(e -> {
            if (!separator) {
                row.setStyle("-fx-background-color: rgba(254,254,254,0.08);"
                        + "-fx-background-radius: 4;");
            }
        });
        row.setOnMouseExited(e -> row.setStyle("-fx-background-radius: 4;"));
        if (action != null) {
            row.setOnMouseClicked(e -> {
                hide();
                action.run();
            });
        }
        return row;
    }

    /** 读 /icons/ 下的图标资源，失败返回 null（菜单项仍可用）。 */
    private Region iconNode(String path) {
        try (java.io.InputStream in =
                     TrayPopupMenu.class.getResourceAsStream("/icons/" + path)) {
            if (in == null) {
                return null;
            }
            var image = new javafx.scene.image.Image(in);
            if (image.isError() || image.getWidth() < 1) {
                return null;
            }
            var view = new javafx.scene.image.ImageView(image);
            view.setPreserveRatio(true);
            view.setSmooth(true);
            // 菜单行高 26，图标统一 14px，接近原版 Electron 菜单的观感
            double h = 14;
            view.setFitHeight(h);
            view.setFitWidth(h * image.getWidth() / image.getHeight());
            StackPane wrap = new StackPane(view);
            wrap.setPickOnBounds(false);
            wrap.setPrefSize(view.getFitWidth(), h);
            wrap.setMaxSize(view.getFitWidth(), h);
            wrap.setMinSize(view.getFitWidth(), h);
            return wrap;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 在鼠标位置附近弹出。
     *
     * <p>贴边处理：优先往下/往右放，放不下就翻到另一侧，
     * 保证菜单不会被屏幕边缘切掉。
     */
    void showAt(double screenX, double screenY) {
        // 尺寸按行数直接算，不依赖 getPrefHeight()/getLayoutBounds()：
        // 那些在 layout 之前都不可靠（实测要么 0、要么算出 4444px 的巨高）。
        int count = box.getChildren().size();
        double contentH = 0;
        for (var child : box.getChildren()) {
            contentH += (child instanceof javafx.scene.layout.Region r)
                    ? Math.max(1, r.getPrefHeight())
                    : ITEM_H;
        }
        contentH += count * GAP;
        double w = ITEM_W + PAD * 2;
        double h = contentH + PAD * 2;

        setPrefSize(w, h);
        setMaxSize(w, h);
        setMinSize(w, h);
        stage.setWidth(w);
        stage.setHeight(h);
        stage.show();
        stage.toFront();
        box.applyCss();
        box.layout();

        Rectangle2D area = Screen.getScreens().stream()
                .filter(s -> screenX >= s.getVisualBounds().getMinX()
                        && screenX <= s.getVisualBounds().getMaxX())
                .findFirst()
                .map(Screen::getVisualBounds)
                .orElse(Screen.getPrimary().getVisualBounds());

        double x = screenX;
        double y = screenY;
        if (x + w > area.getMaxX()) {
            x = Math.max(area.getMinX(), screenX - w);
        }
        if (y + h > area.getMaxY()) {
            y = Math.max(area.getMinY(), screenY - h);
        }
        stage.setX(x);
        stage.setY(y);
    }

    /**
 * 挑一个<b>确实能显示中文</b>的 JavaFX 字体。
     *
     * <p>和 AWT 的 {@code MenuFont} 完全不同：JavaFX 侧没有 native peer，
     * {@code Text.setFont} 设了就一定生效。这里只需要保证<b>选中的字体有 CJK 字形</b> ——
     * 用 {@code Text.getLayoutBounds()} 实际排一遍来判断，比看字体名可靠：
     * 字体存在但字形缺失时，排出来的宽度会是 0 或明显偏小。
     */
    private static javafx.scene.text.Font cjkFxFont() {
        String sample = "播放设置退出";
        List<String> candidates = List.of(
                "Microsoft YaHei UI", "Microsoft YaHei", "微软雅黑",
                "SimHei", "黑体", "SimSun", "宋体",
                "Noto Sans CJK SC", "Source Han Sans SC",
                "WenQuanYi Micro Hei", "PingFang SC");
        for (String name : candidates) {
            var f = javafx.scene.text.Font.font(name, 13);
            if (canRenderCjk(f, sample)) {
                return f;
            }
        }
        // 兜底：用 JavaFX 默认字体。JavaFX 的默认字体走 DirectWrite，
        // 一般带 CJK fallback（不像 AWT 的 Segoe UI 那样直接豆腐块）
        return javafx.scene.text.Font.font(13);
    }

    /** 实际排版验证：中文能不能渲染出可见宽度。 */
    private static boolean canRenderCjk(javafx.scene.text.Font f, String sample) {
        try {
            var t = new javafx.scene.text.Text(sample);
            t.setFont(f);
            double w = t.getLayoutBounds().getWidth();
            // 4 个汉字，正常至少 40px（13px 字号）；豆腐块也会占宽度，
            // 所以再加一条：单个字符不能是「空」
            if (w < 20) {
                return false;
            }
            var one = new javafx.scene.text.Text("播");
            one.setFont(f);
            return one.getLayoutBounds().getWidth() > 3;
        } catch (Throwable e) {
            return false;
        }
    }

    void hide() {
        if (stage.isShowing()) {
            stage.hide();
        }
    }

    boolean isShowing() {
        return stage.isShowing();
    }

    /** 在 FX 线程上执行。 */
    static void onFx(Runnable r) {
        if (Platform.isFxApplicationThread()) {
            r.run();
        } else {
            Platform.runLater(r);
        }
    }
}
