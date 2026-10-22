import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { CookieJar } from './cookies.js';
import { HttpError, requestJson } from './http.js';
import {
  firstLine,
  mapLimit,
  normalizeBiliUrl,
  normalizeImageUrl,
  parseCount,
  safeHttpUrl,
  stripHtml,
  truncate,
} from './util.js';

const BILI_API = 'https://api.bilibili.com';
const PASSPORT_API = 'https://passport.bilibili.com';
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

const DM_FINGERPRINT = {
  dm_img_list: '[]',
  dm_img_str: 'V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ',
  dm_cover_img_str:
    'QU5HTEUgKEludGVsLCBJbnRlbChSKSBVSEQgR3JhcGhpY3MgNjMwIChveDg2ZTY3YzNiIDB4MDAwMDMwMzIpIERpcmVjdDNEMTEgdnNfNV8wIHBzXzVfMCwgRDNEMTEpR29vZ2xlIEluYy4gKEludGVsKSc',
  dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
};

export class BilibiliError extends Error {
  constructor(message, { code = null, status = 0, cause = null } = {}) {
    super(message);
    this.name = 'BilibiliError';
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

function needLogin() {
  return new BilibiliError('B站登录已失效，请重新扫码连接', { code: 'NEED_LOGIN' });
}

function assertOk(data, fallbackMessage = 'B站接口请求失败') {
  if (!data || data.code === undefined) return data;
  if (data.code === 0) return data;
  if (data.code === -101) throw needLogin();
  if (data.code === -352) {
    throw new BilibiliError('B站触发了访问风控', { code: 'RISK_CONTROL', status: 412 });
  }
  throw new BilibiliError(data.message || fallbackMessage, {
    code: data.code,
    status: 400,
  });
}

function biliHeaders(referer) {
  return {
    referer,
    origin: 'https://www.bilibili.com',
    accept: 'application/json, text/plain, */*',
  };
}

function extractAuthorAvatar(author) {
  if (author?.face) return normalizeImageUrl(author.face);
  const layers = author?.avatar?.fallback_layers?.layers || [];
  for (const layer of layers) {
    const url = layer?.resource?.res_image?.image_src?.remote?.url;
    if (url) return normalizeImageUrl(url);
  }
  return null;
}

function imageFromMajor(major) {
  if (!major) return null;
  const candidates = [
    major.archive?.cover,
    major.opus?.pics?.[0]?.url,
    major.article?.covers?.[0],
    major.draw?.items?.[0]?.src,
  ];
  for (const value of candidates) {
    if (value) return normalizeImageUrl(value);
  }
  return null;
}

function dynamicTitle(type, major, text) {
  if (type === 'DYNAMIC_TYPE_AV') return major.archive?.title || '';
  if (type === 'DYNAMIC_TYPE_ARTICLE') return major.article?.title || '';
  if (type === 'DYNAMIC_TYPE_FORWARD') return firstLine(text, 52) || '转发动态';
  return major.opus?.title || firstLine(text, 52) || (major.draw?.items?.length ? '图片动态' : '动态');
}

function formatDuration(seconds) {
  const total = Math.round(Number(seconds) || 0);
  if (total <= 0) return null;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  if (hours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function parseDynamicItem(item, now = Date.now()) {
  if (!item || !item.id_str) return null;
  const type = item.type;
  const supported = new Set([
    'DYNAMIC_TYPE_AV',
    'DYNAMIC_TYPE_DRAW',
    'DYNAMIC_TYPE_WORD',
    'DYNAMIC_TYPE_FORWARD',
    'DYNAMIC_TYPE_ARTICLE',
  ]);
  if (!supported.has(type)) return null;

  const modules = item.modules || {};
  const author = modules.module_author || {};
  const dynamic = modules.module_dynamic || {};
  const major = dynamic.major || {};
  const opus = major.opus || null;
  const text = opus?.summary?.text || dynamic.desc?.text || '';

  let kind = 'post';
  let title = '';
  let excerpt = '';
  let url = '';
  let cover = null;
  let duration = null;

  if (type === 'DYNAMIC_TYPE_AV') {
    const archive = major.archive;
    if (!archive) return null;
    kind = 'video';
    title = archive.title || '';
    excerpt = archive.desc || '';
    url = archive.jump_url || `https://www.bilibili.com/video/${archive.bvid || ''}`;
    cover = normalizeImageUrl(archive.cover);
    duration = archive.duration_text || null;
  } else if (type === 'DYNAMIC_TYPE_ARTICLE') {
    const article = major.article;
    if (!article) return null;
    kind = 'article';
    title = article.title || '';
    excerpt = article.desc || '';
    url = article.jump_url || `https://www.bilibili.com/read/cv${article.id || ''}`;
    cover = normalizeImageUrl(article.covers?.[0]);
  } else {
    kind = 'post';
    title = dynamicTitle(type, major, text);
    excerpt = text;
    cover = imageFromMajor(major);
    url = opus?.jump_url || `https://t.bilibili.com/${item.id_str}`;
    if (type === 'DYNAMIC_TYPE_FORWARD' && !cover) {
      cover = imageFromMajor(item.orig?.modules?.module_dynamic?.major);
    }
  }

  const parsedAt = Number(author.pub_ts);
  const createdAt = Number.isFinite(parsedAt) && parsedAt > 0 ? parsedAt * 1000 : now;
  if (!url || !normalizeBiliUrl(url)) {
    url = `https://t.bilibili.com/${item.id_str}`;
  }
  const normalizedUrl = normalizeBiliUrl(url) || `https://t.bilibili.com/${item.id_str}`;

  const archived = major.archive || null;
  const stat = modules.module_stat || {};
  const stats = {
    likes: Number(stat.like?.count) || 0,
    comments: Number(stat.comment?.count) || 0,
    shares: Number(stat.forward?.count) || 0,
  };
  if (archived) {
    stats.views = parseCount(archived.stat?.play);
    stats.viewsText = archived.stat?.play || '';
    stats.danmaku = parseCount(archived.stat?.danmaku);
  }

  const excerptText = truncate(stripHtml(excerpt), 260);
  return {
    id: `bilibili:dynamic:${item.id_str}`,
    platform: 'bilibili',
    kind,
    title: truncate(stripHtml(title), 160) || firstLine(excerptText, 48) || 'B站动态',
    excerpt: excerptText,
    url: normalizedUrl,
    cover,
    duration,
    createdAt,
    via: author.pub_action || type,
    isTop: Boolean(author.is_top),
    stats,
    author: {
      id: String(author.mid || ''),
      name: author.name || '未知UP主',
      avatar: extractAuthorAvatar(author),
      url: author.mid ? `https://space.bilibili.com/${author.mid}` : null,
    },
  };
}

export function parseFavoriteItem(media, folder = {}) {
  if (!media || Number(media.type) !== 2) return null;
  if (Number(media.attr) & 1) return null;
  const bvid = media.bvid || media.bv_id || '';
  const avid = media.id || '';
  const url = normalizeBiliUrl(
    bvid
      ? `https://www.bilibili.com/video/${bvid}`
      : avid ? `https://www.bilibili.com/video/av${avid}` : '',
  );
  if (!url) return null;

  const upper = media.upper || {};
  const publishedSeconds = Number(media.pubtime || media.ctime) || 0;
  const savedSeconds = Number(media.fav_time) || 0;
  return {
    id: `bilibili:favorite:${folder.id || 'folder'}:${bvid || avid}`,
    platform: 'bilibili',
    kind: 'video',
    collection: 'favorite',
    folder: folder.title || '',
    title: truncate(stripHtml(media.title), 160) || 'B站视频',
    excerpt: truncate(stripHtml(media.intro), 260),
    url,
    cover: normalizeImageUrl(media.cover),
    duration: formatDuration(media.duration),
    createdAt: publishedSeconds ? publishedSeconds * 1000 : Date.now(),
    publishedAt: publishedSeconds ? publishedSeconds * 1000 : null,
    savedAt: savedSeconds ? savedSeconds * 1000 : null,
    via: folder.title ? `收藏于「${folder.title}」` : '收藏夹',
    stats: {
      views: parseCount(media.cnt_info?.play),
      likes: parseCount(media.cnt_info?.like),
      comments: parseCount(media.cnt_info?.reply),
    },
    author: {
      id: String(upper.mid || ''),
      name: upper.name || '未知UP主',
      avatar: normalizeImageUrl(upper.face),
      url: upper.mid ? `https://space.bilibili.com/${upper.mid}` : null,
    },
  };
}

export function parseWatchLaterItem(media) {
  if (!media) return null;
  const bvid = media.bvid || '';
  const avid = media.aid || media.id || '';
  const url = normalizeBiliUrl(
    bvid
      ? `https://www.bilibili.com/video/${bvid}`
      : avid ? `https://www.bilibili.com/video/av${avid}` : '',
  );
  if (!url) return null;

  const owner = media.owner || {};
  const publishedSeconds = Number(media.pubdate || media.ctime) || 0;
  const savedSeconds = Number(media.add_at || media.addAt || media.saved_at) || 0;
  return {
    id: `bilibili:watchlater:${bvid || avid}`,
    platform: 'bilibili',
    kind: 'video',
    collection: 'watchlater',
    title: truncate(stripHtml(media.title), 160) || 'B站视频',
    excerpt: truncate(stripHtml(media.desc), 260),
    url,
    cover: normalizeImageUrl(media.pic),
    duration: formatDuration(media.duration),
    createdAt: publishedSeconds ? publishedSeconds * 1000 : Date.now(),
    publishedAt: publishedSeconds ? publishedSeconds * 1000 : null,
    savedAt: savedSeconds ? savedSeconds * 1000 : null,
    via: '稍后再看',
    stats: {
      views: parseCount(media.stat?.view),
      likes: parseCount(media.stat?.like),
      comments: parseCount(media.stat?.reply),
    },
    author: {
      id: String(owner.mid || ''),
      name: owner.name || '未知UP主',
      avatar: normalizeImageUrl(owner.face),
      url: owner.mid ? `https://space.bilibili.com/${owner.mid}` : null,
    },
  };
}

export class BilibiliClient {
  constructor({ jar, cookies } = {}) {
    this.jar = jar || new CookieJar(cookies || {});
    this.wbi = null;
    this.fingerprintChecked = false;
  }

  get cookies() {
    return this.jar.toJSON();
  }

  get mid() {
    return this.jar.get('DedeUserID') || null;
  }

  async ensureFingerprint() {
    if (this.fingerprintChecked && this.jar.has('buvid3')) return;
    this.fingerprintChecked = true;
    if (this.jar.has('buvid3')) return;
    try {
      const data = await requestJson(`${BILI_API}/x/frontend/finger/spi`, {
        jar: this.jar,
        headers: biliHeaders('https://www.bilibili.com/'),
      });
      if (data?.data?.b_3) this.jar.set('buvid3', data.data.b_3);
      if (data?.data?.b_4) this.jar.set('buvid4', data.data.b_4);
      if (!this.jar.has('b_nut')) this.jar.set('b_nut', String(Math.floor(Date.now() / 1000)));
    } catch {
      // Fingerprint is helpful but not mandatory for every endpoint.
    }
  }

  async getNav() {
    return requestJson(`${BILI_API}/x/web-interface/nav`, {
      jar: this.jar,
      headers: biliHeaders('https://www.bilibili.com/'),
    });
  }

  async getWbiKeys(force = false) {
    const fresh = this.wbi && Date.now() - this.wbi.at < 55 * 60 * 1000;
    if (fresh && !force) return this.wbi;
    const nav = await this.getNav();
    const img = nav?.data?.wbi_img?.img_url || '';
    const sub = nav?.data?.wbi_img?.sub_url || '';
    const imgKey = img.split('/').pop()?.split('.')[0] || '';
    const subKey = sub.split('/').pop()?.split('.')[0] || '';
    if (!imgKey || !subKey) {
      throw new BilibiliError('无法获取 B站签名密钥，请稍后再试');
    }
    const raw = imgKey + subKey;
    const mixinKey = MIXIN_KEY_ENC_TAB.map((index) => raw[index]).join('').slice(0, 32);
    this.wbi = { mixinKey, at: Date.now() };
    return this.wbi;
  }

  async signedQuery(params) {
    const { mixinKey } = await this.getWbiKeys();
    const wts = Math.floor(Date.now() / 1000);
    const clean = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      clean[key] = String(value).replace(/[!'()*]/g, '');
    }
    clean.wts = String(wts);
    const query = Object.keys(clean)
      .sort()
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(clean[key])}`)
      .join('&');
    const wRid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
    return `${query}&w_rid=${wRid}`;
  }

  async generateQr() {
    const data = await requestJson(`${PASSPORT_API}/x/passport-login/web/qrcode/generate`, {
      jar: this.jar,
      headers: biliHeaders('https://www.bilibili.com/'),
    });
    assertOk(data, '无法生成 B站登录二维码');
    const url = data.data?.url;
    const key = data.data?.qrcode_key;
    if (!url || !key) throw new BilibiliError('B站未返回二维码');
    const qrDataUrl = await QRCode.toDataURL(url, {
      margin: 1,
      width: 340,
      color: { dark: '#1d1b17', light: '#fbf8f0' },
    });
    return { key, url, qrDataUrl, expiresIn: 180 };
  }

  async pollQr(key) {
    const data = await requestJson(
      `${PASSPORT_API}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`,
      {
        jar: this.jar,
        headers: biliHeaders('https://www.bilibili.com/'),
      },
    );
    const code = data?.data?.code;
    if (code === 86101) return { status: 'waiting' };
    if (code === 86090) return { status: 'scanned' };
    if (code === 86038) return { status: 'expired' };
    if (code !== 0) {
      throw new BilibiliError(data?.data?.message || data?.message || 'B站扫码登录失败', {
        code: data?.data?.code ?? data?.code,
      });
    }

    if (data?.data?.url) {
      try {
        const callback = new URL(data.data.url);
        for (const name of ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']) {
          const value = callback.searchParams.get(name);
          if (value) this.jar.set(name, value);
        }
      } catch {
        // Set-Cookie already handled.
      }
    }

    if (!this.jar.has('SESSDATA') || !this.jar.has('DedeUserID')) {
      throw new BilibiliError('扫码已完成，但没有拿到登录凭证，请重试');
    }

    const nav = await this.getNav();
    if (!nav?.data?.isLogin) {
      throw new BilibiliError('B站登录校验未通过，请重新扫码');
    }
    return {
      status: 'success',
      account: {
        mid: String(nav.data.mid),
        name: nav.data.uname || 'B站账号',
        face: normalizeImageUrl(nav.data.face),
      },
    };
  }

  async fetchFollowings(onProgress = () => {}) {
    const mid = this.mid;
    if (!mid) throw needLogin();
    const all = [];
    let total = 0;
    for (let page = 1; page <= 20; page += 1) {
      const params = {
        vmid: mid,
        pn: page,
        ps: 50,
        order: 'desc',
        order_type: 'attention',
        type: 0,
        web_location: '333.1387',
      };
      const query = await this.signedQuery(params);
      const data = await requestJson(`${BILI_API}/x/relation/followings?${query}`, {
        jar: this.jar,
        headers: biliHeaders(`https://space.bilibili.com/${mid}/fans/follow`),
      });
      assertOk(data, '无法读取 B站关注列表');
      const list = data?.data?.list || [];
      total = Number(data?.data?.total) || total;
      for (const entry of list) {
        all.push({
          platform: 'bilibili',
          authorId: String(entry.mid),
          name: entry.uname || '未知UP主',
          avatar: normalizeImageUrl(entry.face),
          url: `https://space.bilibili.com/${entry.mid}`,
        });
      }
      onProgress({ done: all.length, total, page });
      if (!list.length || all.length >= total || list.length < 50) break;
    }
    return { list: all, total };
  }

  async fetchFollowingPage({ page = 1, offset = '' } = {}) {
    const params = {
      type: 'all',
      page,
      timezone_offset: String(new Date().getTimezoneOffset()),
      platform: 'web',
      features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote',
      web_location: '333.999',
      ...DM_FINGERPRINT,
    };
    if (offset) params.offset = offset;
    const query = await this.signedQuery(params);
    const data = await requestJson(`${BILI_API}/x/polymer/web-dynamic/v1/feed/all?${query}`, {
      jar: this.jar,
      headers: biliHeaders('https://t.bilibili.com/'),
    });
    assertOk(data, '无法读取 B站关注动态');
    return {
      items: data?.data?.items || [],
      offset: data?.data?.offset || '',
      hasMore: Boolean(data?.data?.has_more),
      updateNum: Number(data?.data?.update_num) || 0,
    };
  }

  async fetchFollowingFeed({ maxPages = 3, cutoffMs = 0, onProgress = () => {} } = {}) {
    const all = [];
    let offset = '';
    for (let page = 1; page <= maxPages; page += 1) {
      const result = await this.fetchFollowingPage({ page, offset });
      all.push(...result.items);
      onProgress({
        phase: 'feed',
        done: page,
        total: maxPages,
        message: `读取关注动态第 ${page} 页`,
      });
      if (!result.hasMore || !result.offset || !result.items.length) break;
      if (cutoffMs) {
        const newest = result.items.reduce((latest, raw) => {
          const at = Number(raw?.modules?.module_author?.pub_ts) || 0;
          return Math.max(latest, at);
        }, 0);
        if (newest && newest * 1000 < cutoffMs) break;
      }
      offset = result.offset;
    }
    return all;
  }

  async fetchFavoriteFolders() {
    await this.ensureFingerprint();
    const mid = this.mid;
    if (!mid) throw needLogin();
    const data = await requestJson(
      `${BILI_API}/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(mid)}`,
      {
        jar: this.jar,
        headers: biliHeaders(`https://space.bilibili.com/${mid}/favlist`),
      },
    );
    assertOk(data, '无法读取 B站收藏夹列表');
    return Array.isArray(data?.data?.list) ? data.data.list : [];
  }

  async fetchFavoritePage(mediaId, page = 1, pageSize = 20) {
    await this.ensureFingerprint();
    const query = new URLSearchParams({
      media_id: String(mediaId),
      pn: String(page),
      ps: String(pageSize),
      order: 'mtime',
      type: '0',
      tid: '0',
      platform: 'web',
    });
    const data = await requestJson(`${BILI_API}/x/v3/fav/resource/list?${query}`, {
      jar: this.jar,
      headers: biliHeaders(`https://www.bilibili.com/medialist/detail/ml${mediaId}`),
    });
    assertOk(data, '无法读取 B站收藏夹');
    return {
      info: data?.data?.info || null,
      medias: Array.isArray(data?.data?.medias) ? data.data.medias : [],
      hasMore: Boolean(data?.data?.has_more),
    };
  }

  async fetchWatchLater() {
    await this.ensureFingerprint();
    const data = await requestJson(`${BILI_API}/x/v2/history/toview`, {
      jar: this.jar,
      headers: biliHeaders('https://www.bilibili.com/watchlater/'),
    });
    assertOk(data, '无法读取稍后再看列表');
    return {
      items: Array.isArray(data?.data?.list) ? data.data.list : [],
      total: Number(data?.data?.count) || 0,
    };
  }

  async fetchSpaceFeed(mid) {
    const params = {
      host_mid: mid,
      timezone_offset: String(new Date().getTimezoneOffset()),
      platform: 'web',
      features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote',
      web_location: '333.999',
      ...DM_FINGERPRINT,
    };
    const query = await this.signedQuery(params);
    const data = await requestJson(`${BILI_API}/x/polymer/web-dynamic/v1/feed/space?${query}`, {
      jar: this.jar,
      headers: biliHeaders(`https://space.bilibili.com/${mid}/dynamic`),
    });
    assertOk(data, '无法读取 UP 主动态');
    return data?.data?.items || [];
  }

  async sync({ cutoffMs, maxPages = 3, onProgress = () => {} } = {}) {
    await this.ensureFingerprint();
    const cutoff = cutoffMs || Date.now() - 45 * 24 * 60 * 60 * 1000;
    const warnings = [];
    let rawItems = [];

    try {
      rawItems = await this.fetchFollowingFeed({ maxPages, cutoffMs: cutoff, onProgress });
    } catch (error) {
      if (error.code === 'NEED_LOGIN') throw error;
      warnings.push('关注动态接口暂不可用，已切换为逐位关注者读取');
      onProgress({
        phase: 'fallback',
        done: 0,
        total: 0,
        message: '关注动态接口受限，读取关注列表…',
      });
      const { list, total } = await this.fetchFollowings(({ done, total: count }) => {
        onProgress({
          phase: 'fallback',
          done,
          total: count || total || 0,
          message: `读取关注列表 ${done}/${count || total || '…'}`,
        });
      });
      const creators = list.slice(0, 300);
      if (list.length > 300) warnings.push('关注人数较多，本次只检查了最近关注的 300 位');
      let finished = 0;
      const results = await mapLimit(creators, 2, async (creator) => {
        try {
          return await this.fetchSpaceFeed(creator.authorId);
        } catch {
          return [];
        } finally {
          finished += 1;
          onProgress({
            phase: 'fallback',
            done: finished,
            total: creators.length,
            message: `逐位读取 ${finished}/${creators.length}`,
          });
        }
      });
      rawItems = results.flat();
    }

    const seen = new Set();
    const items = [];
    for (const raw of rawItems) {
      const item = parseDynamicItem(raw);
      if (!item || seen.has(item.id)) continue;
      if (item.createdAt < cutoff) continue;
      seen.add(item.id);
      items.push(item);
    }
    return { items, warnings };
  }
}

export { extractAuthorAvatar, imageFromMajor };
