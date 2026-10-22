import { USER_AGENT } from './http.js';
import { normalizeImageUrl } from './util.js';

const ALLOWED_HOSTS = ['hdslb.com', 'bilibili.com', 'zhimg.com', 'zhihu.com'];
const CACHE_MAX = 180;
const CACHE_BYTES_MAX = 40 * 1024 * 1024;
const cache = new Map();
let cacheBytes = 0;

function allowedHost(hostname) {
  return ALLOWED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

function hostAllowed(url) {
  try {
    return allowedHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function fetchImage(input) {
  const normalized = normalizeImageUrl(input);
  if (!normalized) throw new Error('无效图片地址');
  const parsed = new URL(normalized);
  if (!allowedHost(parsed.hostname)) throw new Error('不允许的图片来源');

  const key = parsed.toString();
  const hit = cache.get(key);
  if (hit) {
    hit.at = Date.now();
    return hit;
  }

  const referer = parsed.hostname.endsWith('bilibili.com') || parsed.hostname.endsWith('hdslb.com')
    ? 'https://www.bilibili.com/'
    : 'https://www.zhihu.com/';

  const response = await fetch(parsed, {
    headers: {
      'user-agent': USER_AGENT,
      accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      referer,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`图片请求失败（HTTP ${response.status}）`);
  if (!hostAllowed(response.url)) throw new Error('图片重定向到了不允许的域名');
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error('返回内容不是图片');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 12 * 1024 * 1024) throw new Error('图片过大');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 12 * 1024 * 1024) throw new Error('图片过大');

  const entry = { buffer, type, at: Date.now() };
  cache.set(key, entry);
  cacheBytes += buffer.length;
  for (const [cachedKey, cached] of cache) {
    if (cache.size <= CACHE_MAX && cacheBytes <= CACHE_BYTES_MAX) break;
    if (cachedKey === key) continue;
    cache.delete(cachedKey);
    cacheBytes -= cached.buffer.length;
  }
  return entry;
}
