import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScopeWindows } from '../electron/ipc/scope.js';

const windows = {
  main: () => 'main-window',
  lyrics: () => 'lyrics-window',
  spectrum: () => 'spectrum-window'
};

test('scope resolution maps main/hud/any to the declared window sets', () => {
  assert.deepEqual(resolveScopeWindows('main', windows), ['main-window']);
  assert.deepEqual(resolveScopeWindows('hud', windows), ['lyrics-window', 'spectrum-window']);
  assert.deepEqual(resolveScopeWindows('any', windows), ['main-window', 'lyrics-window', 'spectrum-window']);
});

test('scope resolution passes through missing windows for isTrustedSender to filter', () => {
  const partial = { main: () => null, lyrics: () => undefined, spectrum: () => 'spectrum-window' };
  assert.deepEqual(resolveScopeWindows('main', partial), [null]);
  assert.deepEqual(resolveScopeWindows('hud', partial), [undefined, 'spectrum-window']);
});

test('scope resolution rejects unknown scopes instead of silently widening trust', () => {
  assert.throws(() => resolveScopeWindows('everything', windows), /unknown ipc scope/);
  assert.throws(() => resolveScopeWindows(undefined, windows), /unknown ipc scope/);
});
