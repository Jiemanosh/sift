import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { MAX_ITEMS } from './config.js';
import { generateMobileCode } from './mobile.js';
import { shanghaiDateKey } from './util.js';

const STATE_VERSION = 1;

function emptyState() {
  return {
    version: STATE_VERSION,
    items: {},
    creators: {},
    meta: {
      feedVersion: 0,
      stateVersion: 0,
      lastBiliSyncAt: null,
      lastZhihuSyncAt: null,
      lastSyncAt: null,
      createdAt: Date.now(),
    },
  };
}

function publicPlatform(platform) {
  return platform === 'bilibili' ? 'bilibili' : 'zhihu';
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.statePath = path.join(dir, 'state.json');
    this.sessionsPath = path.join(dir, 'sessions.json');
    this.configPath = path.join(dir, 'config.json');
    this.state = emptyState();
    this.sessions = {};
    this.config = {};
    this.writeChain = Promise.resolve();
    this.stateTimer = null;
    this.stateDirty = false;
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    this.state = await this.#readJson(this.statePath, emptyState());
    this.sessions = await this.#readJson(this.sessionsPath, {});
    this.config = await this.#readJson(this.configPath, {});
    this.state.items ||= {};
    this.state.creators ||= {};
    this.state.meta ||= emptyState().meta;
    this.state.meta.feedVersion ||= 0;
    this.state.meta.stateVersion ||= 0;
    let configChanged = false;
    if (!this.config.bridgeToken) {
      this.config.bridgeToken = crypto.randomBytes(24).toString('hex');
      this.config.createdAt ||= Date.now();
      configChanged = true;
    }
    if (!this.config.mobileCode) {
      this.config.mobileCode = generateMobileCode();
      configChanged = true;
    }
    if (!this.config.mobileSecret) {
      this.config.mobileSecret = crypto.randomBytes(32).toString('hex');
      configChanged = true;
    }
    if (configChanged) await this.#writeJson(this.configPath, this.config, 0o600);
    return this;
  }

  async #readJson(file, fallback) {
    try {
      const text = await fs.readFile(file, 'utf8');
      return JSON.parse(text);
    } catch (error) {
      if (error.code === 'ENOENT') return structuredClone(fallback);
      console.warn(`[store] 无法读取 ${path.basename(file)}，已备份并重新创建：${error.message}`);
      try {
        await fs.rename(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        // ignore
      }
      return structuredClone(fallback);
    }
  }

  async #writeJson(file, data, mode) {
    const payload = JSON.stringify(data, null, 2);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const task = async () => {
      await fs.writeFile(tmp, payload, { encoding: 'utf8', mode });
      try {
        await fs.rename(tmp, file);
      } catch {
        await fs.unlink(file).catch(() => {});
        await fs.rename(tmp, file);
      }
    };
    this.writeChain = this.writeChain.then(task, task);
    return this.writeChain;
  }

  queueStateSave() {
    this.stateDirty = true;
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      if (!this.stateDirty) return;
      this.stateDirty = false;
      this.#writeJson(this.statePath, this.state).catch((error) => {
        console.warn('[store] 状态保存失败:', error.message);
      });
    }, 120);
    this.stateTimer.unref?.();
  }

  async flush() {
    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }
    if (this.stateDirty) {
      this.stateDirty = false;
      await this.#writeJson(this.statePath, this.state);
    }
    await this.writeChain;
  }

  getConfig() {
    return this.config;
  }

  async regenerateMobileAccess() {
    this.config.mobileCode = generateMobileCode();
    this.config.mobileSecret = crypto.randomBytes(32).toString('hex');
    await this.#writeJson(this.configPath, this.config, 0o600);
    return this.config.mobileCode;
  }

  getState() {
    return this.state;
  }

  getSession(platform) {
    return this.sessions[publicPlatform(platform)] || null;
  }

  async setSession(platform, session) {
    this.sessions[publicPlatform(platform)] = session;
    await this.#writeJson(this.sessionsPath, this.sessions, 0o600);
  }

  async updateSession(platform, patch) {
    const key = publicPlatform(platform);
    this.sessions[key] = { ...(this.sessions[key] || {}), ...patch };
    await this.#writeJson(this.sessionsPath, this.sessions, 0o600);
    return this.sessions[key];
  }

  async clearSession(platform) {
    delete this.sessions[publicPlatform(platform)];
    await this.#writeJson(this.sessionsPath, this.sessions, 0o600);
  }

  async removePlatform(platform) {
    const key = publicPlatform(platform);
    delete this.sessions[key];
    await this.#writeJson(this.sessionsPath, this.sessions, 0o600);
    for (const [id, item] of Object.entries(this.state.items)) {
      if (item.platform === key) delete this.state.items[id];
    }
    for (const [id, creator] of Object.entries(this.state.creators)) {
      if (creator.platform === key) delete this.state.creators[id];
    }
    this.state.meta.feedVersion += 1;
    this.queueStateSave();
    await this.flush();
  }

  upsertItems(items) {
    let added = 0;
    let changed = 0;
    const now = Date.now();
    for (const raw of items) {
      if (!raw?.id) continue;
      const item = { ...raw, platform: publicPlatform(raw.platform) };
      const previous = this.state.items[item.id];
      if (!previous) {
        this.state.items[item.id] = {
          ...item,
          read: false,
          starred: false,
          firstSeenAt: now,
          fetchedAt: now,
        };
        added += 1;
      } else {
        const before = JSON.stringify({
          title: previous.title,
          excerpt: previous.excerpt,
          cover: previous.cover,
          stats: previous.stats,
          url: previous.url,
        });
        this.state.items[item.id] = {
          ...previous,
          ...item,
          read: previous.read,
          starred: previous.starred,
          firstSeenAt: previous.firstSeenAt,
          fetchedAt: now,
        };
        const after = JSON.stringify({
          title: item.title,
          excerpt: item.excerpt,
          cover: item.cover,
          stats: item.stats,
          url: item.url,
        });
        if (before !== after) changed += 1;
      }
      const creatorId = `${item.platform}:${item.author?.id || item.authorId || ''}`;
      if (item.author?.id) {
        this.state.creators[creatorId] = {
          id: creatorId,
          platform: item.platform,
          authorId: String(item.author.id),
          name: item.author.name || '未知作者',
          avatar: item.author.avatar || null,
          url: item.author.url || null,
          lastAt: Math.max(this.state.creators[creatorId]?.lastAt || 0, item.createdAt || 0),
        };
      }
    }

    if (added || changed) {
      this.state.meta.feedVersion += 1;
      this.trim();
      this.queueStateSave();
    }
    return { added, changed };
  }

  upsertCreators(creators = []) {
    let count = 0;
    for (const raw of creators) {
      if (!raw?.authorId) continue;
      const platform = publicPlatform(raw.platform);
      const id = `${platform}:${raw.authorId}`;
      const previous = this.state.creators[id];
      this.state.creators[id] = {
        ...(previous || {}),
        id,
        platform,
        authorId: String(raw.authorId),
        name: raw.name || previous?.name || '未知作者',
        avatar: raw.avatar || previous?.avatar || null,
        url: raw.url || previous?.url || null,
        lastAt: Math.max(previous?.lastAt || 0, raw.lastAt || 0),
      };
      count += 1;
    }
    if (count) this.queueStateSave();
    return count;
  }

  trim() {
    const entries = Object.entries(this.state.items);
    if (entries.length <= MAX_ITEMS) return;
    entries.sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const keep = new Set();
    for (const [id, item] of entries) {
      if (keep.size < MAX_ITEMS || item.starred) keep.add(id);
    }
    for (const [id] of entries) {
      if (!keep.has(id)) delete this.state.items[id];
    }
  }

  setItemState(id, patch) {
    const item = this.state.items[id];
    if (!item) return null;
    if (typeof patch.read === 'boolean') item.read = patch.read;
    if (typeof patch.starred === 'boolean') item.starred = patch.starred;
    item.stateUpdatedAt = Date.now();
    this.state.meta.stateVersion += 1;
    this.queueStateSave();
    return item;
  }

  markAllRead(platform = null) {
    let count = 0;
    for (const item of Object.values(this.state.items)) {
      if (platform && item.platform !== platform) continue;
      if (!item.read) {
        item.read = true;
        count += 1;
      }
    }
    if (count) {
      this.state.meta.stateVersion += 1;
      this.queueStateSave();
    }
    return count;
  }

  markItemsRead(ids = []) {
    let count = 0;
    for (const id of new Set(ids)) {
      const item = this.state.items[id];
      if (!item || item.read) continue;
      item.read = true;
      count += 1;
    }
    if (count) {
      this.state.meta.stateVersion += 1;
      this.queueStateSave();
    }
    return count;
  }

  touchMeta(patch = {}) {
    this.state.meta = { ...this.state.meta, ...patch };
    this.queueStateSave();
  }

  getFeed(limit = 500) {
    const items = Object.values(this.state.items)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, Math.max(1, Math.min(limit, 1000)))
      .map((item) => ({
        ...item,
        read: Boolean(item.read),
        starred: Boolean(item.starred),
      }));
    return {
      items,
      creators: this.getCreators(),
      meta: {
        ...this.state.meta,
        totalCached: Object.keys(this.state.items).length,
      },
    };
  }

  getCreators() {
    const map = new Map();
    for (const item of Object.values(this.state.items)) {
      const authorId = String(item.author?.id || item.authorId || '');
      if (!authorId) continue;
      const id = `${item.platform}:${authorId}`;
      const current = map.get(id) || {
        id,
        platform: item.platform,
        authorId,
        name: item.author?.name || '未知作者',
        avatar: item.author?.avatar || null,
        url: item.author?.url || null,
        count: 0,
        unread: 0,
        latestAt: 0,
      };
      current.count += 1;
      if (!item.read) current.unread += 1;
      current.latestAt = Math.max(current.latestAt, item.createdAt || 0);
      if (item.author?.avatar) current.avatar = item.author.avatar;
      map.set(id, current);
    }
    return [...map.values()].sort((a, b) => b.latestAt - a.latestAt);
  }

  getCounts() {
    const items = Object.values(this.state.items);
    const today = shanghaiDateKey(Date.now());
    const counts = {
      total: items.length,
      unread: 0,
      starred: 0,
      today: 0,
      bilibili: 0,
      zhihu: 0,
    };
    for (const item of items) {
      if (!item.read) counts.unread += 1;
      if (item.starred) counts.starred += 1;
      if (item.createdAt && shanghaiDateKey(item.createdAt) === today) counts.today += 1;
      if (item.platform === 'bilibili') counts.bilibili += 1;
      if (item.platform === 'zhihu') counts.zhihu += 1;
    }
    return counts;
  }

  getPublicAccounts() {
    const bili = this.getSession('bilibili');
    const zhihu = this.getSession('zhihu');
    return {
      bilibili: bili
        ? {
            connected: Boolean(bili.cookies?.SESSDATA),
            name: bili.name || 'B站账号',
            face: bili.face || null,
            mid: bili.mid || null,
            connectedAt: bili.connectedAt || null,
            lastSyncAt: bili.lastSyncAt || this.state.meta.lastBiliSyncAt || null,
            needsReauth: Boolean(bili.needsReauth),
          }
        : { connected: false },
      zhihu: zhihu
        ? {
            connected: true,
            name: zhihu.name || '知乎账号',
            avatar: zhihu.avatar || null,
            urlToken: zhihu.urlToken || null,
            mode: zhihu.mode || 'bridge',
            connectedAt: zhihu.connectedAt || null,
            lastSyncAt: zhihu.lastSyncAt || zhihu.lastBridgeAt || this.state.meta.lastZhihuSyncAt || null,
            followeeCount: zhihu.followeeCount || null,
            needsBridge: Boolean(zhihu.needsBridge),
          }
        : { connected: false },
    };
  }
}
