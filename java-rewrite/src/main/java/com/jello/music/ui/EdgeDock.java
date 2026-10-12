package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import javafx.geometry.Rectangle2D;
import javafx.scene.Node;
import javafx.scene.input.MouseEvent;
import javafx.stage.Screen;
import javafx.stage.Stage;

/**
 * 贴右边缘收起 / 滑出，以及自绘拖拽。
 *
 * <p>常量与判定规则全部来自原 Electron 实现（{@code electron/appServices.js}），
 * 那里记录了与 sigmarebase 原版逐步推导对齐的过程：
 * <ul>
 *   <li>{@code SIGMA_DOCK_VISIBLE = 40} —— 收起时露在屏幕内的宽度，原版 var8 = parentWidth - 40</li>
 *   <li>{@code SIGMA_RESTORE_MARGIN = 20} —— 展开时右侧留白，原版 var11 = parentWidth - 20 - width</li>
 *   <li>判定「是否已收起」用 <b>状态标志</b>，不是几何位置：
 *       收起动画进行中面板可能还在屏幕中间，按几何判定会误判成「无需滑出」</li>
 *   <li>拖拽夹取无余量，越界只在橡皮筋状态下才可能发生</li>
 * </ul>
 *
 * <p><b>拖拽分两步</b>（{@code appServices.js:679-709} 的 {@code moveSigmaWindow}）：
 * <ol>
 *   <li>第 1 步：{@code clampedX} 精确夹在 {@code [area.left, right - width]}，无越界余量</li>
 *   <li>第 2 步：只有 {@code desiredX + width > right + 200}（var14）<b>且</b>
 *       {@code movedX > 70} 时才进橡皮筋：{@code x = clampedX + (int)((desiredX - clampedX - 200) * 0.5)}</li>
 * </ol>
 * 不动点是 {@code clamp + 0.5*(desired - clamp - 200)}；基准必须是<b>本 tick 刚夹出来的</b>
 * clampedX，不能拿上一次留下的窗口位置，否则每帧都在已推出的位置上再推一半，
 * 面板会一路爬出屏幕且越来越难抓回来。
 *
 * <p><b>半透明判据</b>（{@code SigmaMusicPlayer.vue:504}，对应原版 MusicPlayer.java:360-361）：
 * {@code translucent = 越界 && !已请求滑出}。所以拖拽越过右缘时先半透明，
 * 点收起条的瞬间就 {@code 已请求滑出=true} 开始 150ms 变亮——哪怕面板还基本在屏幕外，
 * 视觉上像「醒来」。淡到 50% 用 80ms、淡回 100% 用 150ms，都是线性，
 * 方向翻转时重新计时（不跳变）。
 *
 * <p><b>吸附只发生在松手</b>：拖拽中越界只是变半透明，不吸附。
 * 之前 {@link #drag} 一越界就立刻收走，用户根本看不到半透明过渡。
 *
 * <p>滑出动画用 {@link AnimationTimer} 手动推进，不用 {@code ValueAnimator}
 * （该类在 JavaFX 21.0.5 的 graphics jar 里缺失）。
 */
public final class EdgeDock {

    /** 原版 var14：橡皮筋的越界余量。 */
    public static final double RUBBER_BAND_ALLOWANCE = 200;
    /** 原版 {@code newHeight - mouseX > 70}：橡皮筋的另一道闸（相对按下点的横向位移）。 */
    public static final double RUBBER_BAND_TRIGGER = 70;
    /** 原版 field20873：收起半透明的透明度。 */
    public static final double DOCKED_OPACITY = 0.5;
    /** 原版 {@code new Animation(80, 150, BACKWARDS)}：淡到 50% 用 80ms。 */
    public static final long DIM_MILLIS = 80;
    /** 淡回 100% 用 150ms。 */
    public static final long BRIGHT_MILLIS = 150;

