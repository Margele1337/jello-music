// Sigma 窗口自绘拖拽（移植旧版 useSigmaWindowDrag）：位置交给主进程处理，
// 四边硬夹在显示器内（四角不出界），向右拖出超过阈值后松手即贴边收起。
// 播放器与设置/登录页共用同一套指针/RAF 逻辑，差异通过参数传入：
// - noDragSelector：交互控件不触发窗口拖动
// - capturePointer：播放器需要 pointer capture（设置页原本不捕获，保持 false）
// - onBeforeDrag：播放器在起手时取消进行中的窗口动画
import { onBeforeUnmount } from 'vue';
import { resolveDragTargetX, resolveNudgeFrame } from '../../shared/dragTarget.js';

const PANEL_WIDTH = 800;
const PANEL_HEIGHT = 600;

// 当前显示器工作区：轻推回程端点与交还后的 1:1 拖拽同源，衔接才无跳变
const workArea = () => {
  const s = window.screen || {};
  const left = Number.isFinite(s.availLeft) ? s.availLeft : 0;
  const top = Number.isFinite(s.availTop) ? s.availTop : 0;
  const width = Number.isFinite(s.availWidth) ? s.availWidth : Number(s.width) || 0;
  const height = Number.isFinite(s.availHeight) ? s.availHeight : Number(s.height) || 0;
  return { left, top, right: left + width, bottom: top + height };
};

