import test from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar, parseCookieString } from '../server/cookies.js';

test('parses cookie strings and ignores malformed fragments', () => {
  const jar = parseCookieString('z_c0=abc; _xsrf=xyz; broken; empty=');
  assert.equal(jar.get('z_c0'), 'abc');
  assert.equal(jar.get('_xsrf'), 'xyz');
  assert.equal(jar.has('empty'), false);
  assert.equal(jar.size, 2);
  assert.equal(jar.header(), 'z_c0=abc; _xsrf=xyz');
});

test('absorbs Set-Cookie headers and drops expired values', () => {
  const jar = new CookieJar({ remove: 'old' });
  const headers = new Headers();
  headers.append('set-cookie', 'kept=1; Path=/; HttpOnly');
  headers.append('set-cookie', 'gone=2; Max-Age=0');
  headers.append('set-cookie', 'remove=3; Expires=Thu, 01 Jan 1970 00:00:00 GMT');

  jar.absorb(headers);
  assert.equal(jar.get('kept'), '1');
  assert.equal(jar.has('gone'), false);
  assert.equal(jar.has('remove'), false);
});

test('merges and serializes cookie jars', () => {
  const jar = new CookieJar({ a: '1' });
  jar.merge({ b: '2', a: '3' });
  jar.delete('b');
  assert.deepEqual(jar.toJSON(), { a: '3' });
});