    // ---- 进出动画（原版 SigmaMusicPlayer.vue:281-328 / appServices.js:578-608）----
    /** 原版：var7 = dt / 18.10361ms。 */
    public static final double ANIM_FRAME_MS = 18.10361;
    /** 原版 x 每帧走剩余距离的 0.25。 */
    private static final double ANIM_X_RATE = 0.25;
    /** 原版 y 每帧走剩余距离的 0.2（比 x 慢）。 */
    private static final double ANIM_Y_RATE = 0.2;
    /** dt 上限 40ms：偶发迟到不产生大跳。 */
    private static final double ANIM_MAX_DT = 40;
    /** 收敛判据：离目标 < 0.5px 就 snap。 */
    private static final double ANIM_EPSILON = 0.5;
    /** 卡死看门狗：超过 3s 强制取消。 */
    private static final long ANIM_WATCHDOG_MS = 3000;

    private final Stage stage;

    /** 原版 {@code sigmaDocked}：离散吸附态，决定动画目标，不描述几何位置。 */
    private boolean snapped;
    /** 原版 {@code sigmaOverhanging}：右缘是否越过工作区右缘，连续量。 */
    private boolean overhanging;
    /** 原版 {@code field20874}「已请求滑出」，半透明判据的否定项。 */
    private boolean undockRequested;
    private boolean translucent;

    private AnimationTimer slideTimer;
    private double slideFromX;
    private double slideFromY;
    private double slideToX;
    private double slideToY;
    private long slideLastNanos;
    private long slideStartedAt;

    private Node opacityTarget;
    private AnimationTimer fadeTimer;
    private long fadeStart;
    /**
     * 淡入淡出方向，对应 mod 的 {@code Animation.Direction}。
     * 初始 BACKWARDS（完全展开、不透明），与 mod 的
     * {@code new Animation(80, 150, Direction.BACKWARDS)} 一致。
     */
    private FadeDirection fadeDirection = FadeDirection.BACKWARDS;

    private double dragAnchorScreenX;
    private double dragAnchorStageX;
    private double dragAnchorScreenY;
    private double dragAnchorStageY;
    /** {@code movedX} 的基准：按下瞬间的屏幕 x（原版 {@code dragState.startX}）。 */
    private double dragStartScreenX;
    private boolean dragging;
    private Runnable dockStateListener;
    /** 越界状态变化回调（对应 mod 每帧的触发条宽度判定）。 */
    private Runnable overhangListener;

    public EdgeDock(Stage stage) {
        this.stage = stage;
        this.snapped = true;
    }

    public boolean isDocked() {
        return snapped;
    }

    /**
     * 吸附态变化时回调（给 MainApp 去开关那条 41px 触发条）。
     *
     * <p>必须覆盖<b>所有</b>改 snapped 的路径，包括 {@link #endDrag()} 里
     * 「拖出去松手被吸走」这一条——只��� RSHIFT 收起时开关触发条的话，
     * 鼠标拖出去之后就点不回来了。
     */
    public void onDockStateChanged(Runnable r) {
        this.dockStateListener = r;
    }

    private void setSnapped(boolean value) {
        if (snapped == value) {
            return;
        }
        snapped = value;
        if (dockStateListener != null) {
            dockStateListener.run();
        }
    }

    /** 供 UiProbe 断言半透明矩阵。 */
    public static boolean translucentOf(boolean overhanging, boolean undockRequested) {
        return overhanging && !undockRequested;
    }

    /**
     * 原版 {@code moveSigmaWindow} 的 x 决策，拆成纯函数便于离屏断言。
     *
     * @param desiredX 光标推出的期望 x（未夹取）
     * @param width    窗口宽
     * @param right    工作区右缘
     * @param movedX   相对按下点的横向位移
     */
    public static double resolveDragX(double desiredX, double width, double right, double movedX) {
        // 第 1 步：精确夹取，无越界余量
        double clampedX = Math.min(Math.max(Math.round(desiredX), 0), right - width);
        // 第 2 步：var14 = 200, newHeight - mouseX > 70
        if (desiredX + width > right + RUBBER_BAND_ALLOWANCE && movedX > RUBBER_BAND_TRIGGER) {
            // var15 = desired - xA - var14；Java 的 (long) 截断等价于 Math.trunc
            return clampedX + (long) ((desiredX - clampedX - RUBBER_BAND_ALLOWANCE) * 0.5);
        }
        return clampedX;
    }

