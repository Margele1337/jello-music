package com.jello.music.model;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 设置项定义（配置 + 默认值 + 分组）。
 *
 * <p>原版有 4 分类 30 项，这里只保留 <b>Java 版真正有对应物</b>的那些，
 * 砍掉的都是 Electron 专属或依赖尚未实现的功能——留着就是「点了没反应」的死开关。
 *
 * <p><b>保留的 9 项</b>（对照 {@code src/config/settings.js}）：
 * <pre>
 *   界面: 重新观看教程 / 频谱幅度 / 平滑系数 / 音画差补偿 / 频谱锁定
 *   声音: 音质选择
 *   系统: 界面缩放 / 开机自启 / 全局快捷键（占位）
 * </pre>
 *
 * <p><b>砍掉的 21 项</b>：托盘菜单、按键显示HUD、桌面歌词(+字体)、状态栏歌词(mac)、
 * 响度标准化、音频输出设备、输出变化暂停、数据源、歌词翻译、GPU加速、
 * 最小化到托盘、网络节点、阻止系统休眠、API模式、RPC地址、TouchBar(mac)、
 * 网络代理、日志操作、界面缩放之外的 DPI 开关等。
 */
public final class Settings {

    /** 每一类设置项的类型。 */
    public enum Kind {
        /** 打开/关闭。 */
        TOGGLE,
        /** 从固定选项里选一个（左右箭头切换）。 */
        CHOICE,
        /** 0..1 的滑块。 */
        SLIDER,
        /** 触发一个动作（如「重新观看教程」）。 */
        ACTION,
        /** 占位，暂不可用。 */
        DISABLED
    }

    /** 一条设置。 */
    public static final class Item {
        public final String key;
        public final String label;
        public final Kind kind;
        public final String defaultValue;
        /** CHOICE 用的可选项（value 与显示文本一一对应）。 */
        public final List<String> options;
        /** CHOICE 里默认选中项的显示文本。 */
        public final String defaultDisplay;
        /** SLIDER 的范围。 */
        public final double min;
        public final double max;
        /** ACTION / DISABLED 的按钮文字。 */
        public final String buttonText;

        Item(String key, String label, Kind kind, String defaultValue,
             List<String> options, String defaultDisplay,
             double min, double max, String buttonText) {
            this.key = key;
            this.label = label;
            this.kind = kind;
            this.defaultValue = defaultValue;
            this.options = options;
            this.defaultDisplay = defaultDisplay;
            this.min = min;
            this.max = max;
            this.buttonText = buttonText;
        }
    }

    /** 一个分类（对应侧栏一项）。 */
    public static final class Section {
        public final String title;
        public final List<Item> items;

        Section(String title, List<Item> items) {
            this.title = title;
            this.items = items;
        }
    }

    private Settings() {
    }

    public static List<Section> sections() {
        return List.of(
                new Section("界面", List.of(
                        action("showTutorial", "重新观看教程", "打开"),
                        slider("spectrumScale", "频谱幅度", 1.0, 0.2, 3.0, "1.0x"),
                        slider("spectrumSigmaSmoothing", "平滑系数", 0.335, 0.0, 1.0, "0.335"),
                        slider("spectrumAvDelay", "音画差补偿", 590, 0, 2000, "590ms"),
                        toggle("spectrumLocked", "频谱锁定", "on"),
                        slider("uiScale", "界面缩放", 1.0, 0.6, 2.0, "1.0x")
                )),
                new Section("声音", List.of(
                        choice("quality", "音质选择",
                                List.of("128", "320", "flac", "high", "viper_atmos",
                                        "viper_clear", "viper_tape"),
                                "标准音质 128K")
                )),
                new Section("系统", List.of(
                        toggle("autoStart", "开机自启", "off"),
                        action("shortcuts", "全局快捷键", "自定义")
                )));
    }

    /** 所有 key -> 默认值，重置时用。 */
    public static Map<String, String> defaults() {
        Map<String, String> m = new LinkedHashMap<>();
        for (Section s : sections()) {
            for (Item i : s.items) {
                m.put(i.key, i.defaultValue);
            }
        }
        return m;
    }

    public static Item find(String key) {
        for (Section s : sections()) {
            for (Item i : s.items) {
                if (i.key.equals(key)) {
                    return i;
                }
            }
        }
        return null;
    }

    // ---- 构造糖 ----

    private static Item toggle(String key, String label, String def) {
        return new Item(key, label, Kind.TOGGLE, def, null, null, 0, 0, null);
    }

    private static Item choice(String key, String label, List<String> opts, String display) {
        return new Item(key, label, Kind.CHOICE, opts.get(0), opts, display, 0, 0, null);
    }

    private static Item slider(String key, String label, double def, double min, double max, String unit) {
        return new Item(key, label, Kind.SLIDER, trim(def), null, unit, min, max, null);
    }

    private static Item action(String key, String label, String text) {
        return new Item(key, label, Kind.ACTION, "", null, null, 0, 0, text);
    }

    static String trim(double v) {
        if (v == Math.rint(v)) {
            return String.valueOf((long) v);
        }
        return String.valueOf(v);
    }
}