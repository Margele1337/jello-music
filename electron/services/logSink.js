import { app, dialog } from 'electron/main';
import fs from 'node:fs';
import path from 'node:path';
import { redactLogText } from '../../shared/ipc.js';

// 本应用此前没有落盘日志（只有 stdout），导出功能无内容可导。
// 这里加一个极小的环形缓冲 + 追加写：常驻内存只留最后 N 行，
// 文件按大小滚动，避免长时间播放把 userData 撑爆。
const MAX_IN_MEMORY_LINES = 4000;
const MAX_LOG_FILE_BYTES = 2 * 1024 * 1024;
const ROTATED_FILE_SUFFIX = '.1';

let logFilePath = '';
let writing = false;
let pending = [];
let memoryLines = [];
let consoleHooked = false;

export const getLogFilePath = () => logFilePath;

const rotateIfNeeded = () => {
  try {
    const stat = fs.statSync(logFilePath);
    if (stat.size < MAX_LOG_FILE_BYTES) return;
    const rotated = `${logFilePath}${ROTATED_FILE_SUFFIX}`;
    fs.rmSync(rotated, { force: true });
    fs.renameSync(logFilePath, rotated);
  } catch {
    /* 文件还不存在或无权限：下一次追加写会重建 */
  }
};

const drain = () => {
  if (writing || !pending.length || !logFilePath) return;
  const batch = pending.splice(0, pending.length);
  writing = true;
  fs.appendFile(logFilePath, `${batch.join('\n')}\n`, (error) => {
    writing = false;
    if (error) console.warn('[log] 写入日志文件失败:', error.message);
    if (pending.length) {
      scheduleFlush();
    } else if (memoryLines.length > MAX_IN_MEMORY_LINES) {
      memoryLines = memoryLines.slice(-MAX_IN_MEMORY_LINES);
    }
  });
};

const scheduleFlush = () => {
  setImmediate(drain);
};

const appendLine = (line) => {
  const text = String(line ?? '').slice(0, 4000);
  if (!text) return;
  memoryLines.push(text);
  if (memoryLines.length > MAX_IN_MEMORY_LINES * 2) {
    memoryLines = memoryLines.slice(-MAX_IN_MEMORY_LINES);
  }
  pending.push(text);
  if (pending.length >= 20) scheduleFlush();
};

const formatLine = (level, args) => {
  const rendered = args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');
  return `${new Date().toISOString()} [${level}] ${rendered}`;
};

// 渲染进程的 console 不会自己进主进程日志，导出副本时会漏掉全部 UI 侧报错
// （自解码降级、播放失败等都在渲染层），所以由 main.js 的 console-message 转发进来。
export const recordRendererMessage = (level, message, source) => {
  const text = String(message ?? '').trim();
  if (!text) return;
  const upper = String(level || 'info').toUpperCase();
  appendLine(formatLine(`RENDERER:${upper}`, [source ? `${text} @ ${source}` : text]));
};

export const initLogSink = () => {  logFilePath = path.join(app.getPath('userData'), 'main.log');
  try {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    rotateIfNeeded();
  } catch (error) {
    console.warn('[log] 日志目录不可用:', error?.message || error);
    logFilePath = '';
    return;
  }

  if (consoleHooked) return;
  consoleHooked = true;
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level]?.bind(console);
    console[level] = (...args) => {
      appendLine(formatLine(level.toUpperCase(), args));
      original?.(...args);
    };
  }
  process.on('uncaughtException', (error) => {
    appendLine(formatLine('FATAL', [error?.stack || error]));
    scheduleFlush();
  });
  process.on('exit', () => {
    // 退出时同步落盘：异步 append 在 app.quit 之后不会再有机会执行
    if (!logFilePath || !pending.length) return;
    try {
      fs.appendFileSync(logFilePath, `${pending.join('\n')}\n`);
      pending = [];
    } catch {
      /* 退出路径不做二次报错 */
    }
  });
};

export const flushLogs = () => {
  if (!logFilePath || !pending.length) return;
  try {
    fs.appendFileSync(logFilePath, `${pending.join('\n')}\n`);
    pending = [];
  } catch {
    /* 保留 pending，等下一次异步 flush */
  }
};

const exportFileName = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `Jello-Music-日志-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.log`;
};

const collectLogSource = () => {
  let fileContent = '';
  if (logFilePath) {
    flushLogs();
    try {
      fileContent = fs.readFileSync(logFilePath, 'utf-8');
    } catch {
      fileContent = '';
    }
  }
  if (fileContent) {
    // 文件是完整来源，内存环只补上还没落盘的最后几行
    const tail = memoryLines.slice(-60).join('\n');
    return tail && !fileContent.includes(tail) ? `${fileContent}\n${tail}` : fileContent;
  }
  return memoryLines.join('\n');
};

/**
 * 导出「脱敏副本」：先弹保存框（用户取消就什么都不写），再把 token/key/手机号/
 * 设备标识逐类替换后落盘。导出的是副本，原始 main.log 保持完整便于本地排查。
 */
export const exportLogsDialog = async (parentWindow = null) => {
  // downloads 在部分系统/沙箱下不可用，回落到 userData
  let baseDir = app.getPath('userData');
  try {
    baseDir = app.getPath('downloads') || baseDir;
  } catch {
    /* 用 userData 兜底 */
  }
  const options = {
    title: '导出日志',
    defaultPath: path.join(baseDir, exportFileName()),
    filters: [{ name: '日志文件', extensions: ['log', 'txt'] }]
  };
  const { canceled, filePath } = parentWindow
    ? await dialog.showSaveDialog(parentWindow, options)
    : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return { ok: false, canceled: true };

  const source = collectLogSource();
  if (!source.trim()) return { ok: false, error: '日志为空' };

  try {
    const header = `Jello Music 日志导出（已脱敏）\n导出时间：${new Date().toISOString()}\n应用版本：${app.getVersion()}\nElectron：${process.versions.electron || ''} / Node：${process.versions.node}\n平台：${process.platform} ${process.arch}\n\n`;
    await fs.promises.writeFile(filePath, `${header}${redactLogText(source)}\n`, 'utf-8');
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
};
