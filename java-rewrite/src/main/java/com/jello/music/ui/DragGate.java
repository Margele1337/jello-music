package com.jello.music.ui;

import javafx.scene.Node;
import javafx.scene.control.Control;
import javafx.scene.control.TextInputControl;

import java.util.Set;

/**
 * 面板拖窗的「不许起拖」判定，对应原版
 * {@code SigmaMusicPlayer.vue:340} 的 {@code NO_DRAG_SELECTOR}：
 *
 * <pre>
 * button, input, .sigma-search-box, .sigma-scrollable-panel, .sigma-text-field,
 * .sigma-progress-bar, .sigma-volume-slider, .sigma-small-image,
 * .sigma-changing-button, .sigma-spectrum-button, .sigma-thumbnail-button,
 * .smp-dock-trigger
 * </pre>
 *
 * <p>原版是 {@code target.closest(NO_DRAG_SELECTOR)}，即从事件目标一路往上找。
 * JavaFX 没有 {@code closest}，这里改成沿 {@link Node#getParent()} 往上走，
 * 命中的条件是「实现了 {@link NonDraggable}」或「带上了原版那个 class 名」。
 *
 * <p>不写死节点引用，是为了让歌单项、缩略图卡这种会重复生成的控件也能被覆盖：
 * 它们在 {@link SigmaScrollablePanel} 里面，走父链一样能命中。
 */
public final class DragGate {

    /** 原版 selector 里的 class 名，1:1 抄过来。 */
    private static final Set<String> NO_DRAG_CLASSES = Set.of(
            "sigma-search-box",
            "sigma-scrollable-panel",
            "sigma-text-field",
            "sigma-progress-bar",
            "sigma-volume-slider",
            "sigma-small-image",
            "sigma-changing-button",
            "sigma-spectrum-button",
            "sigma-thumbnail-button",
            "smp-dock-trigger");

    private DragGate() {
    }

    /**
     * 事件目标或其任一祖先是否命中排除表。
     *
     * @param target 鼠标事件的 target（不是 event source；原版用的也是 target）
     */
    public static boolean blocked(Object target) {
        if (!(target instanceof Node)) {
            return false;
        }
        for (Node n = (Node) target; n != null; n = n.getParent()) {
            // 原版的 button / input：JavaFX 侧就是控件和文本输入
            if (n instanceof Control || n instanceof TextInputControl) {
                return true;
            }
            if (n instanceof NonDraggable) {
                return true;
            }
            for (String cls : n.getStyleClass()) {
                if (NO_DRAG_CLASSES.contains(cls)) {
                    return true;
                }
            }
        }
        return false;
    }
}