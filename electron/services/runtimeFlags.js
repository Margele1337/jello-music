import { app } from 'electron/main';

/**
 * GPU 加速开关必须在 app.ready 之前落定：Chromium 的合成器与 GPU 进程在
 * ready 时就按当时的命令行定型，之后再 disableHardwareAcceleration() 只是记个标志，
 * 透明窗口（本应用主面板是 frameless + transparent）会继续走 GPU 光栅化，
 * 在部分旧驱动/远程桌面上直接黑块。所以这里只改命令行，由 UI 提示用户重启。
 */
export const applyGpuAccelerationFlag = (enabled) => {
  if (enabled !== false) return false;
  app.disableHardwareAcceleration();
  // 透明窗口在软件合成下必须显式开 visuals 并禁 GPU 合成，否则背景不透明
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  return true;
};
