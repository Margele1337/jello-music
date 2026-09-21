// Sigma 窗口自绘拖拽（设置/登录页用）：位置交给主进程处理，
// 四边硬夹在显示器内（四角不出界），向右拖出超过阈值后松手即贴边收起。
// 与 SigmaMusicPlayer 内的拖拽逻辑一致，这里只保留设置/登录页需要的部分。
export function useSigmaWindowDrag(noDragSelector) {
  let pendingDrag = null;
  let dragState = null;
  let dragFrame = null;
  let pendingPosition = null;

  const flushDragPosition = () => {
    dragFrame = null;
    if (!pendingPosition) return;
    window.electron?.ipcRenderer.send('sigma-window-move', pendingPosition);
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
    window.electron?.ipcRenderer.send('sigma-window-drag-end');
    dragState = null;
    pendingDrag = null;
    window.removeEventListener('pointermove', onDragPointerMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || !window.electron?.ipcRenderer) return;
    const target = event.target;
    if (target instanceof Element && noDragSelector && target.closest(noDragSelector)) return;

    pendingDrag = {
      pointerId: event.pointerId,
      lastX: event.screenX,
      lastY: event.screenY,
      startX: event.screenX
    };
    window.addEventListener('pointermove', onDragPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    event.preventDefault();

    window.electron.ipcRenderer.invoke('sigma-window-get-bounds').then((bounds) => {
      if (!bounds || !pendingDrag || pendingDrag.pointerId !== event.pointerId) return;
      dragState = {
        pointerId: pendingDrag.pointerId,
        mouseX: pendingDrag.lastX,
        mouseY: pendingDrag.lastY,
        startX: pendingDrag.startX,
        winX: bounds.x,
        winY: bounds.y
      };
      pendingDrag = null;
    }).catch(() => {
      endDrag();
    });
  };

  return { onPointerDown, endDrag };
}
