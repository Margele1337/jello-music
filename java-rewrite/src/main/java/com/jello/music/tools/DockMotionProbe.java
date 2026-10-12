package com.jello.music.tools;

import javafx.animation.AnimationTimer;
import javafx.application.Platform;
import javafx.geometry.Rectangle2D;
import javafx.scene.Node;
import javafx.scene.Scene;
import javafx.scene.layout.Pane;
import javafx.stage.Screen;
import javafx.stage.Stage;
import javafx.stage.StageStyle;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 贴边动画时序实测：真的摆窗口、真的调 {@link com.jello.music.ui.EdgeDock}，
 * 逐帧记录 x 与 opacity，得到<b>真实时序曲线</b>。
 *
 * <p>{@link UiProbe} 只能验公式（alpha 端点、进度连续性），
 * 验不了「动画到底跑多久、位置有没有跳变、触发条何时出现」。
 *
 * <h2>线程模型（这里踩过坑）</h2>
 * JavaFX 的 {@code AnimationTimer} 只在 FX 线程跑，而 FX 线程一旦被阻塞
 * （哪怕只是 {@code Thread.sleep} 轮询）动画就完全不推进。
 * 所以本探针：
 * <ol>
 *   <li>{@code main} 线程阻塞在 {@link CountDownLatch#await()} 上</li>
 *   <li>{@code Platform.startup} 的 FX 线程负责建窗口、调 dock、启动采样器，
 *       然后<b>自己返回</b>让出事件循环</li>
 *   <li>采样器每帧把 {@code (t, x, alpha)} 放进线程安全的 list</li>
 *   <li>收尾时 {@code latch.countDown()}，main 线程醒过来打印</li>
 * </ol>
 * 主线程<b>全程不碰 FX 对象</b>，只在最后读 list。
 *
 * <pre>
 *   java --module-path ... -m com.jello.music/com.jello.music.tools.DockMotionProbe
 * </pre>
 */
public final class DockMotionProbe {

    private static final long MAX_MILLIS = 1500;

    private DockMotionProbe() {
    }

    public static void main(String[] args) throws Exception {
        List<double[]> samples = new ArrayList<>();
        CountDownLatch done = new CountDownLatch(1);
        Platform.startup(() -> {
            try {
                run(samples, done);
            } catch (Throwable t) {
                t.printStackTrace();
                done.countDown();
            }
        });
        if (!done.await(30, TimeUnit.SECONDS)) {
            System.out.println("探针超时");
        }
        Platform.exit();
    }

    private static void run(List<double[]> samples, CountDownLatch done) {
        try {
            System.out.println("=== 贴边动画时序实测 ===");

            Rectangle2D area = Screen.getPrimary().getVisualBounds();
            Stage stage = new Stage();
            stage.initStyle(StageStyle.TRANSPARENT);
            stage.setWidth(com.jello.music.ui.Theme.PANEL_W);
            stage.setHeight(com.jello.music.ui.Theme.PANEL_H);

            Pane root = new Pane();
            root.setStyle("-fx-background-color: #262626;");
            root.getChildren().add(new com.jello.music.ui.SpectrumView(
                    null, 114, 420, 130).canvas());
            stage.setScene(new Scene(root,
                    com.jello.music.ui.Theme.PANEL_W, com.jello.music.ui.Theme.PANEL_H));

            com.jello.music.ui.EdgeDock dock =
                    new com.jello.music.ui.EdgeDock(stage);
            // 必须绑定透明度目标，否则 applyFade 找不到节点、alpha 永远不动
            // （MainApp 里对应 dock.attachOpacityTarget(root)）
            dock.attachOpacityTarget(root);

            stage.show();
            dock.placeInitially();

            double dockedX = area.getMaxX() - 40;
            double expandedX = area.getMaxX() - stage.getWidth() - 20;
            System.out.println("屏幕     : " + (int) area.getWidth() + "x" + (int) area.getHeight());
            System.out.println("面板     : " + (int) stage.getWidth() + "x" + (int) stage.getHeight());
            System.out.println("收起位 x : " + (int) dockedX + "（露出 40px）");
            System.out.println("展开位 x : " + (int) expandedX + "（右侧留 20px）");
            System.out.println();
            // 收起位的稳态 alpha 必须是 0.5（公式 0.5 + (1-p)*0.5，p=1）。
            // 若这里打印 1.0，说明淡出动画在 placeInitially 里被重置掉了。
            System.out.printf("初始: x=%d 越界=%s 半透明=%s alpha=%.3f（收起稳态应为 0.500）%n",
                    (int) stage.getX(), dock.isOverhanging(),
                    dock.isTranslucent(), root.getOpacity());
            System.out.println("右缘 " + (int) (stage.getX() + stage.getWidth())
                    + " vs 屏幕右界 " + (int) area.getMaxX()
                    + " -> " + (stage.getX() + stage.getWidth() > area.getMaxX()
                    ? "越界，触发条应宽 41" : "未越界，触发条应宽 0"));
            System.out.println();
            System.out.printf("%-8s %-10s %-8s %-8s%n", "t(ms)", "x", "alpha", "scale");
            System.out.println("-".repeat(28));

            long t0 = System.nanoTime();
            // overlay 是 root 的父容器（对应 MainApp 的 StackPane overlay），
            // 缩放作用在它身上、透明度作用在 root 身上——
            // 这个探针要同时采样两者，才能验「最终合成效果」而不是只看一个
            javafx.scene.layout.StackPane overlay =
                    new javafx.scene.layout.StackPane(root);
            javafx.scene.Scene sc2 = new javafx.scene.Scene(overlay,
                    com.jello.music.ui.Theme.PANEL_W, com.jello.music.ui.Theme.PANEL_H);
            stage.setScene(sc2);
            com.jello.music.ui.ElasticReveal reveal =
                    new com.jello.music.ui.ElasticReveal(overlay);
            dock.attachOpacityTarget(root);

            dock.expand();
            reveal.expand(null);
            new Sampler(stage, root, overlay, samples, t0, expandedX).start();

            // FX 线程让出，交给 AnimationTimer；到点后由采样器唤醒 main
            scheduleWakeup(t0, done);
        } catch (Throwable t) {
            t.printStackTrace();
            done.countDown();
        }
    }

    /** 到时间后在 FX 线程里 countDown，让 main 线程打印结果。 */
    private static void scheduleWakeup(long t0, CountDownLatch done) {
        AtomicBoolean fired = new AtomicBoolean();
        new AnimationTimer() {
            @Override
            public void handle(long now) {
                if (System.nanoTime() - t0 > MAX_MILLIS * 1_000_000L
                        && fired.compareAndSet(false, true)) {
                    stop();
                    done.countDown();
                }
            }
        }.start();
    }

    /** 逐帧采样位置与透明度。 */
    private static final class Sampler extends AnimationTimer {
        private final Stage stage;
        private final Node node;
        private final javafx.scene.Node overlay;
        private final List<double[]> samples;
        private final long t0;
        private final double targetX;
        private long last = -1;
        private boolean printedArrive;
        private boolean printedAlpha;
        private double firstX;

        Sampler(Stage stage, Node node, javafx.scene.Node overlay,
                List<double[]> samples, long t0, double targetX) {
            this.stage = stage;
            this.node = node;
            this.overlay = overlay;
            this.samples = samples;
            this.t0 = t0;
            this.targetX = targetX;
        }

        @Override
        public void handle(long now) {
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            double x = stage.getX();
            double alpha = node.getOpacity();
            // overlay 上是缩放，root 上是透明度 —— 两者叠起来才是最终观感
            double scale = overlay.getScaleX();
            if (firstX == 0) {
                firstX = x;
            }
            if (ms - last >= 30) {
                last = ms;
                samples.add(new double[]{ms, x, alpha});
                System.out.printf("%-8d %-10.1f %-8.3f %-8.4f%n",
                        ms, x, alpha, scale);
            }
            if (!printedArrive && Math.abs(x - targetX) < 1.0) {
                printedArrive = true;
                System.out.printf(">> 到达展开位：%d ms%n", ms);
            }
            if (!printedAlpha && alpha >= 0.99) {
                printedAlpha = true;
                System.out.printf(">> alpha 回到 1.0：%d ms（权威 150ms）%n", ms);
            }
            if (printedArrive && printedAlpha) {
                stop();
            }
        }
    }
}