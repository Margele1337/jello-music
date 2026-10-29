import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import {
  GUEST_MODE_KEY,
  buildPasswordLoginData,
  buildPhoneLoginData,
  clearGuestChoice,
  computeTrialBadge,
  extractAccountInfoList,
  isAccountSelectionPayload,
  readGuestChoice,
  shouldPromptLoginOnLaunch,
  writeGuestChoice
} from '../src/services/api/auth.js';
import { sanitizeApiResponse } from '../shared/apiPolicy.js';
import { useAuthStore } from '../src/stores/auth.js';

const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
};

test('builds password login POST body from username + password', () => {
  assert.deepEqual(
    buildPasswordLoginData('  user@example.com ', ' hunter2 '),
    { username: 'user@example.com', password: ' hunter2 ' }
  );
  assert.deepEqual(buildPasswordLoginData(null, undefined), { username: '', password: '' });
});

test('phone login body only carries userid once an account is chosen', () => {
  assert.deepEqual(buildPhoneLoginData({ mobile: ' 13800138000 ', code: ' 1234 ' }), {
    mobile: '13800138000',
    code: '1234'
  });
  assert.deepEqual(buildPhoneLoginData({ mobile: '13800138000', code: '1234', userid: null }), {
    mobile: '13800138000',
    code: '1234'
  });
  assert.deepEqual(
    buildPhoneLoginData({ mobile: '13800138000', code: '1234', userid: 42 }),
    { mobile: '13800138000', code: '1234', userid: 42 }
  );
});

test('extracts multi-account info_list from several payload shapes', () => {
  const accounts = [
    { userid: 1, nickname: 'a' },
    { userid: 2, nickname: 'b' }
  ];
  assert.deepEqual(extractAccountInfoList({ info_list: accounts }), accounts);
  assert.deepEqual(extractAccountInfoList({ data: { info_list: accounts } }), accounts);
  assert.deepEqual(extractAccountInfoList({ data: { data: { info_list: accounts } } }), accounts);
  // axios-like thrown error container
  assert.deepEqual(extractAccountInfoList({ response: { data: { data: { info_list: accounts } } } }), accounts);
  // drop entries without a userid (needed to re-submit)
  assert.deepEqual(extractAccountInfoList({ info_list: [{ nickname: 'x' }, accounts[0]] }), [accounts[0]]);
  assert.deepEqual(extractAccountInfoList(undefined), []);
  assert.deepEqual(extractAccountInfoList({ status: 1, data: { userid: 9 } }), []);
});

test('only treats >1 accounts as a selection prompt', () => {
  assert.equal(isAccountSelectionPayload({ data: { info_list: [{ userid: 1 }, { userid: 2 }] } }), true);
  assert.equal(isAccountSelectionPayload({ data: { info_list: [{ userid: 1 }] } }), false);
  assert.equal(isAccountSelectionPayload({ data: { userid: 1 } }), false);
});

test('guest choice transitions through the injected storage', () => {
  const store = fakeStorage();
  assert.equal(readGuestChoice(store), false);
  writeGuestChoice(store);
  assert.equal(readGuestChoice(store), true);
  assert.equal(store.getItem(GUEST_MODE_KEY), '1');
  clearGuestChoice(store);
  assert.equal(readGuestChoice(store), false);
});

test('launch only prompts login when unauthenticated and no guest memory', () => {
  assert.equal(shouldPromptLoginOnLaunch({ authenticated: false, guestRemembered: false }), true);
  assert.equal(shouldPromptLoginOnLaunch({ authenticated: false, guestRemembered: true }), false);
  assert.equal(shouldPromptLoginOnLaunch({ authenticated: true, guestRemembered: false }), false);
});

test('trial badge is visible only for trial clips and nudges login when unauthenticated', () => {
  assert.deepEqual(computeTrialBadge({ trial: false, authenticated: false }), {
    visible: false, label: '试听片段', nudgesLogin: false, color: '#b9b1c6'
  });
  const authed = computeTrialBadge({ trial: true, authenticated: true });
  assert.equal(authed.visible, true);
  assert.equal(authed.nudgesLogin, false);
  assert.equal(authed.color, '#b9b1c6');
  const guest = computeTrialBadge({ trial: true, authenticated: false });
  assert.equal(guest.nudgesLogin, true);
  assert.equal(guest.color, '#ff69b4');
});

test('auth store remembers guest mode and clears it on successful login', () => {
  const storage = fakeStorage();
  const previous = globalThis.localStorage;
  globalThis.localStorage = storage;
  try {
    setActivePinia(createPinia());
    const auth = useAuthStore();

    assert.equal(auth.guestRemembered, false);
    assert.equal(auth.isGuest, false);

    auth.rememberGuest();
    assert.equal(auth.guestRemembered, true);
    assert.equal(auth.isGuest, true);
    assert.equal(storage.getItem(GUEST_MODE_KEY), '1');

    // a successful login must clear the remembered skip
    auth.setProfile({ userid: 7, nickname: 'demo' });
    assert.equal(auth.guestRemembered, false);
    assert.equal(auth.isGuest, false);
    assert.equal(storage.getItem(GUEST_MODE_KEY), null);

    // and the cleared choice persists to storage
    auth.rememberGuest();
    auth.clearGuestRemember();
    assert.equal(storage.getItem(GUEST_MODE_KEY), null);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('password login response strips tokens for the exact /login path', () => {
  const body = { status: 1, data: { userid: 5, nickname: 'demo', token: 'secret', t1: 'x' } };
  assert.deepEqual(sanitizeApiResponse('/login', body), {
    status: 1,
    data: { userid: 5, nickname: 'demo' }
  });
  // /login/* still stripped; a non-sensitive path untouched
  assert.deepEqual(sanitizeApiResponse('/login/cellphone', body).data.nickname, 'demo');
  assert.equal(sanitizeApiResponse('/playlist/track/all', body), body);
});