    /** 原版判据 {@code getXA() + getWidthA() > parent.getWidthA()}，严格大于。 */
    public static boolean overhangingOf(double x, double width, double right) {
        return x + width > right;
    }

    /** 收起目标 x：只留 DOCK_VISIBLE 露在屏幕内。 */
    public static double dockTargetX(double right) {
        return right - Theme.DOCK_VISIBLE;
    }

    /**
     * 滑出目标 x：原版 var11 = parentWidth - 20 - width。
     *
     * <p>{@code width} 要传<b>屏幕上实际占的宽</b>（逻辑宽 × 缩放比），
     * 理由同 {@link #expandedX}。
     */
    public static double restoreTargetX(double width, double right) {
        return right - width - Theme.RESTORE_MARGIN;
    }

    /**
     * 原版 {@code screen.getDisplayMatching}：取与目标矩形重叠最多的那块屏幕。
     *
     * <p>多显示器时必须按窗口所在屏算右缘，不能一律用主屏。
     */
    public static Rectangle2D displayMatching(double x, double y, double w, double h) {
        Rectangle2D best = Screen.getPrimary().getVisualBounds();
        double bestArea = -1;
        for (Screen s : Screen.getScreens()) {
            Rectangle2D b = s.getVisualBounds();
            double ix = Math.max(0, Math.min(x + w, b.getMaxX()) - Math.max(x, b.getMinX()));
            double iy = Math.max(0, Math.min(y + h, b.getMaxY()) - Math.max(y, b.getMinY()));
            double area = ix * iy;
            if (area > bestArea) {
                bestArea = area;
                best = b;
            }
        }
        return best;
    }

    private Rectangle2D workArea() {
        return displayMatching(stage.getX(), stage.getY(), stage.getWidth(), stage.getHeight());
    }

    private double centerY(Rectangle2D area) {
        // 开了界面缩放后 stage.getHeight() 已是放大后的值（Scene 根节点被 setScaleY，
        // Stage 尺寸也乘了同样的比），直接用即可居中。
        return Math.round(area.getMinY() + (area.getHeight() - stage.getHeight()) / 2);
    }

    /** 收起后的目标 x：面板大部分移出右侧，仅留 DOCK_VISIBLE 可见。 */
    private double dockedX(Rectangle2D area) {
        return dockTargetX(area.getMaxX());
    }

    /** 展开后的目标 x：靠右但留 RESTORE_MARGIN 间隙。 */
    private double expandedX(Rectangle2D area) {
        // stage.getWidth() 在开了界面缩放后已经是放大后的值（Stage 尺寸乘了缩放比），
        // 所以直接用它算就对了。逻辑宽仍按 Theme.PANEL_W 供根节点布局使用。
        return restoreTargetX(stage.getWidth(), area.getMaxX());
    }

    /** 初始摆位：先按收起态藏到右缘。 */
    public void placeInitially() {
        Rectangle2D area = workArea();
        stage.setX(dockedX(area));
        stage.setY(centerY(area));
        setSnapped(true);
        undockRequested = false;
        syncFromGeometry();
        syncTranslucent();
        // 初始摆位直接落到动画终点：mod 的 field20873 是每帧从 elapsed=0 起算，
        // 首次 draw 时 p 还没走完，所以视觉上确实有一小段淡出；
        // 但这里是「还没显示就摆好」，没有中间态可言——
        // 立刻设成收起态的终值（alpha 0.5），避免启动时闪一下全亮。
        //
        // 对应公式 alpha = 0.5 + (1-p)*0.5，要得到 0.5 就得让 p = 1，
        // 也就是把 fadeStart 往前推满一个 DIM_MILLIS（elapsed 满格 p 才是 1）。
        fadeStart = System.nanoTime() - DIM_MILLIS * 1_000_000L;
        fadeDirection = FadeDirection.FORWARDS;
        // 注意传「当前时刻」而不是 fadeStart：
        // applyFade(now) 内部按 (now - fadeStart)/duration 算 elapsed，
        // 传 fadeStart 会得到 elapsed=0 → p=0 → alpha=1.0，正好反了。
        applyFade(System.nanoTime());
        stopSelf();
    }

/**
 * 切换收起/展开（不带节流的裸切换）。
 *
     * <p>120ms 触发节流由调用方 {@code MainApp.toggleDock()} 负责——那里还要
 * * 编排 {@link ElasticReveal}，节流必须罩住整条 RSHIFT 路径，不能只卡位置动画。
 * 这里保留无节流版本给拖拽等非连按场景复用。
     */
    public void toggle() {
        if (snapped) {
            expand();
        } else {
            collapse();
        }
    }

