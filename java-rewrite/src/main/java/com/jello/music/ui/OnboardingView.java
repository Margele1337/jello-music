package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import javafx.geometry.Pos;
import javafx.scene.control.Label;
import javafx.scene.input.MouseEvent;
import javafx.scene.layout.Pane;
import javafx.scene.layout.Region;
import javafx.scene.layout.StackPane;
import javafx.scene.paint.Color;

import java.util.Set;
import java.util.function.Consumer;

/**
 * 新手教程视图 —— 1:1 复刻原版 {@code SigmaUI.vue} 的 {@code view === 'onboarding'}。
 *
 * <p>结构：{@code rgba(1,1,1,0.25)} 底 + 24px 背景模糊，中间是标题与键盘，
 * 底部 {@code bottom:18px} 一行「1 / 1」和「完成」按钮。
 *
 * <p>标题 JelloMedium 40px #FEFEFE、{@code letter-spacing: 2px}，
 * 并与键盘一起按窗口尺寸等比缩放（{@code min(1, (W-60)/1140, (H-180)/402)}）。
 *
 * <p>入场是 0.8 → 1.0 的 easeOutBack 缩放 + 淡入（220ms）。
 */
public final class OnboardingView extends Pane {

    private static final String TITLE = "快捷呼出";
    /** 教程强调的键：右 Shift 的 GLFW 键码（与 KeyManager 的默认绑定一致）。 */
    private static final int HIGHLIGHT_RSHIFT = 344;
    private static final double SCALE_MARGIN = 60;

    private final KeybindKeyboard keyboard =
            new KeybindKeyboard(Set.of(), Set.of(HIGHLIGHT_RSHIFT));
    private final Label title = new Label(TITLE);
    private final Label step = new Label("1 / 1");
    private final StackPane done = new StackPane();
    private final Label doneText = new Label("完成");

    private Consumer<Integer> onKeySelect;
    private Runnable onFinish;
    private boolean finished;

    public OnboardingView(double width, double height) {
        setPrefSize(width, height);
        setMinSize(width, height);
        setMaxSize(width, height);
        setBackground(javafx.scene.layout.Background.fill(
                Color.color(1 / 255.0, 1 / 255.0, 1 / 255.0, 0.25)));
        setClip(new javafx.scene.shape.Rectangle(width, height));

        // 标题：JelloMedium 40 + letter-spacing 2px + #fefefe
        title.setFont(Assets.medium(40));
        title.setTextFill(Theme.TEXT);
        title.setStyle("-fx-letter-spacing: 2px;");
        getChildren().add(title);

        getChildren().add(keyboard);

        // 底部一行：步数 + 完成按钮（bottom 18px 居中，间距 16px）
        step.setFont(Assets.light(14));
        step.setTextFill(Color.color(254 / 255.0, 254 / 255.0, 254 / 255.0, 0.6));
        step.setMouseTransparent(true);
        getChildren().add(step);

// 用 StackPane 而不是 Region：Region.getChildren() 是 protected，
        // 文字加不进按钮里（之前被加到视图原点，按钮上什么都没有）
        done.setPrefSize(70, 34);
        done.setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(Color.web("#f0f0f0"),
                        new javafx.scene.layout.CornerRadii(8), null)));
        doneText.setFont(Assets.light(15));
        doneText.setTextFill(Color.color(1 / 255.0, 1 / 255.0, 1 / 255.0, 0.7));
        doneText.setMouseTransparent(true);
        done.getChildren().add(doneText);
        done.setOnMouseEntered(e -> done.setBackground(javafx.scene.layout.Background.fill(
                Color.web("#fefefe"))));
        done.setOnMouseClicked(e -> {
            if (onFinish != null) {
                onFinish.run();
            }
        });
        getChildren().add(done);

        keyboard.onSelect(code -> {
            if (onKeySelect != null) {
                onKeySelect.accept(code);
            }
        });

        layout(width, height);
        playIntro();
    }

