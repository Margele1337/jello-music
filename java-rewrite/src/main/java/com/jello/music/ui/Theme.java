package com.jello.music.ui;

import javafx.scene.paint.Color;

/**
 * 视觉常量 —— 全部取自原 Vue 版 {@code SigmaMusicPlayer.vue} / {@code SigmaUI.vue}，
 * 数值 1:1 照搬，不做"差不多"的近似。
 *
 * <p>坐标是 800x600 面板内的绝对像素，与原版 {@code position: absolute} 布局一一对应。
 */
public final class Theme {

    private Theme() {
    }

    /** 按 0-255 整数值构造颜色（对应 CSS 的 rgb(38,38,38) 写法）。 */
    private static Color rgb(int r, int g, int b, double a) {
        return Color.color(r / 255.0, g / 255.0, b / 255.0, a);
    }

    public static final double PANEL_W = 800;
    public static final double PANEL_H = 600;

    // ---- 面板底色（与原 CSS 完全一致）----
    /** 左栏 black 95% */
    public static final Color LEFT_PANEL = Color.color(0, 0, 0, 0.95);
    /** 右栏 #262626 80% */
    public static final Color RIGHT_PANEL = rgb(38, 38, 38, 0.80);
    /**
     * 底部封面条遮罩 rgba(1,1,1,0.43)。
     *
     * <p><b>坑</b>：这里的 1 是 CSS 的 0..255 量级，即 rgb(1,1,1) ≈ 纯黑，不是白色。
     * 早先误写成 {@code Color.color(1,1,1,0.43)}（JavaFX 里 1.0 就是纯白），
     * 结果遮罩变成 43% 白，底部条被提亮成浅灰，#fefefe 的歌名/时长直接看不见。
     * 同类写法在音量轨道与进度条填充上各犯过一次，一律走 {@link #rgb}。
     */
    public static final Color STRIP_OVERLAY = rgb(1, 1, 1, 0.43);
    public static final double STRIP_OVERLAY_H = 89;

    // ---- 文字色：原版统一 #fefefe ----
    public static final Color TEXT = Color.web("#fefefe");
    /** 歌单普通项 rgba(254,254,254,0.55) */
    public static final Color TEXT_DIM = rgb(254, 254, 254, 0.55);

    // ---- 几何（1:1 照搬原 CSS 的 left/top/width/height）----
    public static final double LEFT_PANEL_W = 250;
    public static final double RIGHT_PANEL_W = 550;
    public static final double UPPER_H = 506;

    public static final double ARTWORK_X = 68, ARTWORK_Y = 430, ARTWORK_S = 114;
    public static final Color ARTWORK_BG = Color.web("#14161a");
    /** 原版 box-shadow: inset 0 0 0 1px rgba(1,1,1,0.35) 的那一圈内描边 */
    public static final Color ARTWORK_INNER_BORDER = rgb(1, 1, 1, 0.35);

    public static final double TITLE_X = 30, TITLE_Y = 550, TITLE_W = 190;
    /** 原版 .smp-title.single：无歌手时标题下移到 562 */
    public static final double TITLE_SINGLE_Y = 562;
    public static final double SUBTITLE_Y = 570;
    public static final double TIME_L_X = 264, TIME_R_X = 736, TIME_R_W = 50, TIME_Y = 568;

    public static final double LOGO_X = 55, LOGO_Y = 14, LOGO_SIZE = 40;
    public static final double LOGO_SUB_X = 135, LOGO_SUB_Y = 42, LOGO_SUB_SIZE = 20;

    public static final double PREV_X = 392, PREV_Y = 529, PREV_S = 46;
    public static final double PLAY_X = 506, PLAY_Y = 533, PLAY_S = 38;
    public static final double NEXT_X = 620, NEXT_Y = 529, NEXT_S = 46;
    public static final double REPEAT_X = 264, REPEAT_Y = 540;
    public static final double VOLUME_X = 781, VOLUME_Y = 520, VOLUME_W = 4, VOLUME_H = 40;
    /** 音量轨道 rgba(1,1,1,0.2)：1 是 0..255 量级，≈纯黑 */
    public static final Color VOLUME_TRACK = rgb(1, 1, 1, 0.20);
    public static final Color VOLUME_FILL = rgb(254, 254, 254, 0.20);

    public static final double PROGRESS_X = 250, PROGRESS_Y = 595, PROGRESS_W = 550, PROGRESS_H = 5;
    public static final Color PROGRESS_TRACK = rgb(153, 153, 153, 0.075);
    /** 已播放 rgba(1,1,1,0.43)：同样是 ≈纯黑 */
    public static final Color PROGRESS_REMAIN = rgb(1, 1, 1, 0.43);

    public static final double SPECTRUM_X = 15, SPECTRUM_Y = 460, SPECTRUM_S = 40;
    public static final Color SPECTRUM_BAR = Color.web("#fefefe");
    public static final double SPECTRUM_BAR_OFF = 0.09;
    public static final double SPECTRUM_BAR_ON = 0.29;

    public static final double PLAYLIST_X = 0, PLAYLIST_Y = 78, PLAYLIST_W = 250, PLAYLIST_H = 442;

    public static final double STRIP_X = 0, STRIP_Y = 506, STRIP_W = 800, STRIP_H = 94;

    // ---- 边缘收起（原 appServices.js：SIGMA_DOCK_VISIBLE=40 / RESTORE_MARGIN=20）----
    public static final double EDGE_TRIGGER = 41;
    public static final double DOCK_VISIBLE = 40;
    public static final double RESTORE_MARGIN = 20;
}