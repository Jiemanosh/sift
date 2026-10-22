import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import {
  APK_PATH,
  APP_ORIGIN,
  AUTO_SYNC_MS,
  DATA_DIR,
  HOST,
  LAN_ENABLED,
  NO_SYNC,
  PORT,
  PUBLIC_DIR,
  ZHIHU_CUTOFF_DAYS,
} from './config.js';
import { Store } from './store.js';
import { SyncManager } from './sync.js';
import {
  BilibiliClient,
  parseFavoriteItem,
  parseWatchLaterItem,
} from './bilibili.js';
import { ZhihuClient, normalizeZhihuAccount, parseBridgePayload } from './zhihu.js';
import { parseCookieString } from './cookies.js';
import { buildBridge } from './bridge.js';
import { fetchImage } from './image-proxy.js';
import { errorMessage, normalizeZhihuUrl, safeHttpUrl } from './util.js';
import {
  MOBILE_COOKIE,
  MOBILE_SESSION_MS,
  createMobileToken,
  isAllowedHost,
  isLoopbackAddress,
  isMobileReadOnlyRequest,
  listLanAddresses,
  mobileCodesMatch,
  readCookie,
  verifyMobileToken,
} from './mobile.js';

const VERSION = '1.0.0';
const ZHIHU_ORIGINS = new Set(['https://www.zhihu.com', 'https://zhuanlan.zhihu.com']);
const qrSessions = new Map();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

const store = new Store(DATA_DIR);
const sync = new SyncManager(store);

const trustedHosts = new Set(
  [
    os.hostname(),
    ...String(process.env.SIFT_ALLOWED_HOSTS || '').split(','),
  ]
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean),
);
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function isLocalRequest(req) {
  return isLoopbackAddress(req.socket.remoteAddress);
}

function hostGuard(req, res, next) {
  if (isAllowedHost(req.headers.host, trustedHosts)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(403).json({ error: '不允许的主机名', code: 'BAD_HOST' });
  }
  return res.status(403).type('text/plain').send('不允许的主机名');
}

function mobileAuthGuard(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/health' || req.path === '/api/mobile/login') return next();
  if (req.path === '/api/zhihu/ingest') return next();
  if (isLocalRequest(req)) return next();
  const token = readCookie(req.headers.cookie, MOBILE_COOKIE);
  if (!verifyMobileToken(store.getConfig().mobileSecret, token)) {
    return res.status(401).json({ error: '需要先在手机上连接这台电脑', code: 'NEED_MOBILE_AUTH' });
  }
  if (!isMobileReadOnlyRequest(req.method, req.path)) {
    return res.status(403).json({
      error: '手机端为只读：账号登录和同步请在电脑上操作',
      code: 'MOBILE_READ_ONLY',
    });
  }
  return next();
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function mobilePairingPayload() {
  const urls = LAN_ENABLED
    ? listLanAddresses().map((entry) => ({
        name: entry.name,
        url: `http://${entry.address}:${PORT}`,
      }))
    : [];
  const code = store.getConfig().mobileCode;
  const primaryUrl = urls[0]?.url || null;
  const pairUrl = primaryUrl ? `${primaryUrl}/pair#${encodeURIComponent(code)}` : null;
  let qrDataUrl = null;
  if (pairUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(pairUrl, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 280,
        color: { dark: '#1d1b17', light: '#fbf8f0' },
      });
    } catch (error) {
      console.warn('[sift] 生成手机配对二维码失败:', error.message);
    }
  }
  return {
    enabled: Boolean(primaryUrl),
    lanEnabled: LAN_ENABLED,
    urls,
    primaryUrl,
    pairUrl,
    qrDataUrl,
    code,
    apkUrl: '/app/sift.apk',
    apkAvailable: await fileExists(APK_PATH),
  };
}

function apiHeaders(req, res, next) {
  if (req.path.startsWith('/api/')) {
    res.set('cache-control', 'no-store');
    res.set('x-content-type-options', 'nosniff');
    res.set('referrer-policy', 'no-referrer');
  }
  next();
}

app.use(apiHeaders);
app.use(hostGuard);
app.use(mobileAuthGuard);
app.use(express.json({ limit: '12mb' }));

