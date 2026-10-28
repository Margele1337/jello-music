import { app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from '../../shared/ipc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const iconDir = app.isPackaged
  ? path.join(process.resourcesPath, 'sigma-music')
  : path.join(__dirname, '..', '..', 'src', 'assets', 'sigma', 'music');

const icon = (name) => path.join(iconDir, name);

// Windows 任务栏缩略图工具栏：上一首 / 播放暂停 / 下一首
// 按钮状态由渲染进程上报的真实播放状态驱动（player:state），不乐观翻转
export const setThumbarButtons = (mainWindow, isPlaying = false) => {
  if (process.platform !== 'win32') return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setThumbarButtons([
      {
        tooltip: '上一首',
        icon: icon('backwards.png'),
        click: () => mainWindow.webContents.send(IPC.PLAYER_COMMAND, 'previous')
      },
      {
        tooltip: isPlaying ? '暂停' : '播放',
        icon: icon(isPlaying ? 'pause.png' : 'play.png'),
        click: () => mainWindow.webContents.send(IPC.PLAYER_COMMAND, 'toggle')
      },
      {
        tooltip: '下一首',
        icon: icon('forwards.png'),
        click: () => mainWindow.webContents.send(IPC.PLAYER_COMMAND, 'next')
      }
    ]);
  } catch {
    /* 某些会话（如远程桌面）不支持缩略图工具栏 */
  }
};
