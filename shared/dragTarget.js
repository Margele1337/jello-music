// Sigma 面板拖拽的 X 目标解析（纯逻辑，正常拖拽路径与轻推回程共用），
// 1:1 对齐旧版两步顺序：先精确夹进屏幕；越过「右缘 + 200」且相对按下点
// 右移超 70 时进入橡皮筋（越出部分半速跟随，允许悬出屏幕）。两条路径必须
// 同源，否则轻推回程在悬出区间会丢跟。

export const RUBBER_BAND_THRESHOLD_PX = 200;   // 原版 var14
export const RUBBER_BAND_MIN_MOVED_X = 70;

/**
 * @param {number} desiredX 渲染层算出的期望 X（按下基准 + 鼠标位移，可为浮点）
 * @param {number} areaLeft 工作区左缘
 * @param {number} areaRight 工作区右缘
 * @param {number} windowWidth 面板宽（800）
 * @param {number} movedX 相对按下点向右的位移
 * @returns {{ x: number, overhanging: boolean }}
 */
export const resolveDragTargetX = ({
  desiredX, areaLeft, areaRight, windowWidth, movedX
}) => {
  const clampedX = Math.min(Math.max(Math.round(desiredX), areaLeft), areaRight - windowWidth);
  if (desiredX + windowWidth > areaRight + RUBBER_BAND_THRESHOLD_PX
    && movedX > RUBBER_BAND_MIN_MOVED_X) {
    const pushedX = clampedX + Math.trunc((desiredX - clampedX - RUBBER_BAND_THRESHOLD_PX) * 0.5);
    return { x: pushedX, overhanging: pushedX + windowWidth > areaRight };
  }
  return { x: clampedX, overhanging: clampedX + windowWidth > areaRight };
};

// ===== 轻推手势帧（渲染层 rAF 驱动，纯计算便于单测） =====
// 两段连续曲线：出程 easeOutCubic（冲向侧边、自然减速），回程 easeInOutCubic
// 追踪拖拽预期位（端点随鼠标移动实时取当前值，不产生折返死停）。
// 回程端点是「若此刻没有轻推，拖拽会把面板放到的位置」（含橡皮筋）。
export const NUDGE_OUT_MS = 140;
export const NUDGE_BACK_MS = 220;

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * @param {number} elapsedMs 手势开始后经过的毫秒数
 * @returns {{ x: number, y: number, done: boolean }} 该帧面板应在的位置（浮点，
 *   调用方经 animate-position 通道落盘取整，浮点状态留在渲染层不回灌）
 */
export const resolveNudgeFrame = ({
  fromX, fromY, outX, outY, desiredX, desiredY, elapsedMs
}) => {
  if (elapsedMs < NUDGE_OUT_MS) {
    const k = easeOutCubic(Math.max(0, elapsedMs / NUDGE_OUT_MS));
    return {
      x: fromX + (outX - fromX) * k,
      y: fromY + (outY - fromY) * k,
      done: false
    };
  }
  const t = (elapsedMs - NUDGE_OUT_MS) / NUDGE_BACK_MS;
  if (t >= 1) return { x: desiredX, y: desiredY, done: true };
  const k = easeInOutCubic(Math.max(0, t));
  return {
    x: outX + (desiredX - outX) * k,
    y: outY + (desiredY - outY) * k,
    done: false
  };
};
