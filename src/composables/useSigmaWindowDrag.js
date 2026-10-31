// Sigma 窗口自绘拖拽（移植旧版 useSigmaWindowDrag）：位置交给主进程处理，
// 四边硬夹在显示器内（四角不出界），向右拖出超过阈值后松手即贴边收起。
// 播放器与设置/登录页共用同一套指针/RAF 逻辑，差异通过参数传入：
// - noDragSelector：交互控件不触发窗口拖动
// - capturePointer：播放器需要 pointer capture（设置页原本不捕获，保持 false）
// - onBeforeDrag：播放器在起手时取消进行中的窗口动画
import { onBeforeUnmount } from 'vue';

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
  // 停靠状态一变就终止本会话：收起后面板已到屏幕右缘、呼出后面板在回弹路上，
  // 按下时记录的拖拽基准都会在下一次移动把面板拽到错误位置（历史「弹出到
  // 鼠标位置」缺陷的兜底）。重新按住即可再拖
  let unsubscribeDock = null;
  const handleDockChanged = () => {
    if (dragState || pendingDrag) endDrag();
  };
  unsubscribeDock = window.jello?.windowControl?.onDockChanged?.(handleDockChanged) || null;

  const flushDragPosition = () => {
    dragFrame = null;
    if (!pendingPosition) return;
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
    if (dragState || pendingDrag) endDrag();
  });

  return { onPointerDown, endDrag };
}
