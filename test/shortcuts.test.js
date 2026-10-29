import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  normalizeAccelerator,
  normalizeShortcuts,
  sanitizeSettings,
  shortcutsEqual
} from '../shared/settings.js';

test('accelerator normalizes aliases to the Electron canonical form', () => {
  assert.equal(normalizeAccelerator('Ctrl+Shift+S'), 'CommandOrControl+Shift+S');
  assert.equal(normalizeAccelerator('cmdorctrl+shift+s'), 'CommandOrControl+Shift+S');
  assert.equal(normalizeAccelerator('ctrl + shift + s'), 'CommandOrControl+Shift+S');
  assert.equal(normalizeAccelerator('Alt+Ctrl+Left'), 'Alt+CommandOrControl+Left');
  assert.equal(normalizeAccelerator('CommandOrControl+Q'), 'CommandOrControl+Q');
  assert.equal(normalizeAccelerator('f12'), 'F12');
  assert.equal(normalizeAccelerator('Alt+Space'), 'Alt+Space');
});

test('accelerator rejects shapes globalShortcut cannot register', () => {
  assert.equal(normalizeAccelerator(''), '');
  assert.equal(normalizeAccelerator('   '), '');
  assert.equal(normalizeAccelerator('Ctrl+Shift'), '');
  assert.equal(normalizeAccelerator('Ctrl+Shift+Alt+'), '');
  assert.equal(normalizeAccelerator('F25'), '');
  assert.equal(normalizeAccelerator('Ctrl+Shift+Alt+Option+Cmd+A'), '');
  assert.equal(normalizeAccelerator('Ctrl+A+B'), '');
  assert.equal(normalizeAccelerator('Hello World'), '');
  assert.equal(normalizeAccelerator('Ctrl+Shift+;'), '');
  assert.equal(normalizeAccelerator(null), '');
  assert.equal(normalizeAccelerator(123), '');
  assert.equal(normalizeAccelerator('x'.repeat(80)), '');
});

test('accelerator caps token count and rejects repeats', () => {
  assert.equal(normalizeAccelerator('Ctrl+Shift+Alt+Super+D'), 'CommandOrControl+Shift+Alt+Super+D');
  assert.equal(normalizeAccelerator('Ctrl+Shift+Alt+Super+Meta+D'), '');
  assert.equal(normalizeAccelerator('Ctrl+Ctrl+S'), '');
  assert.equal(normalizeAccelerator('Ctrl+S+S'), '');
  assert.equal(normalizeAccelerator('Ctrl++S'), 'CommandOrControl+S');
});

test('shortcut defaults cover exactly the twelve contract actions', () => {
  assert.deepEqual([...SHORTCUT_ACTIONS], [
    'showHide', 'quitApp', 'previous', 'next', 'playPause', 'volumeUp',
    'volumeDown', 'mute', 'like', 'mode', 'desktopLyrics', 'desktopSpectrum'
  ]);
  assert.equal(Object.keys(DEFAULT_SHORTCUTS).length, SHORTCUT_ACTIONS.length);
  for (const action of SHORTCUT_ACTIONS) {
    assert.equal(typeof DEFAULT_SHORTCUTS[action], 'string');
    assert.notEqual(normalizeAccelerator(DEFAULT_SHORTCUTS[action]), '');
  }
});

test('normalizeShortcuts backfills every missing or invalid action', () => {
  assert.deepEqual(normalizeShortcuts({}), { ...DEFAULT_SHORTCUTS });
  assert.deepEqual(normalizeShortcuts(null), { ...DEFAULT_SHORTCUTS });
  assert.deepEqual(normalizeShortcuts('nope'), { ...DEFAULT_SHORTCUTS });
  const mixed = normalizeShortcuts({ mute: 'Ctrl+K', playPause: 'not valid!', extra: 'Ctrl+J' });
  assert.equal(mixed.mute, 'CommandOrControl+K');
  assert.equal(mixed.playPause, DEFAULT_SHORTCUTS.playPause);
  assert.equal(Object.prototype.hasOwnProperty.call(mixed, 'extra'), false);
  assert.equal(Object.keys(mixed).length, SHORTCUT_ACTIONS.length);
});

test('sanitizeSettings canonicalizes the whole shortcut map', () => {
  const next = sanitizeSettings({ shortcuts: { quitApp: 'Ctrl+Q' } });
  assert.deepEqual(next.shortcuts, { ...DEFAULT_SHORTCUTS, quitApp: 'CommandOrControl+Q' });
});

test('shortcutsEqual compares content instead of object identity', () => {
  const left = normalizeShortcuts({ mute: 'Ctrl+K' });
  const right = normalizeShortcuts({ mute: 'CommandOrControl+K' });
  assert.equal(shortcutsEqual(left, right), true);
  assert.equal(shortcutsEqual(left, { ...left, mute: 'Ctrl+J' }), false);
  assert.equal(shortcutsEqual({}, DEFAULT_SHORTCUTS), true);
});
