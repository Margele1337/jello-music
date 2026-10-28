import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_ARG,
  findDeepLinkArg,
  formatTrayTooltip,
  hasSettingsArg,
  parseDeepLink
} from '../shared/ipc.js';

test('detects the --settings launch argument', () => {
  assert.equal(hasSettingsArg(['C:\\app\\jello.exe', SETTINGS_ARG]), true);
  assert.equal(hasSettingsArg(['C:\\app\\jello.exe']), false);
  assert.equal(hasSettingsArg([]), false);
  assert.equal(hasSettingsArg(undefined), false);
});

test('picks the jello:// URL out of a mixed argv', () => {
  const argv = ['C:\\app\\jello.exe', 'D:\\repo', 'jello://share?hash=abc123'];
  assert.equal(findDeepLinkArg(argv), 'jello://share?hash=abc123');
  assert.equal(findDeepLinkArg(['C:\\app\\jello.exe', '--settings']), null);
  assert.equal(findDeepLinkArg(null), null);
});

test('parses legacy share links for songs and playlists', () => {
  const song = parseDeepLink('jello://share?hash=ABC123');
  assert.deepEqual(song, { hash: 'ABC123', listid: '', urlPath: '' });

  const playlist = parseDeepLink('jello://share/?listid=7788');
  assert.deepEqual(playlist, { hash: '', listid: '7788', urlPath: '' });

  const both = parseDeepLink('jello://play?hash=h1&listid=l1');
  assert.deepEqual(both, { hash: 'h1', listid: 'l1', urlPath: '' });

  // 路径式深链保留 urlPath（去掉前导斜杠）
  const withPath = parseDeepLink('jello://host/share?hash=h2');
  assert.deepEqual(withPath, { hash: 'h2', listid: '', urlPath: 'share' });
});

test('rejects malformed or unusable deep links', () => {
  assert.equal(parseDeepLink('jello://'), null);
  assert.equal(parseDeepLink('not a url'), null);
  assert.equal(parseDeepLink(''), null);
  assert.equal(parseDeepLink(undefined), null);
  assert.equal(parseDeepLink('https://example.com/?hash=x'), null);
  assert.equal(parseDeepLink('jello://share?other=1'), null);
});

test('formats the tray tooltip from playback state', () => {
  assert.equal(
    formatTrayTooltip({ playing: true, title: '晴天', artist: '周杰伦' }),
    '正在播放：晴天 - 周杰伦'
  );
  assert.equal(
    formatTrayTooltip({ playing: false, title: '晴天', artist: '周杰伦' }),
    '已暂停：晴天 - 周杰伦'
  );
  // 无歌手时不悬挂分隔符
  assert.equal(formatTrayTooltip({ playing: true, title: '晴天' }), '正在播放：晴天');
  // 无歌曲/空状态回退应用名
  assert.equal(formatTrayTooltip({ playing: true, title: '', artist: '' }), 'Jello Music');
  assert.equal(formatTrayTooltip(null), 'Jello Music');
  assert.equal(formatTrayTooltip(), 'Jello Music');
});
