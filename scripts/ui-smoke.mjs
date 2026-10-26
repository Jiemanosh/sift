import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const BASE_URL = process.env.SMOKE_URL || 'http://127.0.0.1:8787/';
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SHOT_DIR = path.resolve('.tmp', 'ui');

await fs.mkdir(SHOT_DIR, { recursive: true });
const shot = (name) => path.join(SHOT_DIR, name);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const consoleErrors = [];
const results = [];

function watch(page, label) {
  page.on('pageerror', (error) => consoleErrors.push(`${label}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(`${label}: ${message.text()}`);
    }
  });
}

function cardCount(page) {
  return page.locator('.card').count();
}

async function waitForCards(page) {
  await page.waitForSelector('.card', { timeout: 10_000 });
  await page.waitForFunction(() => document.querySelectorAll('.card').length > 0);
}

async function openAccounts(page) {
  if (await page.locator('#accounts-btn').isVisible()) {
    await page.locator('#accounts-btn').click();
  } else {
    await page.locator('#rail-manage-btn').click();
  }
  await page.waitForSelector('[role="dialog"] .connect-card');
  await page.waitForTimeout(400);
}

const desktopContext = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'zh-CN',
  deviceScaleFactor: 1,
});

try {
  const page = await desktopContext.newPage();
  watch(page, 'desktop');
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await waitForCards(page);
  await page.waitForTimeout(400);

  assert.match(await page.title(), /筛 SIFT/);
  assert.equal(await cardCount(page), 22, '桌面端应显示 22 条更新');
  assert.equal(
    (await page.locator('#headline-stats').textContent())?.trim(),
    '今日 4 条更新 · 未读 9 条',
  );
  assert.equal(await page.locator('#source-chips .chip-count').first().textContent(), '22');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 0, `桌面端横向溢出 ${overflow}px`);
  await page.screenshot({ path: shot('sift-desktop.png') });
  results.push({ view: 'desktop', cards: 22, screenshot: 'sift-desktop.png' });

  assert.equal(await page.locator('#range-chips button').count(), 6, '应提供六种更新范围');
  await page.locator('#range-chips button[data-days="1"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 4);
  assert.match(await page.locator('#result-note').textContent(), /4 条更新/);
  assert.equal(
    await page.locator('#range-chips button[data-days="1"]').getAttribute('aria-pressed'),
    'true',
    '一天内选项应处于选中状态',
  );
  assert.equal(await page.locator('#filter-count').textContent(), '1', '非默认范围应计入筛选角标');
  await page.screenshot({ path: shot('sift-range-1.png') });
  await page.locator('#range-chips button[data-days="7"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 14);
  assert.match(await page.locator('#result-note').textContent(), /14 条更新/);
  assert.equal(await page.locator('#filter-count').textContent(), '1', '非默认范围应计入筛选角标');
  await page.screenshot({ path: shot('sift-range-7.png') });
  await page.locator('#range-chips button[data-days="15"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 19);
  await page.locator('#range-chips button[data-days="90"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);
  await page.locator('#range-chips button[data-days="180"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);
  await page.locator('#range-chips button[data-days="30"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);
  assert.equal(await page.locator('#filter-count').isVisible(), false, '默认范围不应计入筛选角标');
  results.push({ view: 'date range', days: [1, 7, 15, 90, 180, 30], counts: [4, 14, 19, 22, 22, 22] });

  // ---- Saved library views (mocked B站 endpoints) ----
  const savedAt = Date.now() - 2 * 3600 * 1000;
  const savedItem = (id, title, folder, extra = {}) => ({
    id,
    platform: 'bilibili',
    kind: 'video',
    collection: folder ? 'favorite' : 'watchlater',
    folder: folder || '',
    title,
    excerpt: `${title}的内容简介。`,
    url: `https://www.bilibili.com/video/${id.split(':').pop()}`,
    cover: null,
    duration: '08:00',
    createdAt: savedAt - 86400000,
    publishedAt: savedAt - 86400000,
    savedAt,
    via: folder ? `收藏于「${folder}」` : '稍后再看',
    stats: { views: 1234, likes: 56, comments: 7 },
    author: {
      id: '4810021',
      name: '林间胶片',
      avatar: null,
      url: 'https://space.bilibili.com/4810021',
    },
    ...extra,
  });
  const folders = [
    { id: '7788', title: '摄影', count: 3, isDefault: true },
    { id: '8899', title: '城市', count: 1, isDefault: false },
  ];
  const favA = savedItem('bilibili:favorite:7788:BVdemoA', '暗房冲扫入门', '摄影');
  const favB = savedItem('bilibili:favorite:7788:BVdemoB', '测光表使用笔记', '摄影');
  const favC = savedItem('bilibili:favorite:7788:BVdemoC', '黑白胶片选择', '摄影');
  const favCity = savedItem('bilibili:favorite:8899:BVdemoD', '城市散步摄影', '城市');
  const laterA = savedItem('bilibili:watchlater:BVdemoE', '街头人像练习', '', { savedAt: null });
  const laterB = savedItem('bilibili:watchlater:BVdemoF', '夜景曝光实验', '', { savedAt: null });

  const favoriteCalls = [];
  await page.route('**/api/bili/favorites**', (route) => {
    const url = new URL(route.request().url());
    const pageNo = Number(url.searchParams.get('page') || '1');
    const folder = url.searchParams.get('folder') || '7788';
    favoriteCalls.push({ page: pageNo, folder });
    let payload;
    if (folder === '8899') {
      payload = {
        folders,
        folder: { ...folders[1], count: 1 },
        items: [favCity],
        page: 1,
        hasMore: false,
        total: 1,
      };
    } else if (pageNo > 1) {
      payload = {
        folders,
        folder: { ...folders[0], count: 3 },
        items: [favC],
        page: 2,
        hasMore: false,
        total: 3,
      };
    } else {
      payload = {
        folders,
        folder: { ...folders[0], count: 3 },
        items: [favA, favB],
        page: 1,
        hasMore: true,
        total: 3,
      };
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  let watchLaterCalls = 0;
  await page.route('**/api/bili/watchlater', (route) => {
    watchLaterCalls += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items: [laterA, laterB], total: 2, truncated: false }),
    });
  });

  assert.equal(await page.locator('.view-tab').count(), 3);
  await page.locator('.view-tab[data-view="favorites"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card.is-saved').length === 2);
  assert.equal(await page.locator('#rail-filters').isVisible(), false, '收藏视图应隐藏筛选栏');
  assert.equal(await page.locator('.creators-section').isVisible(), false, '收藏视图应隐藏博主列表');
  assert.equal(await page.locator('#range-picker').isVisible(), false, '收藏视图应隐藏范围选择');
  assert.equal(await page.locator('#mark-all-btn').isVisible(), false, '收藏视图不应显示全部已读');
  assert.equal(await page.locator('#library-bar').isVisible(), true);
  assert.equal(await page.locator('#folder-select option').count(), 2);
  assert.match(await page.locator('#library-meta').textContent(), /「摄影」已加载 2 \/ 3 个视频/);
  assert.equal(await page.locator('.card.is-saved .star-btn').count(), 0, '收藏视图不应写账号收藏');
  assert.equal(await page.locator('.card.is-saved .read-btn').count(), 0, '收藏视图不应有本地已读按钮');
  assert.match(await page.locator('.card.is-saved').first().innerText(), /收藏于/);
  assert.match(await page.locator('.card.is-saved').first().innerText(), /在 B站 打开/);
  await page.screenshot({ path: shot('sift-saved-favorites.png') });

  await page.locator('#feed-end [data-action="load-more"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card.is-saved').length === 3);
  assert.equal(await page.locator('.card.is-saved').count(), 3, '加载更多应追加收藏视频');

  await page.selectOption('#folder-select', '8899');
  await page.waitForFunction(() => document.querySelectorAll('.card.is-saved').length === 1);
  assert.match(await page.locator('.card.is-saved').innerText(), /城市散步摄影/);
  assert.match(await page.locator('#library-meta').textContent(), /「城市」已加载 1 \/ 1 个视频/);

  await page.locator('#search-input').fill('城市');
  await page.waitForFunction(
    () => /匹配 1/.test(document.querySelector('#result-note')?.textContent || ''),
  );
  assert.equal(await page.locator('.card.is-saved').count(), 1);
  await page.locator('#search-clear').click();
  await page.waitForFunction(() => document.querySelectorAll('.card.is-saved').length === 1);

  await page.locator('.view-tab[data-view="watchlater"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card.is-saved').length === 2);
  assert.equal(await page.locator('#folder-picker').isVisible(), false, '稍后再看不应显示收藏夹选择');
  assert.equal(await page.locator('#library-title').isVisible(), true);
  assert.match(await page.locator('#library-meta').textContent(), /共 2 个视频/);
  assert.match(await page.locator('.card.is-saved').first().innerText(), /发布于/);
  await page.screenshot({ path: shot('sift-saved-watchlater.png') });
  assert.ok(watchLaterCalls >= 1, '应读取稍后再看接口');
  assert.ok(
    favoriteCalls.some((call) => call.folder === '7788' && call.page === 2),
    '收藏加载更多应请求第二页',
  );

  await page.locator('.view-tab[data-view="following"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);
  assert.equal(await page.locator('#range-picker').isVisible(), true);
  await page.unroute('**/api/bili/favorites**');
  await page.unroute('**/api/bili/watchlater');
  results.push({ view: 'saved library', favorites: 3, watchLater: 2, folder: '城市' });

  await page.locator('#source-chips .chip[data-value="bilibili"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 11);
  assert.equal(await page.locator('#result-note').textContent(), '11 条更新');
  const badges = await page.locator('.card .platform-badge').allTextContents();
  assert.ok(badges.every((text) => text === 'B站'), 'B站筛选只应保留 B站内容');
  await page.screenshot({ path: shot('sift-filter-bilibili.png') });

  await page.locator('#source-chips .chip[data-value="bilibili"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);

  await page.locator('#kind-chips .chip[data-value="video"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 7);
  const kinds = await page.locator('.card .kind-label').allTextContents();
  assert.ok(kinds.every((text) => text === '视频'), '类型筛选只应保留视频');
  await page.locator('#kind-chips .chip[data-value="video"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);

  await page.locator('#filter-unread').check();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 9);
  assert.equal(await page.locator('.card.is-unread').count(), 9, '未读筛选应保留 9 条');
  await page.locator('#filter-starred').check();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
  assert.equal(await page.locator('.card.is-starred').count(), 1);
  await page.locator('#filter-unread').uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 2);
  await page.locator('#filter-starred').uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);

  await page.locator('#search-input').fill('暗房');
  await page.waitForFunction(() => {
    const note = document.querySelector('#result-note')?.textContent || '';
    return /条更新/.test(note) && !document.querySelector('#result-note')?.textContent?.includes('22');
  });
  const searchCount = await cardCount(page);
  assert.ok(searchCount > 0 && searchCount < 22, `搜索应命中部分内容，实际 ${searchCount}`);
  const searchText = await page.locator('.card').allTextContents();
  assert.ok(searchText.every((text) => text.includes('暗房')), '搜索结果都应包含关键词');
  await page.screenshot({ path: shot('sift-search.png') });
  await page.locator('#search-clear').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);

  await page.locator('#search-input').fill('没有这条内容');
  await page.waitForSelector('.empty-card');
  assert.match(await page.locator('.empty-card').innerText(), /没有找到/);
  await page.screenshot({ path: shot('sift-filtered-empty.png') });
  await page.locator('.empty-card').getByRole('button', { name: '清除全部筛选' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);

  const firstTitle = (await page.locator('.card .item-title').first().textContent())?.trim();
  await page.locator('.card .creator-link').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 4);
  assert.equal(
    (await page.locator('.creator-chip.is-on .creator-name').textContent())?.trim(),
    '林间胶片',
  );
  await page.locator('#source-chips .chip[data-value="all"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);
  assert.equal(await page.locator('#filter-count').isVisible(), false, '点击全部应复原全部筛选');
  assert.equal(await page.locator('.creator-all').getAttribute('aria-pressed'), 'true');

  await page.locator('.card .creator-link').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 4);
  assert.equal(await page.locator('.creator-all .creator-count').textContent(), '22');
  await page.locator('.creator-all').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);
  assert.equal(await page.locator('.creator-all').getAttribute('aria-pressed'), 'true');

  const restoreY = 620;
  await page.evaluate((top) => window.scrollTo(0, top), restoreY);
  await page.waitForFunction((top) => Math.abs(window.scrollY - top) <= 1, restoreY);
  await page.locator('#creator-chips .creator-chip:not(.creator-all)').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 4);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.locator('.creator-all').click();
  await page.waitForFunction(() => document.querySelectorAll('.card').length === 22);
  await page.waitForFunction((top) => Math.abs(window.scrollY - top) <= 2, restoreY);
  results.push({ view: 'creator scroll restore', scrollY: await page.evaluate(() => window.scrollY) });

  await page.waitForSelector('#to-top.is-visible');
  await page.screenshot({ path: shot('sift-to-top.png') });
  await page.locator('#to-top').click();
  await page.waitForFunction(() => window.scrollY === 0);
  await page.waitForSelector('#to-top.is-visible', { state: 'detached' });
  results.push({ view: 'back to top', offset: 600 });

  await openAccounts(page);
  assert.match(await page.locator('[role="dialog"]').innerText(), /林间胶片/);
  assert.match(await page.locator('[role="dialog"]').innerText(), /暗房笔记/);
  await page.screenshot({ path: shot('sift-accounts.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'hidden' });

  await openAccounts(page);
  await page.getByRole('button', { name: '重新运行同步书签' }).click();
  await page.waitForSelector('.bookmarklet');
  await page.waitForTimeout(400);
  const href = await page.locator('.bookmarklet').getAttribute('href');
  assert.ok(href?.startsWith('javascript:'), '知乎同步书签应是 javascript: 地址');
  assert.match(
    (await page.locator('.bridge-account').innerText()) || '',
    /暗房笔记/,
  );
  await page.screenshot({ path: shot('sift-bridge.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'hidden' });

  const qrDataUrl =
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="340" height="340"><rect width="340" height="340" fill="#fbf8f0"/><g fill="#1d1b17"><rect x="30" y="30" width="80" height="80"/><rect x="230" y="30" width="80" height="80"/><rect x="30" y="230" width="80" height="80"/><rect x="145" y="60" width="30" height="30"/><rect x="190" y="120" width="50" height="50"/><rect x="120" y="190" width="40" height="40"/><rect x="230" y="210" width="50" height="50"/><rect x="60" y="150" width="40" height="40"/></g></svg>',
    );
  await page.route('**/api/bili/qr', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        key: 'demo-key',
        qrDataUrl,
        url: 'https://passport.bilibili.com/demo',
        expiresIn: 180,
      }),
    }),
  );
  await page.route('**/api/bili/qr/demo-key', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'waiting' }),
    }),
  );
  await openAccounts(page);
  await page.getByRole('button', { name: '重新扫码' }).click();
  await page.waitForSelector('.qr-frame img');
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator('.qr-frame img').getAttribute('alt'),
    '哔哩哔哩登录二维码',
  );
  await page.screenshot({ path: shot('sift-qr.png') });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'hidden' });
  await page.unroute('**/api/bili/qr');
  await page.unroute('**/api/bili/qr/demo-key');

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  const mobile = await mobileContext.newPage();
  watch(mobile, 'mobile');
  await mobile.goto(BASE_URL, { waitUntil: 'networkidle' });
  await waitForCards(mobile);
  await mobile.waitForTimeout(400);

  const mobileLayout = await mobile.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headerHeight: document.querySelector('.masthead')?.getBoundingClientRect().height || 0,
    toolbarTop: document.querySelector('.feed-toolbar')?.getBoundingClientRect().top || 0,
  }));
  assert.ok(
    mobileLayout.scrollWidth <= mobileLayout.width,
    `移动端横向溢出 ${mobileLayout.scrollWidth - mobileLayout.width}px`,
  );
  assert.ok(mobileLayout.headerHeight > 0, '移动端应显示报头');
  await mobile.screenshot({ path: shot('sift-mobile.png') });

  await mobile.locator('#filter-toggle').click();
  await mobile.waitForSelector('#rail.is-open');
  assert.equal(await mobile.locator('#range-picker').isVisible(), true, '手机筛选抽屉应显示更新范围');
  assert.deepEqual(
    await mobile.locator('#range-chips button').allTextContents(),
    ['一天内', '近一周', '近十五天', '近一月', '近三月', '近半年'],
  );
  await mobile.screenshot({ path: shot('sift-mobile-filters.png') });

  await mobile.locator('#range-chips button[data-days="1"]').click();
  await mobile.waitForFunction(() => document.querySelectorAll('.card').length === 4);
  assert.equal(await mobile.locator('#filter-count').textContent(), '1');
  await mobile.locator('#range-chips button[data-days="7"]').click();
  await mobile.waitForFunction(() => document.querySelectorAll('.card').length === 14);
  assert.equal(await mobile.locator('#filter-count').textContent(), '1');
  await mobile.locator('#range-chips button[data-days="30"]').click();
  await mobile.waitForFunction(() => document.querySelectorAll('.card').length === 22);

  await mobile.locator('#source-chips .chip[data-value="zhihu"]').click();
  await mobile.waitForFunction(() => document.querySelectorAll('.card').length === 11);
  const mobileBadges = await mobile.locator('.card .platform-badge').allTextContents();
  assert.ok(mobileBadges.every((text) => text === '知乎'));
  await mobile.locator('#source-chips .chip[data-value="zhihu"]').click();
  await mobile.waitForFunction(() => document.querySelectorAll('.card').length === 22);

  await mobile.locator('#rail-done').click();
  await mobile.waitForSelector('#rail.is-open', { state: 'detached' });
  await mobile.evaluate(() => window.scrollTo(0, 500));
  await mobile.waitForFunction(() => Math.abs(window.scrollY - 500) <= 1);
  const mobileCreatorLink = mobile.locator('.card .creator-link').nth(1);
  await mobileCreatorLink.scrollIntoViewIfNeeded();
  const mobileRestoreY = await mobile.evaluate(() => Math.round(window.scrollY));
  assert.ok(mobileRestoreY > 0, '手机端应停在信息流内');
  await mobileCreatorLink.click();
  await mobile.waitForFunction(() => document.querySelectorAll('.card').length === 3);
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await mobile.waitForFunction(() => window.scrollY === 0);
  await mobile.locator('#filter-toggle').click();
  await mobile.waitForSelector('#rail.is-open');
  await mobile.locator('.creator-all').click();
  await mobile.waitForFunction(() => document.querySelectorAll('.card').length === 22);
  await mobile.locator('#rail-done').click();
  await mobile.waitForSelector('#rail.is-open', { state: 'detached' });
  assert.ok(
    Math.abs((await mobile.evaluate(() => window.scrollY)) - mobileRestoreY) <= 2,
    '手机端返回全部博主应恢复滚动位置',
  );

  await mobile.evaluate(() => window.scrollTo(0, 900));
  await mobile.waitForFunction(() => Math.abs(window.scrollY - 900) <= 1);
  await mobile.waitForSelector('#to-top.is-visible');
  const toTopBox = await mobile.locator('#to-top').boundingBox();
  assert.ok(toTopBox && toTopBox.width >= 44 && toTopBox.height >= 44, '手机端回到顶部按钮应可点按');
  await mobile.screenshot({ path: shot('sift-mobile-to-top.png') });
  await mobile.locator('#to-top').click();
  await mobile.waitForFunction(() => window.scrollY === 0);
  await mobile.waitForSelector('#to-top.is-visible', { state: 'detached' });

  results.push({
    view: '390x844',
    cards: 22,
    screenshot: 'sift-mobile.png',
  });
  await mobileContext.close();

  const emptyContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
  });
  const empty = await emptyContext.newPage();
  watch(empty, 'onboarding');
  await empty.route('**/api/feed**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [],
        creators: [],
        counts: { total: 0, unread: 0, starred: 0, today: 0, bilibili: 0, zhihu: 0 },
        accounts: { bilibili: { connected: false }, zhihu: { connected: false } },
        meta: { feedVersion: 0, stateVersion: 0 },
        sync: { running: false, phase: 'idle' },
      }),
    }),
  );
  await empty.goto(BASE_URL, { waitUntil: 'networkidle' });
  await empty.waitForSelector('.onboarding');
  assert.match(await empty.locator('.onboarding').innerText(), /把你的关注，收进一张纸/);
  assert.equal(await empty.getByRole('button', { name: '扫码连接 B站' }).count(), 1);
  assert.equal(await empty.getByRole('button', { name: '连接知乎' }).count(), 1);
  await empty.screenshot({ path: shot('sift-onboarding.png') });
  results.push({ view: 'onboarding', screenshot: 'sift-onboarding.png' });
  await emptyContext.close();

  // State mutations run after every screenshot so they cannot dirty the visual baseline.
  const starredCard = page.locator('.card.is-unread:not(.is-starred)').first();
  const starredTitle = (await starredCard.locator('.item-title').textContent())?.trim();
  await starredCard.locator('.star-btn').click();
  await page.waitForFunction(
    (title) =>
      [...document.querySelectorAll('.card')].some(
        (card) =>
          card.classList.contains('is-starred') &&
          card.querySelector('.item-title')?.textContent?.trim() === title,
      ),
    starredTitle,
  );
  assert.equal(await page.locator('#count-starred').textContent(), '3');

  await page.reload({ waitUntil: 'networkidle' });
  await waitForCards(page);
  const persistedStar = page.locator('.card', { hasText: starredTitle });
  assert.ok(
    await persistedStar.first().evaluate((card) => card.classList.contains('is-starred')),
    '刷新后收藏状态应保留',
  );

  const unreadBefore = Number(await page.locator('#count-unread').textContent());
  const unreadCard = page.locator('.card.is-unread').first();
  await unreadCard.locator('.read-btn').click();
  await page.waitForFunction(
    (before) => Number(document.querySelector('#count-unread')?.textContent) === before - 1,
    unreadBefore,
  );

  // Scoped mark-all: only visible, filtered unread items should be cleared.
  const scopedChip = page.locator('.creator-chip:has(.creator-count.has-unread)').first();
  const scopedName = (await scopedChip.locator('.creator-name').textContent())?.trim();
  await scopedChip.click();
  await page.locator('#filter-unread').check();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.card').length > 0 &&
      document.querySelectorAll('.card.is-unread').length > 0,
  );
  const visibleUnread = await page.locator('.card.is-unread').count();
  const totalUnreadBefore = Number(await page.locator('#count-unread').textContent());
  await page.locator('#mark-all-btn').click();
  await page.waitForFunction(
    () => document.querySelector('#mark-all-btn')?.textContent === '再点一次确认',
  );
  await page.locator('#mark-all-btn').click();
  await page.waitForFunction(
    ([before, visible]) =>
      Number(document.querySelector('#count-unread')?.textContent) === before - visible,
    [totalUnreadBefore, visibleUnread],
  );
  assert.equal(await page.locator('.card.is-unread').count(), 0);
  assert.ok(Number(await page.locator('#count-unread').textContent()) > 0);
  assert.equal(await page.locator('#mark-all-btn').isDisabled(), true);
  results.push({ view: 'scoped mark all', creator: scopedName, marked: visibleUnread });

  await page.locator('#filter-unread').uncheck();
  await page.locator('.creator-chip.is-on').click();
  await page.locator('#mark-all-btn').click();
  await page.waitForFunction(
    () => document.querySelector('#mark-all-btn')?.textContent === '再点一次确认',
  );
  await page.screenshot({ path: shot('sift-mark-all.png') });
  await page.locator('#mark-all-btn').click();
  await page.waitForFunction(() => document.querySelector('#count-unread')?.textContent === '0');
  assert.equal(await page.locator('.card.is-unread').count(), 0);
  assert.equal(
    await page.locator('#mark-all-btn').isDisabled(),
    true,
    '全部已读后按钮应禁用',
  );
  results.push({ view: 'desktop interactions', firstTitle, persistence: 'ok' });

  await page.close();
  await desktopContext.close();

  const fatalErrors = consoleErrors.filter(
    (message) => !/favicon|ERR_INTERNET_DISCONNECTED/i.test(message),
  );
  assert.deepEqual(fatalErrors, [], '页面不应有控制台错误');

  console.log(JSON.stringify({ results, consoleErrors }, null, 2));
  console.log('UI smoke test passed');
} finally {
  await browser.close();
}
