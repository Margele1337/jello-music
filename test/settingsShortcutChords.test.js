import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS } from '../shared/settings.js';
import {
  chordErrorMessage,
  chordFromKeyEvent,
  failuresByAction,
  findDuplicateAccelerators,
  formatAccelerator,
  keyTokenFromEvent,
  shortcutActionLabel,
  shortcutFailureText
} from '../src/components/settings/shortcutChords.js';

test('every contract action has a chinese label and no label falls back to the raw id', () => {
  assert.equal(SHORTCUT_ACTIONS.length, 12);
  for (const action of SHORTCUT_ACTIONS) {
    const label = shortcutActionLabel(action);
    assert.notEqual(label, '');
    assert.notEqual(label, action, `${action} 缺少中文标签`);
    assert.match(label, /[\u4e00-\u9fa5]/, `${action} 标签应为中文`);
  }
  assert.equal(shortcutActionLabel('unknownAction'), 'unknownAction');
});

test('chord recording normalizes modifiers into the electron canonical form', () => {
  assert.equal(chordFromKeyEvent({ key: 's', ctrlKey: true, shiftKey: true }).accelerator, 'CommandOrControl+Shift+S');
  assert.equal(chordFromKeyEvent({ key: 'q', ctrlKey: true }).accelerator, 'CommandOrControl+Q');
  assert.equal(chordFromKeyEvent({ key: 'Left', altKey: true, ctrlKey: true }).accelerator, 'CommandOrControl+Alt+Left');
  assert.equal(chordFromKeyEvent({ key: ' ', ctrlKey: true }).accelerator, 'CommandOrControl+Space');
  assert.equal(chordFromKeyEvent({ key: 'd', metaKey: true }).accelerator, 'Super+D');
});

test('function, media and volume keys may be recorded without modifiers', () => {
  assert.equal(chordFromKeyEvent({ key: 'F13' }).accelerator, 'F13');
  assert.equal(chordFromKeyEvent({ key: 'Escape' }).accelerator, 'Esc');
  assert.equal(chordFromKeyEvent({ key: 'VolumeUp' }).accelerator, 'VolumeUp');
  assert.equal(chordFromKeyEvent({ key: 'AudioVolumeMute', altKey: true }).accelerator, '');
});

test('bare letters and digits are refused with the modifier hint', () => {
  const bare = chordFromKeyEvent({ key: 'a' });
  assert.equal(bare.accelerator, '');
  assert.equal(bare.error, 'modifier-required');
  assert.equal(chordFromKeyEvent({ key: '7' }).error, 'modifier-required');
  assert.match(chordErrorMessage('modifier-required'), /Ctrl/);
});

test('keys the sanitizer cannot express are refused as unsupported', () => {
  const symbol = chordFromKeyEvent({ key: ';', ctrlKey: true });
  assert.equal(symbol.accelerator, '');
  assert.equal(symbol.error, 'unsupported-key');
  assert.equal(chordFromKeyEvent({ key: '+', ctrlKey: true }).error, 'unsupported-key');
  assert.equal(chordFromKeyEvent({ key: 'Dead', altKey: true }).error, 'unsupported-key');
  assert.match(chordErrorMessage('unsupported-key'), /不支持/);
  assert.equal(chordErrorMessage('mystery'), '无法识别该组合键，请重新按下');
});

test('pure modifier presses keep the recorder waiting instead of saving', () => {
  for (const key of ['Control', 'Shift', 'Alt', 'Meta', 'OS']) {
    const result = chordFromKeyEvent({ key, ctrlKey: key === 'Control' });
    assert.equal(result.ignored, true, `${key} 应视为纯修饰键`);
    assert.equal(result.accelerator, '');
    assert.equal(keyTokenFromEvent({ key }), '');
  }
  assert.equal(keyTokenFromEvent({ key: 'Unidentified' }), '');
  assert.equal(keyTokenFromEvent({ key: 'ArrowDown' }), 'Down');
});

test('accelerator display is platform aware and keeps unknown text visible', () => {
  assert.equal(formatAccelerator('CommandOrControl+Shift+S'), 'Ctrl+Shift+S');
  assert.equal(formatAccelerator('Alt+CommandOrControl+Left'), 'Alt+Ctrl+←');
  assert.equal(formatAccelerator('CommandOrControl+Space'), 'Ctrl+空格');
  assert.equal(formatAccelerator('CommandOrControl+Shift+S', 'darwin'), '⌘⇧S');
  assert.equal(formatAccelerator('Alt+CommandOrControl+Right', 'win32'), 'Alt+Ctrl+→');
  assert.equal(formatAccelerator(''), '');
  assert.equal(formatAccelerator('not a chord'), 'not a chord');
});

test('duplicate accelerators are flagged on every action that shares them', () => {
  const next = { ...DEFAULT_SHORTCUTS, next: DEFAULT_SHORTCUTS.previous };
  const duplicates = findDuplicateAccelerators(next);
  assert.equal(duplicates.previous, DEFAULT_SHORTCUTS.previous);
  assert.equal(duplicates.next, DEFAULT_SHORTCUTS.previous);
  assert.equal(Object.keys(duplicates).length, 2);
  assert.deepEqual(findDuplicateAccelerators(DEFAULT_SHORTCUTS), {});
  // 不同写法归一化后相同也算冲突
  assert.ok(findDuplicateAccelerators({ ...DEFAULT_SHORTCUTS, quitApp: 'Ctrl+Shift+S' }).showHide);
});

test('registration failures map to readable chinese reasons', () => {
  assert.equal(shortcutFailureText({ reason: 'invalid' }), '键位格式无效');
  assert.equal(shortcutFailureText({ reason: 'occupied' }), '已被系统或其他程序占用');
  assert.equal(shortcutFailureText({ reason: 'duplicate:playPause' }), '与「播放 / 暂停」重复');
  assert.equal(shortcutFailureText({ reason: 'Cannot register' }), 'Cannot register');
  assert.equal(shortcutFailureText({}), '注册失败');
});

test('failures are indexed per action so the other eleven stay untouched', () => {
  const map = failuresByAction([
    { action: 'mute', accelerator: 'Alt+CommandOrControl+M', reason: 'occupied' },
    { action: 'mute', accelerator: 'Alt+CommandOrControl+M', reason: 'invalid' },
    { action: 'like', accelerator: 'Alt+CommandOrControl+L', reason: 'duplicate:mute' }
  ]);
  assert.deepEqual(Object.keys(map).sort(), ['like', 'mute']);
  assert.equal(map.mute.text, '已被系统或其他程序占用');
  assert.equal(map.like.text, '与「静音」重复');
  assert.deepEqual(failuresByAction(undefined), {});
  assert.deepEqual(failuresByAction([{ reason: 'occupied' }]), {});
});
