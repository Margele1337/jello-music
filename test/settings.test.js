import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTING_DEFAULTS, sanitizeSettings } from '../shared/settings.js';

test('setting defaults are frozen and complete', () => {
  assert.equal(Object.isFrozen(SETTING_DEFAULTS), true);
  assert.equal(SETTING_DEFAULTS.quality, '320');
  assert.equal(SETTING_DEFAULTS.dataSource, 'concept');
});

test('sanitize keeps known keys and drops unknown ones', () => {
  const next = sanitizeSettings({
    quality: 'flac',
    dataSource: 'official',
    unknown: 'drop',
    minimizeToTray: true
  });
  assert.deepEqual(next, {
    quality: 'flac',
    dataSource: 'official',
    minimizeToTray: true
  });
});

test('sanitize clamps volume and rejects wrong types', () => {
  assert.deepEqual(sanitizeSettings({ volume: 2 }), { volume: 1 });
  assert.deepEqual(sanitizeSettings({ volume: -1 }), { volume: 0 });
  assert.deepEqual(sanitizeSettings({ volume: 'loud' }), {});
  assert.deepEqual(sanitizeSettings({ minimizeToTray: 'yes' }), {});
  assert.deepEqual(sanitizeSettings({ desktopLyrics: 'yes' }), {});
  assert.deepEqual(sanitizeSettings({ desktopLyrics: true }), { desktopLyrics: true });
  assert.deepEqual(sanitizeSettings({ spectrum: 'yes' }), {});
  assert.deepEqual(sanitizeSettings({ spectrum: true }), { spectrum: true });
  assert.deepEqual(sanitizeSettings(null), {});
  assert.deepEqual(sanitizeSettings([]), {});
});

test('sanitize rejects unknown quality and data source values', () => {
  assert.deepEqual(sanitizeSettings({ quality: 'hires' }), {});
  assert.deepEqual(sanitizeSettings({ dataSource: 'other' }), {});
  assert.deepEqual(sanitizeSettings({ quality: 'flac', dataSource: 'official' }), {
    quality: 'flac',
    dataSource: 'official'
  });
});
