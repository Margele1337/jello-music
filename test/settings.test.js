import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUALITY_VALUES,
  SETTING_DEFAULTS,
  nextLowerQuality,
  qualityLabel,
  sanitizeSettings
} from '../shared/settings.js';

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
  assert.deepEqual(sanitizeSettings({ spectrumPreset: 'retro' }), {});
  assert.deepEqual(sanitizeSettings({ quality: 'flac', dataSource: 'official' }), {
    quality: 'flac',
    dataSource: 'official'
  });
  assert.deepEqual(sanitizeSettings({ quality: 'high' }), { quality: 'high' });
  assert.deepEqual(sanitizeSettings({ spectrumPreset: 'original' }), { spectrumPreset: 'original' });
  assert.deepEqual(sanitizeSettings({ spectrumPreset: 'wide' }), { spectrumPreset: 'wide' });
  assert.equal(SETTING_DEFAULTS.spectrumPreset, 'original');
});

test('quality ladder covers all seven tiers from low to high', () => {
  assert.deepEqual([...QUALITY_VALUES], [
    '128', '320', 'flac', 'high', 'viper_atmos', 'viper_clear', 'viper_tape'
  ]);
  assert.equal(SETTING_DEFAULTS.quality, '320');
});

test('sanitize accepts the three viper tiers and rejects lookalikes', () => {
  for (const quality of ['viper_atmos', 'viper_clear', 'viper_tape']) {
    assert.deepEqual(sanitizeSettings({ quality }), { quality });
  }
  assert.deepEqual(sanitizeSettings({ quality: 'viper' }), {});
  assert.deepEqual(sanitizeSettings({ quality: 'VIPER_TAPE' }), {});
});

test('nextLowerQuality walks one step down the ladder', () => {
  assert.equal(nextLowerQuality('viper_tape'), 'viper_clear');
  assert.equal(nextLowerQuality('viper_atmos'), 'high');
  assert.equal(nextLowerQuality('320'), '128');
  assert.equal(nextLowerQuality('128'), '');
  assert.equal(nextLowerQuality(''), '');
});

test('qualityLabel maps tiers to Chinese labels', () => {
  assert.equal(qualityLabel('128'), '标准');
  assert.equal(qualityLabel('high'), 'Hi-Res');
  assert.equal(qualityLabel('viper_atmos'), '全景声');
  assert.equal(qualityLabel('viper_clear'), '超清');
  assert.equal(qualityLabel('viper_tape'), '母带');
  assert.equal(qualityLabel('bogus'), '');
});

test('sanitize validates new audio/system settings', () => {
  assert.deepEqual(sanitizeSettings({ playbackRate: 1.25 }), { playbackRate: 1.25 });
  assert.deepEqual(sanitizeSettings({ playbackRate: 1.1 }), {});
  assert.deepEqual(sanitizeSettings({ loudnessNormalization: true }), { loudnessNormalization: true });
  assert.deepEqual(sanitizeSettings({ loudnessNormalization: 'yes' }), {});
  assert.deepEqual(sanitizeSettings({ autoStart: true, preventAppSuspension: true }), {
    autoStart: true,
    preventAppSuspension: true
  });
  assert.deepEqual(sanitizeSettings({ audioOutputDevice: 'abc:123-def_4.5' }), {
    audioOutputDevice: 'abc:123-def_4.5'
  });
  assert.deepEqual(sanitizeSettings({ audioOutputDevice: 'bad id with spaces' }), {});
  assert.deepEqual(sanitizeSettings({ audioOutputDevice: 'x'.repeat(129) }), {});
  assert.deepEqual(sanitizeSettings({ desktopLyricsFont: 'Noto Sans SC' }), {
    desktopLyricsFont: 'Noto Sans SC'
  });
});
