const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  copy: '©',
  reg: '®',
};

export function decodeEntities(input = '') {
  return String(input).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[key] ?? match;
  });
}

export function normalizeWhitespace(input = '') {
  return String(input)
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripHtml(input = '') {
  if (!input) return '';
  let text = String(input);
  text = text.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|section|article|h[1-6]|li|blockquote)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  return normalizeWhitespace(decodeEntities(text));
}

export function truncate(input = '', max = 240) {
  const text = normalizeWhitespace(String(input)).replace(/\s+/g, ' ');
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function firstLine(input = '', max = 64) {
  const text = normalizeWhitespace(String(input));
  if (!text) return '';
  const line = text.split(/\n/).find((part) => part.trim()) || text;
  return truncate(line, max);
}

export function parseCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value) return 0;
  const text = String(value).replace(/,/g, '').trim();
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(亿|万)?/);
  if (!match) return 0;
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base)) return 0;
  if (match[2] === '亿') return Math.round(base * 100000000);
  if (match[2] === '万') return Math.round(base * 10000);
  return Math.round(base);
}

export function safeHttpUrl(input) {
  if (!input) return null;
  let text = String(input).trim();
  if (!text) return null;
  if (text.startsWith('//')) text = `https:${text}`;
  text = text.replace(/^http:\/\//i, 'https://');
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeBiliUrl(input) {
  const url = safeHttpUrl(input);
  if (!url) return null;
  const host = new URL(url).hostname;
  if (!(host === 'bilibili.com' || host.endsWith('.bilibili.com'))) return null;
  return url;
}

export function normalizeZhihuUrl(input) {
  const url = safeHttpUrl(input);
  if (!url) return null;
  const host = new URL(url).hostname;
  if (!(host === 'zhihu.com' || host.endsWith('.zhihu.com'))) return null;
  return url;
}

export function normalizeImageUrl(input) {
  if (!input) return null;
  const text = String(input).replace(/\{size\}/g, 'xl').replace(/\{width\}/g, '720');
  return safeHttpUrl(text);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mapLimit(items, limit, worker) {
  const list = Array.from(items);
  const results = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(list[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function shanghaiDateKey(timestamp = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

export function errorMessage(error) {
  if (!error) return '未知错误';
  if (typeof error === 'string') return error;
  return error.message || String(error);
}
