package com.jello.music.ui;

import javafx.scene.paint.Color;

/**
 * 视觉常量，数值取自原 Vue 版 Sigma 面板的 CSS / JS。
 *
 * <p>来源对应关系：
 * <ul>
 *   <li>{@code .sigma-shell} 的 rgba(6, 8, 12, 0.2) → {@link #SHELL}</li>
 *   <li>{@code --primary-color: #1a9aba} → {@link #ACCENT}</li>
 *   <li>频谱高端色 → {@link #ACCENT_LIGHT}</li>
 *   <li>边缘触发条宽度 41px、收起可见 40px → {@link #EDGE_TRIGGER} / {@link #DOCK_VISIBLE}</li>
 * </ul>
 */
public final class Theme {

    private Theme() {
    }

    /** 壳层半透明深色，等价 CSS rgba(6, 8, 12, 0.2) */
    public static final Color SHELL = Color.rgb(6, 8, 12, 0.2);

    /** 主色 #1a9aba */
    public static final Color ACCENT = Color.web("#1a9aba");

    /** 频谱高端偏青 #44d9e6 */
    public static final Color ACCENT_LIGHT = Color.web("#44d9e6");

    public static final Color TEXT_PRIMARY = Color.web("#e1e1e1");
    public static final Color TEXT_SECONDARY = Color.web("#9fd8e6");
    public static final Color TEXT_MUTED = Color.web("#777777");

    /** 右侧边缘触发条宽度（CSS 41px） */
    public static final double EDGE_TRIGGER = 41;

    /** 收起时露出屏幕外的宽度，原版 var8 = parentWidth - 40 */
    public static final double DOCK_VISIBLE = 40;

    /** 展开时的右侧间隙，原版 var11 = parentWidth - 20 - width */
    public static final double RESTORE_MARGIN = 20;

    /** 面板尺寸，与原 Sigma 面板一致 */
    public static final double PANEL_WIDTH = 800;
    public static final double PANEL_HEIGHT = 600;
}