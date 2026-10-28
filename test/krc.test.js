import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKrc } from '../src/services/lyrics/krc.js';

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

test('parseKrc extracts per-character timings and line text', () => {
  const krc = [
    '[1000,800]<0,400,0>你<400,400,0>好',
    '[2000,600]<0,600,0>world'
  ].join('\n');

  const lines = parseKrc(krc);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, '你好');
  assert.deepEqual(lines[0].characters, [
    { c: '你', s: 1000, e: 1400 },
    { c: '好', s: 1400, e: 1800 }
  ]);
  assert.equal(lines[1].text, 'world');
  assert.deepEqual(lines[1].characters[0], { c: 'world', s: 2000, e: 2600 });
});

test('parseKrc splits plain lines evenly when no char tags exist', () => {
  const lines = parseKrc('[500,1000]ab');
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].characters, [
    { c: 'a', s: 500, e: 1000 },
    { c: 'b', s: 1000, e: 1500 }
  ]);
});

test('parseKrc decodes translation and romanization from language block', () => {
  const language = b64({
    content: [
      { type: 1, lyricContent: [['你好'], ['再见']] },
      { type: 0, lyricContent: [['ni hao']] }
    ]
  });
  const krc = [
    `[language:${language}]`,
    '[1000,800]<0,800,0>你好',
    '[2000,800]<0,800,0>再见'
  ].join('\n');

  const lines = parseKrc(krc);
  assert.equal(lines[0].translated, '你好');
  assert.equal(lines[0].romanized, 'ni hao');
  assert.equal(lines[1].translated, '再见');
});

test('parseKrc ignores metadata and malformed language blocks', () => {
  const lines = parseKrc([
    '[language:!!!not-base64!!!]',
    '[ti:song]',
    '[3000,400]<0,400,0>ok'
  ].join('\n'));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].translated, undefined);
  assert.equal(lines[0].text, 'ok');
});

test('parseKrc returns empty for empty input', () => {
  assert.deepEqual(parseKrc(''), []);
  assert.deepEqual(parseKrc(null), []);
});