    /**
     * 滑出（对应原版 {@code restoreSigmaWindow}）。
     *
     * <p>早退条件不是「有没有越界」而是「是否已吸附」：收起动画进行中面板可能还在
     * 屏幕中间（如 x=1100），按几何判定会误判成无需滑出，面板卡在中间不动。
     */
    public void expand() {
        Rectangle2D area = workArea();
        double w = stage.getWidth();
        // 原版：if (!sigmaDocked && bounds.x + width <= right) return;
        if (!snapped && !overhangingOf(stage.getX(), w, area.getMaxX())) {
            return;
        }
        setSnapped(false);
        // 点一下立刻开始变亮，哪怕面板还基本在屏幕外
        undockRequested = true;
        syncTranslucent();
        slideTo(expandedX(area), centerY(area));
    }

    public void collapse() {
        Rectangle2D area = workArea();
        setSnapped(true);
        undockRequested = false;
        slideTo(dockedX(area), centerY(area));
    }

    /**
     * 进出动画，1:1 复刻 {@code SigmaMusicPlayer.vue:281-328}。
     *
     * <pre>
     *   frameFactor = dt / 18.10361
     *   x = clamp(x + (targetX - x) * 0.25 * frameFactor)   // 按方向夹，不许越过目标
     *   y = clamp(y + (targetY - y) * 0.20 * frameFactor)
     *   |target - cur| < 0.5 -> snap 到 target 并结束
     * </pre>
     *
     * <p>这是<b>帧率无关</b>的指数插值，不是固定时长的缓动曲线：每帧走剩余
     * 距离的一个比例，所以 60Hz 和 144Hz 下耗时一致。之前用 450ms/125ms 的
     * cubic ease-out 是错的——那个曲线与帧率无关但与「原版的速度感」无关，
     * 收放手感明显更快更硬。
     *
     * <p>第一帧用 {@code dt = 1}：收起期间窗口离屏会被系统节流，重新显示后的
     * 第一帧 dt 可能很大（钳到上限也有 40ms -> frameFactor 2.2，一步走出 45% 的
     * 路程），表现为「弹出来时先猛跳一下」。原版为此特意不预设 lastTime。
     */
    private void slideTo(double targetX, double targetY) {
        if (slideTimer != null) {
            slideTimer.stop();
        }
        slideFromX = stage.getX();
        slideFromY = stage.getY();
        slideToX = targetX;
        slideToY = targetY;
        slideLastNanos = 0;
        slideStartedAt = System.currentTimeMillis();

        // 原版：离目标已经 < 1px 就别启动动画，但必须先停掉在跑的那个，
        // 否则旧动画会继续往它自己的目标推进（连按时表现为「分散开」）
        if (Math.abs(slideFromX - targetX) < 1 && Math.abs(slideFromY - targetY) < 1) {
            slideTimer = null;
            return;
        }

        slideTimer = new AnimationTimer() {
            @Override
            public void handle(long now) {
                // 卡死保护：3s 还没走到就直接落位，别让面板永远飘在半路
                if (System.currentTimeMillis() - slideStartedAt > ANIM_WATCHDOG_MS) {
                    finishSlide();
                    return;
                }
                double dt;
                if (slideLastNanos == 0) {
                    slideLastNanos = now;
                    dt = 1;
                } else {
                    dt = Math.min(ANIM_MAX_DT, Math.max(1, (now - slideLastNanos) / 1_000_000.0));
                    slideLastNanos = now;
                }
                double frameFactor = dt / ANIM_FRAME_MS;
                slideFromX = approach(slideFromX, slideToX, ANIM_X_RATE * frameFactor);
                slideFromY = approach(slideFromY, slideToY, ANIM_Y_RATE * frameFactor);
                stage.setX(slideFromX);
                stage.setY(slideFromY);
                // 原版靠 200ms 轮询 updateDockedState 清「已请求滑出」，
                // 这里在动画帧里直接同步，更准也更省
                syncFromGeometry();

                if (Math.abs(slideToX - slideFromX) < ANIM_EPSILON
                        && Math.abs(slideToY - slideFromY) < ANIM_EPSILON) {
                    finishSlide();
                }
            }
        };
        slideTimer.start();
    }

