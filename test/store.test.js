import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { parseFavoriteItem, parseWatchLaterItem } from '../server/bilibili.js';
import { buildBridge } from '../server/bridge.js';

async function makeStore(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sift-store-'));
  const store = new Store(dir);
  await store.init();
  t.after(async () => {
    await store.flush();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return store;
}

function item(id, patch = {}) {
  return {
    id,
    platform: 'bilibili',
    kind: 'video',
    title: '标题',
    excerpt: '摘要',
    url: 'https://www.bilibili.com/video/BV1',
    createdAt: 1700000000000,
    author: { id: '42', name: 'UP主', avatar: null, url: 'https://space.bilibili.com/42' },
    stats: { likes: 1 },
    ...patch,
  };
}

test('initializes a bridge token and persists config', async (t) => {
  const store = await makeStore(t);
  assert.match(store.getConfig().bridgeToken, /^[a-f0-9]{48}$/);
  assert.match(store.getConfig().mobileCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.match(store.getConfig().mobileSecret, /^[a-f0-9]{64}$/);
  assert.deepEqual(store.getPublicAccounts(), {
    bilibili: { connected: false },
    zhihu: { connected: false },
  });
});

test('restores account sessions after a restart', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sift-session-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const first = new Store(dir);
  await first.init();
  await first.setSession('bilibili', {
    cookies: { SESSDATA: 'secret', DedeUserID: '42' },
    name: '不谢_乔布斯',
    mid: '42',
  });
  await first.setSession('zhihu', {
    mode: 'bridge',
    name: 'all mine',
    urlToken: 'all-mine',
  });
  await first.flush();

  const second = new Store(dir);
  await second.init();
  const accounts = second.getPublicAccounts();
  assert.equal(accounts.bilibili.connected, true);
  assert.equal(accounts.bilibili.name, '不谢_乔布斯');
  assert.equal(accounts.bilibili.mid, '42');
  assert.equal(accounts.zhihu.connected, true);
  assert.equal(accounts.zhihu.mode, 'bridge');
  assert.equal(accounts.zhihu.name, 'all mine');
});

test('rotates mobile access credentials', async (t) => {
  const store = await makeStore(t);
  const beforeCode = store.getConfig().mobileCode;
  const beforeSecret = store.getConfig().mobileSecret;
  const code = await store.regenerateMobileAccess();
  assert.notEqual(code, beforeCode);
  assert.notEqual(store.getConfig().mobileSecret, beforeSecret);
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
});

test('keeps read and starred state when upserting', async (t) => {
  const store = await makeStore(t);
  const first = store.upsertItems([item('bilibili:dynamic:1')]);
  assert.equal(first.added, 1);

  store.setItemState('bilibili:dynamic:1', { read: true, starred: true });
  store.upsertItems([item('bilibili:dynamic:1', { title: '新标题' })]);

  const feed = store.getFeed();
  assert.equal(feed.items[0].title, '新标题');
  assert.equal(feed.items[0].read, true);
  assert.equal(feed.items[0].starred, true);
  assert.equal(feed.items[0].firstSeenAt > 0, true);
});

test('counts unread, starred, today and platforms', async (t) => {
  const store = await makeStore(t);
  store.upsertItems([
    item('bilibili:dynamic:1'),
    item('bilibili:dynamic:2', { createdAt: Date.now() }),
    item('zhihu:answer:3', {
      platform: 'zhihu',
      kind: 'answer',
      createdAt: Date.now() - 1000,
      author: { id: 'u1', name: '答主' },
    }),
  ]);
  store.setItemState('bilibili:dynamic:2', { starred: true });
  store.setItemState('bilibili:dynamic:2', { read: true });

  const counts = store.getCounts();
  assert.equal(counts.total, 3);
  assert.equal(counts.bilibili, 2);
  assert.equal(counts.zhihu, 1);
  assert.equal(counts.unread, 2);
  assert.equal(counts.starred, 1);
  assert.equal(counts.today, 2);
});

test('marks all read per platform', async (t) => {
  const store = await makeStore(t);
  store.upsertItems([
    item('bilibili:dynamic:1'),
    item('zhihu:answer:2', { platform: 'zhihu' }),
  ]);

  assert.equal(store.markAllRead('zhihu'), 1);
  const feed = store.getFeed();
  const zhihu = feed.items.find((entry) => entry.platform === 'zhihu');
  const bili = feed.items.find((entry) => entry.platform === 'bilibili');
  assert.equal(zhihu.read, true);
  assert.equal(bili.read, false);
});

test('marks only the given ids read', async (t) => {
  const store = await makeStore(t);
  store.upsertItems([
    item('bilibili:dynamic:1'),
    item('bilibili:dynamic:2'),
    item('zhihu:answer:3', { platform: 'zhihu' }),
  ]);
  store.setItemState('bilibili:dynamic:2', { read: true });

  assert.equal(store.markItemsRead(['bilibili:dynamic:1', 'bilibili:dynamic:2', 'missing:9', 'bilibili:dynamic:1']), 1);

  const feed = store.getFeed();
  const one = feed.items.find((entry) => entry.id === 'bilibili:dynamic:1');
  const three = feed.items.find((entry) => entry.id === 'zhihu:answer:3');
  assert.equal(one.read, true);
  assert.equal(three.read, false);
});

test('returns creators with counts and preserves account privacy', async (t) => {
  const store = await makeStore(t);
  store.upsertItems([item('bilibili:dynamic:1')]);
  await store.setSession('bilibili', {
    cookies: { SESSDATA: 'secret', bili_jct: 'secret2' },
    name: '账号',
    mid: '42',
  });

  const account = store.getPublicAccounts().bilibili;
  assert.equal(account.connected, true);
  assert.equal(account.name, '账号');
  assert.equal('cookies' in account, false);

  const [creator] = store.getCreators();
  assert.equal(creator.name, 'UP主');
  assert.equal(creator.count, 1);
  assert.equal(creator.unread, 1);
});

test('parses favorite media and skips invalid entries', () => {
  const media = {
    type: 2,
    attr: 0,
    bvid: 'BV1xx411c7mD',
    id: 112233,
    title: '收藏的视频',
    intro: '一段简介',
    cover: 'https://i0.hdslb.com/bfs/archive/a.jpg',
    duration: 372,
    pubtime: 1700000000,
    fav_time: 1710000000,
    upper: { mid: 4810021, name: '林间胶片', face: 'https://i0.hdslb.com/bfs/face/a.jpg' },
    cnt_info: { play: 128430, like: 9842, reply: 412 },
  };
  const parsed = parseFavoriteItem(media, { id: 7788, title: '摄影' });
  assert.equal(parsed.id, 'bilibili:favorite:7788:BV1xx411c7mD');
  assert.equal(parsed.collection, 'favorite');
  assert.equal(parsed.folder, '摄影');
  assert.equal(parsed.duration, '6:12');
  assert.equal(parsed.url, 'https://www.bilibili.com/video/BV1xx411c7mD');
  assert.equal(parsed.savedAt, 1710000000000);
  assert.equal(parsed.publishedAt, 1700000000000);
  assert.equal(parsed.stats.views, 128430);
  assert.equal(parsed.author.name, '林间胶片');
  assert.equal(parsed.author.id, '4810021');

  assert.equal(parseFavoriteItem({ ...media, type: 21 }, {}), null);
  assert.equal(parseFavoriteItem({ ...media, attr: 1 }, {}), null);
  assert.equal(parseFavoriteItem({ ...media, bvid: '', id: '' }, {}), null);
});

test('parses watch later media with optional saved time', () => {
  const media = {
    bvid: 'BV1yy411c7qT',
    aid: 445566,
    title: '稍后再看的视频',
    desc: '稍后看简介',
    pic: 'https://i0.hdslb.com/bfs/archive/b.jpg',
    duration: 3661,
    pubdate: 1700000000,
    add_at: 1710000000,
    owner: { mid: 332019, name: '老周修相机', face: 'https://i0.hdslb.com/bfs/face/b.jpg' },
    stat: { view: 76420, like: 4321, reply: 188 },
  };
  const parsed = parseWatchLaterItem(media);
  assert.equal(parsed.id, 'bilibili:watchlater:BV1yy411c7qT');
  assert.equal(parsed.collection, 'watchlater');
  assert.equal(parsed.duration, '1:01:01');
  assert.equal(parsed.savedAt, 1710000000000);
  assert.equal(parsed.stats.likes, 4321);
  assert.equal(parsed.author.name, '老周修相机');

  const noSavedAt = parseWatchLaterItem({ ...media, add_at: undefined });
  assert.equal(noSavedAt.savedAt, null);
  assert.equal(parseWatchLaterItem({ title: '无地址' }), null);
});

test('builds a bridge that transfers data through a local receiver window', () => {
  const token = 'a'.repeat(48);
  const bridge = buildBridge({ origin: 'http://127.0.0.1:8787', token });

  assert.equal(bridge.endpoint, 'http://127.0.0.1:8787/api/zhihu/ingest');
  assert.match(bridge.bookmarklet, /^javascript:/);
  assert.match(bridge.script, /zhihu-bridge\.html/);
  assert.match(bridge.script, /postMessage/);
  assert.match(bridge.script, /sift-open-receiver/);
  assert.ok(bridge.script.includes(token));
  assert.doesNotMatch(bridge.script, /fetch\(ENDPOINT/);
  assert.doesNotMatch(bridge.script, /mode: 'cors'/);
});
