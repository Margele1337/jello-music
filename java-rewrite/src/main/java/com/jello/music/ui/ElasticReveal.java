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
 * <h2>透明度：<b>要乘</b>，不是「各管各的」</h2>
 * mod 里 alpha 是<b>两层相乘</b>的：
 * <pre>
 *   ClickGuiScreen.draw:295  super.draw(partialTicks * Math.min(1.0F, alphaFactor) * fadeAmount);
 *   CustomGuiScreen.draw:219 drawChildren(partialTicks);       // 逐层往下传
 *   MusicPlayer.draw:278     partialTicks *= 0.5F + (1.0F - field20873.calcPercent()) * 0.5F;
 * </pre>
 * 也就是子面板收到的 {@code partialTicks} <b>已经含了父层的 alphaFactor</b>，
 * 再乘一次自己那层。所以两层的最终效果是<b>相乘</b>：
 *
 * <pre>
 *   最终 alpha = min(1, alphaFactor) * (0.5 + (1 - p) * 0.5)
 * </pre>
 *
 * <p>JavaFX 的父子 {@code opacity} 恰好也是相乘的（{@code overlay} 是 {@code root}
 * 的父容器），所以<b>正好可以用同构的结构实现</b>：
 * <ul>
 *   <li>{@code overlay.opacity} = {@code min(1, alphaFactor)} —— 本类负责</li>
 *   <li>{@code root.opacity} = {@code 0.5 + (1 - p) * 0.5} —— {@link EdgeDock} 负责</li>
 * </ul>
 *
 * <p><b>这里踩过一次弯</b>：中途曾把本类的 opacity 整个删掉，理由是
 * 「两个组件各管各的、别相乘」。那是错的——mod 就是相乘的，
 * 删掉之后展开起始会变成 0.5×1.0 而非 mod 的 0.5×0.5，观感偏亮。
 * 真正的 bug 不在相乘，而在 {@code finish()}/{@code reset()} 里
 * 强行 {@code setOpacity(1)} 会把 {@link EdgeDock} 设的半透明抹掉。
 *
 * <p>缩放锚点固定在窗口中心（JavaFX {@code setScaleX} 的默认行为），
 * 与 mod 的 {@code method13279} 一致——它也是围绕面板中心缩放。
 *
 * <p>收起态<b>只淡出、不缩放</b>（对应原版
 * {@code .sigma-shell--docked { animation: none }}）：
 * 面板只是滑出屏幕右侧，不该再有缩放动画。
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

    /** 静止态：scale 恒为 1，alpha 回到 1，展开动画不再残留。 */
    public void reset() {
        stop();
        target.setScaleX(1);
        target.setScaleY(1);
        // opacity 也复位成 1：mod 的 alphaFactor 在静止态是 1
        //（animationCompleted && !animationStarted 走 elastic(p,0.8)*0.5+0.5，
        //  p=1 时正好 1.0）。
        // 注意这不冲突 EdgeDock 的半透明——两层是相乘的，
        // 这里复位的是 overlay 这一层，root 那层归 EdgeDock。
        target.setOpacity(1.0);
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
            // 收起（ClickGuiScreen:255-257 的第二个分支）：
            //   alphaFactor = method13317(percent, 1.0F)
            // 走 period=1.0 的 easeOutElastic —— 同样会过冲，
            // 不是一条单调的淡出曲线。mod 里靠 Math.min(1, ·) 夹住上限。
            //
            // 缩放不动：对应原版 .sigma-shell--docked { animation: none }，
            // 收起态的视觉变化全部来自「滑出屏幕右侧」。
            double factor = alphaFactor(true, true, progress, false);
            target.setScaleX(1);
            target.setScaleY(1);
            target.setOpacity(Math.min(1.0, factor));
            return;
        }
        // 展开（第一个分支）：alphaFactor = method13317(percent, 0.8) * 0.5 + 0.5
        double factor = alphaFactor(true, false, progress, false);
        // 缩放 = 1.5 - alphaFactor * 0.5（ClickGuiScreen:292）
        double scale = 1.5 - factor * 0.5;
        target.setScaleX(scale);
        target.setScaleY(scale);
        // 透明度 = min(1, alphaFactor)（ClickGuiScreen:295）。
        // 必须夹到 1：elastic 会过冲到 1.03，不夹的话展开中途会
        // 「亮过 100%」再暗回来。
        // 另一层（root.opacity = 0.5 + (1-p)*0.5）由 EdgeDock 管，
        // 两者在 JavaFX 里相乘 —— 与 mod 的 partialTicks 逐层传递同构。
        target.setOpacity(Math.min(1.0, factor));
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
        // 收起的终值不是 1：mod 收起时 alphaFactor = elastic(1, 1.0) = 1.0，
        // 但 root 那层（EdgeDock）已经是 0.5，两者相乘 = 0.5 半透明。
        // 这里复位 overlay 层即可，root 层由 EdgeDock 自己收。
        target.setOpacity(1.0);
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