    /** 按方向夹到目标，绝不越过（对应原版的 Math.min / Math.max 二选一）。 */
    private static double approach(double current, double target, double step) {
        return target > current
                ? Math.min(current + (target - current) * step, target)
                : Math.max(current + (target - current) * step, target);
    }

    /** 供 UiProbe 断言的单步插值。 */
    public static double approachForTest(double current, double target, double step) {
        return approach(current, target, step);
    }

    private void finishSlide() {
        if (slideTimer != null) {
            slideTimer.stop();
            slideTimer = null;
        }
        stage.setX(slideToX);
        stage.setY(slideToY);
        syncFromGeometry();
    }

    public void beginDrag(MouseEvent e) {
        dragging = true;
        dragAnchorScreenX = e.getScreenX();
        dragAnchorScreenY = e.getScreenY();
        dragAnchorStageX = stage.getX();
        dragAnchorStageY = stage.getY();
        dragStartScreenX = e.getScreenX();
        if (slideTimer != null) {
            slideTimer.stop();
            slideTimer = null;
        }
    }

    /**
     * 拖拽中，1:1 复刻 {@code moveSigmaWindow}。
     *
     * <p>注意这里<b>不吸附</b>：越界只把面板置为半透明，吸附留给 {@link #endDrag()}。
     */
    public void drag(MouseEvent e) {
        if (!dragging) {
            return;
        }
        double w = stage.getWidth();
        double h = stage.getHeight();
        double desiredX = dragAnchorStageX + (e.getScreenX() - dragAnchorScreenX);
        double desiredY = dragAnchorStageY + (e.getScreenY() - dragAnchorScreenY);
        double movedX = e.getScreenX() - dragStartScreenX;

        Rectangle2D area = displayMatching(desiredX, desiredY, w, h);
        double nextY = Math.min(Math.max(Math.round(desiredY), area.getMinY()),
                area.getMaxY() - h);
        double newX = resolveDragX(desiredX, w, area.getMaxX(), movedX);

        stage.setX(newX);
        stage.setY(nextY);
        setOverhanging(overhangingOf(newX, w, area.getMaxX()));
    }

    /**
     * 松手（对应原版 {@code finishSigmaDrag}）：越界就吸附收起，否则夹回工作区。
     *
     * <p>因为第 1 步夹取不留余量，普通拖拽不可能触发吸附分支，只有橡皮筋推出去才会。
     */
    public void endDrag() {
        dragging = false;
        double w = stage.getWidth();
        double h = stage.getHeight();
        Rectangle2D area = workArea();
        double right = area.getMaxX();

        if (overhangingOf(stage.getX(), w, right)) {
            setSnapped(true);
            undockRequested = false;
            syncTranslucent();
            slideTo(dockTargetX(right), centerY(area));
            return;
        }

        setSnapped(false);
        stage.setX(Math.min(Math.max(stage.getX(), area.getMinX()), right - w));
        stage.setY(Math.min(Math.max(stage.getY(), area.getMinY()), area.getMaxY() - h));
        // 未收起：清掉拖拽期的越界信号，之后透明度只跟吸附态走
        overhanging = false;
        undockRequested = false;
        syncTranslucent();
    }

    public boolean isDragging() {
        return dragging;
    }

    /** 鼠标是否落在右侧触发条范围内（收起态靠它唤出）。 */
    public boolean isOverEdgeTrigger(double mouseScreenX) {
        return mouseScreenX >= workArea().getMaxX() - Theme.EDGE_TRIGGER;
    }

    // ---- 半透明 ----