export function useSigmaWindowDrag(options = {}) {
  const {
    noDragSelector = '',
    capturePointer = false,
    onBeforeDrag = null
  } = options;

  let pendingDrag = null;
  let dragState = null;
  let dragFrame = null;
  let pendingPosition = null;
  // 侧边轻推手势（拖拽中按 RShift）：rAF 驱动出程→回程追踪拖拽预期位，
  // 期间拖拽消息暂停，结束时重定拖拽基准到手势终点，无缝交还 1:1 拖拽
  let nudgeGesture = null;
  let unsubscribeNudge = null;

  // 停靠状态一变就终止会话与手势：否则旧拖拽基准会在下一次移动把面板
  // 拽到错误位置（历史「弹出到鼠标位置」缺陷的兜底）
  let unsubscribeDock = null;
  const handleDockChanged = () => {
    if (dragState || pendingDrag) endDrag();
  };
  unsubscribeDock = window.jello?.windowControl?.onDockChanged?.(handleDockChanged) || null;

  const flushDragPosition = () => {
    dragFrame = null;
    if (nudgeGesture || !pendingPosition) return;
    window.jello?.windowControl?.sendMove?.(pendingPosition);
    pendingPosition = null;
  };

  const onDragPointerMove = (event) => {
    // 窗口位置还没取回来时，只更新最新指针位置（取回后再以此为基准，避免起手跳变）
    if (pendingDrag && event.pointerId === pendingDrag.pointerId) {
      pendingDrag.lastX = event.screenX;
      pendingDrag.lastY = event.screenY;
      return;
    }
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    dragState.lastScreenX = event.screenX;
    dragState.lastScreenY = event.screenY;
    if (nudgeGesture) return;   // 手势期间面板由动画驱动，拖拽消息暂停
    pendingPosition = {
      x: dragState.winX + (event.screenX - dragState.mouseX),
      y: dragState.winY + (event.screenY - dragState.mouseY),
      // 相对起手点向右移动的距离（主进程的贴边收起判定用）
      movedX: event.screenX - dragState.startX
    };
    if (dragFrame === null) {
      dragFrame = requestAnimationFrame(flushDragPosition);
    }
  };

  // ===== 侧边轻推手势 =====

  // 若此刻没有轻推干预，正常拖拽会把面板放到的位置（含橡皮筋/夹屏）
  const desiredWithBoundaries = () => {
    const area = workArea();
    const raw = {
      x: dragState.winX + (dragState.lastScreenX - dragState.mouseX),
      y: dragState.winY + (dragState.lastScreenY - dragState.mouseY)
    };
    const target = resolveDragTargetX({
      desiredX: raw.x,
      areaLeft: area.left,
      areaRight: area.right,
      windowWidth: window.outerWidth || PANEL_WIDTH,
      movedX: dragState.lastScreenX - dragState.startX
    });
    return {
      x: target.x,
      y: Math.min(Math.max(raw.y, area.top), area.bottom - (window.outerHeight || PANEL_HEIGHT))
    };
  };

  const endNudgeGesture = (notifyMain) => {
    const gesture = nudgeGesture;
    if (!gesture) return;
    nudgeGesture = null;
    if (gesture.raf) cancelAnimationFrame(gesture.raf);
    if (notifyMain) window.jello?.windowControl?.sendNudgeDone?.();
  };

  const beginNudgeGesture = ({ fromX, fromY, outX, outY }) => {
    if (!dragState || nudgeGesture) {
      // 无会话/已在手势中：立即回报，别让主进程标志等满兜底时限
      window.jello?.windowControl?.sendNudgeDone?.();
      return;
    }

    const gesture = { raf: 0, startedAt: performance.now() };
    nudgeGesture = gesture;

    const step = (now) => {
      if (nudgeGesture !== gesture) return;
      const desired = desiredWithBoundaries();
      const frame = resolveNudgeFrame({
        fromX, fromY, outX, outY,
        desiredX: desired.x,
        desiredY: desired.y,
        elapsedMs: now - gesture.startedAt
      });
      window.jello?.windowControl?.sendAnimatePosition?.({ x: frame.x, y: frame.y });
      if (!frame.done) {
        gesture.raf = requestAnimationFrame(step);
        return;
      }
      // 重定拖拽基准到手势终点（= 此刻拖拽预期位）：后续 1:1 移动从这里连续
      // 计算，面板已在鼠标预期位，交还无跳变
      dragState.winX = desired.x;
      dragState.winY = desired.y;
      dragState.mouseX = dragState.lastScreenX;
      dragState.mouseY = dragState.lastScreenY;
      nudgeGesture = null;
      window.jello?.windowControl?.sendNudgeDone?.();
    };
    gesture.raf = requestAnimationFrame(step);
  };

  if (window.jello?.windowControl) {
    unsubscribeNudge = window.jello.windowControl.onNudgeStart?.(beginNudgeGesture) || null;
  }

  const releaseCapture = () => {
    if (!capturePointer) return;
    const capture = dragState?.captureEl || pendingDrag?.captureEl;
    const pointerId = dragState?.pointerId ?? pendingDrag?.pointerId;
    if (capture && pointerId !== undefined && capture.hasPointerCapture?.(pointerId)) {
      try {
        capture.releasePointerCapture(pointerId);
      } catch {
        // 忽略
      }
    }
  };

  const endDrag = (event) => {
    if (event) {
      if (pendingDrag && event.pointerId !== pendingDrag.pointerId) return;
      if (dragState && event.pointerId !== dragState.pointerId) return;
    }
    // 先停手势再走松手链：nudge-done 先清掉主进程动画态，
    // sendDragEnd 的贴边收起判定才能正常执行
    endNudgeGesture(true);
    if (dragFrame !== null) {
      cancelAnimationFrame(dragFrame);
      dragFrame = null;
    }
    flushDragPosition();
    window.jello?.windowControl?.sendDragEnd?.();
    window.jello?.windowControl?.setDragActive?.(false);
    releaseCapture();

    dragState = null;
    pendingDrag = null;
    window.removeEventListener('pointermove', onDragPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || !window.jello?.windowControl) return;
    const target = event.target;
    if (target instanceof Element && noDragSelector && target.closest(noDragSelector)) return;

    if (onBeforeDrag) onBeforeDrag(event);

    // pointerdown 的 preventDefault（下方）会一并抑制浏览器默认的失焦流程：
    // 点空白处起拖时主动让聚焦中的输入框失焦（搜索框点外部取消光标）
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      active.blur();
    }

    pendingDrag = {
      pointerId: event.pointerId,
      lastX: event.screenX,
      lastY: event.screenY,
      startX: event.screenX,
      captureEl: capturePointer ? event.currentTarget : null
    };
    if (capturePointer) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 忽略不支持指针捕获的情况
      }
    }
    window.addEventListener('pointermove', onDragPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    // 会话存活上报：主进程 RShift 据此把「拖拽中按热键」解释成侧边轻推
    window.jello?.windowControl?.setDragActive?.(true);
    event.preventDefault();

    window.jello.windowControl.getBounds?.().then((bounds) => {
      if (!bounds || !pendingDrag || pendingDrag.pointerId !== event.pointerId) return;
      dragState = {
        pointerId: pendingDrag.pointerId,
        mouseX: pendingDrag.lastX,
        mouseY: pendingDrag.lastY,
        startX: pendingDrag.startX,
        winX: bounds.x,
        winY: bounds.y,
        lastScreenX: pendingDrag.lastX,
        lastScreenY: pendingDrag.lastY,
        captureEl: pendingDrag.captureEl
      };
      pendingDrag = null;
    }).catch(() => {
      endDrag();
    });
  };

  // 组件卸载时兜底清理（正常路径 endDrag 会自行解绑）
  onBeforeUnmount(() => {
    unsubscribeDock?.();
    unsubscribeDock = null;
    unsubscribeNudge?.();
    unsubscribeNudge = null;
    endNudgeGesture(false);
    if (dragState || pendingDrag) endDrag();
  });

  return { onPointerDown, endDrag };
}
