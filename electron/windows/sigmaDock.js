import { screen } from 'electron';
import { getForegroundFullscreenState } from '../services/fullscreenWatcher.js';
import { resolveDragTargetX } from '../../shared/dragTarget.js';
import { IPC } from '../../shared/ipc.js';

// 右侧收起/呼出：1:1 移植旧版 sigmaWindow.js 的行为。
const DOCK_VISIBLE = 40;   // 收起后保留可见宽度（原版 var8 = parentWidth - 40）
const RESTORE_MARGIN = 20; // 滑出后距右缘间距（原版 var11 = parentWidth - 20 - width）

// 窗口尺寸按设计恒定（无边框，bounds=content）：拖拽/吸附路径一律用常量而不是
// getBounds 的实测值：跨缩放比例显示器拖动时 WM_DPICHANGED 可能瞬时改坏
// 尺寸，若用 bounds.width 回写会把漂移固化。
const WINDOW_WIDTH = 800;
const WINDOW_HEIGHT = 600;

// 拖拽中的「右缘是否越过屏幕右缘」信号（连续，1:1 对齐原版
// MusicPlayer.draw 的 getXA() + getWidthA() > parent.getWidthA()）。
// 与 docked 分开：后者是离散吸附态，前者只描述几何位置。
let overhanging = false;
const setOverhanging = (value) => {
  if (overhanging === value) return;
  overhanging = value;
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.WINDOW_OVERHANG_CHANGED, value);
  }
};

// 缓动动画（复刻原版 updatePanelDimensions：var7 = dt / 18.1ms，每帧 x 0.25 × var7、y 0.2 × var7）
// 首选渲染进程 rAF 驱动（与显示器垂直同步）；窗口离屏导致 rAF 降频/停发时，
// 主进程 150ms 收不到帧就接管，用同一套公式从最后一帧坐标继续推进
const ANIM_GAME_FRAME_MS = 18.10361;
const ANIM_TICK_MS = 4;
const ANIM_MAX_DT = 40;
const ANIM_RENDERER_TIMEOUT = 150;
const ANIM_STUCK_MS = 3000;

const TOGGLE_THROTTLE_MS = 120;

let getWindow = () => null;
let docked = false;
let animating = false;
let animationTimer = null;
let animationWatchdog = null;
let animationStartedAt = 0;
let animationMode = null; // 'renderer' | 'main'
let lastFrameAt = 0;
let lastX = 0;
let lastY = 0;
let targetX = 0;
let targetY = 0;
let lastToggleAt = 0;
let raiseTimer = null;

// 渲染层拖拽会话存活（window:drag-active 上报，pointerdown 建 / pointerup 撤）
let dragActive = false;

// 拖拽中按 RShift 的「侧边轻推」：出程向收起方向位移一小段（不做任何状态
// 切换），回程连续追踪渲染层拖拽的预期位置（moveMainWindow 回程段 retarget），
// 收敛后无缝交还 1:1 拖拽。轻推期间 animationBlocked() 为真：拖拽消息不能
// 直接 setBounds、松手不能触发吸附，任何路径都拽不离动画轨迹
let nudge = null; // { phase: 'out'|'return', timer, startX, startY, outX, targetX, targetY, lastTime }

export const initDockController = (getter) => {
  getWindow = getter;
};

export const isMainWindowDocked = () => docked;

const emitDockState = (value) => {
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send(IPC.WINDOW_DOCK_CHANGED, value);
};

const cancelAnimation = () => {
  if (animationTimer) {
    clearTimeout(animationTimer);
    animationTimer = null;
  }
  if (animationWatchdog) {
    clearInterval(animationWatchdog);
    animationWatchdog = null;
  }
  animationMode = null;
  animating = false;
};

export const stopDockAnimation = () => {
  cancelAnimation();
  cancelNudge();
};

export const resetDockState = () => {
  cancelAnimation();
  cancelNudge();
  docked = false;
  if (raiseTimer) {
    clearTimeout(raiseTimer);
    raiseTimer = null;
  }
};

