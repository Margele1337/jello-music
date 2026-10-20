/**
 * 全局键盘/鼠标监听
 *
 * - RSHIFT：呼出/收起 Sigma 窗口（Electron globalShortcut 无法区分左右 Shift）
 * - W/A/S/D + 鼠标左/右键：转发给 KeyStrokes 覆盖层（1:1 复刻 sigmarebase KeyStrokes 模块）
 *
 * Windows 上不用低级键盘钩子（uiohook）：游戏普遍注册 Raw Input，
 * 会导致其它进程的 WH_KEYBOARD_LL 钩子收不到按键（表现为"游戏内不亮"）。
 * 因此 Windows 改用 GetAsyncKeyState 轮询（koffi 调 user32），不依赖钩子，游戏内同样有效。
 */
const POLL_INTERVAL_MS = 16;
const RSHIFT_POLL_INTERVAL_MS = 30;
const RSHIFT_VK = 0xa1;

// 轮询目标：VK → KeyStrokes 键位 id
const POLL_TARGETS = [
    { vk: 0x57, id: 'forward' }, // W
    { vk: 0x53, id: 'back' },    // S
    { vk: 0x41, id: 'left' },    // A
    { vk: 0x44, id: 'right' },   // D
    { vk: 0x01, id: 'attack' },  // 鼠标左键
    { vk: 0x02, id: 'use' }      // 鼠标右键
];

let started = false;
let suspended = false;
let keystrokesEnabled = false; // KeyStrokes 覆盖层是否开启：WASD/鼠标轮询按需启停
let keystrokeHandler = null;
let onRightShiftHandler = null;
let rshiftTimer = null;
let keyTimer = null;
let pollState = { rshift: false };
let uiohook = null;

const emitKeystroke = (id, down) => {
    if (!id || !keystrokeHandler) return;
    try {
        keystrokeHandler({ id, down });
    } catch (error) {
        console.error('[GlobalKey] 转发按键状态失败:', error);
    }
};

const triggerRightShift = () => {
    try {
        onRightShiftHandler?.();
    } catch (error) {
        console.error('[GlobalKey] 处理 RSHIFT 失败:', error);
    }
};

// ===== Windows：GetAsyncKeyState 轮询 =====
// 拆成两个定时器：
// - RSHIFT（Sigma 呼出热键）：常驻但 30ms 足够（人手按键沿约 20-50ms）
// - WASD/鼠标（KeyStrokes 展示）：仅在覆盖层开启时轮询，关闭即停
// 旧实现 8ms 一档全量常驻（125Hz × 8 次跨 FFI 调用），笔记本上持续耗电
let isKeyDown = null; // initPolling 时赋值：vk → 是否按下

const pollTargetsTick = () => {
    if (!isKeyDown) return;
    for (const target of POLL_TARGETS) {
        const down = isKeyDown(target.vk);
        if (down !== pollState[target.vk]) {
            pollState[target.vk] = down;
            emitKeystroke(target.id, down);
        }
    }
};

const applyKeystrokesEnabled = () => {
    if (process.platform !== 'win32') return;
    const want = started && keystrokesEnabled && !!isKeyDown;
    if (want && !keyTimer) {
        keyTimer = setInterval(pollTargetsTick, POLL_INTERVAL_MS);
    } else if (!want && keyTimer) {
        clearInterval(keyTimer);
        keyTimer = null;
    }
};

const initPolling = (koffi) => {
    const user32 = koffi.load('user32.dll');
    const getAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
    isKeyDown = (vk) => (getAsyncKeyState(vk) & 0x8000) !== 0;

    // 先记录当前状态，避免启动时把"本来就没按下"当成一次松开事件
    for (const target of POLL_TARGETS) {
        pollState[target.vk] = isKeyDown(target.vk);
    }
    pollState.rshift = isKeyDown(RSHIFT_VK);

    rshiftTimer = setInterval(() => {
        const rshift = isKeyDown(RSHIFT_VK);
        if (rshift !== pollState.rshift) {
            pollState.rshift = rshift;
            if (rshift && !suspended) triggerRightShift();
        }
    }, RSHIFT_POLL_INTERVAL_MS);

    applyKeystrokesEnabled();
};

// ===== 其它平台：uiohook 低级钩子 =====
const initUiohook = async () => {
    const { uIOhook, UiohookKey } = await import('uiohook-napi');
    uiohook = uIOhook;

    const TRACKED_KEYS = {
        [UiohookKey.W]: 'forward',
        [UiohookKey.S]: 'back',
        [UiohookKey.A]: 'left',
        [UiohookKey.D]: 'right'
    };
    const TRACKED_MOUSE_BUTTONS = {
        1: 'attack',
        2: 'use'
    };

    uIOhook.on('keydown', (event) => {
        if (event.keycode === UiohookKey.ShiftRight) {
            if (!suspended) triggerRightShift();
            return;
        }
        if (keystrokesEnabled) emitKeystroke(TRACKED_KEYS[event.keycode], true);
    });
    uIOhook.on('keyup', (event) => {
        if (keystrokesEnabled) emitKeystroke(TRACKED_KEYS[event.keycode], false);
    });
    uIOhook.on('mousedown', (event) => {
        if (keystrokesEnabled) emitKeystroke(TRACKED_MOUSE_BUTTONS[event.button], true);
    });
    uIOhook.on('mouseup', (event) => {
        if (keystrokesEnabled) emitKeystroke(TRACKED_MOUSE_BUTTONS[event.button], false);
    });
    uIOhook.start();
};

export function setGlobalKeySuspended(flag) {
    suspended = !!flag;
}

// KeyStrokes 覆盖层开关：WASD/鼠标轮询只在开启时跑（RSHIFT 热键不受影响）
export function setKeystrokesEnabled(flag) {
    keystrokesEnabled = !!flag;
    applyKeystrokesEnabled();
}

export function setKeystrokeHandler(handler) {
    keystrokeHandler = typeof handler === 'function' ? handler : null;
}

export function initGlobalKeyListener({ onRightShift } = {}) {
    if (started) return;
    started = true;
    onRightShiftHandler = onRightShift;

    if (process.platform === 'win32') {
        import('koffi')
            .then((module) => {
                const koffi = module.default || module;
                initPolling(koffi);
                console.log('[GlobalKey] 已启用 GetAsyncKeyState 轮询（兼容游戏 Raw Input）');
            })
            .catch((error) => {
                console.error('[GlobalKey] 轮询启动失败，回退到低级钩子:', error);
                initUiohook().catch((err) => console.error('[GlobalKey] 启动键盘监听失败:', err));
            });
        return;
    }

    initUiohook()
        .then(() => console.log('[GlobalKey] 已启用低级钩子监听'))
        .catch((error) => console.error('[GlobalKey] 启动键盘监听失败:', error));
}

export function stopGlobalKeyListener() {
    if (!started) return;
    started = false;
    applyKeystrokesEnabled();
    if (rshiftTimer) {
        clearInterval(rshiftTimer);
        rshiftTimer = null;
    }
    try {
        uiohook?.stop();
    } catch (error) {
        console.error('[GlobalKey] 停止键盘监听失败:', error);
    }
}
