import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICON_PATH = path.join(__dirname, 'assets', 'tray.png');

let tray = null;
let callbacks = {
  showWindow: () => {},
  quit: () => {},
  playPause: () => {},
  previous: () => {},
  next: () => {}
};

export const initTray = (nextCallbacks) => {
  callbacks = { ...callbacks, ...nextCallbacks };
};

export const hasTray = () => !!tray;

export const syncTray = (enabled) => {
  if (!enabled) {
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
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '播放 / 暂停', click: () => callbacks.playPause() },
    { label: '上一首', click: () => callbacks.previous() },
    { label: '下一首', click: () => callbacks.next() },
    { type: 'separator' },
    { label: '显示 Jello Music', click: () => callbacks.showWindow() },
    { type: 'separator' },
    { label: '退出', click: () => callbacks.quit() }
  ]));
  tray.on('click', () => callbacks.showWindow());
};
