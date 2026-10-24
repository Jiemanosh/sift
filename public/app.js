const PLATFORMS = {
  bilibili: { label: 'B站', mark: 'B', className: 'bili' },
  zhihu: { label: '知乎', mark: '知', className: 'zhihu' },
};

const KINDS = {
  video: '视频',
  article: '文章',
  answer: '回答',
  post: '动态',
};

const PAGE_SIZE = 60;
const TZ = 'Asia/Shanghai';
const STATUS_INTERVAL = 15000;
const DEFAULT_RANGE_DAYS = 30;
const TO_TOP_OFFSET = 600;
const SAVED_VIEWS = new Set(['favorites', 'watchlater']);

function createSavedState(owner = null) {
  return {
    owner,
    favorites: {
      items: [],
      folders: [],
      folderId: null,
      page: 1,
      hasMore: false,
      total: 0,
      loaded: false,
      loading: false,
      error: '',
      errorCode: null,
      requestId: 0,
    },
    watchlater: {
      items: [],
      total: 0,
      truncated: false,
      loaded: false,
      loading: false,
      error: '',
      errorCode: null,
      requestId: 0,
    },
  };
}

const state = {
  items: [],
  creators: [],
  app: null,
  counts: { total: 0, unread: 0, starred: 0, today: 0, bilibili: 0, zhihu: 0 },
  accounts: { bilibili: { connected: false }, zhihu: { connected: false } },
  meta: {},
  sync: null,
  view: 'following',
  saved: createSavedState(),
  filters: {
    source: 'all',
    kind: 'all',
    creator: 'all',
    unread: false,
    starred: false,
    query: '',
    days: DEFAULT_RANGE_DAYS,
  },
  visibleCount: PAGE_SIZE,
  allCreatorsMemory: null,
  pendingAllCreatorsScroll: null,
  loading: true,
  loadError: '',
  loadedOnce: false,
  accountsReady: false,
  offline: false,
  retryTimer: null,
  zhihuBridgeHint: false,
  feedBusy: false,
  syncing: false,
  syncTimer: null,
  syncPollBusy: false,
  statusBusy: false,
  bannerDismissedAt: 0,
  markAllArmed: false,
  markAllTimer: null,
  modalCleanup: null,
  modalSession: 0,
  focusRefreshAt: 0,
  toastTimer: null,
  toastHideTimer: null,
};

const dom = {};

function isMobileShell() {
  return state.app?.localRequest === false;
}

function setRailOpen(open) {
  if (!dom.rail || !dom.filterToggle) return;
  dom.rail.classList.toggle('is-open', open);
  dom.filterToggle.setAttribute('aria-expanded', String(open));
  if (open || !state.pendingAllCreatorsScroll) return;
  const pending = state.pendingAllCreatorsScroll;
  state.pendingAllCreatorsScroll = null;
  if (pending.signature === filterSignature()) scrollToFeedPosition(pending.target);
}

function activeFilterCount() {
  const filters = state.filters;
  return [
    filters.source !== 'all',
    filters.kind !== 'all',
    filters.creator !== 'all',
    filters.days !== DEFAULT_RANGE_DAYS,
    filters.unread,
    filters.starred,
    Boolean(filters.query),
  ].filter(Boolean).length;
}

function renderFilterBadge() {
  if (!dom.filterToggle || !dom.filterCount) return;
  const count = activeFilterCount();
  dom.filterCount.hidden = count === 0;
  dom.filterCount.textContent = String(count);
  dom.filterToggle.classList.toggle('has-filters', count > 0);
  dom.filterToggle.setAttribute('aria-label', count ? `筛选，已启用 ${count} 项` : '筛选');
}

function requireDesktop() {
  if (!isMobileShell()) return true;
  toast('手机只读：账号登录和同步请在电脑上完成');
  return false;
}

function $(id) {
  return document.getElementById(id);
}

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const clockFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const fullDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const weekdayFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: TZ,
  weekday: 'short',
});

function dateKey(timestamp) {
  return dateKeyFormatter.format(new Date(timestamp));
}

function formatClock(timestamp) {
  return clockFormatter.format(new Date(timestamp));
}

function formatTimeAgo(timestamp) {
  const value = Number(timestamp) || 0;
  if (!value) return '';
  const diff = Math.max(0, Date.now() - value);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(value));
}

function shortDate(timestamp) {
  const stamp = Number(timestamp) || 0;
  if (!stamp) return '';
  const options = { timeZone: TZ, month: 'numeric', day: 'numeric' };
  if (dateKey(stamp).slice(0, 4) !== dateKey(Date.now()).slice(0, 4)) options.year = 'numeric';
  return new Intl.DateTimeFormat('zh-CN', options).format(new Date(stamp));
}

function dayTitle(timestamp) {
  const key = dateKey(timestamp);
  const now = Date.now();
  if (key === dateKey(now)) return '今天';
  if (key === dateKey(now - 86400000)) return '昨天';
  const date = new Date(timestamp);
  const nowShanghaiYear = dateKey(now).slice(0, 4);
  const options = { timeZone: TZ, month: 'long', day: 'numeric' };
  if (key.slice(0, 4) !== nowShanghaiYear) options.year = 'numeric';
  return new Intl.DateTimeFormat('zh-CN', options).format(date);
}

function dayRight(timestamp) {
  const key = dateKey(timestamp);
  const now = Date.now();
  const nowShanghaiYear = dateKey(now).slice(0, 4);
  const isRecent = key === dateKey(now) || key === dateKey(now - 86400000);
  if (isRecent) {
    return `${new Intl.DateTimeFormat('zh-CN', {
      timeZone: TZ,
      month: 'long',
      day: 'numeric',
    }).format(new Date(timestamp))} · ${weekdayFormatter.format(new Date(timestamp))}`;
  }
  if (key.slice(0, 4) !== nowShanghaiYear) {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: TZ,
      year: 'numeric',
      weekday: 'short',
    }).format(new Date(timestamp));
  }
  return weekdayFormatter.format(new Date(timestamp));
}

function formatCount(value) {
  const number = Number(value) || 0;
  if (number >= 100000000) {
    return `${trimZero((number / 100000000).toFixed(1))}亿`;
  }
  if (number >= 10000) {
    return `${trimZero((number / 10000).toFixed(1))}万`;
  }
  return number.toLocaleString('zh-CN');
}

function trimZero(text) {
  return text.replace(/\.0$/, '');
}

function formatRemain(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function externalUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    // invalid URL
  }
  return null;
}

function proxiedImage(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  const url = externalUrl(text);
  if (!url) return null;
  return `/api/img?u=${encodeURIComponent(url)}`;
}

async function api(path, { method = 'GET', body, keepalive = false } = {}) {
  const options = { method, keepalive, headers: {} };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    if (response.status === 401 && data?.code === 'NEED_MOBILE_AUTH') {
      window.SiftApp?.connectRequired?.();
    }
    const error = new Error(data?.error || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    error.code = data?.code || null;
    throw error;
  }
  return data || {};
}

function avatar(name, url, extraClass = '') {
  const node = h('span', `avatar${extraClass ? ` ${extraClass}` : ''}`);
  node.setAttribute('aria-hidden', 'true');
  node.append(h('span', 'avatar-initial', (name || '?').trim().slice(0, 1)));
  const imageUrl = proxiedImage(url);
  if (imageUrl) {
    const image = new Image();
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = imageUrl;
    image.addEventListener('load', () => image.classList.add('is-loaded'));
    image.addEventListener('error', () => image.remove());
    node.append(image);
  }
  return node;
}

