package com.jello.music.system;

import com.jello.music.AppPrefs;

import java.util.Locale;

/**
 * 界面缩放，对应原版 {@code electron/main.js:204-207}：
 * <pre>
 *   if (settings?.highDpi === 'on') {
 *       app.commandLine.appendSwitch('high-dpi-support', '1');
 *       app.commandLine.appendSwitch('force-device-scale-factor', settings?.dpiScale || '1');
 *   }
 * </pre>
 *
 * <p><b>和原版一样是启动时生效、不可中途切换</b>：Electron 那两个 switch 只能在
 * app ready 之前设置，所以原版的设置项上写着「重启后生效」。
 * 这里不去做「运行中热切换」——那需要重建整个场景树，且会和频谱窗、贴边动画的
 * 坐标换算纠缠在一起，收益远小于代价。
 *
 * <p>Java 侧的等价手段是 {@code Stage.setXScale / setYScale}：
 * 它缩放的是整个场景，鼠标坐标由 JavaFX 自动反算，所以
 * {@code DragGate}、频谱窗拖动那些基于 {@code getScreenX()} 的逻辑不用改。
 */
public final class UiScale {

    /** 设置项 key，对应原版 localStorage 的 {@code settings.uiScale}。 */
    public static final String SETTING_KEY = "uiScale";

    /** 允许范围，与设置页滑块一致。 */
    public static final double MIN = 0.6;
    public static final double MAX = 2.0;

    public static final double DEFAULT = 1.0;

    private UiScale() {
    }

    /** 读设置里的缩放比；越界或非数字回落到 1.0。 */
    public static double current() {
        String raw = AppPrefs.getSetting(SETTING_KEY, String.valueOf(DEFAULT));
        try {
            double v = Double.parseDouble(raw);
            if (!Double.isFinite(v)) {
                return DEFAULT;
            }
            return Math.max(MIN, Math.min(MAX, v));
        } catch (NumberFormatException e) {
            return DEFAULT;
        }
    }

    /** 缩放比是否不是 1.0（即是否需要真的动手）。 */
    public static boolean isScaled() {
        return Math.abs(current() - DEFAULT) > 1e-6;
    }

    /**
     * 按当前设置缩放一个舞台。
     *
     * <h2>为什么不能用 {@code Stage.setXScale}</h2>
     * JavaFX 21 的 {@code javafx.stage.Window} <b>没有</b> {@code setXScale/getXScale}
     * （只有 {@code setRenderScaleX}，那是 HiDPI 渲染比例，不是布局缩放），
     * 想整体放大只能缩场景根节点。
     *
     * <p>做法：把 Stage 放大到 {@code baseW*s × baseH*s}，同时对根节点
     * {@code setScaleX/Y = s}。布局仍按 800x600 的逻辑坐标算
     * （{@link com.jello.music.ui.Theme} 的常量一个都不用动），
     * 鼠标事件由 JavaFX 自动反算，{@code DragGate} 那些基于
     * {@code getScreenX()} 的逻辑照常工作。
     *
     * <p><b>副作用</b>：逻辑坐标变成 {@code baseW*s}，所以任何「按逻辑宽度算位置」
     * 的代码要改成乘 s ——目前只有 {@code EdgeDock} 的贴边与垂直居中会碰到，
     * 已在那里按缩放后的实际尺寸计算。
     *
     * @param stage  目标舞台
     * @param baseW  缩放前的逻辑宽（面板 800 / 频谱窗 420）
     * @param baseH  缩放前的逻辑高
     */
    public static void apply(javafx.stage.Stage stage, double baseW, double baseH) {
        if (stage == null) {
            return;
        }
        double s = current();
        try {
            javafx.scene.Scene sc = stage.getScene();
            if (sc != null && sc.getRoot() != null) {
                sc.getRoot().setScaleX(s);
                sc.getRoot().setScaleY(s);
            }
            if (Math.abs(s - DEFAULT) > 1e-6) {
                stage.setWidth(baseW * s);
                stage.setHeight(baseH * s);
            }
        } catch (Throwable t) {
            // 缩放失败不该挡住启动：面板照常显示，只是没缩放
            System.err.println("[UiScale] 应用界面缩放失败: " + t);
        }
    }

    /** 设置页滑块用的显示文本，例如 {@code 1.5x}。 */
    public static String displayText(double scale) {
        return String.format(java.util.Locale.ROOT, "%.1fx",
                Math.max(MIN, Math.min(MAX, scale)));
    }

    static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).startsWith("windows");
    }
}