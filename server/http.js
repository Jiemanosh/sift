import dns from 'node:dns';
import { sleep } from './util.js';

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  // older runtimes
}

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(message, { status = 0, code = null, body = null, url = '' } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.url = url;
  }
}

function extractErrorMessage(data, status) {
  if (!data) return `请求失败（HTTP ${status}）`;
  if (typeof data === 'string') return data.slice(0, 240) || `请求失败（HTTP ${status}）`;
  return (
    data.message ||
    data.error?.message ||
    data.error?.name ||
    data.msg ||
    `请求失败（HTTP ${status}）`
  );
}

function extractErrorCode(data) {
  if (!data || typeof data !== 'object') return null;
  return data.code ?? data.error?.code ?? null;
}

export async function fetchWithJar(url, options = {}) {
  const {
    jar,
    headers = {},
    timeoutMs = 20000,
    retries = 1,
    ...init
  } = options;

  const finalHeaders = {
    'user-agent': USER_AGENT,
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
    accept: 'application/json, text/plain, */*',
    ...headers,
  };
  if (jar && jar.size) finalHeaders.cookie = jar.header();

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: finalHeaders,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      jar?.absorb(response.headers);

      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await response.arrayBuffer().catch(() => {});
        await sleep(500 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(400 * (attempt + 1));
        continue;
      }
    }
  }

  const cause = lastError?.cause?.code || lastError?.code || '';
  const suffix = cause ? `（${cause}）` : '';
  throw new HttpError(`网络连接失败${suffix}`, { url });
}

export async function requestJson(url, options = {}) {
  const response = await fetchWithJar(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new HttpError('接口返回了无法解析的内容', {
        status: response.status,
        body: text.slice(0, 300),
        url,
      });
    }
  }

  if (!response.ok) {
    throw new HttpError(extractErrorMessage(data, response.status), {
      status: response.status,
      code: extractErrorCode(data),
      body: data,
      url,
    });
  }

  return data;
}

export async function postJson(url, body, options = {}) {
  return requestJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify(body ?? {}),
    ...options,
  });
}