function actionButton(label, className, onClick) {
  const button = h('button', `btn ${className}`.trim(), label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function isAnyConnected() {
  return Boolean(state.accounts.bilibili?.connected || state.accounts.zhihu?.connected);
}

function isSavedView() {
  return SAVED_VIEWS.has(state.view);
}

function currentSaved() {
  return state.saved[state.view];
}

function biliConnected() {
  return Boolean(state.accounts.bilibili?.connected);
}

function adoptAccounts(accounts) {
  state.accounts = accounts || state.accounts;
  state.accountsReady = true;
  const owner = biliConnected() ? String(state.accounts.bilibili?.mid || 'connected') : null;
  if (owner === state.saved.owner) return false;
  state.saved = createSavedState(owner);
  if (isSavedView()) {
    state.view = 'following';
    return true;
  }
  return false;
}

function cacheDom() {
  dom.todayLabel = $('today-label');
  dom.headlineStats = $('headline-stats');
  dom.syncBtn = $('sync-btn');
  dom.syncBtnLabel = $('sync-btn-label');
  dom.accountsBtn = $('accounts-btn');
  dom.filterToggle = $('filter-toggle');
  dom.filterCount = $('filter-count');
  dom.rail = $('rail');
  dom.railDone = $('rail-done');
  dom.railManageBtn = $('rail-manage-btn');
  dom.accountSummary = $('account-summary');
  dom.railFilters = $('rail-filters');
  dom.creatorsSection = document.querySelector('.creators-section');
  dom.sourceChips = $('source-chips');
  dom.kindChips = $('kind-chips');
  dom.filterUnread = $('filter-unread');
  dom.filterStarred = $('filter-starred');
  dom.countUnread = $('count-unread');
  dom.countStarred = $('count-starred');
  dom.creatorChips = $('creator-chips');
  dom.creatorTotal = $('creator-total');
  dom.resetFilters = $('reset-filters');
  dom.viewSwitch = $('view-switch');
  dom.rangePicker = $('range-picker');
  dom.rangeChips = $('range-chips');
  dom.searchInput = $('search-input');
  dom.searchClear = $('search-clear');
  dom.resultNote = $('result-note');
  dom.markAllBtn = $('mark-all-btn');
  dom.libraryBar = $('library-bar');
  dom.libraryTitle = $('library-title');
  dom.folderPicker = $('folder-picker');
  dom.folderSelect = $('folder-select');
  dom.libraryMeta = $('library-meta');
  dom.libraryRefresh = $('library-refresh');
  dom.statusBanner = $('status-banner');
  dom.bannerProgress = $('banner-progress');
  dom.bannerText = $('banner-text');
  dom.bannerDismiss = $('banner-dismiss');
  dom.feed = $('feed');
  dom.emptyState = $('empty-state');
  dom.feedEnd = $('feed-end');
  dom.modalRoot = $('modal-root');
  dom.modal = dom.modalRoot.querySelector('.modal');
  dom.modalKicker = $('modal-kicker');
  dom.modalTitle = $('modal-title');
  dom.modalBody = $('modal-body');
  dom.toTop = $('to-top');
  dom.toast = $('toast');
}

function bindEvents() {
  dom.syncBtn.addEventListener('click', triggerSync);
  dom.accountsBtn.addEventListener('click', openAccountsModal);
  dom.railManageBtn.addEventListener('click', openAccountsModal);
  dom.filterToggle.addEventListener('click', () => {
    setRailOpen(!dom.rail.classList.contains('is-open'));
  });
  dom.railDone.addEventListener('click', () => {
    setRailOpen(false);
    dom.filterToggle.focus({ preventScroll: true });
  });

  dom.viewSwitch.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-view]');
    if (!button) return;
    setView(button.dataset.view);
  });

  dom.rangeChips.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-days]');
    if (!button) return;
    const days = Number(button.dataset.days);
    state.filters.days = Number.isFinite(days) && days > 0 ? days : DEFAULT_RANGE_DAYS;
    state.visibleCount = PAGE_SIZE;
    renderFilterUI();
    renderFeedArea();
  });

  dom.sourceChips.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    const value = button.dataset.value;
    const next = state.filters.source === value && value !== 'all' ? 'all' : value;
    const wasAllCreators = state.filters.creator === 'all';
    state.filters.source = next;
    if (next === 'all') {
      state.filters.creator = 'all';
    } else if (state.filters.creator !== 'all') {
      const creator = state.creators.find(
        (entry) => `${entry.platform}:${entry.authorId}` === state.filters.creator,
      );
      if (creator && creator.platform !== next) {
        state.filters.creator = 'all';
      }
    }
    let restore = null;
    if (!wasAllCreators && state.filters.creator === 'all') {
      restore = beginAllCreatorsReturn();
    } else {
      state.visibleCount = PAGE_SIZE;
    }
    renderFilterUI();
    renderCreators();
    renderFeedArea();
    applyAllCreatorsScroll(restore);
  });

  dom.kindChips.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    const value = button.dataset.value;
    state.filters.kind = state.filters.kind === value && value !== 'all' ? 'all' : value;
    state.visibleCount = PAGE_SIZE;
    renderFilterUI();
    renderFeedArea();
  });

  dom.filterUnread.addEventListener('change', () => {
    state.filters.unread = dom.filterUnread.checked;
    state.visibleCount = PAGE_SIZE;
    renderFilterUI();
    renderFeedArea();
  });

  dom.filterStarred.addEventListener('change', () => {
    state.filters.starred = dom.filterStarred.checked;
    state.visibleCount = PAGE_SIZE;
    renderFilterUI();
    renderFeedArea();
  });

  dom.resetFilters.addEventListener('click', resetFilters);

  dom.searchInput.addEventListener('input', debounce(() => {
    state.filters.query = dom.searchInput.value.trim();
    state.visibleCount = PAGE_SIZE;
    dom.searchClear.hidden = !dom.searchInput.value;
    renderFilterUI();
    renderFeedArea();
  }, 180));

  dom.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      dom.searchInput.value = '';
      dom.searchClear.hidden = true;
      state.filters.query = '';
      state.visibleCount = PAGE_SIZE;
      renderFilterUI();
      renderFeedArea();
      dom.searchInput.blur();
    }
  });

  dom.searchClear.addEventListener('click', () => {
    dom.searchInput.value = '';
    dom.searchClear.hidden = true;
    state.filters.query = '';
    state.visibleCount = PAGE_SIZE;
    renderFilterUI();
    renderFeedArea();
    dom.searchInput.focus();
  });

  dom.markAllBtn.addEventListener('click', handleMarkAllClick);
  dom.bannerDismiss.addEventListener('click', () => {
    state.bannerDismissedAt = state.sync?.finishedAt || Date.now();
    dom.statusBanner.hidden = true;
  });

  dom.feedEnd.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="load-more"]');
    if (!button) return;
    if (isSavedView()) {
      const saved = currentSaved();
      if (state.view === 'favorites') {
        if (saved.hasMore && !saved.loading) {
          loadFavorites({ folderId: saved.folderId, page: saved.page + 1, append: true });
        }
        return;
      }
      state.visibleCount += PAGE_SIZE;
      renderSavedFeedArea();
      return;
    }
    state.visibleCount += PAGE_SIZE;
    renderFeedArea();
  });

  dom.folderSelect.addEventListener('change', () => {
    loadFavorites({ folderId: dom.folderSelect.value, page: 1 });
  });

  dom.libraryRefresh.addEventListener('click', () => {
    refreshSavedView();
  });

  dom.modalRoot.addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close]')) closeModal();
  });

  document.addEventListener('keydown', handleKeydown);
  dom.toTop.addEventListener('click', scrollToTop);
  window.addEventListener('scroll', updateToTopVisibility, { passive: true });
  window.addEventListener('resize', updateToTopVisibility);
  window.addEventListener('focus', maybeRefresh);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) maybeRefresh();
  });
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function handleKeydown(event) {
  if (event.key === 'Escape' && !dom.modalRoot.hidden) {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key === 'Tab' && !dom.modalRoot.hidden) {
    trapFocus(event);
    return;
  }
  const target = event.target;
  const typing = target && (
    target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.isContentEditable
  );
  if (!typing && event.key === '/') {
    event.preventDefault();
    dom.searchInput.focus();
    dom.searchInput.select();
  }
  if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    dom.searchInput.focus();
    dom.searchInput.select();
  }
}

function trapFocus(event) {
  const focusable = [...dom.modal.querySelectorAll(
    'a[href], button:not([disabled]), textarea, input, summary, [tabindex]:not([tabindex="-1"])',
  )].filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function maybeRefresh() {
  if (document.hidden) return;
  if (Date.now() - state.focusRefreshAt < 3000) return;
  state.focusRefreshAt = Date.now();
  loadFeed({ silent: true });
}

// ---------- Data loading ----------

async function loadFeed({ silent = false, quiet = false } = {}) {
  if (state.feedBusy) return;
  state.feedBusy = true;
  const previousTotal = Number(state.counts.total) || 0;
  const wasLoaded = state.loadedOnce;

  if (!silent) {
    state.loading = !wasLoaded;
    renderFilterUI();
    if (!wasLoaded) {
      state.loadError = '';
      dom.emptyState.hidden = true;
      dom.feed.hidden = false;
      dom.feedEnd.hidden = true;
      renderSkeletons();
    }
  }

  try {
    const data = await api('/api/feed?limit=1000');
    state.items = Array.isArray(data.items) ? data.items : [];
    state.creators = Array.isArray(data.creators) ? data.creators : [];
    state.counts = data.counts || state.counts;
    state.app = data.app || state.app;
    adoptAccounts(data.accounts);
    state.meta = data.meta || {};
    state.sync = data.sync || state.sync;
    state.loading = false;
    state.loadError = '';
    state.loadedOnce = true;
    state.offline = false;
    clearFeedRetry();
    renderAll();

    if (silent && wasLoaded && !quiet) {
      const added = Number(state.counts.total) - previousTotal;
      if (added > 0) toast(`收到 ${added} 条新更新`);
    }
    if (state.sync?.running && !state.syncTimer) startSyncWatch();
  } catch (error) {
    if (wasLoaded) {
      if (!quiet) toast(`刷新失败：${error.message}`, 'error');
    } else {
      state.loading = false;
      state.loadError = error.message;
      state.offline = true;
      renderHeader();
      renderAccounts();
      renderFeedArea();
      renderFilterUI();
      scheduleFeedRetry();
      if (!silent) toast(`读取失败：${error.message}`, 'error');
    }
  } finally {
    state.feedBusy = false;
  }
}

function scheduleFeedRetry() {
  if (state.retryTimer || state.loadedOnce) return;
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    if (!state.loadedOnce) loadFeed({ silent: true, quiet: true });
  }, 5000);
}

function clearFeedRetry() {
  if (!state.retryTimer) return;
  clearTimeout(state.retryTimer);
  state.retryTimer = null;
}

async function pollStatus() {
  if (document.hidden || state.statusBusy) return;
  state.statusBusy = true;
  try {
    const status = await api('/api/status');
    const previousFeedVersion = state.meta?.feedVersion;
    const previousStateVersion = state.meta?.stateVersion;
    state.offline = false;
    applyStatus(status);
    if (!state.loadedOnce && !state.feedBusy) {
      await loadFeed({ silent: true, quiet: true });
      return;
    }
    const changed = status.meta?.feedVersion !== previousFeedVersion
      || status.meta?.stateVersion !== previousStateVersion;
    if (changed && state.loadedOnce) {
      await loadFeed({ silent: true, quiet: true });
    }
    if (status.sync?.running && !state.syncTimer) startSyncWatch();
  } catch {
    if (!state.loadedOnce) {
      state.offline = true;
      renderHeader();
      renderAccounts();
      scheduleFeedRetry();
    }
  } finally {
    state.statusBusy = false;
  }
}

function applyStatus(status) {
  if (!status) return;
  const viewReset = adoptAccounts(status.accounts);
  state.app = status.app || state.app;
  state.counts = status.counts || state.counts;
  state.meta = status.meta || state.meta;
  state.sync = status.sync || state.sync;
  renderHeader();
  renderAccounts();
  renderCounts();
  renderFilterUI();
  renderViewChrome();
  renderSync();
  renderSyncButton();
  if (viewReset) renderFeedArea();
}

async function refreshStatus() {
  if (state.statusBusy) return null;
  state.statusBusy = true;
  try {
    const status = await api('/api/status');
    applyStatus(status);
    return status;
  } catch {
    return null;
  } finally {
    state.statusBusy = false;
  }
}

// ---------- Rendering ----------

function renderAll() {
  renderHeader();
  renderAccounts();
  renderCounts();
  renderFilterUI();
  renderCreators();
  renderViewChrome();
  renderSync();
  renderSyncButton();
  renderFeedArea();
}

function renderHeader() {
  dom.todayLabel.textContent = `${fullDateFormatter.format(new Date())} · ${weekdayFormatter.format(new Date())}`;
  const counts = state.counts;
  if (!state.accountsReady) {
    dom.headlineStats.textContent = state.offline ? '本机服务未响应' : '正在连接…';
    return;
  }
  if (!isAnyConnected()) {
    dom.headlineStats.textContent = '等待连接来源';
    return;
  }
  if (!counts.total) {
    dom.headlineStats.textContent = '还没有收录更新';
    return;
  }
  dom.headlineStats.textContent = `今日 ${counts.today} 条更新 · 未读 ${counts.unread} 条`;
}

function accountLine(platform) {
  const account = state.accounts[platform] || { connected: false };
  const meta = PLATFORMS[platform];
  const button = h('button', 'account-line');
  button.type = 'button';
  const accountLabel = !state.accountsReady
    ? (state.offline ? '本机服务未响应' : '正在读取')
    : (account.connected ? account.name || meta.label : '未连接');
  button.setAttribute('aria-label', `${meta.label}账号：${accountLabel}，打开账号管理`);

  if (account.connected && (account.face || account.avatar)) {
    button.append(avatar(account.name, account.face || account.avatar));
  } else {
    button.append(h('span', `platform-mark ${meta.className}`, meta.mark));
  }

  const copy = h('div', 'account-copy');
  copy.append(h(
    'span',
    'account-name',
    account.connected ? account.name || meta.label : (platform === 'bilibili' ? '哔哩哔哩' : '知乎'),
  ));

  const status = h('span', 'account-status');
  let text = '未连接';
  let warn = false;
  if (!state.accountsReady) {
    text = state.offline ? '本机服务未响应' : '正在读取账号…';
    warn = state.offline;
  } else if (account.connected) {
    if (platform === 'bilibili') {
      if (account.needsReauth) {
        text = '登录已失效，点击重连';
        warn = true;
      } else {
        text = account.lastSyncAt
          ? `已连接 · ${formatTimeAgo(account.lastSyncAt)}同步`
          : '已连接 · 等待首次同步';
      }
    } else if (account.needsBridge) {
      text = '直连受限，建议改用书签';
      warn = true;
    } else {
      const mode = account.mode === 'cookie' ? 'Cookie' : '书签';
      text = account.lastSyncAt
        ? `${mode}同步 · ${formatTimeAgo(account.lastSyncAt)}`
        : `${mode}已连接 · 尚未同步`;
    }
  }
  if (warn) status.classList.add('is-warn');
  status.textContent = text;
  copy.append(status);
  button.append(copy);

  const dot = h('span', 'status-dot');
  if (account.connected) dot.classList.add(warn ? 'is-warn' : 'is-online');
  button.append(dot);
  button.addEventListener('click', openAccountsModal);
  return button;
}

