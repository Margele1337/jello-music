// electron-builder 复制 Electron 后会删除 resources/default_app.asar，而 Windows
// 杀毒/索引器可能短暂占用该文件，导致 unlink EBUSY、整个打包失败。
// 本项目始终以自带 app 启动 Electron，不需要 default_app.asar，打包前从本地
// Electron 分发里移除它，electron-builder 就不会再尝试删除目标副本。
const fs = require('node:fs');
const path = require('node:path');

const target = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar');

const remove = (attempt) => {
  try {
    if (!fs.existsSync(target)) return;
    fs.unlinkSync(target);
    console.log('[electron-dist] removed default_app.asar');
  } catch (error) {
    if (attempt >= 5) {
      console.warn('[electron-dist] could not remove default_app.asar:', error.message);
      return;
    }
    setTimeout(() => remove(attempt + 1), 400);
  }
};

remove(1);