function bridgeCors(req, res, next) {
  const origin = req.get('origin') || '';
  if (ZHIHU_ORIGINS.has(origin)) {
    res.set('access-control-allow-origin', origin);
    res.set('vary', 'Origin');
    res.set('access-control-allow-methods', 'POST, OPTIONS');
    res.set('access-control-allow-headers', 'content-type, x-sift-token');
    res.set('access-control-allow-private-network', 'true');
    res.set('access-control-max-age', '600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

function tokenMatches(input) {
  const expected = String(store.getConfig().bridgeToken || '');
  const given = String(input || '');
  if (!expected || !given || given.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  } catch {
    return false;
  }
}

function statusPayload(req) {
  return {
    app: {
      name: '筛 SIFT',
      version: VERSION,
      origin: APP_ORIGIN,
      now: Date.now(),
      localOnly: HOST === '127.0.0.1' || HOST === 'localhost',
      lanEnabled: LAN_ENABLED,
      localRequest: req ? isLocalRequest(req) : true,
    },
    accounts: store.getPublicAccounts(),
    counts: store.getCounts(),
    meta: store.getState().meta,
    sync: sync.getStatus(),
    bridge: { ready: true },
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'sift', version: VERSION });
});

app.post('/api/mobile/login', (req, res) => {
  const now = Date.now();
  const ip = req.socket.remoteAddress || 'unknown';
  let attempt = loginAttempts.get(ip);
  if (!attempt || now >= attempt.resetAt) {
    attempt = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    loginAttempts.set(ip, attempt);
  }
  if (attempt.count >= LOGIN_MAX_FAILURES) {
    res.set('retry-after', String(Math.ceil((attempt.resetAt - now) / 1000)));
    return res.status(429).json({ error: '访问码尝试次数过多，请十分钟后再试', code: 'TOO_MANY_ATTEMPTS' });
  }
  if (!mobileCodesMatch(req.body?.code, store.getConfig().mobileCode)) {
    attempt.count += 1;
    return res.status(401).json({ error: '访问码不正确', code: 'BAD_MOBILE_CODE' });
  }

  loginAttempts.delete(ip);
  const { token, expiresAt } = createMobileToken(store.getConfig().mobileSecret);
  const cookie = [
    `${MOBILE_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(MOBILE_SESSION_MS / 1000)}`,
    req.secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
  res.set('set-cookie', cookie);
  res.set('cache-control', 'no-store');
  res.json({ ok: true, expiresAt });
});

app.get('/api/mobile/pairing', wrap(async (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: '只能在这台电脑上查看手机连接信息', code: 'LOCAL_ONLY' });
  }
  res.json(await mobilePairingPayload());
}));

app.post('/api/mobile/access', wrap(async (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: '只能在这台电脑上重新生成访问码', code: 'LOCAL_ONLY' });
  }
  await store.regenerateMobileAccess();
  res.json(await mobilePairingPayload());
}));

app.get('/api/status', (req, res) => {
  res.json(statusPayload(req));
});

app.get('/api/feed', (req, res) => {
  const limit = Number(req.query.limit) || 500;
  res.json({
    ...store.getFeed(limit),
    app: statusPayload(req).app,
    counts: store.getCounts(),
    accounts: store.getPublicAccounts(),
    sync: sync.getStatus(),
  });
});

app.get('/api/creators', (req, res) => {
  res.json({ creators: store.getCreators() });
});

app.post('/api/items/:id/state', (req, res) => {
  const patch = {};
  if (typeof req.body?.read === 'boolean') patch.read = req.body.read;
  if (typeof req.body?.starred === 'boolean') patch.starred = req.body.starred;
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: '没有可更新的状态' });
  }
  const item = store.setItemState(req.params.id, patch);
  if (!item) return res.status(404).json({ error: '内容不存在' });
  res.json({ ok: true, item });
});

app.post('/api/items/read-all', (req, res) => {
  const ids = Array.isArray(req.body?.ids)
    ? req.body.ids
      .filter((id) => typeof id === 'string' && id.length <= 200)
      .slice(0, 2000)
    : null;
  if (ids) {
    return res.json({ ok: true, count: store.markItemsRead(ids) });
  }
  const platform = req.body?.platform === 'bilibili' || req.body?.platform === 'zhihu'
    ? req.body.platform
    : null;
  const count = store.markAllRead(platform);
  res.json({ ok: true, count });
});

app.post('/api/sync', (req, res) => {
  const started = sync.requestSync('manual');
  res.status(202).json({ ok: true, started, sync: sync.getStatus() });
});

