package com.jello.music.ui;

/**
 * 标记「落在这个控件上不该起拖窗」。
 *
 * <p>对应原版 {@code NO_DRAG_SELECTOR} 里那些 {@code button} 类条目
 * （见 {@link DragGate}）。class 名能覆盖到的优先用 class（和原版 CSS 同名），
 * 这个接口给那些不方便套 class 的控件用。
 */
public interface NonDraggable {
}