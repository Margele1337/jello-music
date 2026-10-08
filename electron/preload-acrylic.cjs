// 毛玻璃层的 preload
//
// 两个职责：
// 1) 转发点击坐标 —— 这层铺满工作区且不穿透，需要知道用户点在了哪里：
//    点在 Sigma 面板内 → 只把毛玻璃补回来；点在面板外 → 收起毛玻璃并把面板吸附到右侧。
//    单独一个 preload 而非复用 preload.cjs：那边是白名单通道，不适合这种内部坐标上报。
// 2) 转发采集源 —— 页面是 sandbox + contextIsolation，拿不到 desktopCapturer，
//    必须由主进程把 sourceId / 分辨率送进来才能起 getUserMedia 流。
const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('mousedown', function (event) {
    // 显式取基本类型再发送：sandboxed preload 里直接把事件对象塞进结构化
    // 克隆会报 "object is not iterable"
    ipcRenderer.send('acrylic-click', {
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0
    });
});

// 只暴露这一个主进程 → 页面的事件，不做通用通道桥
contextBridge.exposeInMainWorld('acrylicBridge', {
    onCaptureSource: (listener) => {
        if (typeof listener !== 'function') return;
        ipcRenderer.on('acrylic-capture-source', (_event, info) => {
            if (!info) return;
            // active=false 只带停流信号，没有 sourceId
            if (info.active === false) {
                listener({ active: false });
                return;
            }
            if (!info.sourceId) return;
            listener({
                active: true,
                sourceId: String(info.sourceId),
                width: Number(info.width) || 0,
                height: Number(info.height) || 0,
                maxFrameRate: Number(info.maxFrameRate) || 30,
                // show 时带上当前模糊进度，让页面先落位再起流
                reveal: Number(info.reveal) || 0,
                radius: Number(info.radius) || 0
            });
        });
    },
    // 起流失败时告诉主进程：多半是缓存的 sourceId 失效了
    reportCaptureFailure: () => ipcRenderer.send('acrylic-capture-failed')
});