/**
 * 按窗口尺寸重排。
 *
     * <p><b>关键坑</b>：JavaFX 的 {@code setScaleX/Y} 是<b>绕节点中心</b>缩放的
     * （CSS 的 transform 默认绕左上角），所以「缩放后仍然水平居中」对应的是
     * {@code layoutX = (width - 原始宽) / 2}，跟 scale 无关——
     * 写成 {@code (width - 缩放后宽) / 2} 会整体右移半个身位，键盘直接被推出屏幕。
     *
     * <p>标题和步数的宽度只能在 CSS 之后才量得准，所以这个方法要在视图挂进 Scene、
     * 布局跑过一次之后再调一次。
     */
    public void layout(double width, double height) {
        // 先量一次真实宽度（首次调用时控件还没进 Scene，宽度是 0）
        title.applyCss();
        double titleW = title.prefWidth(-1);
        double stepW = step.prefWidth(-1);
        double doneW = done.prefWidth(-1);

        double scale = Math.min(1,
                Math.min((width - SCALE_MARGIN) / (KeybindKeyboard.plateWidth() + 40),
                        (height - SCALE_MARGIN - 120) / (KeybindKeyboard.plateHeight() + 45)));
        double kbW = KeybindKeyboard.plateWidth();
        double kbH = KeybindKeyboard.plateHeight();

        // 缩放绕中心，所以居中位置只跟原始尺寸有关
        keyboard.setLayoutX((width - kbW) / 2);
        keyboard.setLayoutY((height - kbH) / 2 + 10);
        keyboard.setScaleX(scale);
        keyboard.setScaleY(scale);

        title.setLayoutX((width - titleW) / 2);
        title.setLayoutY((height - kbH * scale) / 2 - 60);
        title.setScaleX(scale);
        title.setScaleY(scale);

        // 底部一行：步数与完成按钮间距 16、整体在 bottom:18px 处居中，
        // 原版是 flex + align-items:center，所以步数要垂直居中于按钮
        double groupW = stepW + 16 + doneW;
        double left = (width - groupW) / 2;
        step.setLayoutX(left);
        step.setLayoutY(height - 18 - 34 + (34 - step.prefHeight(-1)) / 2);
        done.setLayoutX(left + stepW + 16);
        done.setLayoutY(height - 18 - 34);
    }

    /** 入场：0.8 -> 1.0 的 easeOutBack 缩放 + 淡入，220ms（对应原版 kbm-intro）。 */
    private void playIntro() {
        long start = System.nanoTime();
        new AnimationTimer() {
            @Override
            public void handle(long now) {
                double p = Math.min(1.0, (now - start) / (220.0 * 1_000_000.0));
                double eased = easeOutBack(p);
                setScaleX(0.8 + 0.2 * eased);
                setScaleY(0.8 + 0.2 * eased);
                setOpacity(p);
                if (p >= 1.0) {
                    stop();
                }
            }
        }.start();
    }

    /** 原版 cubic-bezier(0.34, 1.56, 0.64, 1) 的等价 easeOutBack。 */
    public static double easeOutBack(double p) {
        double c1 = 1.70158;
        double c3 = c1 + 1;
        return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    }

    public void onKeySelect(Consumer<Integer> c) {
        this.onKeySelect = c;
    }

    public void onFinish(Runnable r) {
        this.onFinish = r;
    }

/** 完成按钮的点击区（Region 的子节点拿不到，就单独暴露出去给外层挂事件）。 */
    public StackPane finishButton() {
        return done;
    }

    /** 底部步数文字。 */
    public Label stepLabel() {
        return step;
    }

    public KeybindKeyboard keyboard() {
        return keyboard;
    }

/** 标题（供离屏校验查字体与文案）。 */
    public javafx.scene.control.Label titleLabel() {
        return title;
    }

    /** 完成按钮的文字，单独暴露（Region.getChildren() 是 protected，拿不到）。 */
    public Label finishLabel() {
        return doneText;
    }

    /** 底板尺寸，供外层算缩放。 */
    public static double plateWidth() {
        return KeybindKeyboard.plateWidth();
    }

    public static double plateHeight() {
        return KeybindKeyboard.plateHeight();
    }

    /** 离屏校验用：键帽数。 */
    public int keyCount() {
        return keyboard.keyCount();
    }
}
