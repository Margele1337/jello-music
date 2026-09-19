import { ref } from 'vue';

// 只保留 Sigma 界面：主窗口作为隐藏播放宿主，始终处于 Sigma 模式
const sigmaUI = ref(true);
let initialized = false;

// Sigma 独立窗口自身不触发窗口切换
const hashRoute = typeof window !== 'undefined'
  ? window.location.hash.replace(/^#\/?/, '').split('?')[0]
  : '';
const isSigmaWindow = hashRoute === 'sigma';
// 桌面歌词/频谱/按键显示等辅助窗口不触发打开 Sigma 窗口
const isAuxWindow = hashRoute === 'lyrics' || hashRoute === 'spectrum-hud' || hashRoute === 'keystrokes';

// 兼容旧调用：不再支持退出 Sigma 模式
const setSigmaUI = () => {
  sigmaUI.value = true;
};

const init = () => {
  if (initialized) return;
  initialized = true;
  sigmaUI.value = true;

  if (typeof window !== 'undefined' && window.electron?.ipcRenderer && !isSigmaWindow && !isAuxWindow) {
    // 启动即打开独立 Sigma 窗口（主窗口保持隐藏播放）
    setTimeout(() => {
      window.electron.ipcRenderer.send('sigma-window-enter');
    }, 0);
  }
};

export function useSigmaUI() {
  init();
  return {
    sigmaUI,
    setSigmaUI
  };
}
