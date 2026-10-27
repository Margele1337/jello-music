const ALLOWED_PREFIXES = [
  '/login',
  '/captcha',
  '/register',
  '/user',
  '/song',
  '/search',
  '/playlist',
  '/everyday',
  '/privilege',
  '/top',
  '/lyric',
  '/rank',
  '/singer',
  '/album',
  '/fm',
  '/youth'
];

const ALLOWED_METHODS = new Set(['GET', 'POST']);

const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

export const sanitizeApiRequest = (input) => {
  if (!isPlainObject(input)) throw new Error('invalid api request');

  const method = String(input.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error('unsupported api method');

  const path = String(input.path || '');
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('invalid api path');
  if (path.includes('..') || /^[a-z]+:/i.test(path)) throw new Error('invalid api path');
  if (!ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    throw new Error('api path is not allowed');
  }

  const params = isPlainObject(input.params) ? input.params : {};
  const data = isPlainObject(input.data) ? input.data : undefined;
  return { method, path, params, data };
};

const stripAuthFields = (value) => {
  if (Array.isArray(value)) return value.map(stripAuthFields);
  if (!isPlainObject(value)) return value;

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (['token', 'vip_token', 't1', 't', 'cookie', 'secu_params', 'access_token', 'refresh_token'].includes(key)) continue;
    next[key] = stripAuthFields(item);
  }
  return next;
};

export const sanitizeApiResponse = (path, body) => {
  const sensitive = path.startsWith('/login/')
    || path.startsWith('/user/')
    || path.startsWith('/register/')
    || path.startsWith('/youth/');
  if (!sensitive) return body;
  return stripAuthFields(body);
};
