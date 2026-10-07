// 亚克力毛玻璃层的 preload
//
// 这层铺满工作区且不穿透，需要知道用户点在了哪里：
// 点在 Sigma 面板内 → 只把毛玻璃补回来；点在面板外 → 收起毛玻璃并把面板吸附到右侧。
// 单独一个 preload 而非复用 preload.cjs：那边是白名单通道，不适合这种内部坐标上报。
const { ipcRenderer } = require('electron');

window.addEventListener('mousedown', function (event) {
    // 显式取基本类型再发送：sandboxed preload 里直接把事件对象塞进结构化
    // 克隆会报 "object is not iterable"
    ipcRenderer.send('acrylic-click', {
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0
    });
});