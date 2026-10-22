import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMobileToken,
  generateMobileCode,
  isAllowedHost,
  isLoopbackAddress,
  isMobileCode,
  isMobileReadOnlyRequest,
  isPrivateIpv4,
  isPrivateIpv6,
  listLanAddresses,
  mobileCodesMatch,
  normalizeMobileCode,
  readCookie,
  verifyMobileToken,
} from '../server/mobile.js';

test('generates grouped, unambiguous access codes', () => {
  assert.equal(generateMobileCode(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])), 'ABCD-EFGH');
  assert.equal(generateMobileCode(Buffer.alloc(32)), 'AAAA-AAAA');
  const code = generateMobileCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(isMobileCode(code), true);
});

test('normalizes and compares access codes safely', () => {
  assert.equal(normalizeMobileCode(' rhtq-mjlu '), 'RHTQMJLU');
  assert.equal(mobileCodesMatch('rhtq mjlu', 'RHTQ-MJLU'), true);
  assert.equal(mobileCodesMatch('RHTQ-MJLV', 'RHTQ-MJLU'), false);
  assert.equal(mobileCodesMatch('RHTQ-MJLU', 'RHTQ-MJLU'), true);
  assert.equal(mobileCodesMatch('ABCD-EFGI', 'ABCD-EFGI'), false);
  assert.equal(mobileCodesMatch('', 'ABCD-EFGH'), false);
});

test('signs, verifies, expires and rejects mobile sessions', () => {
  const { token, expiresAt } = createMobileToken('secret', { now: 1000, ttlMs: 60_000 });
  assert.equal(expiresAt, 61_000);
  assert.equal(verifyMobileToken('secret', token, 60_999), true);
  assert.equal(verifyMobileToken('secret', token, 61_000), false);
  assert.equal(verifyMobileToken('other-secret', token, 60_999), false);
  assert.equal(verifyMobileToken('secret', `${token}x`, 60_999), false);
  assert.equal(verifyMobileToken('secret', '', 60_999), false);
});

test('keeps paired phones on read-only routes', () => {
  assert.equal(isMobileReadOnlyRequest('GET', '/api/status'), true);
  assert.equal(isMobileReadOnlyRequest('GET', '/api/feed'), true);
  assert.equal(isMobileReadOnlyRequest('GET', '/api/bili/favorites'), true);
  assert.equal(isMobileReadOnlyRequest('POST', '/api/items/abc/state'), true);
  assert.equal(isMobileReadOnlyRequest('POST', '/api/items/read-all'), true);
  assert.equal(isMobileReadOnlyRequest('POST', '/api/sync'), false);
  assert.equal(isMobileReadOnlyRequest('GET', '/api/zhihu/bridge'), false);
  assert.equal(isMobileReadOnlyRequest('POST', '/api/mobile/access'), false);
  assert.equal(isMobileReadOnlyRequest('DELETE', '/api/bili/session'), false);
});

test('reads the mobile cookie from a cookie header', () => {
  assert.equal(readCookie('a=1; sift_mobile=abc.def; b=2'), 'abc.def');
  assert.equal(readCookie('sift_mobile=abc.def'), 'abc.def');
  assert.equal(readCookie('sift_mobile=; a=1'), '');
  assert.equal(readCookie(''), '');
});

test('recognizes loopback and private addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.7'), false);
  assert.equal(isPrivateIpv4('192.168.1.7'), true);
  assert.equal(isPrivateIpv4('10.0.0.2'), true);
  assert.equal(isPrivateIpv4('172.20.1.2'), true);
  assert.equal(isPrivateIpv4('172.32.1.2'), false);
  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(isPrivateIpv6('::1'), true);
  assert.equal(isPrivateIpv6('fe80::1'), true);
  assert.equal(isPrivateIpv6('fd00::1'), true);
  assert.equal(isPrivateIpv6('2001:db8::1'), false);
});

test('only accepts local, private or explicitly trusted hosts', () => {
  assert.equal(isAllowedHost('localhost:8787'), true);
  assert.equal(isAllowedHost('127.0.0.1:8787'), true);
  assert.equal(isAllowedHost('[::1]:8787'), true);
  assert.equal(isAllowedHost('192.168.1.7:8787'), true);
  assert.equal(isAllowedHost('10.204.12.49:8787'), true);
  assert.equal(isAllowedHost('[fe80::1]:8787'), true);
  assert.equal(isAllowedHost('evil.example.com:8787'), false);
  assert.equal(isAllowedHost('8.8.8.8:8787'), false);
  assert.equal(isAllowedHost('192.168.1.7.evil.example:8787'), false);
  assert.equal(isAllowedHost(''), false);
  assert.equal(isAllowedHost('my-pc.local:8787', ['my-pc.local']), true);
});

test('lists only private IPv4 LAN addresses without duplicates', () => {
  const entries = listLanAddresses();
  assert.ok(Array.isArray(entries));
  const addresses = entries.map((entry) => entry.address);
  assert.equal(new Set(addresses).size, addresses.length);
  for (const address of addresses) {
    assert.equal(isPrivateIpv4(address), true);
    assert.equal(address.startsWith('127.'), false);
  }
});
