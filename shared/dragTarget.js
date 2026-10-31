// Sigma 面板拖拽的 X 目标解析（纯逻辑，主进程拖拽路径与轻推回程共用）。
// 1:1 对齐旧版 AnimatedIconPanel.handleMovementAndCheckBoundaries +
// MusicPlayer.updatePanelDimensions 的两步顺序：
//   1) 先把期望位精确夹进屏幕（无越界余量）；
//   2) 期望位右缘越过「屏幕右缘 + 200」且相对按下点右移超过 70 时进入橡皮筋：
//      越出部分以半速跟随（var14 = 200），此时面板允许悬出屏幕。
// 抽成纯函数的原因：轻推回程必须与正常拖拽产出完全相同的目标（含橡皮筋），
// 否则「回到鼠标预期位置」在悬出区间会丢跟（回归缺陷：回程被硬夹在屏幕内）。

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