app.get('/api/sync', (req, res) => {
  res.json(sync.getStatus());
});

// ---------- Bilibili ----------

app.post('/api/bili/qr', wrap(async (req, res) => {
  const client = new BilibiliClient();
  const qr = await client.generateQr();
  qrSessions.set(qr.key, { client, createdAt: Date.now() });
  res.json({ key: qr.key, qrDataUrl: qr.qrDataUrl, url: qr.url, expiresIn: qr.expiresIn });
}));

app.get('/api/bili/qr/:key', wrap(async (req, res) => {
  const entry = qrSessions.get(req.params.key);
  if (!entry) return res.status(404).json({ error: '二维码已失效，请刷新' });

  const result = await entry.client.pollQr(req.params.key);
  if (result.status === 'success') {
    qrSessions.delete(req.params.key);
    await store.setSession('bilibili', {
      cookies: entry.client.cookies,
      mid: result.account.mid,
      name: result.account.name,
      face: result.account.face,
      connectedAt: Date.now(),
      lastSyncAt: null,
      needsReauth: false,
    });
    sync.requestSync('bili-login');
    return res.json({ status: 'success', account: result.account });
  }

  if (result.status === 'expired') {
    qrSessions.delete(req.params.key);
    return res.json({ status: 'expired' });
  }
  res.json({ status: result.status });
}));

app.delete('/api/bili/session', wrap(async (req, res) => {
  qrSessions.clear();
  await store.removePlatform('bilibili');
  res.json({ ok: true });
}));

function requireBiliSession(res) {
  const session = store.getSession('bilibili');
  if (!session?.cookies?.SESSDATA) {
    res.status(401).json({ error: '请先连接 B站账号', code: 'NEED_LOGIN' });
    return null;
  }
  return session;
}

function sendBiliError(res, error) {
  const status = error.code === 'NEED_LOGIN' ? 401 : error.code === 'RISK_CONTROL' ? 403 : 502;
  res.status(status).json({ error: errorMessage(error), code: error.code || null });
}

app.get('/api/bili/favorites', wrap(async (req, res) => {
  const session = requireBiliSession(res);
  if (!session) return;
  const page = Math.max(1, Math.min(100, Number(req.query.page) || 1));
  const requestedFolder = /^\d+$/.test(String(req.query.folder || '')) ? String(req.query.folder) : '';
  const client = new BilibiliClient({ cookies: session.cookies });
  try {
    const rawFolders = await client.fetchFavoriteFolders();
    const folders = rawFolders
      .filter((folder) => folder && folder.id)
      .map((folder, index) => ({
        id: String(folder.id),
        title: folder.title || '未命名收藏夹',
        count: Number(folder.media_count) || 0,
        isDefault: index === 0,
      }));
    if (!folders.length) {
      return res.json({ folders: [], folder: null, items: [], page: 1, hasMore: false, total: 0 });
    }
    const selected = folders.find((folder) => folder.id === requestedFolder) || folders[0];
    const result = await client.fetchFavoritePage(selected.id, page, 20);
    const items = result.medias
      .map((media) => parseFavoriteItem(media, selected))
      .filter(Boolean);
    const total = Number(result.info?.media_count) || selected.count;
    res.json({
      folders,
      folder: { ...selected, count: total },
      items,
      page,
      hasMore: result.hasMore,
      total,
    });
  } catch (error) {
    sendBiliError(res, error);
  }
}));

app.get('/api/bili/watchlater', wrap(async (req, res) => {
  const session = requireBiliSession(res);
  if (!session) return;
  const client = new BilibiliClient({ cookies: session.cookies });
  try {
    const result = await client.fetchWatchLater();
    const rawItems = result.items.slice(0, 1000);
    const items = rawItems.map(parseWatchLaterItem).filter(Boolean);
    res.json({
      items,
      total: result.total || result.items.length,
      truncated: result.items.length > rawItems.length,
    });
  } catch (error) {
    sendBiliError(res, error);
  }
}));

// ---------- Zhihu ----------

