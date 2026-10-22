import crypto from 'node:crypto';
import net from 'node:net';
import os from 'node:os';

export const MOBILE_COOKIE = 'sift_mobile';
export const MOBILE_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const MOBILE_READ_PATHS = new Set([
  '/api/status',
  '/api/feed',
  '/api/creators',
  '/api/sync',
  '/api/img',
  '/api/bili/favorites',
  '/api/bili/watchlater',
]);

export function isMobileReadOnlyRequest(method, pathname) {
  const verb = String(method || '').toUpperCase();
  const route = String(pathname || '');
  if (verb === 'GET' && MOBILE_READ_PATHS.has(route)) return true;
  if (verb === 'POST' && route === '/api/items/read-all') return true;
  return verb === 'POST' && /^\/api\/items\/[^/]+\/state$/.test(route);
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const CODE_GROUP = 4;

export function generateMobileCode(bytes = crypto.randomBytes(32)) {
  let raw = '';
  for (const byte of bytes) {
    raw += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    if (raw.length === CODE_LENGTH) break;
  }
  return `${raw.slice(0, CODE_GROUP)}-${raw.slice(CODE_GROUP)}`;
}

export function normalizeMobileCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isMobileCode(value) {
  const code = normalizeMobileCode(value);
  if (code.length !== CODE_LENGTH) return false;
  for (const char of code) {
    if (!CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

export function mobileCodesMatch(input, expected) {
  const given = normalizeMobileCode(input);
  const target = normalizeMobileCode(expected);
  if (!isMobileCode(given) || !isMobileCode(target)) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(target));
}

export function createMobileToken(secret, { now = Date.now(), ttlMs = MOBILE_SESSION_MS } = {}) {
  const expiresAt = now + ttlMs;
  const payload = Math.floor(expiresAt / 1000).toString(36);
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt };
}

export function verifyMobileToken(secret, token, now = Date.now()) {
  const value = String(token || '');
  const dot = value.indexOf('.');
  if (dot <= 0) return false;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!payload || !signature) return false;
  const expiresAt = Number.parseInt(payload, 36);
  if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= now) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const givenBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (givenBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(givenBuffer, expectedBuffer);
}

export function readCookie(header, name = MOBILE_COOKIE) {
  const text = String(header || '');
  if (!text) return '';
  for (const part of text.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return part.slice(index + 1).trim();
  }
  return '';
}

export function isLoopbackAddress(address) {
  let value = String(address || '').toLowerCase();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  if (value === '::1') return true;
  if (net.isIP(value) === 4) return value.startsWith('127.');
  return false;
}

export function isPrivateIpv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function isPrivateIpv6(address) {
  if (net.isIP(address) !== 6) return false;
  let value = address.toLowerCase().split('%')[0];
  if (value === '::1') return true;
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    if (net.isIP(mapped) === 4) return isPrivateIpv4(mapped);
  }
  return value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd');
}

export function hostnameFromHeader(value) {
  const host = String(value || '').trim().toLowerCase();
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 1 ? host.slice(1, end) : '';
  }
  const first = host.indexOf(':');
  const last = host.lastIndexOf(':');
  if (first !== -1 && first === last) return host.slice(0, first);
  return host;
}

export function isAllowedHost(header, extraHosts = []) {
  const host = hostnameFromHeader(header);
  if (!host) return false;
  if (host === 'localhost') return true;
  if (Array.from(extraHosts || []).map((item) => String(item || '').toLowerCase()).includes(host)) return true;
  if (isPrivateIpv4(host)) return true;
  if (isPrivateIpv6(host)) return true;
  return false;
}

export function listLanAddresses() {
  const entries = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const info of addresses || []) {
      if (info.internal || info.family !== 'IPv4') continue;
      if (!isPrivateIpv4(info.address) || info.address.startsWith('127.')) continue;
      entries.push({ name, address: info.address });
    }
  }

  const score = (entry) => {
    let value = 0;
    if (/wlan|wi-?fi|wireless|无线/i.test(entry.name)) value += 100;
    else if (/ethernet|以太网/i.test(entry.name)) value += 90;
    if (entry.address.startsWith('192.168.')) value += 20;
    else if (entry.address.startsWith('10.')) value += 15;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)) value += 10;
    if (/vethernet|vmware|virtualbox|hyper-v|docker|wsl|tap|tun|zerotier|tailscale/i.test(entry.name)) value -= 80;
    return value;
  };

  entries.sort((a, b) => score(b) - score(a) || a.address.localeCompare(b.address));
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.address)) return false;
    seen.add(entry.address);
    return true;
  });
}