const animationBlocked = () => {
  if (nudge) return true;
  if (!animating) return false;
  if (Date.now() - animationStartedAt > ANIM_STUCK_MS) {
    cancelAnimation();
    return false;
  }
  return true;
};

const setBoundsAt = (win, x, y) => {
  // 重申固定 800x600 而不能只 setPosition：WM_DPICHANGED 后系统可能改大窗口，
  // 动画期间只改位置会把漂移留到收起结束，下方露出额外透明背景
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
};

// 主进程接管推进（渲染进程 rAF 不可用时兜底，公式与渲染层完全一致）
const runMainAnimation = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) {
    cancelAnimation();
    return;
  }
  animationMode = 'main';
  win.webContents.send(IPC.WINDOW_ANIMATE_STOP);

  let currentX = lastX;
  let currentY = lastY;
  let lastTime = Date.now();

  const step = () => {
    animationTimer = null;
    const current = getWindow();
    if (!current || current.isDestroyed()) {
      cancelAnimation();
      return;
    }

    const now = Date.now();
    const dt = Math.min(ANIM_MAX_DT, Math.max(1, now - lastTime));
    lastTime = now;
    const frameFactor = dt / ANIM_GAME_FRAME_MS;

    currentX = targetX > currentX
      ? Math.min(currentX + (targetX - currentX) * 0.25 * frameFactor, targetX)
      : Math.max(currentX + (targetX - currentX) * 0.25 * frameFactor, targetX);
    currentY = targetY > currentY
      ? Math.min(currentY + (targetY - currentY) * 0.2 * frameFactor, targetY)
      : Math.max(currentY + (targetY - currentY) * 0.2 * frameFactor, targetY);

    lastX = currentX;
    lastY = currentY;

    if (Math.abs(targetX - currentX) < 0.5 && Math.abs(targetY - currentY) < 0.5) {
      setBoundsAt(current, targetX, targetY);
      cancelAnimation();
      return;
    }

    setBoundsAt(current, currentX, currentY);
    animationTimer = setTimeout(step, ANIM_TICK_MS);
  };
  step();
};

const startAnimation = (win, toX, toY) => {
  cancelNudge();   // 真实收起/呼出动画接管：进行中的轻推作废
  const start = win.getBounds();
  if (Math.abs(start.x - toX) < 1 && Math.abs(start.y - toY) < 1) {
    // 必须先停掉在跑的动画：否则旧动画会继续往它自己的目标推进，
    // 面板就与目标位各走各的（连按时表现为"分散开"）
    cancelAnimation();
    return;
  }

  cancelAnimation();
  animating = true;
  animationStartedAt = Date.now();
  animationMode = 'renderer';
  targetX = toX;
  targetY = toY;
  lastX = start.x;
  lastY = start.y;
  lastFrameAt = Date.now();

  win.webContents.send(IPC.WINDOW_ANIMATE_TO, {
    x: Math.round(toX),
    y: Math.round(toY),
    fromX: start.x,
    fromY: start.y
  });

  animationWatchdog = setInterval(() => {
    if (!animating || animationMode !== 'renderer') return;
    if (Date.now() - lastFrameAt > ANIM_RENDERER_TIMEOUT) runMainAnimation();
  }, 50);
};

// 渲染进程每帧回传的动画位置（仅渲染进程驱动阶段生效）
export const applyAnimatePosition = (x, y) => {
  const win = getWindow();
  if (!win || win.isDestroyed() || !animating || animationMode !== 'renderer') return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  lastFrameAt = Date.now();
  lastX = x;
  lastY = y;
  setBoundsAt(win, x, y);
};

// 渲染进程动画结束（主进程接管后忽略，避免误取消）
export const finishAnimate = () => {
  if (!animating || animationMode !== 'renderer') return;
  cancelAnimation();
};

const areaFor = (win) => screen.getDisplayMatching(win.getBounds()).workArea;

const centerYFor = (area, height = WINDOW_HEIGHT) => (
  Math.round(area.y + (area.height - height) / 2)
);

