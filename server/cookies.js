export class CookieJar {
  constructor(initial = {}) {
    this.cookies = new Map();
    if (initial && typeof initial === 'object') {
      for (const [name, value] of Object.entries(initial)) {
        if (value !== undefined && value !== null) this.cookies.set(name, String(value));
      }
    }
  }

  get size() {
    return this.cookies.size;
  }

  get(name) {
    return this.cookies.get(name);
  }

  has(name) {
    return this.cookies.has(name);
  }

  set(name, value) {
    if (!name) return;
    if (value === undefined || value === null || value === '') {
      this.cookies.delete(name);
      return;
    }
    this.cookies.set(name, String(value));
  }

  delete(name) {
    this.cookies.delete(name);
  }

  merge(values = {}) {
    for (const [name, value] of Object.entries(values)) this.set(name, value);
  }

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  toJSON() {
    return Object.fromEntries(this.cookies.entries());
  }

  absorb(headers) {
    if (!headers) return;
    const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
    for (const raw of list) {
      if (!raw) continue;
      const parts = String(raw).split(';');
      const pair = parts.shift() || '';
      const equals = pair.indexOf('=');
      if (equals <= 0) continue;
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1).trim();
      if (!name) continue;

      let expired = false;
      for (const attr of parts) {
        const pivot = attr.indexOf('=');
        const key = (pivot >= 0 ? attr.slice(0, pivot) : attr).trim().toLowerCase();
        const val = pivot >= 0 ? attr.slice(pivot + 1).trim() : '';
        if (key === 'max-age') {
          const seconds = Number.parseInt(val, 10);
          if (Number.isFinite(seconds) && seconds <= 0) expired = true;
        }
        if (key === 'expires') {
          const stamp = Date.parse(val);
          if (Number.isFinite(stamp) && stamp <= Date.now()) expired = true;
        }
      }

      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

export function parseCookieString(input = '') {
  const jar = new CookieJar();
  for (const part of String(input).split(';')) {
    const pivot = part.indexOf('=');
    if (pivot <= 0) continue;
    const name = part.slice(0, pivot).trim();
    const value = part.slice(pivot + 1).trim();
    if (name) jar.set(name, value);
  }
  return jar;
}