function renderAccounts() {
  dom.accountSummary.replaceChildren(accountLine('bilibili'), accountLine('zhihu'));
}

function renderCounts() {
  const counts = state.counts;
  dom.sourceChips.querySelectorAll('[data-count]').forEach((node) => {
    node.textContent = node.dataset.count === 'all' ? counts.total ?? 0 : counts[node.dataset.count] ?? 0;
  });
  dom.countUnread.textContent = counts.unread ?? 0;
  dom.countStarred.textContent = counts.starred ?? 0;
}

function renderFilterUI() {
  dom.sourceChips.querySelectorAll('button[data-value]').forEach((button) => {
    const active = button.dataset.value === state.filters.source;
    button.classList.toggle('is-on', active);
    button.setAttribute('aria-pressed', String(active));
  });
  dom.kindChips.querySelectorAll('button[data-value]').forEach((button) => {
    const active = button.dataset.value === state.filters.kind;
    button.classList.toggle('is-on', active);
    button.setAttribute('aria-pressed', String(active));
  });
  dom.rangeChips.querySelectorAll('button[data-days]').forEach((button) => {
    const active = Number(button.dataset.days) === state.filters.days;
    button.classList.toggle('is-on', active);
    button.setAttribute('aria-pressed', String(active));
  });
  dom.filterUnread.checked = state.filters.unread;
  dom.filterStarred.checked = state.filters.starred;
  dom.searchClear.hidden = !dom.searchInput.value;
  renderFilterBadge();
  dom.resetFilters.hidden = isDefaultFilters();
  renderMarkAllState();
}

function isDefaultFilters() {
  const filters = state.filters;
  return filters.source === 'all'
    && filters.kind === 'all'
    && filters.creator === 'all'
    && !filters.unread
    && !filters.starred
    && !filters.query
    && filters.days === DEFAULT_RANGE_DAYS;
}

function renderMarkAllState() {
  const visibleUnread = getFilteredItems().filter((item) => !item.read).length;
  dom.markAllBtn.disabled = Boolean(state.loading) || visibleUnread === 0;
  if (!state.markAllArmed) dom.markAllBtn.textContent = '全部标为已读';
}

function filterSignature() {
  const { source, kind, unread, starred, query, days } = state.filters;
  return [source, kind, unread, starred, query, days].join('|');
}

function isRailExpanded() {
  return window.matchMedia('(max-width: 900px)').matches
    && Boolean(dom.rail?.classList.contains('is-open'));
}

function rememberAllCreatorsPosition() {
  if (state.view !== 'following' || state.filters.creator !== 'all') return;
  if (isRailExpanded()) return;
  state.allCreatorsMemory = {
    signature: filterSignature(),
    scrollY: window.scrollY,
    visibleCount: Math.max(PAGE_SIZE, state.visibleCount),
  };
}

function beginAllCreatorsReturn() {
  const memory = state.allCreatorsMemory;
  if (!memory || memory.signature !== filterSignature()) {
    state.visibleCount = PAGE_SIZE;
    return null;
  }
  state.visibleCount = Math.max(PAGE_SIZE, memory.visibleCount);
  return memory.scrollY;
}

function scrollToFeedPosition(target) {
  const root = document.documentElement;
  const previous = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  window.scrollTo(0, target);
  root.style.scrollBehavior = previous;
}

function applyAllCreatorsScroll(target) {
  if (target === null) return;
  if (isRailExpanded()) {
    state.pendingAllCreatorsScroll = { target, signature: filterSignature() };
    return;
  }
  scrollToFeedPosition(target);
}

function updateToTopVisibility() {
  dom.toTop.classList.toggle('is-visible', window.scrollY > TO_TOP_OFFSET);
}

function scrollToTop() {
  state.pendingAllCreatorsScroll = null;
  window.scrollTo({ top: 0 });
  updateToTopVisibility();
}

function renderCreators() {
  const list = state.creators.filter(
    (creator) => state.filters.source === 'all' || creator.platform === state.filters.source,
  );
  dom.creatorChips.replaceChildren();
  dom.creatorTotal.textContent = list.length ? `${list.length} 位` : '';

  if (!list.length) {
    dom.creatorChips.append(h('p', 'creator-empty', '暂无可筛选的博主'));
    return;
  }

  const allActive = state.filters.creator === 'all';
  const allButton = h('button', `creator-chip creator-all${allActive ? ' is-on' : ''}`);
  allButton.type = 'button';
  allButton.setAttribute('aria-pressed', String(allActive));
  allButton.title = '显示全部博主的更新';
  allButton.append(avatar('全', null));
  allButton.append(h('span', 'creator-name', '全部博主'));
  const total = list.reduce((sum, creator) => sum + (Number(creator.count) || 0), 0);
  allButton.append(h('span', 'creator-count', String(total)));
  allButton.addEventListener('click', () => {
    if (state.filters.creator === 'all') return;
    state.filters.creator = 'all';
    const restore = beginAllCreatorsReturn();
    renderFilterUI();
    renderCreators();
    renderFeedArea();
    applyAllCreatorsScroll(restore);
  });
  dom.creatorChips.append(allButton);

  for (const creator of list) {
    const id = `${creator.platform}:${creator.authorId}`;
    const active = state.filters.creator === id;
    const button = h('button', `creator-chip${active ? ' is-on' : ''}`);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(active));
    button.title = `${creator.name}：共 ${creator.count} 条${creator.unread ? `，${creator.unread} 条未读` : ''}`;
    button.append(avatar(creator.name, creator.avatar));
    button.append(h('span', 'creator-name', creator.name));
    const count = h(
      'span',
      `creator-count${creator.unread ? ' has-unread' : ''}`,
      String(creator.count || 0),
    );
    button.append(count);
    button.addEventListener('click', () => {
      const next = active ? 'all' : id;
      if (state.filters.creator === next) return;
      if (state.filters.creator === 'all') rememberAllCreatorsPosition();
      state.filters.creator = next;
      const restore = next === 'all' ? beginAllCreatorsReturn() : null;
      if (next !== 'all') state.visibleCount = PAGE_SIZE;
      renderFilterUI();
      renderCreators();
      renderFeedArea();
      applyAllCreatorsScroll(restore);
    });
    dom.creatorChips.append(button);
  }
}

function getFilteredItems() {
  const { source, kind, creator, unread, starred, query, days } = state.filters;
  const cutoff = Date.now() - (Number(days) || DEFAULT_RANGE_DAYS) * 86400000;
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return state.items.filter((item) => {
    if (Number(item.createdAt) < cutoff) return false;
    if (source !== 'all' && item.platform !== source) return false;
    if (kind !== 'all' && item.kind !== kind) return false;
    if (creator !== 'all' && `${item.platform}:${item.author?.id || ''}` !== creator) return false;
    if (unread && item.read) return false;
    if (starred && !item.starred) return false;
    if (tokens.length) {
      const haystack = `${item.title || ''} ${item.excerpt || ''} ${item.author?.name || ''} ${item.via || ''}`.toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return false;
    }
    return true;
  });
}

function renderFeedArea() {
  if (isSavedView()) {
    renderSavedFeedArea();
    return;
  }

  dom.emptyState.hidden = true;
  dom.feed.hidden = false;
  dom.feedEnd.hidden = true;

  if (state.loading && !state.loadError) {
    dom.resultNote.textContent = '正在读取…';
    return;
  }

  if (state.loadError && !state.loadedOnce) {
    dom.feed.replaceChildren();
    dom.resultNote.textContent = '读取失败';
    renderEmpty('error');
    return;
  }

  const filtered = getFilteredItems();

  if (!state.items.length) {
    dom.feed.replaceChildren();
    dom.resultNote.textContent = '0 条';
    renderEmpty(isAnyConnected() ? 'empty' : 'onboarding');
    return;
  }

  if (!filtered.length) {
    dom.feed.replaceChildren();
    dom.resultNote.textContent = '0 条';
    const hasZhihuItems = state.items.some((item) => item.platform === 'zhihu');
    if (state.filters.source === 'zhihu' && !hasZhihuItems) {
      renderEmpty(state.accounts.zhihu?.connected ? 'zhihu-empty' : 'zhihu-off');
      return;
    }
    renderEmpty('filtered');
    return;
  }

  const visibleCount = Math.min(filtered.length, Math.max(PAGE_SIZE, state.visibleCount));
  const visible = filtered.slice(0, visibleCount);
  dom.resultNote.textContent = filtered.length > visible.length
    ? `显示 ${visible.length} / ${filtered.length} 条`
    : `${filtered.length} 条更新`;

  const groups = new Map();
  for (const item of visible) {
    const key = dateKey(item.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const fragment = document.createDocumentFragment();
  for (const items of groups.values()) {
    fragment.append(buildDayGroup(items));
  }
  dom.feed.replaceChildren(fragment);

  dom.feedEnd.hidden = false;
  if (filtered.length > visible.length) {
    dom.feedEnd.replaceChildren(h('span', null, `已显示 ${visible.length} / ${filtered.length} 条`));
    const more = h('button', 'load-more', '再显示一些');
    more.type = 'button';
    more.dataset.action = 'load-more';
    dom.feedEnd.append(more);
  } else {
    dom.feedEnd.replaceChildren(h('span', null, `已经到底了 · 共 ${filtered.length} 条`));
  }
}

// ---------- View switch and saved library ----------

function renderViewChrome() {
  if (isSavedView() && !biliConnected()) state.view = 'following';
  const saved = isSavedView();
  dom.viewSwitch.hidden = !biliConnected();
  dom.viewSwitch.querySelectorAll('button[data-view]').forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('is-on', active);
    button.setAttribute('aria-pressed', String(active));
  });
  dom.railFilters.hidden = saved;
  dom.creatorsSection.hidden = saved;
  dom.rangePicker.hidden = saved;
  dom.markAllBtn.hidden = saved;
  dom.libraryBar.hidden = !saved;
  dom.folderPicker.hidden = state.view !== 'favorites';
  dom.libraryTitle.hidden = state.view !== 'watchlater';
  dom.searchInput.placeholder = saved
    ? (state.view === 'favorites' ? '搜索已加载的收藏（按 /）' : '搜索已加载的稍后再看（按 /）')
    : '搜索标题、摘要、博主（按 /）';
  if (saved) renderLibraryChrome();
}

function renderLibraryChrome() {
  const saved = currentSaved();
  dom.libraryRefresh.disabled = Boolean(saved.loading);
  dom.libraryRefresh.textContent = saved.loading ? '读取中…' : '刷新列表';
  if (state.view === 'favorites') {
    renderFolderOptions(saved);
    const folder = saved.folders.find((entry) => entry.id === saved.folderId);
    if (saved.loading && !saved.items.length) {
      dom.libraryMeta.textContent = '正在读取收藏夹…';
    } else if (!saved.loaded && saved.error) {
      dom.libraryMeta.textContent = '读取失败';
    } else if (!saved.folders.length) {
      dom.libraryMeta.textContent = '没有收藏夹';
    } else {
      const name = folder?.title ? `「${folder.title}」` : '';
      dom.libraryMeta.textContent = `${name}已加载 ${saved.items.length} / ${saved.total} 个视频`;
    }
    return;
  }

  if (saved.loading && !saved.items.length) {
    dom.libraryMeta.textContent = '正在读取稍后再看…';
  } else if (!saved.loaded && saved.error) {
    dom.libraryMeta.textContent = '读取失败';
  } else {
    const truncated = saved.truncated ? ` · 仅显示前 ${saved.items.length} 个` : '';
    dom.libraryMeta.textContent = `共 ${saved.total || saved.items.length} 个视频${truncated}`;
  }
}