    /**
     * 透明度动画挂在面板根节点上（对应原版 {@code .sigma-music-player}）。
     *
     * <p>注意别和 {@link ElasticReveal} 抢同一个节点：reveal 动的是外层 overlay
     * 的 opacity，这里动的是面板根，两者叠加才对得上原版「浮层缩放 + 面板变暗」。
     */
    public void attachOpacityTarget(Node node) {
        this.opacityTarget = node;
    }

    public boolean isTranslucent() {
        return translucent;
    }

    private void setOverhanging(boolean value) {
        if (overhanging == value) {
            return;
        }
        overhanging = value;
        syncTranslucent();
        // 触发条按「越界」而非「吸附态」开关，对应 MusicPlayer:275 的每帧判定。
        // 差在拖拽滑出途中：那时还没吸附，但 mod 已经把触发条显示出来了。
        if (overhangListener != null) {
            overhangListener.run();
        }
    }

    /**
     * 越界状态变化时回调（给 MainApp 开关 41px 触发条）。
     *
     * <p>与 {@link #onDockStateChanged}（吸附态）是<b>两件事</b>：
     * 吸附态是用户操作触发的离散事件，越界是每帧连续判定。
     */
    public void onOverhangChanged(Runnable r) {
        this.overhangListener = r;
    }

    /** 面板当前是否越界（供断言与诊断用）。 */
    public boolean isOverhanging() {
        return overhanging;
    }

    /** 位置一变就同步越界标志；回到屏幕内即视为滑出结束，清掉「已请求滑出」。 */
    private void syncFromGeometry() {
        boolean oh = overhangingOf(stage.getX(), stage.getWidth(), workArea().getMaxX());
        if (!oh) {
            undockRequested = false;
        }
        setOverhanging(oh);
    }

    private void syncTranslucent() {
        boolean want = translucentOf(overhanging, undockRequested);
        FadeDirection next = want ? FadeDirection.FORWARDS : FadeDirection.BACKWARDS;
        long now = System.nanoTime();
        if (fadeDirection != next) {
            // 1:1 复刻 mod 的 {@code Animation.changeDirection}（:50-58）：
            // 用<b>当前进度</b>反推新方向的时间起点，保证翻转时进度连续不跳变。
            double p = fadePercent(now);
            long newDuration = (next == FadeDirection.FORWARDS ? DIM_MILLIS : BRIGHT_MILLIS)
                    * 1_000_000L;
            fadeStart = next == FadeDirection.FORWARDS
                    ? now - (long) (p * newDuration)
                    : now - (long) ((1.0 - p) * newDuration);
            fadeDirection = next;
        }
        // 注意：这里<b>不</b>像原来那样「状态相同就 return」。
        // mod 的 field20873（MusicPlayer:275-278）是每帧无条件跑
        // changeDirection + calcPercent 的，动画由自己的时间基准推进。
        ensureFadeTimer();
        // 立刻应用一次当前进度：否则从「展开态 alpha=1」切到「收起」时，
        // 第一帧跑之前 alpha 还是旧值，视觉上就是「先亮一下再变暗」——
        // mod 是同帧算完就画，没有这个闪。
        applyFade(now);
    }

    /** 当前方向的时长（纳秒），对应 mod 的 {@code Animation(80, 150, BACKWARDS)}。 */
    private long fadeDurationNanos() {
        return (fadeDirection == FadeDirection.FORWARDS ? DIM_MILLIS : BRIGHT_MILLIS)
                * 1_000_000L;
    }

    /**
     * 当前的动画进度 0..1，1:1 对应 mod 的 {@code Animation.calcPercent()}。
     *
     * <p>mod 的公式（{@code Animation.java:70-74}）：
     * <pre>
     *   BACKWARDS:  1 - min(1, (now - reverseStartTime) / reverseDuration)
     *   FORWARDS:       min(1, (now - startTime)        / duration)
     * </pre>
     * 两支都是<b>线性</b>，差别只在从哪个时间点起算。
     *
     * <p>然后 mod 用它算整个面板的 alpha 系数（{@code MusicPlayer:278}）：
     * <pre>
     *   partialTicks *= 0.5F + (1.0F - calcPercent()) * 0.5F
     * </pre>
     * 也就是「收起时面板整体降到 50% alpha，展开时回到 100%」，
     * 而不是我们原先那种「切状态就启动一段独立的淡入淡出」。
     */
    private double fadePercent(long now) {
        double sinceStart = (now - fadeStart) / (double) fadeDurationNanos();
        if (fadeDirection == FadeDirection.BACKWARDS) {
            return Math.max(0.0, 1.0 - Math.min(1.0, sinceStart));
        }
        return Math.min(1.0, Math.max(0.0, sinceStart));
    }

