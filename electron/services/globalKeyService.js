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
const POLL_INTERVAL_MS = 8;
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
let keystrokeHandler = null;
let onRightShiftHandler = null;
let pollTimer = null;
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
const initPolling = (koffi) => {
    const user32 = koffi.load('user32.dll');
    const getAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)');
    const isDown = (vk) => (getAsyncKeyState(vk) & 0x8000) !== 0;

    // 先记录当前状态，避免启动时把"本来就没按下"当成一次松开事件
    for (const target of POLL_TARGETS) {
        pollState[target.vk] = isDown(target.vk);
    }
    pollState.rshift = isDown(RSHIFT_VK);

    pollTimer = setInterval(() => {
        for (const target of POLL_TARGETS) {
            const down = isDown(target.vk);
            if (down !== pollState[target.vk]) {
                pollState[target.vk] = down;
                emitKeystroke(target.id, down);
            }
        }
        const rshift = isDown(RSHIFT_VK);
        if (rshift !== pollState.rshift) {
            pollState.rshift = rshift;
            if (rshift && !suspended) triggerRightShift();
        }
    }, POLL_INTERVAL_MS);
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
        emitKeystroke(TRACKED_KEYS[event.keycode], true);
    });
    uIOhook.on('keyup', (event) => {
        emitKeystroke(TRACKED_KEYS[event.keycode], false);
    });
    uIOhook.on('mousedown', (event) => {
        emitKeystroke(TRACKED_MOUSE_BUTTONS[event.button], true);
    });
    uIOhook.on('mouseup', (event) => {
        emitKeystroke(TRACKED_MOUSE_BUTTONS[event.button], false);
    });
    uIOhook.start();
};

export function setGlobalKeySuspended(flag) {
    suspended = !!flag;
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
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    try {
        uiohook?.stop();
    } catch (error) {
        console.error('[GlobalKey] 停止键盘监听失败:', error);
    }
}
