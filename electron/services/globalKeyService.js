/**
 * 全局键盘监听（RSHIFT 等）
 *
 * Electron 的 globalShortcut 无法区分左右 Shift（只能注册整个 Shift），
 * 因此用底层键盘钩子 uiohook-napi 精确监听右 Shift。
 */
import { uIOhook, UiohookKey } from 'uiohook-napi';

let started = false;
let lastTriggerAt = 0;

// 长按自动重复时的去抖间隔
const TRIGGER_DEBOUNCE_MS = 300;

export function initGlobalKeyListener({ onRightShift } = {}) {
    if (started) return;
    started = true;

    uIOhook.on('keydown', (event) => {
        if (event.keycode !== UiohookKey.ShiftRight) return;
        const now = Date.now();
        if (now - lastTriggerAt < TRIGGER_DEBOUNCE_MS) return;
        lastTriggerAt = now;
        try {
            onRightShift?.();
        } catch (error) {
            console.error('[GlobalKey] 处理 RSHIFT 失败:', error);
        }
    });

    try {
        uIOhook.start();
        console.log('[GlobalKey] RSHIFT 全局监听已启动');
    } catch (error) {
        console.error('[GlobalKey] 启动键盘监听失败:', error);
    }
}

export function stopGlobalKeyListener() {
    if (!started) return;
    started = false;
    try {
        uIOhook.stop();
    } catch (error) {
        console.error('[GlobalKey] 停止键盘监听失败:', error);
    }
}
