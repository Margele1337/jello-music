package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import javafx.scene.control.Label;
import javafx.scene.layout.Pane;
import javafx.scene.text.Font;
import javafx.scene.text.Text;

/**
 * 跑马灯文字 —— 1:1 复刻原版 {@code SigmaText.vue} 的 {@code scroll} 行为，
 * 对应 sigmarebase 的 {@code MusicPlayer.method13192}。
 *
 * <p>参数全部照抄原版：
 * <ul>
 *   <li>整轮 {@code MARQUEE_CYCLE_MS = 8500}ms</li>
 *   <li>前 40% 完全静止，只在剩下的 60% 里走</li>
 *   <li>缓动用 {@code easeInOutQuad}，位移 {@code shift = textWidth * eased}</li>
 *   <li>额外再左移 {@code MARQUEE_EXTRA_SHIFT * eased}（50px）</li>
 *   <li>透明度按 {@code 1 - eased * 0.75} 衰减</li>
 *   <li>{@code eased > 0} 时在 {@code baseX - shift + textWidth} 处补一份同样文字，
 *       做出「无缝绕回来」的效果</li>
 * </ul>
 *
 * <p>{@code phase} 用来让歌名与歌手错开（原版给歌手传 -1000），
 * 免得两行同时动。
 *
 * <p>文字不超框时不启动动画，行为与原版一致（原版只在
 * {@code textWidth > boxWidth} 时才进 marquee 分支）。
 */
public final class MarqueeText extends Pane {

    private static final long CYCLE_MS = 8500L;
    private static final double EXTRA_SHIFT = 50;
    private static final double FADE = 0.75;
    private static final double PAUSE_FRACTION = 0.4;

    private final double boxW;
    private final double size;
    private final long phaseMs;
    private final Font font;
    private final Label main = new Label();
    private final Label loop = new Label();

    private AnimationTimer timer;
    private String text = "";

    public MarqueeText(double boxW, double size, long phaseMs) {
        this.boxW = boxW;
        this.size = size;
        this.phaseMs = phaseMs;
        this.font = Assets.light(size);

        main.setFont(font);
        loop.setFont(font);
        main.setTextFill(Theme.TEXT);
        loop.setTextFill(Theme.TEXT);
        main.setWrapText(false);
        loop.setWrapText(false);
        loop.setOpacity(0);
        loop.setMouseTransparent(true);
        main.setMouseTransparent(true);
        getChildren().addAll(main, loop);

        setPrefSize(boxW, size + 6);
        setMinSize(boxW, size + 6);
        setMaxSize(boxW, size + 6);
        // 视口裁切：超出的部分不画，超出框的文字靠平移露出
        setClip(new javafx.scene.shape.Rectangle(boxW, size + 6));
    }

    public long phaseMs() {
        return phaseMs;
    }

    public void setText(String s) {
        this.text = s == null ? "" : s;
        main.setText(this.text);
        loop.setText(this.text);
        if (this.text.isEmpty() || textWidth() <= boxW) {
            stopTimer();
            main.setLayoutX(0);
            main.setOpacity(1);
            loop.setOpacity(0);
        } else {
            startTimer();
        }
    }

    private double textWidth() {
        if (text.isEmpty()) {
            return 0;
        }
        Text t = new Text(text);
        t.setFont(font);
        return t.getLayoutBounds().getWidth();
    }

    private void startTimer() {
        if (timer != null) {
            return;
        }
        timer = new AnimationTimer() {
            @Override
            public void handle(long now) {
                double p = progress(now / 1_000_000L);
                double eased = easeInOutQuad(p);
                double tw = textWidth();
                if (tw <= 0) {
                    return;
                }
                double visible = Math.min(boxW, tw);
                double baseX = Math.floor((boxW - visible) / 2);
                double shift = tw * eased;

                main.setLayoutX(baseX - shift - EXTRA_SHIFT * eased);
                main.setOpacity(1 - eased * FADE);

                // 补一份同样的文字做出环；框太窄装不下第二份时就别画
                if (eased > 0 && tw < boxW * 2) {
                    loop.setLayoutX(baseX - shift + tw);
                    loop.setOpacity(1);
                } else {
                    loop.setOpacity(0);
                }
            }
        };
        timer.start();
    }

    /**
     * 整轮 8500ms：前 40% 静止，剩下 60% 走完一个 easeInOutQuad。
     * <p>抽成静态方法是为了让离屏校验能直接断言这段时序，不用真等 8.5 秒。
     */
    public static double progress(long nowMs, long phaseMs) {
        double cycle = (((nowMs + phaseMs) % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
        double p = cycle / (double) CYCLE_MS;
        if (p < PAUSE_FRACTION) {
            return 0;
        }
        return (p - PAUSE_FRACTION) / (1 - PAUSE_FRACTION);
    }

    double progress(long nowMs) {
        return progress(nowMs, phaseMs);
    }

    public static double easeInOutQuad(double t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    public void dispose() {
        stopTimer();
    }

    private void stopTimer() {
        if (timer != null) {
            timer.stop();
            timer = null;
        }
    }
}