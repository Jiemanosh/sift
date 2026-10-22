import { BilibiliClient } from './bilibili.js';
import { ZhihuClient } from './zhihu.js';
import { BILI_CUTOFF_DAYS } from './config.js';
import { errorMessage } from './util.js';

export class SyncManager {
  constructor(store) {
    this.store = store;
    this.current = null;
    this.pending = false;
    this.progress = this.#idleProgress();
  }

  #idleProgress() {
    return {
      running: false,
      phase: 'idle',
      platform: null,
      message: '',
      done: 0,
      total: 0,
      startedAt: null,
      finishedAt: null,
      errors: { bilibili: null, zhihu: null },
      warnings: [],
    };
  }

  getStatus() {
    return structuredClone(this.progress);
  }

  requestSync(reason = 'manual') {
    if (this.current) {
      this.pending = true;
      return false;
    }
    this.current = this.#run(reason).finally(() => {
      this.current = null;
      if (this.pending) {
        this.pending = false;
        this.requestSync('queued');
      }
    });
    return true;
  }

  async #run(reason) {
    this.progress = {
      ...this.#idleProgress(),
      running: true,
      phase: 'starting',
      message: '准备同步…',
      startedAt: Date.now(),
    };
    try {
      const biliSession = this.store.getSession('bilibili');
      const zhihuSession = this.store.getSession('zhihu');

      if (biliSession?.cookies?.SESSDATA) {
        await this.#syncBilibili(biliSession);
      }
      if (zhihuSession && zhihuSession.mode === 'cookie' && zhihuSession.cookies?.z_c0) {
        await this.#syncZhihu(zhihuSession);
      } else if (zhihuSession && zhihuSession.mode === 'bridge') {
        this.progress.message = '知乎由浏览器书签同步';
      }

      const errors = Object.values(this.progress.errors).filter(Boolean);
      if (errors.length) {
        this.progress.message = '同步完成，但有部分来源失败';
      } else if (this.progress.phase !== 'idle') {
        this.progress.message = '同步完成';
      }
      this.progress.finishedAt = Date.now();
      this.progress.reason = reason;
    } catch (error) {
      this.progress.errors.general = errorMessage(error);
      this.progress.message = `同步失败：${errorMessage(error)}`;
    } finally {
      this.progress.running = false;
      this.progress.platform = null;
      this.progress.phase = this.progress.errors.general ? 'error' : 'idle';
      if (!this.progress.finishedAt) this.progress.finishedAt = Date.now();
    }
  }

  async #syncBilibili(session) {
    this.progress.platform = 'bilibili';
    this.progress.phase = 'bilibili';
    this.progress.message = '读取 B站关注动态…';
    this.progress.done = 0;
    this.progress.total = 0;
    this.progress.errors.bilibili = null;
    const client = new BilibiliClient({ cookies: session.cookies });
    try {
      const cutoff = Date.now() - BILI_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
      const maxPages = Math.min(10, Math.max(3, Math.ceil(BILI_CUTOFF_DAYS / 22)));
      const result = await client.sync({
        cutoffMs: cutoff,
        maxPages,
        onProgress: (event) => {
          this.progress.phase = 'bilibili';
          this.progress.message = event.message || this.progress.message;
          if (typeof event.done === 'number') this.progress.done = event.done;
          if (typeof event.total === 'number') this.progress.total = event.total;
        },
      });
      const { added, changed } = this.store.upsertItems(result.items);
      const now = Date.now();
      this.store.touchMeta({ lastBiliSyncAt: now, lastSyncAt: now });
      await this.store.updateSession('bilibili', {
        cookies: client.cookies,
        name: session.name,
        mid: session.mid,
        face: session.face,
        connectedAt: session.connectedAt || now,
        lastSyncAt: now,
        needsReauth: false,
        lastError: null,
      });
      this.progress.warnings = result.warnings || [];
      this.progress.message = `B站：${result.items.length} 条更新${added ? `，新增 ${added}` : ''}${changed ? `，更新 ${changed}` : ''}`;
    } catch (error) {
      const message = errorMessage(error);
      this.progress.errors.bilibili = message;
      if (error.code === 'NEED_LOGIN') {
        const verdict = await this.#verifyBiliLogin(client);
        if (verdict === 'invalid') {
          await this.store.updateSession('bilibili', { needsReauth: true, lastError: message });
        } else {
          const warning = verdict === 'valid'
            ? 'B站接口暂时拒绝同步，但登录仍然有效，稍后会自动重试'
            : 'B站登录暂时无法校验，已保留登录状态，稍后会自动重试';
          this.progress.warnings.push(warning);
          await this.store.updateSession('bilibili', { needsReauth: false, lastError: message });
        }
      } else {
        await this.store.updateSession('bilibili', { lastError: message });
      }
      this.progress.message = `B站同步失败：${message}`;
    }
  }

  async #verifyBiliLogin(client) {
    try {
      const nav = await client.getNav();
      return nav?.data?.isLogin ? 'valid' : 'invalid';
    } catch {
      return 'unknown';
    }
  }

  async #syncZhihu(session) {
    this.progress.platform = 'zhihu';
    this.progress.phase = 'zhihu';
    this.progress.message = '读取知乎关注者更新…';
    this.progress.done = 0;
    this.progress.total = 0;
    this.progress.errors.zhihu = null;
    const client = new ZhihuClient({ cookies: session.cookies });
    try {
      const result = await client.sync({
        maxCreators: 100,
        onProgress: (event) => {
          this.progress.phase = 'zhihu';
          this.progress.message = event.message || this.progress.message;
          if (typeof event.done === 'number') this.progress.done = event.done;
          if (typeof event.total === 'number') this.progress.total = event.total;
        },
      });
      const { added, changed } = this.store.upsertItems(result.items);
      const now = Date.now();
      this.store.touchMeta({ lastZhihuSyncAt: now, lastSyncAt: now });
      await this.store.updateSession('zhihu', {
        cookies: client.cookies,
        urlToken: result.me?.url_token || session.urlToken,
        name: result.me?.name || session.name,
        avatar: result.me?.avatar_url || session.avatar,
        followeeCount: result.followees.length,
        lastSyncAt: now,
        needsBridge: false,
        lastError: null,
      });
      this.progress.message = `知乎：${result.items.length} 条更新${added ? `，新增 ${added}` : ''}${changed ? `，更新 ${changed}` : ''}`;
    } catch (error) {
      const message = errorMessage(error);
      this.progress.errors.zhihu = message;
      const needsBridge = error.code === 'RISK_CONTROL' || error.code === 'NEED_LOGIN';
      await this.store.updateSession('zhihu', {
        needsBridge,
        lastError: message,
      });
      this.progress.message = `知乎同步失败：${message}`;
    }
  }
}