    /**
     * 按 mod 的公式把进度映射成面板 opacity。
     *
     * <p>{@code alpha系数 = 0.5 + (1 - p) * 0.5}，
     * 其中 {@code p = calcPercent()}：p=1（完全展开）→ 系数 0.5？不对——
     * 实际方向反了：展开完成时 {@code calcPercent()→1}（BACKWARDS 走完），
     * 系数 = 0.5 + (1-1)*0.5 = 0.5。
     *
     * <p>这里要结合方向一起看才清楚：
     * <ul>
     *   <li><b>收起</b>（FORWARDS）：p 从 0 涨到 1，系数 1.0 → 0.5，面板变半透明</li>
     *   <li><b>展开</b>（BACKWARDS）：p 从 1 降到 0，系数 0.5 → 1.0，面板恢复</li>
     * </ul>
     * 也就是「收起到半透明、展开到全不透明」，与 {@link #DOCKED_OPACITY} 一致。
     */
    /**
     * 按 mod 的公式把进度映射成面板 opacity。
     *
     * <p>权威是 {@code MusicPlayer:278} 那一行：
     * <pre>
     *   partialTicks *= 0.5F + (1.0F - calcPercent()) * 0.5F
     * </pre>
     * 而 {@code partialTicks} 在面板展开时约等于 1.0，所以实际 alpha 就是
     * {@code 0.5 + (1 - p) * 0.5}：
     *
     * <pre>
     *   p = 1  -&gt; alpha = 0.5   半透明（收起完成）
     *   p = 0  -&gt; alpha = 1.0   不透明（展开完成）
     * </pre>
     *
     * <p><b>注意 p 与 alpha 的绑定跟方向无关</b>，只看 {@code calcPercent()}：
     * 收起走 FORWARDS（p: 0→1）、展开走 BACKWARDS（p: 1→0），
     * 但公式对两者是同一条。
     *
     * <p>mod 构造时初始方向是 BACKWARDS 且 elapsed=0，所以 {@code p=1}、
     * alpha 起步就是 0.5——刚创建还没展开过时面板是半透明的。
     */
    private void applyFade(long now) {
        if (opacityTarget == null) {
            return;
        }
        double p = fadePercent(now);
        opacityTarget.setOpacity(0.5 + (1.0 - p) * 0.5);
        translucent = opacityTarget.getOpacity() < 0.99;
    }

    /**
     * 启动（或复用）每帧推进的动画。
     *
     * <p>mod 是每帧在 {@code draw} 里重算进度（{@code MusicPlayer:275-278}），
     * 这里是 {@link AnimationTimer}，语义一致。
     */
    private void ensureFadeTimer() {
        if (opacityTarget == null) {
            return;
        }
        if (fadeTimer != null) {
            fadeTimer.stop();
            fadeTimer = null;
        }
        fadeTimer = new AnimationTimer() {
            @Override
            public void handle(long now) {
                applyFade(now);
                // 到达端点后停掉，下一帧若方向再变再重启
                double p = fadePercent(now);
                if (p <= 0.0 || p >= 1.0) {
                    applyFade(now);
                    stopSelf();
                }
            }
        };
        fadeTimer.start();
    }

    /**
     * 停掉当前的淡入淡出计时器。
     *
     * <p>写成独立方法而不是在匿名 {@code AnimationTimer} 里定义 {@code stop()}——
     * 同名会「试图覆盖父类的 public 方法」，编译不过。
     */
    private void stopSelf() {
        if (fadeTimer != null) {
            fadeTimer.stop();
            fadeTimer = null;
        }
    }

    /** 淡入淡出的方向，对应 mod 的 {@code Animation.Direction}。 */
    private enum FadeDirection {
        /** 收起：越界且未请求滑出。 */
        FORWARDS,
        /** 展开。 */
        BACKWARDS
    }
}