// 呼出瞬间置顶 600ms（不常驻）；前台是全屏应用时保持置顶直到全屏退出，
// 否则降回会让面板立刻沉到全屏窗口后面，看起来像「呼出没反应」
export const raiseMainWindow = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true);
  win.show();
  win.moveTop();
  win.focus();
  if (raiseTimer) clearTimeout(raiseTimer);
  const dropWhenSafe = () => {
    raiseTimer = null;
    const current = getWindow();
    if (!current || current.isDestroyed()) return;
    if (getForegroundFullscreenState().fullscreen) {
      raiseTimer = setTimeout(dropWhenSafe, 500);
      return;
    }
    current.setAlwaysOnTop(false);
  };
  raiseTimer = setTimeout(dropWhenSafe, 600);
};

export const dropMainWindowRaise = () => {
  if (raiseTimer) {
    clearTimeout(raiseTimer);
    raiseTimer = null;
  }
  const win = getWindow();
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(false);
};

export const dockMainWindow = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) return false;

  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();
  if (win.isMaximized()) win.unmaximize();

  const area = areaFor(win);
  const bounds = win.getBounds();
  const right = area.x + area.width;
  const centerY = centerYFor(area);

  // 收起 = 用户明确不再需要面板在前：立即撤掉呼出时的置顶
  if (raiseTimer) {
    clearTimeout(raiseTimer);
    raiseTimer = null;
  }
  win.setAlwaysOnTop(false);

  docked = true;
  emitDockState(true);

  if (Math.abs(bounds.x - (right - DOCK_VISIBLE)) < 1 && Math.abs(bounds.y - centerY) < 1) {
    cancelAnimation();
    return true;
  }
  startAnimation(win, right - DOCK_VISIBLE, centerY);
  return true;
};

export const restoreMainWindow = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) return false;

  if (!win.isVisible()) win.show();
  if (win.isMinimized()) win.restore();

  const area = areaFor(win);
  const bounds = win.getBounds();
  const right = area.x + area.width;

  // 不要用「是否越过右边缘」判断是否需要滑出：收起动画进行中面板可能还在屏幕
  // 中间，按几何位置判定会误判成「无需滑出」而卡在中间。docked 才是权威标志。
  if (!docked && bounds.x + bounds.width <= right) return false;

  docked = false;
  emitDockState(false);
  startAnimation(win, right - WINDOW_WIDTH - RESTORE_MARGIN, centerYFor(area));
  return true;
};

export const toggleMainWindowDock = () => {
  const now = Date.now();
  if (now - lastToggleAt < TOGGLE_THROTTLE_MS) return false;
  lastToggleAt = now;
  return docked ? restoreMainWindow() : dockMainWindow();
};

