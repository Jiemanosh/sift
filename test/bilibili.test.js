import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDynamicItem } from '../server/bilibili.js';

const baseStat = {
  like: { count: 12 },
  comment: { count: 3 },
  forward: { count: 1 },
};

test('parses a bilibili video dynamic', () => {
  const item = parseDynamicItem({
    id_str: '9001',
    type: 'DYNAMIC_TYPE_AV',
    modules: {
      module_author: {
        mid: 42,
        name: '测试UP',
        face: 'https://i0.hdslb.com/bfs/face/abc.jpg',
        pub_ts: '1700000000',
        pub_action: '投稿了视频',
      },
      module_dynamic: {
        major: {
          archive: {
            bvid: 'BV1xx411c7mD',
            title: '一条测试视频',
            desc: '视频简介',
            cover: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
            jump_url: 'https://www.bilibili.com/video/BV1xx411c7mD',
            duration_text: '03:12',
            stat: { play: '1.2万', danmaku: '34' },
          },
        },
      },
      module_stat: baseStat,
    },
  });

  assert.ok(item);
  assert.equal(item.id, 'bilibili:dynamic:9001');
  assert.equal(item.kind, 'video');
  assert.equal(item.title, '一条测试视频');
  assert.equal(item.excerpt, '视频简介');
  assert.equal(item.createdAt, 1700000000000);
  assert.equal(item.stats.likes, 12);
  assert.equal(item.stats.views, 12000);
  assert.equal(item.author.id, '42');
  assert.equal(item.author.name, '测试UP');
  assert.equal(item.cover, 'https://i0.hdslb.com/bfs/archive/cover.jpg');
});

test('parses image posts and falls back to t.bilibili.com', () => {
  const item = parseDynamicItem({
    id_str: '9002',
    type: 'DYNAMIC_TYPE_DRAW',
    modules: {
      module_author: { mid: '7', name: '画师', pub_ts: 1700000100 },
      module_dynamic: {
        major: {
          opus: {
            summary: { text: '今天画了一张图 <b>#插画</b>' },
            pics: [{ url: 'https://i0.hdslb.com/bfs/new_dyn/pic.jpg' }],
          },
        },
      },
      module_stat: baseStat,
    },
  });

  assert.ok(item);
  assert.equal(item.kind, 'post');
  assert.equal(item.title, '今天画了一张图 #插画');
  assert.equal(item.url, 'https://t.bilibili.com/9002');
  assert.equal(item.cover, 'https://i0.hdslb.com/bfs/new_dyn/pic.jpg');
  assert.equal(item.author.avatar, null);
});

test('parses article dynamics', () => {
  const item = parseDynamicItem({
    id_str: '9003',
    type: 'DYNAMIC_TYPE_ARTICLE',
    modules: {
      module_author: { mid: '9', name: '作者', pub_ts: '1700000200' },
      module_dynamic: {
        major: {
          article: {
            id: 771,
            title: '专栏标题',
            desc: '专栏摘要',
            covers: ['https://i0.hdslb.com/bfs/article/cover.jpg'],
          },
        },
      },
      module_stat: baseStat,
    },
  });

  assert.ok(item);
  assert.equal(item.kind, 'article');
  assert.equal(item.url, 'https://www.bilibili.com/read/cv771');
  assert.equal(item.cover, 'https://i0.hdslb.com/bfs/article/cover.jpg');
});

test('skips unsupported dynamic types and missing payloads', () => {
  assert.equal(parseDynamicItem({ id_str: '1', type: 'DYNAMIC_TYPE_LIVE_RCMD' }), null);
  assert.equal(parseDynamicItem({ id_str: '2', type: 'DYNAMIC_TYPE_AV', modules: {} }), null);
  assert.equal(parseDynamicItem(null), null);
});
