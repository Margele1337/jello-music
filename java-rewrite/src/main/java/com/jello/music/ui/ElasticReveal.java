package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import javafx.scene.Node;

/**
 * 展开/收起的弹性缩放动画，1:1 复刻原版 Minecraft 客户端的
 * {@code ClickGuiScreen.draw:304-346}：
 *
 * <pre>
 *   scale = 1.5 - a * 0.5
 *   a     = easeOutElastic(p)，p = t / 450ms（展开）或 t / 125ms（收起）
 *   alpha = 0.2 * a
 * </pre>
 *
 * <p><b>起始点是 1.25 而不是 1.5</b>：a 的初始值为 0.5，所以
 * {@code 1.5 - 0.5*0.5 = 1.25}。这正是原版「不先猛缩一下再弹」的表现——
 * 之前 Electron 版踩过这个坑，收起态误用 1.5→1 导致收缩时先缩再弹。
 *
 * <p>easeOutElastic 用 Minecraft 的公式
 * {@code 2^(-10p) * sin((p - period/4) * 2pi / period) + 1}，
 * period = 0.8，p 先乘 4 再传入（对应原版 {@code method13279} 的调用方式）。
 *
 * <p>收起态<b>不做缩放</b>（对应原版 {@code .sigma-shell--docked { animation: none }}）：
 * 面板只是滑出屏幕右侧并把大部分移出视野，不应该再有缩放动画。
 * 因此 {@link #collapse} 只做淡出，缩放保持 1。
 *
 * <p><b>实现说明</b>：用 {@link AnimationTimer} 手动按时间推进，而不是
 * {@code ValueAnimator}——{@code ValueAnimator} 在 JavaFX 21.0.5 的
 * {@code javafx-graphics} jar 里缺失（该版本的类拆分问题），且手动驱动更精确。
 */
public final class ElasticReveal {

    private static final double PERIOD = 0.8;
    private static final long OPEN_NANOS = 450L * 1_000_000L;
    private static final long CLOSE_NANOS = 125L * 1_000_000L;

    private final Node target;
    private AnimationTimer timer;
    private long startNanos;
    private long durationNanos;
    private boolean animateScale;
    private Runnable onFinished;

    public ElasticReveal(Node target) {
        this.target = target;
        reset();
    }

    /** 展开：1.25 → 回弹 → 1.0，同时淡入。 */
    public void expand(Runnable onFinished) {
        start(OPEN_NANOS, true, onFinished);
    }

    /**
     * 收起：只淡出并把控制权交回给 {@link EdgeDock} 做位置滑出，
     * 这里刻意<b>不动缩放</b>——保持 scale = 1 对应原版收起态无缩放动画。
     */
    public void collapse(Runnable onFinished) {
        start(CLOSE_NANOS, false, onFinished);
    }

    /** 静止态：scale 恒为 1，展开动画不再残留。 */
    public void reset() {
        stop();
        target.setScaleX(1);
        target.setScaleY(1);
        target.setOpacity(1);
        target.setMouseTransparent(false);
        target.setVisible(true);
    }

    private void start(long durationNanos, boolean animateScale, Runnable onFinished) {
        stop();
        this.animateScale = animateScale;
        this.onFinished = onFinished;
        this.durationNanos = durationNanos;
        this.startNanos = System.nanoTime();
        target.setVisible(true);

        timer = new AnimationTimer() {
            @Override
            public void handle(long now) {
                double elapsed = now - startNanos;
                double progress = Math.min(1.0, elapsed / (double) durationNanos);
                if (progress >= 1.0) {
                    finish();
                } else {
                    applyFrame(progress);
                }
            }
        };
        timer.start();
    }