app.post('/api/zhihu/cookie', wrap(async (req, res) => {
  const raw = String(req.body?.cookie || '').trim();
  if (!raw) return res.status(400).json({ error: '请粘贴知乎 Cookie' });
  const jar = parseCookieString(raw);
  if (!jar.has('z_c0')) {
    return res.status(400).json({ error: 'Cookie 中缺少 z_c0，请确认复制的是已登录状态下的完整 Cookie' });
  }
  const client = new ZhihuClient({ jar });
  let me;
  try {
    me = await client.me();
  } catch (error) {
    const status = error.code === 'RISK_CONTROL' ? 403 : error.code === 'NEED_LOGIN' ? 401 : 400;
    return res.status(status).json({
      error: errorMessage(error),
      code: error.code || null,
    });
  }
  const account = normalizeZhihuAccount(me);
  if (!account?.urlToken) {
    return res.status(400).json({ error: '无法读取知乎账号信息，Cookie 可能已失效' });
  }
  const now = Date.now();
  await store.setSession('zhihu', {
    mode: 'cookie',
    cookies: client.cookies,
    urlToken: account.urlToken,
    name: account.name,
    avatar: account.avatar,
    connectedAt: now,
    lastSyncAt: null,
    needsBridge: false,
  });
  sync.requestSync('zhihu-login');
  res.json({ ok: true, account });
}));

app.delete('/api/zhihu/session', wrap(async (req, res) => {
  await store.removePlatform('zhihu');
  res.json({ ok: true });
}));

app.get('/api/zhihu/bridge', (req, res) => {
  const origin = APP_ORIGIN;
  const token = store.getConfig().bridgeToken;
  const bridge = buildBridge({ origin, token });
  const session = store.getSession('zhihu');
  res.json({
    bookmarklet: bridge.bookmarklet,
    script: bridge.script,
    endpoint: bridge.endpoint,
    origin,
    account: session
      ? {
          name: session.name || null,
          urlToken: session.urlToken || null,
          mode: session.mode || 'bridge',
          followeeCount: session.followeeCount || null,
          lastBridgeAt: session.lastBridgeAt || null,
        }
      : null,
  });
});

app.options('/api/zhihu/ingest', bridgeCors);

app.post('/api/zhihu/ingest', bridgeCors, wrap(async (req, res) => {
  const token = req.query.token || req.get('x-sift-token');
  if (!tokenMatches(token)) {
    return res.status(403).json({ error: '同步令牌无效，请从仪表盘重新复制书签' });
  }
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: '请求内容为空' });
  }

  const parsed = parseBridgePayload(req.body);
  const cutoff = Date.now() - ZHIHU_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  const items = parsed.items
    .filter((item) => item?.id && item?.author?.id)
    .filter((item) => item.createdAt >= cutoff)
    .filter((item) => normalizeZhihuUrl(item.url))
    .slice(0, 5000);

  const { added, changed } = store.upsertItems(items);
  if (parsed.followees.length) {
    store.upsertCreators(
      parsed.followees.map((creator) => ({
        platform: 'zhihu',
        authorId: creator.urlToken,
        name: creator.name,
        avatar: creator.avatar,
        url: `https://www.zhihu.com/people/${creator.urlToken}`,
      })),
    );
  }

  const now = Date.now();
  const existing = store.getSession('zhihu');
  const account = parsed.account;
  if (account?.urlToken || parsed.followees.length || items.length) {
    await store.setSession('zhihu', {
      mode: 'bridge',
      name: account?.name || existing?.name || '知乎账号',
      avatar: account?.avatar || existing?.avatar || null,
      urlToken: account?.urlToken || existing?.urlToken || null,
      connectedAt: existing?.connectedAt || now,
      lastBridgeAt: now,
      lastSyncAt: now,
      followeeCount: parsed.followees.length || existing?.followeeCount || null,
      needsBridge: false,
      lastError: null,
    });
  }
  store.touchMeta({ lastZhihuSyncAt: now, lastSyncAt: now });
  await store.flush();

  res.json({
    ok: true,
    accepted: items.length,
    added,
    changed,
    creators: parsed.followees.length,
    errors: parsed.errors,
  });
}));

// ---------- Image proxy ----------

