package com.jello.music.ui;

import javafx.scene.canvas.Canvas;
import javafx.scene.canvas.GraphicsContext;
import javafx.scene.layout.Pane;
import javafx.scene.paint.Color;

/**
 * 设置入口按钮（自研）。
 *
 * <p>原版在托盘菜单里进设置，800x600 的面板上没有入口，所以这里加一个，
 * 位置紧挨频谱按钮，同为左下角的圆形按钮区。
 *
 * <p>没有齿轮图标资源，用 Canvas 现画一个：三齿 + 中心空心圆，
 * 透明度对齐频谱按钮的常态 {@link Theme#SPECTRUM_BAR_OFF}。
 */
final class SettingsButton extends Pane {

    private static final double R = 8;      // 外圆半径
    private static final double HOLE = 3;   // 中心孔半径
    private static final int TEETH = 8;

    SettingsButton() {
        double s = Theme.SPECTRUM_S;
        setPrefSize(s, s);
        setMinSize(s, s);
        setMaxSize(s, s);
        Canvas c = new Canvas(s, s);
        c.setLayoutX(0);
        c.setLayoutY(0);
        c.setMouseTransparent(true);
        draw(c.getGraphicsContext2D());
        getChildren().add(c);
        // 关键：这是个没有背景的 Pane，JavaFX 默认不参与命中测试
        // （Region 只有「有背景」或 pickOnBounds=true 才接鼠标）。
        // 而 Canvas 被设成 mouseTransparent 后，整块 40x40 区域点不动——
        // 表现为设置入口「看得见、点不开」。
        setPickOnBounds(true);
        setBackground(new javafx.scene.layout.Background(
                new javafx.scene.layout.BackgroundFill(Color.color(1, 1, 1, 0.01), null, null)));
        setOnMouseEntered(e -> c.setOpacity(0.8));
        setOnMouseExited(e -> c.setOpacity(1));
    }

    private void draw(GraphicsContext g) {
        double cx = Theme.SPECTRUM_S / 2;
        double cy = Theme.SPECTRUM_S / 2;
        g.clearRect(0, 0, Theme.SPECTRUM_S, Theme.SPECTRUM_S);
        g.setStroke(Theme.SPECTRUM_BAR);
        g.setLineWidth(1.6);
        // 齿：绕圆心放射的小短线
        for (int i = 0; i < TEETH; i++) {
            double a = Math.PI * 2 * i / TEETH;
            double x1 = cx + Math.cos(a) * (R - 1.5);
            double y1 = cy + Math.sin(a) * (R - 1.5);
            double x2 = cx + Math.cos(a) * (R + 2.5);
            double y2 = cy + Math.sin(a) * (R + 2.5);
            g.strokeLine(x1, y1, x2, y2);
        }
        // 外圈
        g.strokeOval(cx - R, cy - R, R * 2, R * 2);
        // 中心孔
        g.strokeOval(cx - HOLE, cy - HOLE, HOLE * 2, HOLE * 2);
        // 常态透明度对齐频谱按钮
        g.setGlobalAlpha(0.55);
    }
}