function renderFolderOptions(saved) {
  const signature = saved.folders.map((folder) => `${folder.id}|${folder.title}|${folder.count}`).join('~');
  if (dom.folderSelect.dataset.signature !== signature) {
    dom.folderSelect.replaceChildren();
    if (!saved.folders.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = saved.loaded ? '没有可用的收藏夹' : '正在读取…';
      dom.folderSelect.append(option);
    } else {
      for (const folder of saved.folders) {
        const option = document.createElement('option');
        option.value = String(folder.id);
        option.textContent = `${folder.title}（${folder.count}）`;
        dom.folderSelect.append(option);
      }
    }
    dom.folderSelect.dataset.signature = signature;
  }
  dom.folderSelect.disabled = !saved.folders.length;
  if (saved.folders.length) {
    dom.folderSelect.value = String(saved.folderId || saved.folders[0].id);
  }
}

function setView(view) {
  if (!['following', 'favorites', 'watchlater'].includes(view)) return;
  if (view === state.view) return;
  if (SAVED_VIEWS.has(view) && !biliConnected()) {
    openAccountsModal();
    return;
  }
  state.view = view;
  state.visibleCount = PAGE_SIZE;
  clearTimeout(state.markAllTimer);
  state.markAllArmed = false;
  state.filters.query = '';
  dom.searchInput.value = '';
  dom.searchClear.hidden = true;
  renderViewChrome();
  renderFilterUI();
  if (isSavedView()) {
    loadSavedView();
    return;
  }
  renderCreators();
  renderFeedArea();
}

function loadSavedView() {
  const saved = currentSaved();
  if (saved.loaded && !saved.loading) {
    renderLibraryChrome();
    renderSavedFeedArea();
    return;
  }
  if (state.view === 'favorites') loadFavorites({ page: 1 });
  else loadWatchLater();
}

function refreshSavedView() {
  if (!isSavedView()) return;
  const saved = currentSaved();
  if (saved.loading) return;
  if (state.view === 'favorites') loadFavorites({ folderId: saved.folderId, page: 1 });
  else loadWatchLater();
}

async function loadFavorites({ folderId = null, page = 1, append = false } = {}) {
  const saved = state.saved.favorites;
  if (append && saved.loading) return;
  const targetFolder = folderId ? String(folderId) : saved.folderId;
  const requestId = ++saved.requestId;

  if (!append && targetFolder && String(saved.folderId || '') !== targetFolder) {
    saved.folderId = targetFolder;
    saved.items = [];
    saved.total = 0;
    saved.hasMore = false;
    saved.page = 1;
  }

  saved.loading = true;
  saved.error = '';
  saved.errorCode = null;
  if (state.view === 'favorites') {
    renderLibraryChrome();
    renderSavedFeedArea();
  }

  const params = new URLSearchParams({ page: String(page) });
  if (targetFolder) params.set('folder', targetFolder);

  try {
    const data = await api(`/api/bili/favorites?${params.toString()}`);
    if (requestId !== saved.requestId) return;
    saved.folders = Array.isArray(data.folders) ? data.folders : [];
    if (data.folder?.id !== undefined && data.folder?.id !== null) {
      saved.folderId = String(data.folder.id);
    }
    saved.page = Number(data.page) || page;
    saved.total = Number(data.total) || 0;
    saved.hasMore = Boolean(data.hasMore);
    const incoming = Array.isArray(data.items) ? data.items : [];
    if (append) {
      const seen = new Set(saved.items.map((item) => item.id));
      for (const item of incoming) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        saved.items.push(item);
      }
    } else {
      saved.items = incoming;
    }
    saved.loaded = true;
  } catch (error) {
    if (requestId !== saved.requestId) return;
    saved.error = error.message || '读取收藏夹失败';
    saved.errorCode = error.code || null;
    if (append) toast(`加载更多失败：${saved.error}`, 'error');
    else if (saved.items.length) toast(`刷新收藏夹失败：${saved.error}`, 'error');
  } finally {
    if (requestId === saved.requestId) {
      saved.loading = false;
      if (state.view === 'favorites') {
        renderLibraryChrome();
        renderSavedFeedArea();
      }
    }
  }
}

async function loadWatchLater() {
  const saved = state.saved.watchlater;
  if (saved.loading) return;
  const requestId = ++saved.requestId;
  saved.loading = true;
  saved.error = '';
  saved.errorCode = null;
  if (state.view === 'watchlater') {
    renderLibraryChrome();
    renderSavedFeedArea();
  }
  try {
    const data = await api('/api/bili/watchlater');
    if (requestId !== saved.requestId) return;
    saved.items = Array.isArray(data.items) ? data.items : [];
    saved.total = Number(data.total) || saved.items.length;
    saved.truncated = Boolean(data.truncated);
    saved.loaded = true;
  } catch (error) {
    if (requestId !== saved.requestId) return;
    saved.error = error.message || '读取稍后再看失败';
    saved.errorCode = error.code || null;
    if (saved.items.length) toast(`刷新稍后再看失败：${saved.error}`, 'error');
  } finally {
    if (requestId === saved.requestId) {
      saved.loading = false;
      if (state.view === 'watchlater') {
        renderLibraryChrome();
        renderSavedFeedArea();
      }
    }
  }
}

function savedDateLabel(item) {
  const savedAt = Number(item.savedAt) || 0;
  const publishedAt = Number(item.publishedAt || item.createdAt) || 0;
  const stamp = savedAt || publishedAt;
  if (!stamp) return item.via || '';
  if (savedAt) return `${state.view === 'watchlater' ? '加入于' : '收藏于'} ${shortDate(stamp)}`;
  return `发布于 ${shortDate(stamp)}`;
}