app.get('/api/img', wrap(async (req, res) => {
  const raw = String(req.query.u || '');
  if (!raw || raw.length > 2048 || !safeHttpUrl(raw)) {
    return res.status(400).end();
  }
  const image = await fetchImage(raw);
  res.set('content-type', image.type || 'image/jpeg');
  res.set('cache-control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.set('x-content-type-options', 'nosniff');
  res.send(image.buffer);
}));

// ---------- Android shell ----------

app.get('/app/sift.apk', async (req, res) => {
  if (!(await fileExists(APK_PATH))) {
    return res.status(404).type('text/plain; charset=utf-8').send('安卓安装包还没有生成');
  }
  res.set('cache-control', 'no-store');
  res.set('x-content-type-options', 'nosniff');
  res.type('application/vnd.android.package-archive');
  res.download(APK_PATH, 'sift.apk', (error) => {
    if (!error || res.headersSent) return;
    res.status(500).type('text/plain; charset=utf-8').send('安装包发送失败');
  });
});

// ---------- Static ----------

app.use(express.static(PUBLIC_DIR, {
  extensions: ['html'],
  maxAge: 0,
  setHeaders(res, filePath) {
    if (path.basename(filePath) === 'index.html') {
      res.set('cache-control', 'no-cache');
      res.set('content-security-policy', [
        "default-src 'self'",
        "img-src 'self' data:",
        "style-src 'self'",
        "script-src 'self'",
        "connect-src 'self'",
        "font-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '));
    }
    if (path.basename(filePath) === 'zhihu-bridge.html') {
      res.set('cache-control', 'no-store');
      res.set('referrer-policy', 'no-referrer');
      res.set('content-security-policy', [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '));
    }
    if (path.basename(filePath) === 'pair.html') {
      res.set('cache-control', 'no-store');
      res.set('referrer-policy', 'no-referrer');
      res.set('content-security-policy', [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '));
    }
  },
}));

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  const status = Number(error.status || error.statusCode) || 500;
  if (status >= 500) {
    console.error('[sift] 请求失败:', error);
  }
  if (res.headersSent) return;
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: '提交的数据过大' });
  }
  if (status === 400 && error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求格式错误' });
  }
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: errorMessage(error) || '服务器内部错误',
  });
});

// ---------- Lifecycle ----------

function cleanupQrSessions() {
  const now = Date.now();
  for (const [key, entry] of qrSessions) {
    if (now - entry.createdAt > 10 * 60 * 1000) qrSessions.delete(key);
  }
}

function autoSyncIfStale(reason) {
  if (NO_SYNC) return;
  const bili = store.getSession('bilibili');
  if (!bili?.cookies?.SESSDATA) return;
  const last = Number(store.getState().meta.lastBiliSyncAt || 0);
  if (bili.needsReauth || Date.now() - last > 10 * 60 * 1000) sync.requestSync(reason);
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (error) {
    console.warn('[sift] 无法自动打开浏览器:', error.message);
  }
}

async function start() {
  await store.init();
  const server = app.listen(PORT, HOST, () => {
    const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
    const url = `http://${displayHost}:${PORT}`;
    console.log('');
    console.log('  筛 SIFT · 只看你关注的人');
    console.log(`  本地地址  ${url}`);
    if (LAN_ENABLED) {
      const lanUrls = listLanAddresses();
      for (const entry of lanUrls.slice(0, 3)) {
        console.log(`  手机地址  http://${entry.address}:${PORT}  (${entry.name})`);
      }
      if (lanUrls.length) console.log('  手机访问码  在网页「账号与来源 → 手机 App」查看');
    }
    console.log(`  数据目录  ${DATA_DIR}`);
    console.log(`  B站自动同步  ${NO_SYNC ? '已关闭' : `每 ${Math.round(AUTO_SYNC_MS / 60000)} 分钟`}`);
    console.log('');
    if (process.argv.includes('--open')) setTimeout(() => openBrowser(url), 350);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`[sift] 端口 ${PORT} 已被占用。请关闭占用程序，或设置 SIFT_PORT 后重试。`);
    } else {
      console.error('[sift] 服务启动失败:', error);
    }
    process.exit(1);
  });

  const qrTimer = setInterval(cleanupQrSessions, 60 * 1000);
  qrTimer.unref?.();

  const syncTimer = setInterval(() => autoSyncIfStale('auto'), AUTO_SYNC_MS);
  syncTimer.unref?.();

  const startupTimer = setTimeout(() => autoSyncIfStale('startup'), 2500);
  startupTimer.unref?.();

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) process.exit(0);
    closing = true;
    console.log(`\n[sift] 收到 ${signal}，保存状态并退出…`);
    clearInterval(syncTimer);
    clearInterval(qrTimer);
    try {
      await store.flush();
    } catch (error) {
      console.warn('[sift] 状态保存失败:', error.message);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error('[sift] 启动失败:', error);
  process.exit(1);
});
