import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBridgePayload,
  parseZhihuActivity,
  parseZhihuAnswers,
  parseZhihuPins,
} from '../server/zhihu.js';

const creator = { url_token: 'sift-user', name: '关注的人', avatar_url: 'https://pic1.zhimg.com/avatar.jpg' };

function answerTarget() {
  return {
    type: 'answer',
    id: 101,
    question: { id: 55, title: '这是一个问题吗？' },
    author: { url_token: 'sift-user', name: '关注的人', avatar_url: 'https://pic1.zhimg.com/avatar.jpg' },
    excerpt: '<p>回答的摘要 &amp; 内容</p>',
    created_time: 1700000000,
    voteup_count: 8,
    comment_count: 2,
  };
}

test('parses an answer activity from a followed creator', () => {
  const item = parseZhihuActivity({
    type: 'MEMBER_ANSWER_QUESTION',
    created_time: 1700000000,
    target: answerTarget(),
  }, creator);

  assert.ok(item);
  assert.equal(item.id, 'zhihu:answer:101');
  assert.equal(item.kind, 'answer');
  assert.equal(item.title, '这是一个问题吗？');
  assert.equal(item.excerpt, '回答的摘要 & 内容');
  assert.equal(item.url, 'https://www.zhihu.com/question/55/answer/101');
  assert.equal(item.author.id, 'sift-user');
  assert.equal(item.createdAt, 1700000000000);
  assert.equal(item.stats.likes, 8);
});

test('ignores social actions, other authors and unstamped content', () => {
  assert.equal(parseZhihuActivity({ type: 'MEMBER_VOTEUP_ANSWER', target: answerTarget() }, creator), null);
  assert.equal(parseZhihuActivity({ type: 'MEMBER_FOLLOW_COLLECTION', target: answerTarget() }, creator), null);

  const otherAuthor = answerTarget();
  otherAuthor.author.url_token = 'someone-else';
  assert.equal(parseZhihuActivity({
    type: 'MEMBER_ANSWER_QUESTION',
    target: otherAuthor,
  }, creator), null);

  assert.equal(parseZhihuActivity({
    type: 'MEMBER_ANSWER_QUESTION',
    target: { ...answerTarget(), created_time: 0 },
  }, creator), null);
});

test('parses pins with images and text', () => {
  const author = { url_token: 'sift-user', name: '关注的人' };
  const [pin] = parseZhihuPins({
    data: [{
      type: 'pin',
      id: 303,
      created_time: 1700000300,
      author,
      content: [
        { type: 'text', own_text: '想法正文' },
        { type: 'image', src: 'https://pic1.zhimg.com/pin.jpg' },
      ],
      like_count: 4,
    }],
  }, creator);

  assert.ok(pin);
  assert.equal(pin.kind, 'post');
  assert.equal(pin.title, '想法正文');
  assert.equal(pin.cover, 'https://pic1.zhimg.com/pin.jpg');
  assert.equal(pin.url, 'https://www.zhihu.com/pin/303');
});

test('parses answers endpoint payloads', () => {
  const items = parseZhihuAnswers({ data: [answerTarget()] }, creator);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'answer');
});

test('merges bridge payloads and de-duplicates items', () => {
  const payload = {
    account: { url_token: 'me', name: '我' },
    followees: [creator],
    creators: [
      {
        creator,
        activities: {
          data: [{
            type: 'MEMBER_ANSWER_QUESTION',
            target: answerTarget(),
          }],
        },
      },
      {
        creator,
        answers: { data: [answerTarget()] },
        error: 'timeout',
      },
    ],
  };

  const result = parseBridgePayload(payload);
  assert.equal(result.account.urlToken, 'me');
  assert.equal(result.followees.length, 1);
  assert.equal(result.followees[0].urlToken, 'sift-user');
  assert.equal(result.items.length, 1);
  assert.equal(result.errors, 1);
});

test('rejects bridge items without a valid platform or url', () => {
  const result = parseBridgePayload({
    creators: [{
      creator,
      items: [
        { id: 'zhihu:answer:1', platform: 'zhihu', url: 'https://www.zhihu.com/question/1/answer/1', createdAt: 1 },
        { id: 'evil:1', platform: 'evil', url: 'https://example.com' },
      ],
    }],
  });
  assert.equal(result.items.length, 1);
});