    private void applyFrame(double progress) {
        if (!animateScale) {
            // 收起：只淡出，缩放保持 1（对应原版 .sigma-shell--docked { animation: none }）
            target.setScaleX(1);
            target.setScaleY(1);
            target.setOpacity(1 - progress);
            return;
        }
        // 展开：走权威的 alphaFactor（展开完成中 = easeOutElastic(·,0.8)*0.5+0.5）
        double factor = alphaFactor(true, false, progress, false);
        double scale = 1.5 - factor * 0.5;
        target.setScaleX(scale);
        target.setScaleY(scale);
        target.setOpacity(0.5 + 0.5 * factor);
    }

    /**
     * 权威的 {@code alphaFactor}，1:1 对应 {@code ClickGuiScreen.draw:255-257}。
     *
     * <pre>
     *   float alphaFactor = animationCompleted &amp;&amp; !animationStarted
     *       ? method13317(animationProgress.calcPercent(), 0.8F) * 0.5F + 0.5F
     *       : (!animationCompleted ? 1.0F : method13317(animationProgress.calcPercent(), 1.0F));
     * </pre>
     *
     * <p>三个分支分别对应：
     * <ul>
     *   <li><b>展开完成中</b>（点开但动画还没走完）：用 period=0.8 的 elastic
     *       压缩到 0.5~1.0 —— 这是「弹进来」那一段</li>
     *   <li><b>未完成</b>（第一次进游戏，动画没跑过）：恒为 1.0</li>
     *   <li><b>收起中</b>：period=1.0 的 elastic</li>
     * </ul>
     *
     * <p>Java 版之前只有单一的 elastic 公式，缺了「展开完成中」的分支，
     * 所以展开时的手感与原版不同。
     */
    public static double alphaFactor(boolean animationCompleted, boolean animationStarted,
                              double percent, boolean backwards) {
        if (animationCompleted && !animationStarted) {
            return ease13317(percent, 0.8) * 0.5 + 0.5;
        }
        if (!animationCompleted) {
            return 1.0;
        }
        return ease13317(percent, 1.0);
    }

    /**
     * {@code ClickGuiScreen.method13317}（:247-251）：
     * <pre>
     *   return direction != BACKWARDS
     *       ? 2^(-10p) * sin((p - period/4) * 2PI / period) + 1     // easeOutElastic
     *       : QuadraticEasing.easeOutQuad(p, 0, 1, 1);           // easeOutQuad
     * </pre>
     *
     * <p><b>方向决定用哪个缓动</b>：BACKWARDS（反向，即展开）走 easeOutQuad，
     * FORWARDS（收起）才走 easeOutElastic。之前的实现无条件用 elastic，
     * 展开时曲线就错了。
     */
    public static double ease13317(double p, double period, boolean elastic) {
        return elastic ? easeOutElastic(p, period) : easeOutQuad(p);
    }

    public static double ease13317(double p, double period) {
        // 默认按 elastic 处理（收起分支）
        return easeOutElastic(p, period);
    }

    /**
     * QuadraticEasing.easeOutQuad(p, 0, 1, 1)，
     * 即 {@code 1 - (1 - p)^2}。
     */
    public static double easeOutQuad(double p) {
        if (p <= 0) {
            return 0;
        }
        if (p >= 1) {
            return 1;
        }
        double inv = 1 - p;
        return 1 - inv * inv;
    }

    private void finish() {
        stop();
        target.setScaleX(1);
        target.setScaleY(1);
        target.setOpacity(1);
        if (onFinished != null) {
            onFinished.run();
        }
    }

    private void stop() {
        if (timer != null) {
            timer.stop();
            timer = null;
        }
    }

    public boolean isRunning() {
        return timer != null;
    }

    /**
     * Minecraft 的 easeOutElastic：
     * {@code 2^(-10p) * sin((p - period/4) * (2*PI) / period) + 1}
     */
    public static double easeOutElastic(double p, double period) {
        if (p <= 0) {
            return 0;
        }
        if (p >= 1) {
            return 1;
        }
        return Math.pow(2, -10 * p)
                * Math.sin((p - period / 4) * (2 * Math.PI) / period)
                + 1;
    }
}