function getSavedFilteredItems() {
  const saved = currentSaved();
  const tokens = state.filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return saved.items;
  return saved.items.filter((item) => {
    const haystack = `${item.title || ''} ${item.excerpt || ''} ${item.author?.name || ''} ${item.folder || ''}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

function renderSavedFeedArea() {
  const saved = currentSaved();
  dom.emptyState.hidden = true;
  dom.feed.hidden = false;
  dom.feedEnd.hidden = true;

  if (saved.loading && !saved.items.length) {
    dom.resultNote.textContent = '正在读取…';
    renderSkeletons();
    return;
  }

  if (!saved.items.length && saved.error) {
    dom.feed.replaceChildren();
    dom.resultNote.textContent = '读取失败';
    renderSavedEmpty('error');
    return;
  }

  if (!saved.items.length) {
    dom.feed.replaceChildren();
    dom.resultNote.textContent = '0 条';
    renderSavedEmpty('empty');
    return;
  }

  const filtered = getSavedFilteredItems();
  if (!filtered.length) {
    dom.feed.replaceChildren();
    dom.resultNote.textContent = '0 条';
    renderSavedEmpty('filtered');
    return;
  }

  const hasQuery = Boolean(state.filters.query.trim());
  dom.resultNote.textContent = hasQuery
    ? `匹配 ${filtered.length} / 已加载 ${saved.items.length} 个`
    : (state.view === 'favorites'
      ? `已加载 ${saved.items.length} / ${saved.total} 个视频`
      : `${saved.items.length} 个视频`);

  const list = h('div', 'saved-list');
  const visible = state.view === 'watchlater'
    ? filtered.slice(0, Math.max(PAGE_SIZE, state.visibleCount))
    : filtered;
  for (const item of visible) list.append(buildCard(item, { saved: true }));
  dom.feed.replaceChildren(list);

  dom.feedEnd.hidden = false;
  if (state.view === 'watchlater' && filtered.length > visible.length) {
    dom.feedEnd.replaceChildren(h('span', null, `已显示 ${visible.length} / ${filtered.length} 个`));
    const more = h('button', 'load-more', '再显示一些');
    more.type = 'button';
    more.dataset.action = 'load-more';
    dom.feedEnd.append(more);
    return;
  }
  if (state.view === 'favorites' && saved.hasMore) {
    dom.feedEnd.replaceChildren(h('span', null, `已加载 ${saved.items.length} / ${saved.total} 个`));
    const more = h('button', 'load-more', saved.loading ? '正在加载…' : '加载更多');
    more.type = 'button';
    more.dataset.action = 'load-more';
    more.disabled = saved.loading;
    dom.feedEnd.append(more);
    return;
  }
  if (saved.truncated) {
    dom.feedEnd.replaceChildren(h('span', null, `仅显示前 ${saved.items.length} 个 · 共 ${saved.total} 个`));
    return;
  }
  dom.feedEnd.replaceChildren(h('span', null, `已经到底了 · 共 ${saved.items.length} 个视频`));
}

function renderSavedEmpty(kind) {
  dom.feed.hidden = true;
  dom.feedEnd.hidden = true;
  dom.emptyState.hidden = false;
  const saved = currentSaved();
  const favorites = state.view === 'favorites';

  if (kind === 'error') {
    const box = h('div', 'empty-card');
    if (saved.errorCode === 'NEED_LOGIN') {
      box.append(h('p', 'onboard-kicker', '登录失效'));
      box.append(h('h2', null, 'B站 登录已失效'));
      box.append(h('p', null, '重新扫码连接后，才能读取收藏夹和稍后再看。'));
      const actions = h('div', 'empty-actions');
      actions.append(actionButton('重新连接 B站', 'btn-primary', openBiliQrModal));
      box.append(actions);
    } else {
      box.append(h('p', 'onboard-kicker', '读取失败'));
      box.append(h('h2', null, favorites ? '没能读取收藏夹' : '没能读取稍后再看'));
      box.append(h('p', null, saved.error || '请稍后再试。'));
      const actions = h('div', 'empty-actions');
      actions.append(actionButton('重试', 'btn-primary', refreshSavedView));
      box.append(actions);
    }
    dom.emptyState.replaceChildren(box);
    return;
  }

  if (kind === 'filtered') {
    const box = h('div', 'empty-card');
    box.append(h('h2', null, `没有找到「${state.filters.query}」`));
    box.append(h('p', null, '搜索只覆盖已经加载的内容，可以清空关键词后继续加载更多。'));
    const actions = h('div', 'empty-actions');
    actions.append(actionButton('清空搜索', 'btn-primary', () => {
      dom.searchInput.value = '';
      dom.searchClear.hidden = true;
      state.filters.query = '';
      renderFilterUI();
      renderSavedFeedArea();
    }));
    box.append(actions);
    dom.emptyState.replaceChildren(box);
    return;
  }

  const box = h('div', 'empty-card');
  const noFolders = favorites && !saved.folders.length;
  box.append(h('p', 'onboard-kicker', favorites ? '收藏夹' : '稍后再看'));
  box.append(h('h2', null, noFolders ? '还没有收藏夹' : (favorites ? '这个收藏夹还是空的' : '稍后再看是空的')));
  box.append(h(
    'p',
    null,
    noFolders
      ? '先在 B站 创建一个收藏夹并收藏视频，再回来点「刷新列表」。'
      : (favorites
        ? '在 B站 收藏一些视频后，点「刷新列表」就能在这里看到。'
        : '在 B站 把视频加入稍后再看后，点「刷新列表」就能在这里看到。'),
  ));
  const actions = h('div', 'empty-actions');
  actions.append(actionButton('刷新列表', 'btn-primary', refreshSavedView));
  box.append(actions);
  dom.emptyState.replaceChildren(box);
}

function buildDayGroup(items) {
  const group = h('section', 'day-group');
  const first = items[0];
  const head = h('div', 'day-head');
  head.append(h('span', 'day-title', dayTitle(first.createdAt)));
  head.append(h('span', 'day-date', dayRight(first.createdAt)));
  head.append(h('span', 'day-rule'));
  head.append(h('span', 'day-count', `${items.length} 条`));
  group.append(head);
  for (const item of items) group.append(buildCard(item));
  return group;
}

function buildCard(item, { saved = false } = {}) {
  const card = h(
    'article',
    saved
      ? 'card is-saved'
      : `card${item.read ? ' is-read' : ' is-unread'}${item.starred ? ' is-starred' : ''}`,
  );
  card.dataset.id = item.id;

  const body = h('div', 'item-body');
  const kicker = h('div', 'item-kicker');
  const platform = PLATFORMS[item.platform] || { label: item.platform || '来源', className: 'unknown' };
  kicker.append(h('span', `platform-badge ${platform.className}`, platform.label));
  kicker.append(h('span', 'kind-label', KINDS[item.kind] || '更新'));
  if (item.author?.name) {
    kicker.append(h('span', 'kicker-sep', '/'));
    if (saved) {
      const creator = h('span', 'creator-link is-static');
      creator.append(avatar(item.author.name, item.author.avatar, 'avatar-xs'));
      creator.append(h('span', 'creator-label', item.author.name));
      kicker.append(creator);
    } else {
      const creator = h('button', 'creator-link');
      creator.type = 'button';
      creator.title = `只看 ${item.author.name}`;
      creator.append(avatar(item.author.name, item.author.avatar, 'avatar-xs'));
      creator.append(h('span', 'creator-label', item.author.name));
      creator.addEventListener('click', () => {
        if (!item.author?.id) return;
        if (state.filters.creator === 'all') rememberAllCreatorsPosition();
        state.filters.creator = `${item.platform}:${item.author.id}`;
        state.visibleCount = PAGE_SIZE;
        renderFilterUI();
        renderCreators();
        renderFeedArea();
      });
      kicker.append(creator);
    }
  }
  kicker.append(h('span', 'item-time', saved ? savedDateLabel(item) : formatClock(item.createdAt)));
  if (!saved && !item.read) kicker.append(h('span', 'unread-mark'));
  body.append(kicker);

  const url = externalUrl(item.url);
  const title = h('a', 'item-title', item.title || '无标题');
  if (url) {
    title.href = url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    if (!saved) title.addEventListener('click', () => markReadOnOpen(item));
  }
  body.append(title);

  if (item.excerpt) {
    body.append(h('p', 'item-excerpt', item.excerpt));
  }

  const foot = h('div', 'item-foot');
  if (item.stats?.views) foot.append(statNode('播放', formatCount(item.stats.views)));
  if (item.stats?.likes) foot.append(statNode('赞', formatCount(item.stats.likes)));
  if (item.stats?.comments) foot.append(statNode('评论', formatCount(item.stats.comments)));
  if (item.duration) foot.append(h('span', 'item-duration', item.duration));

  if (saved) {
    if (url) {
      const open = h('a', 'saved-open', '在 B站 打开 ↗');
      open.href = url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      foot.append(open);
    }
  } else {
    const star = h('button', 'star-btn');
    star.type = 'button';
    star.setAttribute('aria-pressed', String(Boolean(item.starred)));
    star.setAttribute('aria-label', `${item.starred ? '取消收藏' : '收藏'}：${item.title || ''}`);
    star.append(h('span', 'star-glyph', item.starred ? '★' : '☆'));
    star.append(h('span', null, item.starred ? '已收藏' : '收藏'));
    star.addEventListener('click', () => {
      const focused = document.activeElement === star;
      toggleItemState(item, { starred: !item.starred }).then(() => {
        if (focused) focusCardControl(item.id, '.star-btn');
      });
    });
    foot.append(star);

    const readButton = h('button', 'read-btn', item.read ? '标为未读' : '标为已读');
    readButton.type = 'button';
    readButton.addEventListener('click', () => {
      const focused = document.activeElement === readButton;
      toggleItemState(item, { read: !item.read }).then(() => {
        if (focused) focusCardControl(item.id, '.read-btn');
      });
    });
    foot.append(readButton);
  }
  body.append(foot);

  if (item.cover) {
    const imageUrl = proxiedImage(item.cover);
    if (imageUrl) {
      const cover = url ? h('a', 'item-cover') : h('span', 'item-cover');
      if (url) {
        cover.href = url;
        cover.target = '_blank';
        cover.rel = 'noopener noreferrer';
        cover.tabIndex = -1;
        cover.setAttribute('aria-hidden', 'true');
        if (!saved) cover.addEventListener('click', () => markReadOnOpen(item));
      }
      const image = new Image();
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = imageUrl;
      image.addEventListener('error', () => {
        cover.remove();
        card.classList.add('no-cover');
      });
      cover.append(image);
      card.append(body, cover);
      return card;
    }
  }

  card.classList.add('no-cover');
  card.append(body);
  return card;
}

function statNode(label, value) {
  const node = h('span', 'item-stat');
  node.append(h('span', 'stat-key', label));
  node.append(h('span', null, value));
  return node;
}

function renderSkeletons() {
  const fragment = document.createDocumentFragment();
  const widths = [
    ['w-20', 'w-70', 'w-45'],
    ['w-15', 'w-60', 'w-40'],
    ['w-25', 'w-75', 'w-50'],
  ];
  for (const row of widths) {
    const card = h('div', 'skeleton-card');
    for (const width of row) card.append(h('span', `skeleton-line ${width}`));
    fragment.append(card);
  }
  dom.feed.replaceChildren(fragment);
}

function focusCardControl(id, selector) {
  requestAnimationFrame(() => {
    const card = [...dom.feed.querySelectorAll('.card')].find((entry) => entry.dataset.id === id);
    card?.querySelector(selector)?.focus();
  });
}

function renderEmpty(kind) {
  dom.feed.hidden = true;
  dom.feedEnd.hidden = true;
  dom.emptyState.hidden = false;

  if (kind === 'onboarding') {
    const box = h('div', 'onboarding');
    box.append(h('p', 'onboard-kicker', '开始使用'));
    box.append(h('h2', null, '把你的关注，收进一张纸。'));
    box.append(h(
      'p',
      null,
      '连接 B站 和知乎后，筛会读取你的关注列表，只把他们的新视频、文章、回答和动态汇总到这里。没有推荐流，也没有广告。',
    ));
    const actions = h('div', 'onboard-actions');
    if (isMobileShell()) {
      actions.append(actionButton('刷新', 'btn-ghost', () => loadFeed({ silent: true, quiet: true })));
      box.append(actions);
      box.append(h('p', null, '账号连接和同步在电脑上完成。电脑连好之后，手机刷新一下就能看到更新。'));
    } else {
      actions.append(actionButton('扫码连接 B站', 'btn-primary', openBiliQrModal));
      actions.append(actionButton('连接知乎', 'btn-ghost', () => openBridgeModal()));
      box.append(actions);
    }
    const steps = h('div', 'onboard-steps');
    steps.append(onboardStep('01', '连接账号', 'B站扫码；知乎拖一个书签到浏览器，完全使用你自己的登录态。'));
    steps.append(onboardStep('02', '让它自己更新', 'B站定时同步；知乎在浏览器里点一下书签，更新只送到本机。'));
    steps.append(onboardStep('03', '只看你关心的', '按平台、类型、博主筛选，未读和收藏状态都保存在本地。'));
    box.append(steps);
    dom.emptyState.replaceChildren(box);
    return;
  }

  if (kind === 'empty') {
    const box = h('div', 'empty-card');
    box.append(h('p', 'onboard-kicker', '暂时空白'));
    box.append(h('h2', null, '还没有更新'));
    box.append(h(
      'p',
      null,
      '账号已连接，但暂时没有读到新内容。B站可以立即同步；知乎请在已登录的知乎页面运行同步书签。',
    ));
    const actions = h('div', 'empty-actions');
    actions.append(actionButton(isMobileShell() ? '刷新' : '立即同步', 'btn-primary', triggerSync));
    if (state.accounts.zhihu?.connected && !isMobileShell()) {
      actions.append(actionButton('打开知乎同步书签', 'btn-ghost', () => openBridgeModal()));
    }
    box.append(actions);
    dom.emptyState.replaceChildren(box);
    return;
  }

  if (kind === 'zhihu-off') {
    const box = h('div', 'empty-card');
    box.append(h('p', 'onboard-kicker', '知乎未连接'));
    box.append(h('h2', null, '知乎还没有接入'));
    box.append(h(
      'p',
      null,
      isMobileShell()
        ? '知乎还没有接入。请在电脑上完成连接；手机只负责查看，不保存登录凭证。'
        : 'B站可以自动同步；知乎对服务器访问有风控，需要你在已登录的知乎页面运行一次同步书签。数据只发送到这台电脑。',
    ));
    const actions = h('div', 'empty-actions');
    if (isMobileShell()) {
      actions.append(actionButton('刷新信息流', 'btn-ghost', () => loadFeed({ silent: true, quiet: true })));
    } else {
      actions.append(actionButton('用书签连接知乎', 'btn-primary', () => openBridgeModal()));
      actions.append(actionButton('打开账号管理', 'btn-ghost', openAccountsModal));
    }
    box.append(actions);
    dom.emptyState.replaceChildren(box);
    return;
  }

  if (kind === 'zhihu-empty') {
    const box = h('div', 'empty-card');
    box.append(h('p', 'onboard-kicker', '等待同步'));
    box.append(h('h2', null, '还没有收到知乎更新'));
    box.append(h(
      'p',
      null,
      '知乎账号已经连接，但书签还没有送来内容。请在已登录的知乎页面重新运行一次同步书签；旧版书签也可能需要重新安装。',
    ));
    const actions = h('div', 'empty-actions');
    if (!isMobileShell()) {
      actions.append(actionButton('打开知乎同步书签', 'btn-primary', () => openBridgeModal()));
    }
    actions.append(actionButton('刷新信息流', 'btn-ghost', () => loadFeed({ silent: true, quiet: true })));
    box.append(actions);
    dom.emptyState.replaceChildren(box);
    return;
  }

  if (kind === 'filtered') {
    const box = h('div', 'empty-card');
    box.append(h('h2', null, state.filters.query ? `没有找到「${state.filters.query}」` : '没有符合筛选的内容'));
    box.append(h('p', null, '试试取消未读或收藏限制，换一个博主，或清空搜索关键词。'));
    const actions = h('div', 'empty-actions');
    actions.append(actionButton('清除全部筛选', 'btn-primary', resetFilters));
    box.append(actions);
    dom.emptyState.replaceChildren(box);
    return;
  }

  const box = h('div', 'empty-card');
  box.append(h('p', 'onboard-kicker', '连接异常'));
  box.append(h('h2', null, '读取信息流失败'));
  box.append(h('p', null, state.loadError || '本机服务没有响应，请确认它还在运行。'));
  const actions = h('div', 'empty-actions');
  actions.append(actionButton('重新读取', 'btn-primary', () => loadFeed()));
  box.append(actions);
  dom.emptyState.replaceChildren(box);
}

function onboardStep(number, title, description) {
  const step = h('div', 'onboard-step');
  step.append(h('span', 'onboard-step-no', number));
  step.append(h('p', null, `${title} · ${description}`));
  return step;
}

function resetFilters() {
  state.filters = {
    source: 'all',
    kind: 'all',
    creator: 'all',
    unread: false,
    starred: false,
    query: '',
    days: DEFAULT_RANGE_DAYS,
  };
  state.visibleCount = PAGE_SIZE;
  dom.searchInput.value = '';
  renderFilterUI();
  renderCreators();
  renderFeedArea();
}

// ---------- Item state ----------

function adjustCounts(item, previous, next) {
  if (previous.read !== next.read) {
    state.counts.unread = Math.max(0, Number(state.counts.unread || 0) + (next.read ? -1 : 1));
  }
  if (previous.starred !== next.starred) {
    state.counts.starred = Math.max(0, Number(state.counts.starred || 0) + (next.starred ? 1 : -1));
  }
  if (previous.read !== next.read && item.author?.id) {
    const creator = state.creators.find(
      (entry) => entry.platform === item.platform && String(entry.authorId) === String(item.author.id),
    );
    if (creator) creator.unread = Math.max(0, Number(creator.unread || 0) + (next.read ? -1 : 1));
  }
}

async function toggleItemState(item, patch) {
  const previous = { read: Boolean(item.read), starred: Boolean(item.starred) };
  const next = {
    read: typeof patch.read === 'boolean' ? patch.read : previous.read,
    starred: typeof patch.starred === 'boolean' ? patch.starred : previous.starred,
  };
  if (next.read === previous.read && next.starred === previous.starred) return;

  Object.assign(item, next);
  adjustCounts(item, previous, next);
  renderHeader();
  renderCounts();
  renderFilterUI();
  renderCreators();
  renderFeedArea();

  try {
    const result = await api(`/api/items/${encodeURIComponent(item.id)}/state`, {
      method: 'POST',
      body: patch,
    });
    if (result.item) {
      item.read = Boolean(result.item.read);
      item.starred = Boolean(result.item.starred);
    }
  } catch (error) {
    Object.assign(item, previous);
    adjustCounts(item, next, previous);
    renderHeader();
    renderCounts();
    renderFilterUI();
    renderCreators();
    renderFeedArea();
    toast(`状态保存失败：${error.message}`, 'error');
  }
}

function markReadOnOpen(item) {
  if (item.read) return;
  const previous = { read: false, starred: Boolean(item.starred) };
  const next = { read: true, starred: Boolean(item.starred) };
  item.read = true;
  adjustCounts(item, previous, next);
  renderHeader();
  renderCounts();
  renderCreators();
  renderMarkAllState();

  const cards = [...dom.feed.querySelectorAll('.card')].filter((entry) => entry.dataset.id === item.id);
  for (const card of cards) {
    card.classList.remove('is-unread');
    card.classList.add('is-read');
    card.querySelector('.unread-mark')?.remove();
    const readButton = card.querySelector('.read-btn');
    if (readButton) readButton.textContent = '标为未读';
  }

  api(`/api/items/${encodeURIComponent(item.id)}/state`, {
    method: 'POST',
    body: { read: true },
    keepalive: true,
  }).catch(() => {
    item.read = previous.read;
    adjustCounts(item, next, previous);
    renderHeader();
    renderCounts();
    renderCreators();
    renderFeedArea();
  });
}

function handleMarkAllClick() {
  if (state.markAllArmed) {
    executeMarkAll();
    return;
  }
  state.markAllArmed = true;
  dom.markAllBtn.textContent = '再点一次确认';
  clearTimeout(state.markAllTimer);
  state.markAllTimer = setTimeout(() => {
    state.markAllArmed = false;
    renderMarkAllState();
  }, 3200);
}

async function executeMarkAll() {
  clearTimeout(state.markAllTimer);
  state.markAllArmed = false;
  const ids = getFilteredItems()
    .filter((item) => !item.read)
    .map((item) => item.id);
  if (!ids.length) {
    renderMarkAllState();
    return;
  }
  dom.markAllBtn.disabled = true;
  dom.markAllBtn.textContent = '正在标记…';
  try {
    const result = await api('/api/items/read-all', { method: 'POST', body: { ids } });
    await loadFeed({ silent: true, quiet: true });
    toast(`已标记 ${result.count} 条为已读`);
  } catch (error) {
    toast(`操作失败：${error.message}`, 'error');
  } finally {
    renderMarkAllState();
  }
}

// ---------- Sync ----------

async function triggerSync() {
  if (state.sync?.running || state.syncing) return;
  if (isMobileShell()) {
    await loadFeed({ silent: true, quiet: true });
    toast('已刷新');
    return;
  }

  const biliConnected = Boolean(state.accounts.bilibili?.connected);
  const zhihuBridge = Boolean(state.accounts.zhihu?.connected && state.accounts.zhihu.mode === 'bridge');
  if (!biliConnected && zhihuBridge) {
    openBridgeModal();
    return;
  }
  if (!biliConnected && !state.accounts.zhihu?.connected) {
    openAccountsModal();
    return;
  }

  state.zhihuBridgeHint = zhihuBridge;
  state.syncing = true;
  renderSyncButton();
  try {
    await api('/api/sync', { method: 'POST' });
    const status = await refreshStatus();
    if (status?.sync?.running) {
      startSyncWatch();
    } else {
      state.syncing = false;
      renderSyncButton();
      if (state.zhihuBridgeHint) {
        state.zhihuBridgeHint = false;
        toast('B站已同步。知乎需在浏览器点一次同步书签更新。');
      }
      await loadFeed({ silent: true, quiet: true });
    }
  } catch (error) {
    state.syncing = false;
    state.zhihuBridgeHint = false;
    renderSyncButton();
    toast(`同步失败：${error.message}`, 'error');
  }
}

function startSyncWatch() {
  stopSyncWatch();
  state.syncing = true;
  renderSyncButton();

  const tick = async () => {
    if (state.syncPollBusy) return;
    state.syncPollBusy = true;
    const wasActive = state.syncing || Boolean(state.sync?.running);
    try {
      const sync = await api('/api/sync');
      state.sync = sync;
      state.syncing = Boolean(sync.running);
      renderSync();
      renderSyncButton();
      if (wasActive && !sync.running) {
        stopSyncWatch();
        await handleSyncFinished(sync);
      } else if (!sync.running) {
        stopSyncWatch();
      }
    } catch {
      // keep polling; server may be momentarily busy
    } finally {
      state.syncPollBusy = false;
    }
  };

  tick();
  state.syncTimer = setInterval(tick, 1300);
}

function stopSyncWatch() {
  if (state.syncTimer) {
    clearInterval(state.syncTimer);
    state.syncTimer = null;
  }
  state.syncPollBusy = false;
  state.syncing = false;
  renderSyncButton();
}

async function handleSyncFinished(sync) {
  state.syncing = false;
  renderSyncButton();
  const errors = [
    sync.errors?.bilibili,
    sync.errors?.zhihu,
    sync.errors?.general,
  ].filter(Boolean);
  const zhihuHint = state.zhihuBridgeHint ? ' 知乎需在浏览器点一次同步书签更新。' : '';
  state.zhihuBridgeHint = false;
  await loadFeed({ silent: true, quiet: true });
  if (errors.length) {
    toast(`同步完成，但有来源失败：${errors[0]}${zhihuHint}`, 'error');
  } else if (sync.message || zhihuHint) {
    toast(`${sync.message || '同步完成'}${zhihuHint}`);
  }
}

function renderSyncButton() {
  const running = Boolean(state.sync?.running || state.syncing);
  dom.syncBtn.disabled = running;
  dom.syncBtn.classList.toggle('is-syncing', running);
  if (isMobileShell()) {
    dom.syncBtnLabel.textContent = running ? '刷新中…' : '刷新';
    return;
  }
  dom.syncBtnLabel.textContent = running ? '同步中…' : '同步更新';
}

function renderSync() {
  const sync = state.sync;
  if (!sync || (!sync.running && !sync.finishedAt)) {
    dom.statusBanner.hidden = true;
    return;
  }

  if (!sync.running && state.bannerDismissedAt && state.bannerDismissedAt >= (sync.finishedAt || 0)) {
    dom.statusBanner.hidden = true;
    return;
  }

  const errors = [
    sync.errors?.bilibili,
    sync.errors?.zhihu,
    sync.errors?.general,
  ].filter(Boolean);

  dom.statusBanner.hidden = false;
  dom.statusBanner.classList.remove('is-running', 'is-success', 'is-warn', 'is-error', 'has-progress');

  if (sync.running) {
    dom.statusBanner.classList.add('is-running');
    const total = Number(sync.total) || 0;
    const done = Number(sync.done) || 0;
    if (total > 0) {
      dom.statusBanner.classList.add('has-progress');
      dom.bannerProgress.value = Math.min(100, Math.round((done / total) * 100));
    } else {
      dom.bannerProgress.value = 0;
    }
    dom.bannerText.textContent = sync.message || '正在同步…';
    dom.bannerDismiss.hidden = true;
    return;
  }

  dom.bannerDismiss.hidden = false;
  if (errors.length) {
    dom.statusBanner.classList.add(sync.errors?.general ? 'is-error' : 'is-warn');
    const base = sync.message || '同步完成，但部分来源失败';
    const detail = errors.filter((message) => !base.includes(message)).join('；');
    dom.bannerText.textContent = detail ? `${base}：${detail}` : base;
  } else {
    dom.statusBanner.classList.add('is-success');
    dom.bannerText.textContent = sync.message || '同步完成';
  }
}

// ---------- Toast ----------

function toast(message, tone) {
  clearTimeout(state.toastTimer);
  clearTimeout(state.toastHideTimer);
  dom.toast.textContent = message;
  dom.toast.classList.remove('is-error', 'is-visible');
  if (tone === 'error') dom.toast.classList.add('is-error');
  dom.toast.hidden = false;
  requestAnimationFrame(() => dom.toast.classList.add('is-visible'));
  state.toastTimer = setTimeout(() => {
    dom.toast.classList.remove('is-visible');
    state.toastHideTimer = setTimeout(() => {
      dom.toast.hidden = true;
    }, 220);
  }, 3200);
}

async function copyText(text, successMessage) {
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    toast(successMessage);
    return;
  } catch {
    // fall through to legacy copy
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.className = 'copy-fallback';
  area.setAttribute('readonly', '');
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  toast(copied ? successMessage : '复制失败，请手动选择复制', copied ? undefined : 'error');
}

// ---------- Modal framework ----------

function openModal({ title, kicker }) {
  closeModal();
  state.modalSession += 1;
  const session = state.modalSession;
  dom.modalKicker.textContent = kicker || '';
  dom.modalTitle.textContent = title;
  dom.modalBody.replaceChildren();
  dom.modalRoot.hidden = false;
  document.body.classList.add('modal-open');
  dom.modal.scrollTop = 0;
  requestAnimationFrame(() => dom.modal.focus());
  return session;
}

function isModalSession(session) {
  return !dom.modalRoot.hidden && session === state.modalSession;
}

function closeModal() {
  if (state.modalCleanup) {
    try {
      state.modalCleanup();
    } catch {
      // ignore cleanup errors
    }
    state.modalCleanup = null;
  }
  state.modalSession += 1;
  dom.modalRoot.hidden = true;
  document.body.classList.remove('modal-open');
  dom.modalBody.replaceChildren();
}

function modalLoading(text) {
  return h('div', 'modal-loading', text);
}

function modalError(message, retry) {
  const box = h('div', 'modal-load-error');
  box.append(h('p', 'form-error', message));
  box.append(actionButton('重试', 'btn-ghost btn-sm', retry));
  return box;
}

// ---------- Accounts modal ----------

async function openAccountsModal() {
  if (!requireDesktop()) return;
  const session = openModal({ title: '账号与来源', kicker: 'ACCOUNT' });
  dom.modalBody.append(modalLoading('正在读取账号状态…'));
  try {
    const status = await api('/api/status');
    applyStatus(status);
  } catch {
    if (!isModalSession(session)) return;
    if (!state.accountsReady) {
      dom.modalBody.replaceChildren(modalError(
        '无法连接本机服务，请确认筛仍在运行，然后重试。',
        openAccountsModal,
      ));
      return;
    }
  }
  if (!isModalSession(session)) return;
  buildAccountsView(dom.modalBody);
}

function buildAccountsView(body) {
  body.replaceChildren();
  body.append(h(
    'p',
    'modal-lead',
    '连接后，筛只读取你的关注列表和他们的公开更新，不会发帖、点赞或关注任何人。',
  ));

  const bili = state.accounts.bilibili || { connected: false };
  const biliCard = h('div', 'connect-card');
  const biliHead = h('div', 'connect-head');
  biliHead.append(h('span', 'platform-mark lg bili', 'B'));
  const biliCopy = h('div');
  biliCopy.append(h('h3', null, '哔哩哔哩'));
  const biliStatus = h('p', 'connect-status');
  if (bili.connected) {
    if (bili.needsReauth) {
      biliStatus.classList.add('is-warn');
      biliStatus.textContent = '登录已失效，需要重新扫码';
    } else {
      biliStatus.textContent = `${bili.name || 'B站账号'} · ${bili.lastSyncAt ? `${formatTimeAgo(bili.lastSyncAt)}同步` : '等待首次同步'}`;
    }
  } else {
    biliStatus.textContent = '未连接';
  }
  biliCopy.append(biliStatus);
  biliHead.append(biliCopy);
  biliCard.append(biliHead);
  biliCard.append(h(
    'p',
    'connect-desc',
    '扫码登录一次，之后筛会定时读取你关注 UP 主近 45 天内的视频、专栏和动态。',
  ));
  const biliActions = h('div', 'connect-actions');
  if (bili.connected) {
    biliActions.append(actionButton('立即同步', 'btn-primary btn-sm', () => {
      closeModal();
      triggerSync();
    }));
    biliActions.append(actionButton('重新扫码', 'btn-ghost btn-sm', openBiliQrModal));
    biliActions.append(actionButton('断开 B站', 'btn-danger btn-sm', () => disconnect('bilibili')));
  } else {
    biliActions.append(actionButton('扫码连接', 'btn-primary btn-sm', openBiliQrModal));
  }
  biliCard.append(biliActions);
  body.append(biliCard);

  const zhihu = state.accounts.zhihu || { connected: false };
  const zhihuCard = h('div', 'connect-card');
  const zhihuHead = h('div', 'connect-head');
  zhihuHead.append(h('span', 'platform-mark lg zhihu', '知'));
  const zhihuCopy = h('div');
  zhihuCopy.append(h('h3', null, '知乎'));
  const zhihuStatus = h('p', 'connect-status');
  if (zhihu.connected) {
    if (zhihu.needsBridge) {
      zhihuStatus.classList.add('is-warn');
      zhihuStatus.textContent = 'Cookie 直连受限，建议改用书签';
    } else {
      const mode = zhihu.mode === 'cookie' ? 'Cookie 直连' : '浏览器书签';
      const syncText = zhihu.lastSyncAt ? `${formatTimeAgo(zhihu.lastSyncAt)}同步` : '尚未同步';
      const followText = zhihu.followeeCount ? ` · 关注 ${zhihu.followeeCount} 人` : '';
      zhihuStatus.textContent = `${zhihu.name || '知乎账号'} · ${mode} · ${syncText}${followText}`;
    }
  } else {
    zhihuStatus.textContent = '未连接';
  }
  zhihuCopy.append(zhihuStatus);
  zhihuHead.append(zhihuCopy);
  zhihuCard.append(zhihuHead);
  zhihuCard.append(h(
    'p',
    'connect-desc',
    '知乎对服务器访问有严格风控。推荐用浏览器书签，在你已登录的知乎页面读取关注更新，数据只发送到本机。',
  ));
  const zhihuActions = h('div', 'connect-actions');
  if (zhihu.connected) {
    zhihuActions.append(actionButton('重新运行同步书签', 'btn-primary btn-sm', () => openBridgeModal()));
    zhihuActions.append(actionButton('刷新信息流', 'btn-ghost btn-sm', async () => {
      closeModal();
      await loadFeed({ silent: true, quiet: true });
      toast('信息流已刷新');
    }));
    zhihuActions.append(actionButton('断开知乎', 'btn-danger btn-sm', () => disconnect('zhihu')));
  } else {
    zhihuActions.append(actionButton('用书签连接', 'btn-primary btn-sm', () => openBridgeModal()));
    zhihuActions.append(actionButton('Cookie 方式', 'btn-ghost btn-sm', () => openBridgeModal({ cookieOpen: true })));
  }
  zhihuCard.append(zhihuActions);
  body.append(zhihuCard);

  if (state.app?.localRequest !== false) {
    body.append(buildMobileCard());
  }

  body.append(h(
    'p',
    'privacy-note',
    '登录凭证只写入这台电脑上的 sift/data/sessions.json（仅当前系统用户可读），不会暴露给网页，也不会发送到任何第三方。你可以随时断开并清除缓存。',
  ));
}

function buildMobileCard() {
  const card = h('div', 'connect-card');
  const head = h('div', 'connect-head');
  head.append(h('span', 'platform-mark lg mobile', '机'));
  const copy = h('div');
  copy.append(h('h3', null, '手机 App'));
  copy.append(h('p', 'connect-status', '只读 · 与电脑同一 Wi-Fi'));
  head.append(copy);
  card.append(head);
  card.append(h(
    'p',
    'connect-desc',
    '在安卓手机上浏览和筛选。手机不保存 B站/知乎 登录凭证，登录与同步仍然在电脑上完成。',
  ));
  const actions = h('div', 'connect-actions');
  actions.append(actionButton('连接手机', 'btn-primary btn-sm', openMobileModal));
  actions.append(actionButton('下载 APK', 'btn-ghost btn-sm', () => {
    window.location.href = '/app/sift.apk';
  }));
  card.append(actions);
  return card;
}

async function openMobileModal() {
  const session = openModal({ title: '连接手机', kicker: 'MOBILE' });
  dom.modalBody.append(modalLoading('正在读取手机连接信息…'));
  let data;
  try {
    data = await api('/api/mobile/pairing');
  } catch (error) {
    if (!isModalSession(session)) return;
    dom.modalBody.replaceChildren(modalError(error.message, openMobileModal));
    return;
  }
  if (!isModalSession(session)) return;
  renderMobilePairing(data, session);
}

function renderMobilePairing(data, session) {
  if (!isModalSession(session)) return;
  const body = dom.modalBody;
  body.replaceChildren();
  body.append(h(
    'p',
    'modal-lead',
    '手机只读。用手机相机扫下面的二维码，在打开的页面里点“在筛 App 中打开”；也可以手动输入地址和访问码。',
  ));

  if (!data.enabled) {
    const box = h('div', 'modal-load-error');
    const message = data.lanEnabled === false
      ? '当前服务只监听本机，手机无法连接。请用默认方式重新启动筛，再回到这里。'
      : '没有检测到局域网地址。请确认电脑已经连接 Wi-Fi 或网线，然后重试。';
    box.append(h('p', 'form-error', message));
    box.append(actionButton('重试', 'btn-ghost btn-sm', openMobileModal));
    body.append(box);
    return;
  }

  const stage = h('div', 'mobile-pair qr-stage');
  const frame = h('div', 'qr-frame');
  if (data.qrDataUrl) {
    const image = document.createElement('img');
    image.src = data.qrDataUrl;
    image.alt = '手机配对二维码';
    image.width = 280;
    image.height = 280;
    frame.append(image);
  } else {
    frame.append(h('span', 'qr-placeholder', '二维码生成失败，请使用下方信息手动连接。'));
  }
  stage.append(frame);
  stage.append(h('p', 'qr-hint', '二维码只在这台电脑上显示，里面包含当前地址和访问码。'));
  body.append(stage);

  const lines = h('div', 'pair-lines');
  (data.urls || []).forEach((entry, index) => {
    lines.append(pairLine(
      `电脑地址${entry.name ? ` · ${entry.name}` : ''}${index === 0 ? ' · 推荐' : ''}`,
      entry.url,
      false,
    ));
  });
  lines.append(pairLine('访问码', data.code, true));
  body.append(lines);

  const actions = h('div', 'connect-actions');
  actions.append(actionButton('复制连接信息', 'btn-primary btn-sm', () => {
    const url = data.primaryUrl || '';
    copyText(`${url}\n访问码：${data.code}`, '连接信息已复制');
  }));
  if (data.apkAvailable) {
    actions.append(actionButton('下载 APK', 'btn-ghost btn-sm', () => {
      window.open(data.apkUrl, '_blank', 'noopener');
    }));
  }
  actions.append(actionButton('重新生成访问码', 'btn-danger btn-sm', async () => {
    if (!window.confirm('重新生成后，已经连接的手机需要重新输入新访问码。继续吗？')) return;
    try {
      const next = await api('/api/mobile/access', { method: 'POST' });
      if (!isModalSession(session)) return;
      renderMobilePairing(next, session);
      toast('访问码已更新，请在手机上重新连接');
    } catch (error) {
      toast(`更新失败：${error.message}`, 'error');
    }
  }));
  body.append(actions);

  const steps = h('ol', 'mobile-steps');
  steps.append(h('li', null, '让手机和电脑连上同一个 Wi-Fi。'));
  steps.append(h('li', null, '用手机相机扫码，在打开的页面里下载并安装 APK；已经安装就直接点“在筛 App 中打开”。'));
  steps.append(h('li', null, 'App 会自动填入连接信息，确认后即可查看信息流。'));
  steps.append(h('li', null, '手机只读；B站/知乎 的登录和同步仍然在电脑上。'));
  body.append(steps);

  body.append(h(
    'p',
    'mobile-note',
    '如果扫码后打不开，试试下面另一个“电脑地址”。访问码相当于这扇门的钥匙，不要发给别人，也不要在公共 Wi-Fi 下使用。',
  ));
}

function pairLine(label, value, isCode) {
  const row = h('div', 'pair-line');
  const copy = h('div', 'pair-line-copy');
  copy.append(h('span', 'pair-line-label', label));
  copy.append(h('span', `pair-line-value${isCode ? ' is-code' : ''}`, value));
  row.append(copy);
  const button = h('button', 'text-btn', '复制');
  button.type = 'button';
  button.addEventListener('click', () => copyText(value, `${label}已复制`));
  row.append(button);
  return row;
}

async function disconnect(platform) {
  const label = PLATFORMS[platform].label;
  const confirmed = window.confirm(`断开${label}后，已缓存的${label}内容也会从筛中清除。确定断开吗？`);
  if (!confirmed) return;
  try {
    const path = platform === 'bilibili' ? '/api/bili/session' : '/api/zhihu/session';
    await api(path, { method: 'DELETE' });
    closeModal();
    toast(`${label}已断开`);
    await loadFeed({ silent: true, quiet: true });
  } catch (error) {
    toast(`断开失败：${error.message}`, 'error');
  }
}

// ---------- Bilibili QR ----------

async function openBiliQrModal() {
  if (!requireDesktop()) return;
  const session = openModal({ title: '连接哔哩哔哩', kicker: 'BILIBILI' });
  dom.modalBody.append(h(
    'p',
    'modal-lead',
    '用哔哩哔哩 App 扫描二维码。确认登录后，筛会读取你的关注动态，不会发帖、点赞或关注任何人。',
  ));

  const stage = h('div', 'qr-stage');
  const frame = h('div', 'qr-frame');
  frame.append(h('span', 'qr-placeholder', '正在生成二维码…'));
  const status = h('div', 'qr-status is-waiting', '正在生成二维码');
  const hint = h('p', 'qr-hint', '二维码 3 分钟内有效。');
  const actions = h('div', 'qr-actions');
  const refresh = actionButton('重新生成二维码', 'btn-ghost btn-sm', () => generate());
  refresh.hidden = true;
  actions.append(refresh);
  stage.append(frame, status, hint, actions);
  dom.modalBody.append(stage);

  let pollTimer = null;
  let countdownTimer = null;
  let currentKey = null;
  let stopped = false;

  state.modalCleanup = () => {
    stopped = true;
    clearInterval(pollTimer);
    clearInterval(countdownTimer);
  };

  function stopTimers() {
    clearInterval(pollTimer);
    clearInterval(countdownTimer);
    pollTimer = null;
    countdownTimer = null;
  }

  function expire(message) {
    stopTimers();
    status.className = 'qr-status is-error';
    status.textContent = message;
    hint.textContent = '请重新生成二维码后再扫码。';
    refresh.hidden = false;
  }

  async function generate() {
    stopTimers();
    refresh.hidden = true;
    status.className = 'qr-status is-waiting';
    status.textContent = '正在生成二维码';
    hint.textContent = '二维码 3 分钟内有效。';
    frame.replaceChildren(h('span', 'qr-placeholder', '正在生成二维码…'));

    try {
      const qr = await api('/api/bili/qr', { method: 'POST' });
      if (stopped || !isModalSession(session)) return;
      currentKey = qr.key;

      const image = new Image();
      image.alt = '哔哩哔哩登录二维码';
      image.src = qr.qrDataUrl;
      frame.replaceChildren(image);

      let remain = Number(qr.expiresIn) || 180;
      status.className = 'qr-status is-waiting';
      status.textContent = `等待扫码 · ${formatRemain(remain)}`;
      countdownTimer = setInterval(() => {
        remain -= 1;
        if (remain <= 0) {
          expire('二维码已过期');
          return;
        }
        if (status.classList.contains('is-waiting')) {
          status.textContent = `等待扫码 · ${formatRemain(remain)}`;
        }
      }, 1000);

      pollTimer = setInterval(() => poll(qr.key), 1500);
    } catch (error) {
      if (stopped || !isModalSession(session)) return;
      status.className = 'qr-status is-error';
      status.textContent = '生成二维码失败';
      hint.textContent = error.message;
      refresh.hidden = false;
    }
  }

  async function poll(key) {
    if (stopped || !isModalSession(session) || key !== currentKey) return;
    try {
      const result = await api(`/api/bili/qr/${encodeURIComponent(key)}`);
      if (stopped || key !== currentKey) return;
      if (result.status === 'waiting') return;
      if (result.status === 'scanned') {
        status.className = 'qr-status is-scanned';
        status.textContent = '已扫码，请在手机上确认';
        return;
      }
      if (result.status === 'expired') {
        expire('二维码已过期');
        return;
      }
      if (result.status === 'success') {
        stopTimers();
        renderQrSuccess(stage, result.account);
        await refreshStatus();
        if (state.sync?.running) startSyncWatch();
      }
    } catch (error) {
      if (error.status === 404) {
        expire('二维码已失效');
      }
    }
  }

  generate();
}

function renderQrSuccess(stage, account) {
  const box = h('div', 'qr-success');
  box.append(avatar(account?.name, account?.face));
  box.append(h('h3', null, `${account?.name || 'B站账号'} 已连接`));
  box.append(h('p', null, '正在同步关注动态，稍后就能在信息流里看到。'));
  const actions = h('div', 'empty-actions');
  actions.append(actionButton('去看信息流', 'btn-primary', () => {
    closeModal();
    loadFeed({ silent: true, quiet: true });
  }));
  box.append(actions);
  stage.replaceChildren(box);
}

// ---------- Zhihu bridge ----------

async function openBridgeModal({ cookieOpen = false } = {}) {
  if (!requireDesktop()) return;
  const session = openModal({ title: '用浏览器连接知乎', kicker: 'ZHIHU' });
  dom.modalBody.append(modalLoading('正在准备同步书签…'));

  let data;
  try {
    data = await api('/api/zhihu/bridge');
    state.bridge = data;
  } catch (error) {
    if (!isModalSession(session)) return;
    dom.modalBody.replaceChildren(modalError(
      `无法准备同步书签：${error.message}`,
      () => openBridgeModal({ cookieOpen }),
    ));
    return;
  }
  if (!isModalSession(session)) return;
  buildBridgeView(data, { cookieOpen });
}

function buildBridgeView(data, { cookieOpen }) {
  const body = dom.modalBody;
  body.replaceChildren();
  body.append(h(
    'p',
    'modal-lead',
    '知乎对服务器访问有风控。这个书签会在你已登录的知乎页面里读取关注更新，然后只发送到这台电脑。数据不经过第三方。',
  ));

  const steps = h('ol', 'steps');

  const step1 = h('li', 'step');
  step1.append(h('span', 'step-no', '1'));
  const step1Body = h('div', 'step-body');
  step1Body.append(h('strong', null, '安装同步书签'));
  step1Body.append(h(
    'p',
    null,
    '把下面的按钮拖到浏览器书签栏（按 Ctrl+Shift+B 可显示书签栏）。拖不动就点一下复制地址，再新建书签并粘贴。',
  ));
  const bookmarklet = h('a', 'bookmarklet', '筛 · 知乎同步');
  bookmarklet.href = data.bookmarklet;
  bookmarklet.draggable = true;
  bookmarklet.title = '拖到书签栏，或点击复制书签地址';
  bookmarklet.addEventListener('click', (event) => {
    event.preventDefault();
    copyText(data.bookmarklet, '同步书签地址已复制。到书签栏新建书签并粘贴即可。');
  });
  step1Body.append(bookmarklet);
  step1Body.append(h('p', 'hint-inline', '书签地址很长是正常的，它包含只属于这台电脑的同步令牌。'));
  step1Body.append(h(
    'p',
    'hint-inline',
    '如果之前装过旧版书签，请重新拖一次。新版 Chrome 会拦截旧版直接向本机发送数据。',
  ));
  step1.append(step1Body);
  steps.append(step1);

  const step2 = h('li', 'step');
  step2.append(h('span', 'step-no', '2'));
  const step2Body = h('div', 'step-body');
  step2Body.append(h('strong', null, '在知乎运行一次'));
  step2Body.append(h(
    'p',
    null,
    '打开 zhihu.com 并保持登录，点击书签。右下角会出现「筛 · 知乎同步」面板，同时弹出一个「知乎同步接收器」小窗口；保持两个窗口打开，直到显示完成。',
  ));
  step2.append(step2Body);
  steps.append(step2);

  const step3 = h('li', 'step');
  step3.append(h('span', 'step-no', '3'));
  const step3Body = h('div', 'step-body');
  step3Body.append(h('strong', null, '回到筛刷新'));
  step3Body.append(h(
    'p',
    null,
    '同步完成后回到这里，点下方按钮刷新信息流。以后想看知乎更新，重复第 2 步即可。',
  ));
  step3.append(step3Body);
  steps.append(step3);

  body.append(steps);

  if (data.account?.name || data.account?.lastBridgeAt) {
    const line = h('div', 'bridge-account');
    line.append(avatar(data.account.name, null));
    const copy = h('div');
    const last = data.account.lastBridgeAt || state.accounts.zhihu?.lastSyncAt;
    const follow = data.account.followeeCount ? ` · 关注 ${data.account.followeeCount} 人` : '';
    copy.append(h('strong', null, data.account.name || '知乎账号'));
    copy.append(h('span', null, ` · ${last ? `${formatTimeAgo(last)}同步` : '尚未同步'}${follow}`));
    line.append(copy);
    body.append(line);
  }

  const actions = h('div', 'bridge-actions');
  actions.append(actionButton('我已完成，刷新信息流', 'btn-primary', async () => {
    closeModal();
    await loadFeed({ silent: true, quiet: true });
    toast('信息流已刷新。若知乎同步面板还没结束，请等它完成后再刷新。');
  }));
  body.append(actions);

  const scriptDetails = h('details', 'advanced');
  scriptDetails.append(h('summary', null, '书签拖不动？复制控制台脚本'));
  const scriptBody = h('div', 'advanced-body');
  scriptBody.append(h(
    'p',
    'hint-inline',
    '在知乎任意页面按 F12 打开开发者工具，切换到 Console，粘贴运行。效果与书签相同。',
  ));
  scriptBody.append(actionButton('复制控制台脚本', 'btn-ghost btn-sm', () => {
    copyText(data.script, '控制台脚本已复制。请在知乎页面的 Console 中粘贴运行。');
  }));
  scriptDetails.append(scriptBody);
  body.append(scriptDetails);

  const cookieDetails = h('details', 'advanced');
  if (cookieOpen) cookieDetails.open = true;
  cookieDetails.append(h('summary', null, '高级：使用 Cookie 直连（可能触发风控）'));
  const cookieBody = h('div', 'advanced-body');
  cookieBody.append(h(
    'p',
    'hint-inline',
    '只有在不方便使用书签时才选这个方式。知乎可能要求安全验证，导致服务器无法读取关注列表。',
  ));
  cookieBody.append(h('label', 'field-label', '知乎 Cookie'));
  const cookieInput = h('textarea', 'field-textarea');
  cookieInput.placeholder = 'z_c0=...; _xsrf=...; d_c0=...';
  cookieInput.setAttribute('aria-label', '知乎 Cookie');
  cookieBody.append(cookieInput);
  const cookieError = h('p', 'form-error');
  cookieBody.append(cookieError);
  const cookieActions = h('div', 'form-actions');
  const cookieButton = actionButton('用 Cookie 连接', 'btn-ghost btn-sm', async () => {
    const cookie = cookieInput.value.trim();
    if (!cookie) {
      cookieError.textContent = '请先粘贴知乎 Cookie。';
      return;
    }
    cookieButton.disabled = true;
    cookieButton.textContent = '连接中…';
    cookieError.textContent = '';
    try {
      const result = await api('/api/zhihu/cookie', { method: 'POST', body: { cookie } });
      closeModal();
      toast(`知乎账号「${result.account.name}」已连接，开始同步`);
      await refreshStatus();
      if (state.sync?.running) startSyncWatch();
      else await loadFeed({ silent: true, quiet: true });
    } catch (error) {
      cookieError.textContent = error.message
        + (error.code === 'RISK_CONTROL' ? ' 知乎拒绝了服务器直连，请改用上方书签同步。' : '');
      cookieButton.disabled = false;
      cookieButton.textContent = '用 Cookie 连接';
    }
  });
  cookieActions.append(cookieButton);
  cookieBody.append(cookieActions);
  cookieDetails.append(cookieBody);
  body.append(cookieDetails);

  body.append(h(
    'p',
    'privacy-note',
    '同步令牌只用于接收你浏览器发来的数据，保存在本机配置中。书签只会读取你的关注列表和他们的公开内容，不会修改你的知乎账号。',
  ));

  if (cookieOpen) {
    requestAnimationFrame(() => cookieInput.focus());
  }
}

// ---------- Init ----------

function init() {
  cacheDom();
  bindEvents();
  updateToTopVisibility();
  renderHeader();
  renderAccounts();
  renderFilterUI();
  renderCreators();
  renderSync();
  renderSyncButton();
  loadFeed();
  setInterval(pollStatus, STATUS_INTERVAL);
}

init();
