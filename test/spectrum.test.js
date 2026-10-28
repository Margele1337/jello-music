import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECTRUM_BAR_COUNT,
  SPECTRUM_MAX_LEVEL,
  sanitizeSpectrumPayload
} from '../shared/spectrum.js';

test('spectrum sanitizer clamps and pads the 114 FFT levels', () => {
  const payload = sanitizeSpectrumPayload({
    levels: [12.5, -5, 99999999, 'x', 4],
    reset: true,
    cover: 'cover.jpg',
    title: '晴天',
    author: '周杰伦',
    playing: true
  });

  assert.equal(payload.levels.length, SPECTRUM_BAR_COUNT);
  assert.equal(payload.levels[0], 12.5);
  assert.equal(payload.levels[1], 0);
  assert.equal(payload.levels[2], SPECTRUM_MAX_LEVEL);
  assert.equal(payload.levels[3], 0);
  assert.equal(payload.levels[4], 4);
  assert.equal(payload.reset, true);
  assert.equal(payload.cover, 'cover.jpg');
  assert.equal(payload.title, '晴天');
  assert.equal(payload.playing, true);
});

test('spectrum sanitizer drops optional metadata when absent', () => {
  const payload = sanitizeSpectrumPayload({ levels: [] });
  assert.deepEqual(payload.levels, new Array(SPECTRUM_BAR_COUNT).fill(0));
  assert.equal(payload.playing, false);
  assert.equal('cover' in payload, false);
  assert.equal('reset' in payload, false);
});

test('spectrum sanitizer tolerates malformed input', () => {
  assert.equal(sanitizeSpectrumPayload(null).levels.length, SPECTRUM_BAR_COUNT);
  assert.equal(sanitizeSpectrumPayload('nope').playing, false);
});
