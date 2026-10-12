package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import javafx.scene.Node;

/**
 * 展开/收起的缩放动画，1:1 复刻 sigmarebase
 * {@code ClickGuiScreen.draw:292} 的
 * {@code child.method13279(1.5F - alphaFactor * 0.5F, ...)}。
 *
 * <pre>
 *   float alphaFactor = animationCompleted &amp;&amp; !animationStarted
 *       ? method13317(animationProgress.calcPercent(), 0.8F) * 0.5F + 0.5F
 *       : (!animationCompleted ? 1.0F : method13317(animationProgress.calcPercent(), 1.0F));
 * </pre>
 *
 * <h2>只管缩放，不管透明度</h2>
 * mod 里这是<b>两层独立</b>的：
 * <ul>
 *   <li>{@code ClickGuiScreen} 的 {@code alphaFactor} → 整个 GUI 的缩放
 *       （展开时从 1.25 回弹到 1.0）</li>
 *   <li>{@code MusicPlayer} 的 {@code partialTicks *= 0.5 + (1-p)*0.5}
 *       → <b>只影响面板内部绘制</b>（底板、Logo、文字的 alpha）</li>
 * </ul>
 *
 * <p>之前 Java 版把两者都压到同一个节点的 {@code setOpacity} 上，
 * 而 {@code overlay} 是 {@code root} 的<b>父容器</b>——父子 opacity 会<b>相乘</b>：
 * EdgeDock 设 0.5、这里再设 0.5，实际渲染成 0.25。
 * 这就是「收起后比原版暗得多、展开后也不对」的根因。
 *
 * <p>所以这里<b>只操作缩放</b>，透明度一律交给 {@link EdgeDock} 统一管理。
 * 缩放锚点固定在窗口中心（JavaFX {@code setScaleX} 的默认行为），
 * 与 mod 的 {@code method13279} 一致——它也是围绕面板中心缩放。
 *
 * <p>收起态<b>不做缩放</b>（对应原版 {@code .sigma-shell--docked { animation: none }}）：
 * 面板只是滑出屏幕右侧并把大部分移出视野，不应该再有缩放动画。
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

    /** 展开：1.25 → 回弹 → 1.0（只改缩放，透明度见 {@link EdgeDock}）。 */
    public void expand(Runnable onFinished) {
        start(OPEN_NANOS, true, onFinished);
    }

    /**
     * 收起：保持 scale = 1，把控制权交回 {@link EdgeDock} 做位置滑出与透明度。
     *
     * <p>对应原版 {@code .sigma-shell--docked { animation: none }}——
     * 收起态没有缩放动画，视觉变化全部来自「滑出屏幕右侧」。
     */
    public void collapse(Runnable onFinished) {
        start(CLOSE_NANOS, false, onFinished);
    }

    /**
     * 只把缩放复位到 1，不碰其它任何属性。
     *
     * <p>收起时用：原版收起态没有缩放动画（{@code .sigma-shell--docked
     * { animation: none }}），但上一次展开可能留下没走完的 1.25 缩放，
     * 得立刻归位。刻意做成「只动缩放」而不是调 {@link #reset()}——
     * 后者会连带清掉 {@link EdgeDock} 设的透明度。
     */
    public void resetScale() {
        stop();
        target.setScaleX(1);
        target.setScaleY(1);
    }

    /** 静止态：scale 恒为 1，展开动画不再残留。 */
    public void reset() {
        stop();
        target.setScaleX(1);
        target.setScaleY(1);
        // opacity 归 EdgeDock 管，这里不动（构造时的初值本来就是 1，
        //  但显式写一次会把 EdgeDock 已设的半透明抹掉）
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
            // 收起：不动缩放（对应原版 .sigma-shell--docked { animation: none }）。
            // 位置滑出交给 EdgeDock，透明度也由 EdgeDock 统一管，
            // 这里<b>不能</b>再碰 opacity —— overlay 是 root 的父容器，
            // 父子 opacity 相乘会叠成 0.25。
            target.setScaleX(1);
            target.setScaleY(1);
            return;
        }
        // 展开：走权威的 alphaFactor（展开完成中 = easeOutElastic(·,0.8)*0.5+0.5）
        double factor = alphaFactor(true, false, progress, false);
        double scale = 1.5 - factor * 0.5;
        target.setScaleX(scale);
        target.setScaleY(scale);
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
        // 不动 opacity —— 它归 {@link EdgeDock} 管。
        // 这里强行设 1 会把收起态的半透明抹掉（动画结束的那一帧闪一下全亮）。
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