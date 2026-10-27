import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLrc } from '../src/services/lyrics/lrc.js';

test('parses timestamps, multiple tags, metadata and offset', () => {
  const text = [
    '[ti:晴天]',
    '[offset:+500]',
    '[00:01.00][00:03.50]第一句',
    '[00:02:25]第二句',
    '[00:04.000]',
    '[00:05.00]第三句'
  ].join('\n');

  assert.deepEqual(parseLrc(text), [
    { time: 1.5, text: '第一句' },
    { time: 2.75, text: '第二句' },
    { time: 4, text: '第一句' },
    { time: 5.5, text: '第三句' }
  ]);
});

test('returns an empty list for missing or untimed content', () => {
  assert.deepEqual(parseLrc(''), []);
  assert.deepEqual(parseLrc('no timestamps here'), []);
});
