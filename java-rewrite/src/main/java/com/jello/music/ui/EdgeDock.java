package com.jello.music.ui;

import javafx.animation.AnimationTimer;
import javafx.geometry.Rectangle2D;
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
 * <p>滑出动画用 {@link AnimationTimer} 手动推进，不用 {@code ValueAnimator}
 * （该类在 JavaFX 21.0.5 的 graphics jar 里缺失）。
 */
public final class EdgeDock {

    private final Stage stage;
    private boolean docked;
    private AnimationTimer slideTimer;
    private long slideStart;
    private double slideFromX;
    private double slideFromY;
    private double slideToX;
    private double slideToY;
    private long slideDurationNanos;

    private double dragAnchorScreenX;
    private double dragAnchorStageX;
    private double dragAnchorScreenY;
    private double dragAnchorStageY;
    private boolean dragging;

    public EdgeDock(Stage stage) {
        this.stage = stage;
        this.docked = true;
    }

    public boolean isDocked() {
        return docked;
    }

    private Rectangle2D workArea() {
        return Screen.getPrimary().getVisualBounds();
    }

    /** 收起后的目标 x：面板大部分移出右侧，仅留 DOCK_VISIBLE 可见。 */
    private double dockedX() {
        return workArea().getMaxX() - Theme.DOCK_VISIBLE;
    }

    /** 展开后的目标 x：靠右但留 RESTORE_MARGIN 间隙。 */
    private double expandedX() {
        return workArea().getMaxX() - Theme.RESTORE_MARGIN - stage.getWidth();
    }

    private double centerY() {
        Rectangle2D area = workArea();
        return Math.round(area.getMinY() + (area.getHeight() - stage.getHeight()) / 2);
    }

    /** 初始摆位：先按收起态藏到右缘。 */
    public void placeInitially() {
        stage.setX(dockedX());
        stage.setY(centerY());
    }

    /**
     * 切换收起/展开。这与原版「点右侧 41px 触发条」与「RSHIFT/托盘」共用同一条路径。
     */
    public void toggle() {
        if (docked) {
            expand();
        } else {
            collapse();
        }
    }

    public void expand() {
        docked = false;
        slideTo(expandedX(), centerY(), 450);
    }

    public void collapse() {
        docked = true;
        slideTo(dockedX(), centerY(), 125);
    }

    private void slideTo(double targetX, double targetY, long millis) {
        if (slideTimer != null) {
            slideTimer.stop();
        }
        slideFromX = stage.getX();
        slideFromY = stage.getY();
        slideToX = targetX;
        slideToY = targetY;
        slideDurationNanos = millis * 1_000_000L;
        slideStart = System.nanoTime();

        slideTimer = new AnimationTimer() {
            @Override
            public void handle(long now) {
                double t = Math.min(1.0, (now - slideStart) / (double) slideDurationNanos);
                // ease-out，让接近目标时减速，像原版那样有「滑到位才停」的收尾
                double k = 1 - Math.pow(1 - t, 3);
                stage.setX(slideFromX + (slideToX - slideFromX) * k);
                stage.setY(slideFromY + (slideToY - slideFromY) * k);
                if (t >= 1.0) {
                    slideTimer.stop();
                    slideTimer = null;
                    // 兜底：精确落到目标，避免累积误差导致状态判定不一致
                    stage.setX(targetX);
                    stage.setY(targetY);
                }
            }
        };
        slideTimer.start();
    }

    public void beginDrag(MouseEvent e) {
        dragging = true;
        dragAnchorScreenX = e.getScreenX();
        dragAnchorScreenY = e.getScreenY();
        dragAnchorStageX = stage.getX();
        dragAnchorStageY = stage.getY();
        if (slideTimer != null) {
            slideTimer.stop();
            slideTimer = null;
        }
    }

    /**
     * 拖拽中。判定与原版一致：贴右判定为严格 &gt; right 才吸附收起，
     * 夹取范围无余量，窗口左上不得越过工作区左上。
     */
    public void drag(MouseEvent e) {
        if (!dragging) {
            return;
        }
        Rectangle2D area = workArea();
        double desiredX = dragAnchorStageX + (e.getScreenX() - dragAnchorScreenX);
        double desiredY = dragAnchorStageY + (e.getScreenY() - dragAnchorScreenY);

        if (desiredX + stage.getWidth() > area.getMaxX()) {
            docked = true;
            stage.setX(area.getMaxX() - Theme.DOCK_VISIBLE);
            stage.setY(centerY());
            return;
        }
        docked = false;
        double clampedX = Math.min(Math.max(desiredX, area.getMinX()),
                area.getMaxX() - stage.getWidth());
        double clampedY = Math.min(Math.max(desiredY, area.getMinY()),
                area.getMaxY() - stage.getHeight());
        stage.setX(clampedX);
        stage.setY(clampedY);
    }

    public void endDrag() {
        dragging = false;
    }

    public boolean isDragging() {
        return dragging;
    }

    /** 鼠标是否落在右侧触发条范围内（收起态靠它唤出）。 */
    public boolean isOverEdgeTrigger(double mouseScreenX) {
        return mouseScreenX >= workArea().getMaxX() - Theme.EDGE_TRIGGER;
    }
}