// 拖动过程中，1:1 对齐原版 AnimatedIconPanel.handleMovementAndCheckBoundaries
// 与 MusicPlayer.updatePanelDimensions 的 else（拖拽中）分支。原版每 tick 顺序：
//   1) AnimatedIconPanel 先 setXA(desired)，再把 xA 精确夹在 [0, parentW - width]
//   2) MusicPlayer 再判 desired + width > parentW + 200 && movedX > 70
//      成立则 var15 = desired - xA - 200，xA = (int)(xA + var15 * 0.5)
//
// 关键：第 2 步的基准 xA 是「本 tick 刚从 desired 夹出来的值」，不是上一次留下的
// 窗口位置。基准取错会让橡皮筋不动点从「纯光标函数」退化成「完整超出量」。
export const moveMainWindow = (x, y, movedX = 0) => {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  if (nudge) {
    // 轻推回程段：渲染层拖拽的预期位置就是回程目标，动画连续追踪——直接
    // setBounds 会把「回到鼠标」变成瞬移；出程段丢弃拖拽消息。
    // 目标解析必须与正常拖拽同一套（含橡皮筋）：悬出区间若被硬夹回屏幕内，
    // 回程就到不了鼠标预期位置（回归缺陷：拖右一段距离后回不到鼠标）
    if (nudge.phase === 'return' && Number.isFinite(x) && Number.isFinite(y)) {
      const area = screen.getDisplayMatching({
        x: Math.round(x), y: Math.round(y), width: WINDOW_WIDTH, height: WINDOW_HEIGHT
      }).workArea;
      const target = resolveDragTargetX({
        desiredX: x, areaLeft: area.x, areaRight: area.x + area.width, windowWidth: WINDOW_WIDTH, movedX
      });
      nudge.targetX = target.x;
      nudge.targetY = Math.min(Math.max(Math.round(y), area.y), area.y + area.height - WINDOW_HEIGHT);
      setOverhanging(target.overhanging);
    }
    return;
  }
  if (animationBlocked()) return;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  const bounds = win.getBounds();
  const display = screen.getDisplayMatching({
    x: Math.round(x), y: Math.round(y), width: WINDOW_WIDTH, height: WINDOW_HEIGHT
  });
  const area = display.workArea;
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const nextY = Math.min(Math.max(Math.round(y), area.y), bottom - WINDOW_HEIGHT);

  // 夹取 + 橡皮筋两步（原版顺序）收敛在纯函数里，与轻推回程共用同一套目标
  const target = resolveDragTargetX({
    desiredX: x, areaLeft: area.x, areaRight: right, windowWidth: WINDOW_WIDTH, movedX
  });
  setOverhanging(target.overhanging);
  if (target.x !== bounds.x || nextY !== bounds.y) {
    win.setBounds({ x: target.x, y: nextY, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  }
};

// 松手：若窗口右缘越过屏幕右缘（严格 >，1:1 对齐原版 MusicPlayer.java:309）→ 吸附收起
export const finishMainWindowDrag = () => {
  const win = getWindow();
  if (!win || win.isDestroyed() || animationBlocked()) return;
  const bounds = win.getBounds();
  const area = areaFor(win);
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const centerY = centerYFor(area);

  if (bounds.x + WINDOW_WIDTH > right) {
    docked = true;
    emitDockState(true);
    setOverhanging(true);
    startAnimation(win, right - DOCK_VISIBLE, centerY);
    return;
  }

  docked = false;
  emitDockState(false);
  // 未收起：清掉拖拽期的越界信号，之后透明度只跟 dock-changed 走
  setOverhanging(false);
  const nextX = Math.min(Math.max(bounds.x, area.x), right - WINDOW_WIDTH);
  const nextY = Math.min(Math.max(bounds.y, area.y), bottom - WINDOW_HEIGHT);
  if (nextX !== bounds.x || nextY !== bounds.y) {
    win.setBounds({ x: nextX, y: nextY, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  }
};

// ===== 拖拽会话存活与「侧边轻推」 =====

export const setMainWindowDragActive = (value) => {
  dragActive = value === true;
};

export const isMainWindowDragActive = () => dragActive;

export const isNudgeActive = () => !!nudge;

export const cancelNudge = () => {
  if (!nudge) return;
  if (nudge.timer) clearTimeout(nudge.timer);
  nudge = null;
};

const NUDGE_OUT_RATIO = 0.25;   // 出程位移 = 距收起位距离的 25%（「移动一点」）
const NUDGE_MAX_PX = 140;       // 出程位移上限
const NUDGE_MIN_PX = 24;        // 已悬出收起位时的保底可见位移
const NUDGE_OUT_FACTOR = 0.25;  // 缓动系数与收起动画同族
const NUDGE_RETURN_FACTOR = 0.35;
const NUDGE_RETURN_Y_FACTOR = 0.25;
const NUDGE_RETURN_FAILSAFE_MS = 2000;   // 回程兜底：超时强制交还 1:1 拖拽

const nudgeStep = () => {
  if (!nudge) return;
  nudge.timer = null;
  const win = getWindow();
  if (!win || win.isDestroyed()) {
    cancelNudge();
    return;
  }

  const now = Date.now();
  const dt = Math.min(ANIM_MAX_DT, Math.max(1, now - nudge.lastTime));
  nudge.lastTime = now;
  const frameFactor = dt / ANIM_GAME_FRAME_MS;
  const fx = nudge.phase === 'out' ? NUDGE_OUT_FACTOR : NUDGE_RETURN_FACTOR;
  const fy = nudge.phase === 'out' ? 0.2 : NUDGE_RETURN_Y_FACTOR;

  // 位置推进必须走内部浮点状态（与 runMainAnimation 同构），不能每帧回读
  // getBounds 再缓动：setBounds 写入取整，剩余距离缩到步长 < 1px 时取整会
  // 把步进整个吞掉，位置停住而收敛判定（对内部值）永假——出程段永久卡死，
  // 拖拽消息被全部丢弃（表现为面板冻结，只能 RShift 收起恢复）
  let currentX = nudge.currentX;
  let currentY = nudge.currentY;
  currentX = nudge.targetX > currentX
    ? Math.min(currentX + (nudge.targetX - currentX) * fx * frameFactor, nudge.targetX)
    : Math.max(currentX + (nudge.targetX - currentX) * fx * frameFactor, nudge.targetX);
  currentY = nudge.targetY > currentY
    ? Math.min(currentY + (nudge.targetY - currentY) * fy * frameFactor, nudge.targetY)
    : Math.max(currentY + (nudge.targetY - currentY) * fy * frameFactor, nudge.targetY);
  nudge.currentX = currentX;
  nudge.currentY = currentY;

  if (nudge.phase === 'out' && Math.abs(nudge.outX - currentX) < 0.5) {
    // 出程到位 → 切回程：目标先回到轻推起点，回程段由 moveMainWindow 持续
    // retarget 成拖拽预期位置（鼠标在动就跟手，静止则原位收回）
    nudge.phase = 'return';
    nudge.returnStartedAt = now;
    nudge.targetX = nudge.startX;
    nudge.targetY = nudge.startY;
  } else if (nudge.phase === 'return'
    && Math.abs(nudge.targetX - currentX) < 0.5 && Math.abs(nudge.targetY - currentY) < 0.5) {
    // 收敛到拖拽预期位置：此时交还 1:1 拖拽，后续 moveMainWindow 直接生效，
    // 面板已在鼠标预期位，无跳变
    setBoundsAt(win, nudge.targetX, nudge.targetY);
    cancelNudge();
    return;
  }

  if (!nudge) return;
  // 兜底：拖拽目标持续移动导致缓动长期不收敛时，强制交还 1:1 拖拽
  //（交还瞬间位置与目标可能有小差量，由后续 moveMainWindow 平滑追上）
  if (nudge.phase === 'return' && now - nudge.returnStartedAt > NUDGE_RETURN_FAILSAFE_MS) {
    cancelNudge();
    return;
  }
  setBoundsAt(win, currentX, currentY);
  nudge.timer = setTimeout(nudgeStep, ANIM_TICK_MS);
};

export const nudgeMainWindow = () => {
  const win = getWindow();
  if (!win || win.isDestroyed() || !win.isVisible() || nudge) return false;
  cancelAnimation();   // 若有收起/呼出动画在跑（理论不会：拖拽起手已取消），先停
  const bounds = win.getBounds();
  const area = areaFor(win);
  const dockX = area.x + area.width - DOCK_VISIBLE;
  // 已悬出收起位（向右拖过头）时也必须给出可见的轻推并回程——绝不能在此
  // 返回 false 落回「真收起」分支，那正是「拖右一段距离后按 RShift 面板
  // 不回到鼠标位置」的根源之一
  const towardDock = dockX - bounds.x;
  const excursion = towardDock > 0
    ? Math.min(NUDGE_MAX_PX, towardDock * NUDGE_OUT_RATIO)
    : NUDGE_MIN_PX;
  const outX = bounds.x + excursion;
  if (excursion < 2) return false;   // 理论兜底（悬出态走 NUDGE_MIN_PX，不会到达）
  nudge = {
    phase: 'out',
    timer: null,
    startX: bounds.x,
    startY: bounds.y,
    currentX: bounds.x,
    currentY: bounds.y,
    outX,
    targetX: outX,
    targetY: bounds.y,
    lastTime: Date.now()
  };
  nudgeStep();
  return true;
};

export const getMainWindowBounds = () => {
  const win = getWindow();
  if (!win || win.isDestroyed()) return null;
  return win.getBounds();
};
