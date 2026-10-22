import { CookieJar } from './cookies.js';
import { HttpError, requestJson } from './http.js';
import {
  firstLine,
  mapLimit,
  normalizeImageUrl,
  normalizeZhihuUrl,
  safeHttpUrl,
  sleep,
  stripHtml,
  truncate,
} from './util.js';

const ZHIHU = 'https://www.zhihu.com';
const CREATED_ACTION = /(CREATE|ANSWER|PUBLISH|POST)/i;
const IGNORED_ACTION = /(VOTE|FOLLOW|COLLECT|COMMENT|THANK|LIKE|SHARE|REPOST)/i;

export class ZhihuError extends Error {
  constructor(message, { code = null, status = 0, body = null } = {}) {
    super(message);
    this.name = 'ZhihuError';
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

function parseZhihuError(data, status) {
  const code = data?.error?.code ?? data?.code ?? null;
  const message = data?.error?.message || data?.message || `知乎接口请求失败（HTTP ${status}）`;
  if (status === 403 || code === 40352 || code === 40353 || data?.error?.need_login) {
    return new ZhihuError(
      '知乎触发了安全验证，服务器无法直接读取。请使用浏览器同步。',
      { code: 'RISK_CONTROL', status, body: data },
    );
  }
  if (status === 401 || code === 101 || code === 100) {
    return new ZhihuError('知乎登录状态无效，请重新连接', {
      code: 'NEED_LOGIN',
      status,
      body: data,
    });
  }
  return new ZhihuError(message, { code, status, body: data });
}

function toMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return number > 100000000000 ? number : number * 1000;
}

function zhihuAvatar(url) {
  if (!url) return null;
  return normalizeImageUrl(String(url).replace(/\{size\}/g, 'xl'));
}

function imageFromHtml(html) {
  if (!html || typeof html !== 'string') return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? normalizeImageUrl(match[1]) : null;
}

function pinParts(content) {
  if (Array.isArray(content)) {
    const texts = [];
    let cover = null;
    for (const part of content) {
      if (typeof part === 'string') {
        texts.push(stripHtml(part));
        cover ||= imageFromHtml(part);
        continue;
      }
      if (!part || typeof part !== 'object') continue;
      const text = part.own_text || part.text || part.content || part.title || '';
      if (text) texts.push(stripHtml(text));
      const image = part.src || part.url || part.image_url || part.imageUrl || part.thumbnail;
      if (image) cover ||= normalizeImageUrl(image);
      if (!cover) cover ||= imageFromHtml(part.content || part.own_text || '');
    }
    return { text: texts.join('\n').trim(), cover };
  }
  if (typeof content === 'string') {
    return { text: stripHtml(content), cover: imageFromHtml(content) };
  }
  return { text: '', cover: null };
}

function answerUrl(target) {
  const questionId = target?.question?.id || target?.question?.question_id || target?.question_id;
  if (questionId && target?.id) return `https://www.zhihu.com/question/${questionId}/answer/${target.id}`;
  if (target?.id) return `https://www.zhihu.com/answer/${target.id}`;
  return null;
}

function articleUrl(target) {
  if (target?.id) return `https://zhuanlan.zhihu.com/p/${target.id}`;
  return normalizeZhihuUrl(target?.url) || null;
}

function pinUrl(target) {
  if (target?.id) return `https://www.zhihu.com/pin/${target.id}`;
  return null;
}

function zvideoUrl(target) {
  if (target?.id) return `https://www.zhihu.com/zvideo/${target.id}`;
  return null;
}

function questionUrl(target) {
  if (target?.id) return `https://www.zhihu.com/question/${target.id}`;
  return null;
}

function normalizeZhihuItem({ kind, target, activity = null, creator = null, fallbackAuthor = null }) {
  if (!target) return null;
  const authorRaw = target.author || activity?.actor || fallbackAuthor || creator || {};
  const authorToken = authorRaw.url_token || authorRaw.token || creator?.url_token || '';
  const authorName = authorRaw.name || creator?.name || '知乎用户';

  let title = '';
  let excerpt = '';
  let url = null;
  let cover = null;
  let actualKind = kind;
  let contentText = '';

  if (kind === 'answer') {
    title = target.question?.title || target.question?.name || '知乎回答';
    contentText = target.excerpt || target.content || target.description || '';
    excerpt = stripHtml(contentText);
    url = answerUrl(target);
    cover = normalizeImageUrl(target.thumbnail || target.image_url);
  } else if (kind === 'article') {
    title = target.title || '知乎文章';
    contentText = target.excerpt || target.content || target.description || '';
    excerpt = stripHtml(contentText);
    url = articleUrl(target);
    cover =
      normalizeImageUrl(target.image_url || target.thumbnail || target.title_image) ||
      imageFromHtml(target.content || '');
  } else if (kind === 'pin') {
    actualKind = 'post';
    const parts = pinParts(target.content);
    contentText = parts.text || target.excerpt || '';
    excerpt = stripHtml(contentText);
    title = firstLine(excerpt, 56) || '知乎想法';
    url = pinUrl(target);
    cover = parts.cover || normalizeImageUrl(target.thumbnail || target.image_url);
  } else if (kind === 'zvideo') {
    actualKind = 'video';
    title = target.title || '知乎视频';
    excerpt = stripHtml(target.description || target.excerpt || '');
    url = zvideoUrl(target);
    cover = normalizeImageUrl(target.thumbnail || target.cover_url || target.image_url);
  } else if (kind === 'question') {
    actualKind = 'post';
    title = target.title || '知乎提问';
    excerpt = stripHtml(target.excerpt || target.description || target.detail || '');
    url = questionUrl(target);
    cover = normalizeImageUrl(target.thumbnail || target.image_url);
  } else {
    return null;
  }

  if (!url) return null;
  const createdAt = toMs(target.created_time || activity?.created_time || target.updated_time);
  if (!createdAt) return null;
  const itemId = `zhihu:${actualKind}:${target.id || activity?.id || url}`;
  const stats = {
    likes: Number(target.voteup_count ?? target.like_count ?? 0) || 0,
    comments: Number(target.comment_count ?? 0) || 0,
  };
  return {
    id: itemId,
    platform: 'zhihu',
    kind: actualKind,
    title: truncate(stripHtml(title), 160) || firstLine(excerpt, 48) || '知乎内容',
    excerpt: truncate(excerpt, 260),
    url,
    cover,
    createdAt,
    via: activity?.action_text || activity?.type || '知乎更新',
    stats,
    author: {
      id: String(authorToken || ''),
      name: authorName,
      avatar: zhihuAvatar(authorRaw.avatar_url || authorRaw.avatar || creator?.avatar_url),
      url: authorToken ? `https://www.zhihu.com/people/${authorToken}` : null,
    },
  };
}

function targetKind(target, activityType) {
  const type = target?.type;
  if (type === 'answer' || type === 'article' || type === 'pin' || type === 'zvideo' || type === 'question') {
    return type;
  }
  if (/ANSWER/i.test(activityType || '')) return 'answer';
  if (/ARTICLE/i.test(activityType || '')) return 'article';
  if (/PIN/i.test(activityType || '')) return 'pin';
  if (/ZVIDEO/i.test(activityType || '')) return 'zvideo';
  if (/QUESTION/i.test(activityType || '')) return 'question';
  return null;
}

export function parseZhihuActivity(activity, creator = null) {
  if (!activity?.target) return null;
  const action = activity.type || '';
  if (IGNORED_ACTION.test(action)) return null;
  const kind = targetKind(activity.target, action);
  if (!kind) return null;
  const authorToken = activity.target?.author?.url_token;
  if (creator?.url_token && authorToken && authorToken !== creator.url_token) return null;
  if (!authorToken && !CREATED_ACTION.test(action)) return null;
  return normalizeZhihuItem({ kind, target: activity.target, activity, creator });
}

export function parseZhihuAnswers(raw, creator = null) {
  return (raw?.data || [])
    .map((target) => normalizeZhihuItem({ kind: 'answer', target, creator }))
    .filter(Boolean);
}

export function parseZhihuArticles(raw, creator = null) {
  return (raw?.data || [])
    .map((target) => normalizeZhihuItem({ kind: 'article', target, creator }))
    .filter(Boolean);
}

export function parseZhihuPins(raw, creator = null) {
  return (raw?.data || [])
    .map((target) => normalizeZhihuItem({ kind: 'pin', target, creator }))
    .filter(Boolean);
}

export function normalizeZhihuAccount(me) {
  if (!me) return null;
  return {
    urlToken: me.url_token || me.urlToken || null,
    name: me.name || '知乎账号',
    avatar: zhihuAvatar(me.avatar_url || me.avatar),
  };
}

export function normalizeZhihuFollowee(followee) {
  if (!followee) return null;
  const token = followee.url_token || followee.urlToken;
  if (!token) return null;
  return {
    urlToken: token,
    name: followee.name || '知乎用户',
    avatar: zhihuAvatar(followee.avatar_url || followee.avatar),
    headline: followee.headline || '',
  };
}

export function parseBridgePayload(payload = {}) {
  const account = normalizeZhihuAccount(payload.account);
  const followees = (payload.followees || []).map(normalizeZhihuFollowee).filter(Boolean);
  const items = [];
  const seen = new Set();
  let errors = 0;

  for (const entry of payload.creators || []) {
    if (!entry) continue;
    const creator = normalizeZhihuFollowee(entry.creator || entry) || {};
    if (entry.error) errors += 1;
    const push = (item) => {
      if (!item || seen.has(item.id)) return;
      seen.add(item.id);
      items.push(item);
    };

    if (Array.isArray(entry.items)) {
      for (const item of entry.items) {
        if (item?.id && item?.platform === 'zhihu' && item?.url) push(item);
      }
      continue;
    }

    const activityData = entry.activities?.data || [];
    for (const activity of activityData) push(parseZhihuActivity(activity, creator));
    if (entry.answers) for (const item of parseZhihuAnswers(entry.answers, creator)) push(item);
    if (entry.articles) for (const item of parseZhihuArticles(entry.articles, creator)) push(item);
    if (entry.pins) for (const item of parseZhihuPins(entry.pins, creator)) push(item);
  }

  return { account, followees, items, errors };
}

export class ZhihuClient {
  constructor({ jar, cookies } = {}) {
    this.jar = jar || new CookieJar(cookies || {});
  }

