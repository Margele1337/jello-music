import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import customTrayMenu from './services/customTrayMenu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_PATH = path.join(__dirname, 'assets', 'tray.png');

let tray = null;
let callbacks = {
  showWindow: () => {},
  quit: () => {},
  playPause: () => {},
  previous: () => {},
  next: () => {},
  showHide: () => {},
  openSettings: () => {}
};

export const initTray = (nextCallbacks) => {
  callbacks = { ...callbacks, ...nextCallbacks };
};

export const hasTray = () => !!tray;

// 右键托盘：自绘 HTML 菜单（歌曲卡片 + 播放控制 + 动作列表，含设置入口）。
// 主窗口不可用时回退原生菜单。
const buildNativeFallback = () => Menu.buildFromTemplate([
  { label: '播放 / 暂停', click: () => callbacks.playPause() },
  { label: '上一首', click: () => callbacks.previous() },
  { label: '下一首', click: () => callbacks.next() },
  { type: 'separator' },
  { label: '设置', click: () => callbacks.openSettings() },
  { label: '显示 Jello Music', click: () => callbacks.showWindow() },
  { type: 'separator' },
  { label: '退出', click: () => callbacks.quit() }
]);

export const syncTray = (enabled) => {
  if (!enabled) {
    customTrayMenu.cleanup();
    tray?.destroy();
    tray = null;
    return;
  }
  if (tray) return;

  const image = nativeImage.createFromPath(ICON_PATH);
  if (image.isEmpty()) {
    console.warn('[tray] 托盘图标加载失败:', ICON_PATH);
    return;
  }

  tray = new Tray(image.resize({ width: 32, height: 32 }));
  tray.setToolTip('Jello Music');

  // 右键：自绘菜单窗（原生菜单仅作主窗口缺失时的兜底）
  tray.on('right-click', () => {
    customTrayMenu.toggle().catch(() => {
      customTrayMenu.hide();
      tray?.popUpContextMenu(buildNativeFallback());
    });
  });

  // 左键单击/双击：呼出面板
  tray.on('click', () => {
    customTrayMenu.hide();
    callbacks.showWindow();
  });
  tray.on('double-click', () => {
    customTrayMenu.hide();
    callbacks.showWindow();
  });
};

export const getTrayInstance = () => tray;
