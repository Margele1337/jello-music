import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_BASE_URL_MODES,
  PLAYBACK_RATES,
  SETTING_DEFAULTS,
  normalizeApiBaseUrl,
  normalizeProxyUrl,
  sanitizeSettings
} from '../shared/settings.js';

test('network settings ship with the contract defaults', () => {
  assert.equal(SETTING_DEFAULTS.proxyEnabled, false);
  assert.equal(SETTING_DEFAULTS.proxyUrl, '');
  assert.equal(SETTING_DEFAULTS.apiBaseUrlMode, 'default');
  assert.equal(SETTING_DEFAULTS.apiBaseUrl, '');
  assert.equal(SETTING_DEFAULTS.gpuAcceleration, true);
  assert.deepEqual([...PLAYBACK_RATES], [0.5, 0.75, 1, 1.25, 1.5, 2]);
  assert.deepEqual([...API_BASE_URL_MODES], ['default', 'custom']);
});

test('proxy url accepts http/https/socks forms and normalizes them', () => {
  assert.equal(normalizeProxyUrl('http://127.0.0.1:7890'), 'http://127.0.0.1:7890');
  assert.equal(normalizeProxyUrl('  http://127.0.0.1:7890/  '), 'http://127.0.0.1:7890');
  assert.equal(normalizeProxyUrl('127.0.0.1:7890'), 'http://127.0.0.1:7890');
  assert.equal(normalizeProxyUrl('socks5://10.0.0.1:1080'), 'socks5://10.0.0.1:1080');
  assert.equal(normalizeProxyUrl('socks://[::1]:1080'), 'socks5://[::1]:1080');
  assert.equal(normalizeProxyUrl('https://user:pass@proxy.example:8443'), 'https://user:pass@proxy.example:8443');
  assert.equal(normalizeProxyUrl(''), '');
});

test('proxy url rejects unsupported schemes and junk', () => {
  assert.equal(normalizeProxyUrl('ftp://127.0.0.1:21'), '');
  assert.equal(normalizeProxyUrl('file:///C:/proxy'), '');
  assert.equal(normalizeProxyUrl('javascript:alert(1)'), '');
  assert.equal(normalizeProxyUrl('not a url at all'), '');
  assert.equal(normalizeProxyUrl('socks5://127.0.0.1'), '');
  assert.equal(normalizeProxyUrl('http://'), '');
  assert.equal(normalizeProxyUrl(null), '');
  assert.equal(normalizeProxyUrl('x'.repeat(600)).length <= 512, true);
});

test('api base url only allows https or loopback http', () => {
  assert.equal(normalizeApiBaseUrl('https://rpc.example.com/'), 'https://rpc.example.com');
  assert.equal(normalizeApiBaseUrl('https://rpc.example.com:8443'), 'https://rpc.example.com:8443');
  assert.equal(normalizeApiBaseUrl('http://127.0.0.1:6521/'), 'http://127.0.0.1:6521');
  assert.equal(normalizeApiBaseUrl('http://localhost:6521'), 'http://localhost:6521');
  assert.equal(normalizeApiBaseUrl('http://[::1]:6521'), 'http://[::1]:6521');
});

test('api base url never lets plain http leave the machine', () => {
  assert.equal(normalizeApiBaseUrl('http://rpc.example.com'), '');
  assert.equal(normalizeApiBaseUrl('http://192.168.1.20:6521'), '');
  assert.equal(normalizeApiBaseUrl('http://10.0.0.9'), '');
  assert.equal(normalizeApiBaseUrl('http://user:pass@127.0.0.1:80'), '');
  assert.equal(normalizeApiBaseUrl('ftp://127.0.0.1:21'), '');
  assert.equal(normalizeApiBaseUrl('javascript:alert(1)'), '');
  assert.equal(normalizeApiBaseUrl('http://127.0.0.1.evil.com'), '');
});

test('sanitize normalizes the network settings and gpu switch', () => {
  const next = sanitizeSettings({
    proxyEnabled: true,
    proxyUrl: 'SOCKS5://127.0.0.1:1080'.toLowerCase(),
    apiBaseUrlMode: 'custom',
    apiBaseUrl: 'https://rpc.example.com/',
    gpuAcceleration: false
  });
  assert.deepEqual(next, {
    proxyEnabled: true,
    proxyUrl: 'socks5://127.0.0.1:1080',
    apiBaseUrlMode: 'custom',
    apiBaseUrl: 'https://rpc.example.com',
    gpuAcceleration: false
  });
});

test('sanitize falls back to safe values on bad input', () => {
  assert.deepEqual(sanitizeSettings({ proxyEnabled: 'yes' }), {});
  assert.deepEqual(sanitizeSettings({ gpuAcceleration: 'off' }), {});
  assert.deepEqual(sanitizeSettings({ apiBaseUrlMode: 'bogus' }), { apiBaseUrlMode: 'default' });
  assert.deepEqual(sanitizeSettings({ apiBaseUrl: 'http://evil.example' }), { apiBaseUrl: '' });
  assert.deepEqual(sanitizeSettings({ proxyUrl: 'ftp://x:1' }), { proxyUrl: '' });
  assert.deepEqual(sanitizeSettings({ playbackRate: 0.5 }), { playbackRate: 0.5 });
  assert.deepEqual(sanitizeSettings({ playbackRate: 0.6 }), {});
});
