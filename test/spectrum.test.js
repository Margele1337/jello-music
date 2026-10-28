import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECTRUM_BANDS,
  SPECTRUM_MAX,
  sanitizeSpectrumBands
} from '../shared/spectrum.js';
import { computeBands } from '../src/services/audio/spectrum.js';

test('spectrum sanitizer clamps, rounds, and pads bands', () => {
  const bands = sanitizeSpectrumBands([12.6, -5, 999, 'x', 4], 8);
  assert.equal(bands.length, 8);
  assert.deepEqual(bands, [13, 0, 255, 0, 4, 0, 0, 0]);
  assert.equal(SPECTRUM_MAX, 255);
});

test('spectrum sanitizer returns a zero array for malformed input', () => {
  assert.deepEqual(sanitizeSpectrumBands(null), new Array(SPECTRUM_BANDS).fill(0));
  assert.deepEqual(sanitizeSpectrumBands('nope', 3), [0, 0, 0]);
});

test('computeBands produces bounded log-spaced bands', () => {
  const silent = computeBands(new Uint8Array(1024), 48000, 48);
  assert.equal(silent.length, 48);
  assert.ok(silent.every((value) => value === 0));

  const loud = new Uint8Array(1024).fill(255);
  const bands = computeBands(loud, 48000, 48);
  assert.equal(bands.length, 48);
  assert.ok(bands.every((value) => value === SPECTRUM_MAX));

  const low = new Uint8Array(1024);
  low[1] = 200;
  const lowBands = computeBands(low, 48000, 48);
  assert.ok(lowBands[0] > lowBands[47]);
});