  get cookies() {
    return this.jar.toJSON();
  }

  headersFor(referer) {
    return {
      referer: referer || `${ZHIHU}/`,
      'x-requested-with': 'fetch',
      'x-zse-93': '101_3_3.0',
      accept: '*/*',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    };
  }

  async request(path, { referer } = {}) {
    const url = path.startsWith('http') ? path : `${ZHIHU}${path}`;
    let response;
    try {
      response = await requestJson(url, {
        jar: this.jar,
        headers: this.headersFor(referer),
        timeoutMs: 15000,
        retries: 0,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        throw parseZhihuError(error.body, error.status);
      }
      throw error;
    }
    if (response?.error) throw parseZhihuError(response, 200);
    return response;
  }

  async me() {
    return this.request('/api/v4/me', { referer: `${ZHIHU}/` });
  }

  async fetchFollowees({ maxCreators = 120, onProgress = () => {} } = {}) {
    const me = await this.me();
    const token = me?.url_token;
    if (!token) throw new ZhihuError('无法读取知乎账号信息', { code: 'NEED_LOGIN' });
    const list = [];
    let total = 0;
    for (let offset = 0; offset < maxCreators; offset += 20) {
      const params = new URLSearchParams({
        offset: String(offset),
        limit: '20',
        include: 'data[*].answer_count,articles_count,follower_count',
      });
      const data = await this.request(`/api/v4/members/${encodeURIComponent(token)}/followees?${params}`, {
        referer: `${ZHIHU}/people/${token}/following`,
      });
      const page = data?.data || [];
      total = Number(data?.paging?.totals) || total;
      for (const entry of page) {
        const normalized = normalizeZhihuFollowee(entry);
        if (normalized) list.push(normalized);
      }
      onProgress({ phase: 'followees', done: list.length, total: Math.min(total || maxCreators, maxCreators) });
      if (data?.paging?.is_end || !page.length) break;
      await sleep(220);
    }
    return { me, list: list.slice(0, maxCreators), total };
  }

  async activities(token) {
    const params = new URLSearchParams({ limit: '10', offset: '0' });
    return this.request(`/api/v4/members/${encodeURIComponent(token)}/activities?${params}`, {
      referer: `${ZHIHU}/people/${token}`,
    });
  }

  async answers(token) {
    const params = new URLSearchParams({ limit: '4', offset: '0', sort_by: 'created' });
    return this.request(`/api/v4/members/${encodeURIComponent(token)}/answers?${params}`, {
      referer: `${ZHIHU}/people/${token}/answers`,
    });
  }

  async articles(token) {
    const params = new URLSearchParams({ limit: '4', offset: '0', sort_by: 'created' });
    return this.request(`/api/v4/members/${encodeURIComponent(token)}/articles?${params}`, {
      referer: `${ZHIHU}/people/${token}/posts`,
    });
  }

  async pins(token) {
    const params = new URLSearchParams({ limit: '4', offset: '0' });
    return this.request(`/api/v4/members/${encodeURIComponent(token)}/pins?${params}`, {
      referer: `${ZHIHU}/people/${token}/pins`,
    });
  }

  async collectCreator(creator) {
    const items = [];
    let activities = null;
    try {
      activities = await this.activities(creator.urlToken);
      for (const activity of activities?.data || []) {
        const item = parseZhihuActivity(activity, creator);
        if (item) items.push(item);
      }
    } catch (error) {
      if (error.code === 'RISK_CONTROL' || error.code === 'NEED_LOGIN') throw error;
    }

    if (!items.length) {
      try {
        const answers = await this.answers(creator.urlToken);
        for (const item of parseZhihuAnswers(answers, creator)) items.push(item);
      } catch (error) {
        if (error.code === 'RISK_CONTROL' || error.code === 'NEED_LOGIN') throw error;
      }
      try {
        const articles = await this.articles(creator.urlToken);
        for (const item of parseZhihuArticles(articles, creator)) items.push(item);
      } catch (error) {
        if (error.code === 'RISK_CONTROL' || error.code === 'NEED_LOGIN') throw error;
      }
      try {
        const pins = await this.pins(creator.urlToken);
        for (const item of parseZhihuPins(pins, creator)) items.push(item);
      } catch (error) {
        if (error.code === 'RISK_CONTROL' || error.code === 'NEED_LOGIN') throw error;
      }
    }
    return items;
  }

  async sync({ maxCreators = 100, onProgress = () => {} } = {}) {
    const { me, list } = await this.fetchFollowees({ maxCreators, onProgress });
    const creators = list.slice(0, maxCreators);
    const items = [];
    const seen = new Set();
    let done = 0;
    await mapLimit(creators, 2, async (creator) => {
      try {
        const creatorItems = await this.collectCreator(creator);
        for (const item of creatorItems) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          items.push(item);
        }
      } catch (error) {
        if (error.code === 'RISK_CONTROL' || error.code === 'NEED_LOGIN') throw error;
      } finally {
        done += 1;
        onProgress({
          phase: 'zhihu',
          done,
          total: creators.length,
          message: `读取知乎关注者 ${done}/${creators.length}`,
        });
      }
    });
    return { me, followees: list, creators, items };
  }
}
