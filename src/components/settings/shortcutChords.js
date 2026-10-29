// 设置页快捷键面板的纯逻辑：键盘事件 -> Electron accelerator、展示格式化、
// 冲突与注册失败文案。刻意与视图解耦（不依赖 Vue/DOM），node --test 可直接覆盖。
import { SHORTCUT_ACTIONS, normalizeAccelerator } from '../../../shared/settings.js';

// 12 个动作的中文标签：与主进程 ACTION_COMMANDS 的能力一一对应
export const SHORTCUT_ACTION_LABELS = Object.freeze({
  showHide: '显示 / 隐藏主窗口',
  quitApp: '退出应用',
  previous: '上一首',
  next: '下一首',
  playPause: '播放 / 暂停',
  volumeUp: '音量 +',
  volumeDown: '音量 -',
  mute: '静音',
  like: '喜欢当前歌曲',
  mode: '切换播放模式',
  desktopLyrics: '桌面歌词开关',
  desktopSpectrum: '桌面频谱开关'
});

export const shortcutActionLabel = (action) => (
  SHORTCUT_ACTION_LABELS[action] || String(action || '')
);

// 录键侧按 Electron 文档推荐顺序拼 token（Ctrl → Alt → Shift → Cmd/Win），
// 顺序不影响 normalizeAccelerator 的判定，只影响「按下 Ctrl+Shift」时的观感一致性
const MODIFIER_FLAGS = Object.freeze([
  ['ctrlKey', 'Ctrl'],
  ['altKey', 'Alt'],
  ['shiftKey', 'Shift'],
  ['metaKey', 'Meta']
]);

const MODIFIER_KEY_NAMES = new Set(['control', 'shift', 'alt', 'meta', 'os']);

// 浏览器 event.key -> shared/settings.js 认识的键名
const KEY_NAME_ALIASES = Object.freeze(new Map([
  [' ', 'Space'],
  ['spacebar', 'Space'],
  ['escape', 'Esc'],
  ['arrowup', 'Up'],
  ['arrowdown', 'Down'],
  ['arrowleft', 'Left'],
  ['arrowright', 'Right'],
  ['pageup', 'PageUp'],
  ['pagedown', 'PageDown'],
  ['volumeup', 'VolumeUp'],
  ['volumedown', 'VolumeDown'],
  ['volumemute', 'VolumeMute'],
  ['mediaplaypause', 'MediaPlayPause'],
  ['medianext', 'MediaNextTrack'],
  ['mediaprevious', 'MediaPreviousTrack'],
  ['mediastop', 'MediaStop']
]));

export const keyTokenFromEvent = (event) => {
  const raw = String(event?.key ?? '');
  if (!raw || raw.toLowerCase() === 'unidentified') return '';
  const lower = raw.toLowerCase();
  if (KEY_NAME_ALIASES.has(lower)) return KEY_NAME_ALIASES.get(lower);
  // 只按下修饰键时没有主键，返回空串让调用方继续等待下一个按键
  if (MODIFIER_KEY_NAMES.has(lower)) return '';
  return raw;
};

/**
 * 一次按键 -> 候选 accelerator。
 * 返回 { ignored, accelerator, error }：ignored 表示纯修饰键（继续录制），
 * error 是 CHORD_ERROR_MESSAGES 的键，由 UI 翻译成中文原因。
 * 合法性一律交给 normalizeAccelerator：不能在这层自己放行，否则主进程注册才会报错。
 */
export const chordFromKeyEvent = (event) => {
  const keyToken = keyTokenFromEvent(event);
  const modifiers = MODIFIER_FLAGS
    .filter(([flag]) => !!event?.[flag])
    .map(([, token]) => token);
  if (!keyToken) return { ignored: true, accelerator: '', error: '' };

  const accelerator = normalizeAccelerator([...modifiers, keyToken].join('+'));
  if (accelerator) return { ignored: false, accelerator, error: '' };
  if (!modifiers.length) return { ignored: false, accelerator: '', error: 'modifier-required' };
  return { ignored: false, accelerator: '', error: 'unsupported-key' };
};

export const CHORD_ERROR_MESSAGES = Object.freeze({
  'modifier-required': '单独的字母 / 数字不能作为全局热键（会劫持系统输入），请搭配 Ctrl / Alt / Shift / Win；F1-F24 与媒体键可单独使用',
  'unsupported-key': '该键不支持，请改用字母、数字、F1-F24、方向键或媒体 / 音量键'
});

export const chordErrorMessage = (code) => (
  CHORD_ERROR_MESSAGES[code] || '无法识别该组合键，请重新按下'
);

// action -> 冲突的 accelerator（Electron 只能注册一份，先拒掉让用户改）
export const findDuplicateAccelerators = (shortcuts) => {
  const owner = new Map();
  const duplicates = {};
  for (const action of SHORTCUT_ACTIONS) {
    const accelerator = normalizeAccelerator(shortcuts?.[action]);
    if (!accelerator) continue;
    const previous = owner.get(accelerator);
    if (previous) {
      duplicates[previous] = duplicates[previous] || accelerator;
      duplicates[action] = duplicates[action] || accelerator;
      continue;
    }
    owner.set(accelerator, action);
  }
  return duplicates;
};

const DISPLAY_KEYS = Object.freeze(new Map([
  ['up', '↑'],
  ['down', '↓'],
  ['left', '←'],
  ['right', '→'],
  ['space', '空格'],
  ['pageup', 'Page Up'],
  ['pagedown', 'Page Down'],
  ['mediaplaypause', '播放/暂停'],
  ['medianext', '下一首'],
  ['mediaprevious', '上一首'],
  ['mediastop', '停止'],
  ['volumeup', '音量 +'],
  ['volumedown', '音量 -'],
  ['volumemute', '静音']
]));

// 存储用 CommandOrControl（跨平台语义），展示要还原成用户看得懂的键名
export const formatAccelerator = (accelerator, platform = '') => {
  const canonical = normalizeAccelerator(accelerator);
  if (!canonical) return String(accelerator || '');
  const darwin = String(platform || '').toLowerCase() === 'darwin';
  const tokens = canonical.split('+').map((token) => {
    const lower = token.toLowerCase();
    if (lower === 'commandorcontrol') return darwin ? '⌘' : 'Ctrl';
    if (lower === 'super') return darwin ? '⌘' : 'Win';
    if (lower === 'alt') return darwin ? '⌥' : 'Alt';
    if (lower === 'shift') return darwin ? '⇧' : 'Shift';
    return DISPLAY_KEYS.get(lower) || token;
  });
  // macOS 惯例是符号并排无分隔符
  return tokens.join(darwin ? '' : '+');
};

export const shortcutFailureText = (failure) => {
  const reason = String(failure?.reason || '');
  if (reason === 'invalid') return '键位格式无效';
  if (reason === 'occupied') return '已被系统或其他程序占用';
  if (reason.startsWith('duplicate:')) {
    return `与「${shortcutActionLabel(reason.slice('duplicate:'.length))}」重复`;
  }
  return reason || '注册失败';
};

// action -> 失败详情，供列表逐行标注（其余动作照常生效，不能一笔抹掉）
export const failuresByAction = (failed) => {
  const map = {};
  for (const failure of Array.isArray(failed) ? failed : []) {
    const action = failure?.action;
    if (!action || map[action]) continue;
    map[action] = { accelerator: String(failure.accelerator || ''), text: shortcutFailureText(failure) };
  }
  return map;
};
