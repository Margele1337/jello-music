import test from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedSender } from '../electron/security/trustedSender.js';

const makeWindow = () => {
  const mainFrame = {};
  const webContents = { mainFrame };
  return {
    mainFrame,
    webContents,
    isDestroyed: () => false
  };
};

test('accepts the main frame of the registered window', () => {
  const window = makeWindow();
  assert.equal(
    isTrustedSender({ sender: window.webContents, senderFrame: window.mainFrame }, window),
    true
  );
});

test('rejects subframes, other senders, and destroyed windows', () => {
  const window = makeWindow();
  assert.equal(
    isTrustedSender({ sender: window.webContents, senderFrame: {} }, window),
    false
  );
  assert.equal(
    isTrustedSender({ sender: {}, senderFrame: window.mainFrame }, window),
    false
  );
  window.isDestroyed = () => true;
  assert.equal(
    isTrustedSender({ sender: window.webContents, senderFrame: window.mainFrame }, window),
    false
  );
});
