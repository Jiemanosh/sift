import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.SIFT_DATA_DIR || path.join(ROOT, '.tmp', 'demo'));
const REAL_DATA_DIR = path.resolve(ROOT, 'data');

if (DATA_DIR === REAL_DATA_DIR) {
  console.error('[demo] 拒绝写入正式数据目录 data/，请换一个 SIFT_DATA_DIR。');
  process.exit(1);
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.now();
const at = (millisecondsAgo) => now - millisecondsAgo;

const BILI_AUTHORS = {
  linjian: {
    id: '4810021',
    name: '林间胶片',
    url: 'https://space.bilibili.com/4810021',
  },
  laozhou: {
    id: '332019',
    name: '老周修相机',
    url: 'https://space.bilibili.com/332019',
  },
  beichuang: {
    id: '772210',
    name: '北窗观影',
    url: 'https://space.bilibili.com/772210',
  },
  zhishang: {
    id: '118920',
    name: '纸上城市',
    url: 'https://space.bilibili.com/118920',
  },
  shiye: {
    id: '101920',
    name: '深夜食堂笔记',
    url: 'https://space.bilibili.com/101920',
  },
};

const ZHIHU_AUTHORS = {
  anfang: {
    id: 'anfangbiji',
    name: '暗房笔记',
    url: 'https://www.zhihu.com/people/anfangbiji',
  },
  wanfeng: {
    id: 'wanfengshujian',
    name: '晚风书简',
    url: 'https://www.zhihu.com/people/wanfengshujian',
  },
  touming: {
    id: 'touming-shichang',
    name: '透明市场',
    url: 'https://www.zhihu.com/people/touming-shichang',
  },
  yanxia: {
    id: 'yanxia-sanbu',
    name: '岩下散步',
    url: 'https://www.zhihu.com/people/yanxia-sanbu',
  },
};

const items = [];

function addItem({
  platform,
  kind,
  author,
  title,
  excerpt = '',
  url,
  cover = null,
  duration = null,
  stats = {},
  createdAt,
  via,
  read = false,
  starred = false,
}) {
  const creator = platform === 'bilibili' ? BILI_AUTHORS[author] : ZHIHU_AUTHORS[author];
  items.push({
    id: `${platform}:demo:${items.length + 1}`,
    platform,
    kind,
    title,
    excerpt,
    url,
    cover,
    duration,
    createdAt,
    via,
    isTop: false,
    stats,
    author: {
      id: creator.id,
      name: creator.name,
      avatar: null,
      url: creator.url,
    },
    read,
    starred,
    firstSeenAt: Math.min(now, createdAt + 2 * HOUR),
    fetchedAt: at(11 * MINUTE),
  });
}

addItem({
  platform: 'bilibili',
  kind: 'video',
  author: 'linjian',
  title: '用一卷过期十年的 Portra 400，拍下秋天最安静的一条街',
  excerpt: '过期胶片的红雾、偏色和掉感都不是缺陷，是它自带的天气。这次从测光、色温到冲扫，完整记录一卷过期 Portra 的脾气，也顺便聊聊为什么我越来越喜欢慢一点拍。',
  url: 'https://www.bilibili.com/video/BV1Sx411c7mD',
  cover: '/demo/cover-light.svg',
  duration: '12:48',
  stats: { views: 128430, likes: 9842, comments: 412, danmaku: 186 },
  createdAt: at(35 * MINUTE),
  via: '投稿了视频',
  starred: true,
});

addItem({
  platform: 'zhihu',
  kind: 'answer',
  author: 'anfang',
  title: '为什么胶片摄影在数码时代还有吸引力？',
  excerpt: '不是因为颗粒更「高级」，而是胶片把拍照变成了一连串需要身体参与的动作：装卷、估光、等待、在灯下看第一眼。它让结果来得慢一点，也让你对每一次按下快门更有记忆点。',
  url: 'https://www.zhihu.com/question/367214857/answer/1975302461',
  stats: { likes: 1824, comments: 143 },
  createdAt: at(1.5 * HOUR),
  via: '回答了问题',
});

addItem({
  platform: 'bilibili',
  kind: 'video',
  author: 'laozhou',
  title: '把一台 1968 年的旁轴拆开，里面比想象中干净',
  excerpt: '这台相机在抽屉里躺了二十年。拆开顶盖之后，取景器里那层雾的来历终于清楚了：不是霉，而是当年润滑脂慢慢挥发留下的膜。清理、校准黄斑、重新上油，最后装回一卷黑白试机。',
  url: 'https://www.bilibili.com/video/BV1Kx411c7qT',
  cover: '/demo/cover-camera.svg',
  duration: '17:05',
  stats: { views: 76420, likes: 4321, comments: 188, danmaku: 64 },
  createdAt: at(3.3 * HOUR),
  via: '投稿了视频',
});

addItem({
  platform: 'zhihu',
  kind: 'article',
  author: 'anfang',
  title: '暗房笔记：把灰度控制拆成三个可以练习的动作',
  excerpt: '很多人把放大想得太神秘。其实先只练三件事：确定底片正确曝光、用试条找第一张可用的相纸曝光、再微调反差。把变量固定住，灰度自然会开始听话。',
  url: 'https://zhuanlan.zhihu.com/p/621830947',
  cover: '/demo/cover-darkroom.svg',
  stats: { likes: 962, comments: 64 },
  createdAt: at(6.2 * HOUR),
  via: '发布了文章',
});

addItem({
  platform: 'bilibili',
  kind: 'post',
  author: 'linjian',
  title: '今天冲的两卷黑白，灰阶比预想中更软',
  excerpt: 'D-76 1:1，20 度，9 分 30 秒。也许是快门速度估低了半档，也可能只是最近喜欢更浅的灰。先扫出来放一放，过两天再判断。',
  url: 'https://t.bilibili.com/1129458372017704961',
  cover: '/demo/cover-print.svg',
  stats: { likes: 328, comments: 22 },
  createdAt: at(25.5 * HOUR),
  via: '发布了动态',
});

addItem({
  platform: 'zhihu',
  kind: 'article',
  author: 'wanfeng',
  title: '从取景器到印刷品：一张照片要走多远',
  excerpt: '拍摄只是第一步。选片、扫描、调整、试印、干燥、签名，每一步都在改变照片的最终样子。写这篇不是教程，而是想把一条常被忽略的路径完整地摊开。',
  url: 'https://zhuanlan.zhihu.com/p/618420113',
  cover: '/demo/cover-print.svg',
  stats: { likes: 1180, comments: 87 },
  createdAt: at(29 * HOUR),
  via: '发布了文章',
  read: true,
  starred: true,
});

addItem({
  platform: 'bilibili',
  kind: 'video',
  author: 'zhishang',
  title: '城市为什么总在河边转身？从一段旧堤岸说起',
  excerpt: '沿着老地图上的一条河岸线走了一天，发现今天的街道、桥和建筑朝向，仍然在回答一百年前那个问题：城市应该把背还是正面留给水。',
  url: 'https://www.bilibili.com/video/BV1Hx411c7Wz',
  cover: '/demo/cover-city.svg',
  duration: '22:14',
  stats: { views: 51230, likes: 1832, comments: 77, danmaku: 31 },
  createdAt: at(33 * HOUR),
  via: '投稿了视频',
});

addItem({
  platform: 'zhihu',
  kind: 'post',
  author: 'yanxia',
  title: '秋天适合散步的路线，附几张随手拍',
  excerpt: '从旧货市场后门进去，沿着铁路边走，最后在一片菜地前拐弯。全程不到四公里，没有景点，但光很好。把路线和几张照片放在这里，周末可以慢慢走。',
  url: 'https://www.zhihu.com/pin/1692774120348200961',
  cover: '/demo/cover-walk.svg',
  stats: { likes: 496, comments: 31 },
  createdAt: at(37 * HOUR),
  via: '发布了想法',
  read: true,
});

addItem({
  platform: 'bilibili',
  kind: 'article',
  author: 'linjian',
  title: '胶片的宽容度到底意味着什么：一次欠曝实验记录',
  excerpt: '同一场景，从正常测光到欠曝四档，各拍一张。负片能拉回来的细节比想象中多，但颜色和颗粒会最先投反对票。实验方法、扫描参数和结论都写在里面。',
  url: 'https://www.bilibili.com/read/cv28401673',
  stats: { likes: 1200, comments: 58 },
  createdAt: at(3 * DAY + HOUR),
  via: '发表了专栏',
});

addItem({
  platform: 'zhihu',
  kind: 'answer',
  author: 'touming',
  title: '有哪些看似普通却非常耐看的街头摄影作品？',
  excerpt: '我想到的三组作品都没有戏剧性的瞬间，耐看来自结构：一条重复的线、一个被留白推开的人、一块刚好接住光的墙面。真正难的是在普通场景里保持耐心。',
  url: 'https://www.zhihu.com/question/301248731/answer/1748205913',
  stats: { likes: 2400, comments: 210 },
  createdAt: at(3 * DAY + 5 * HOUR),
  via: '回答了问题',
  read: true,
});

addItem({
  platform: 'bilibili',
  kind: 'video',
  author: 'beichuang',
  title: '在菜市场拍一上午，只用了 35mm 定焦',
  excerpt: '没有长焦，没有连拍，也没有摆拍。今天只带一支 35mm，看看走近之后会发生什么。拍到的不是「市井感」，而是很多具体的动作和关系。',
  url: 'https://www.bilibili.com/video/BV1Ax411c7Yp',
  cover: '/demo/cover-walk.svg',
  duration: '14:02',
  stats: { views: 94320, likes: 6204, comments: 321, danmaku: 102 },
  createdAt: at(4 * DAY + 2 * HOUR),
  via: '投稿了视频',
});

addItem({
  platform: 'zhihu',
  kind: 'post',
  author: 'wanfeng',
  title: '最近读完的三本关于城市与摄影的书',
  excerpt: '一本谈步行者的目光，一本谈照片如何制造地方记忆，还有一本几乎全是图版。都值得反复翻，尤其是第三本，印刷比文字更有说服力。',
  url: 'https://www.zhihu.com/pin/1691324804817403904',
  cover: '/demo/cover-books.svg',
  stats: { likes: 214, comments: 18 },
  createdAt: at(4 * DAY + 5 * HOUR),
  via: '发布了想法',
  read: true,
});

addItem({
  platform: 'bilibili',
  kind: 'post',
  author: 'laozhou',
  title: '修好一台测光失准的 Yashica，顺便记录过程',
  excerpt: '测光电池换成了适配电压，结果偏差仍然有一档。最后发现问题不在电路，而在电池仓触点氧化。清理之后重新标定，现在和新表只差三分之一档。',
  url: 'https://t.bilibili.com/1127369401577082881',
  stats: { likes: 189, comments: 12 },
  createdAt: at(5 * DAY),
  via: '发布了动态',
  read: true,
});

addItem({
  platform: 'zhihu',
  kind: 'answer',
  author: 'anfang',
  title: '放大照片时，如何判断曝光和反差是否到位？',
  excerpt: '先看高光：最亮的白里是否还有一点层次；再看阴影：黑里是否还愿意透露细节。反差不是越高越好，先让中间调站出来，再决定要不要加一号纸。',
  url: 'https://www.zhihu.com/question/224178563/answer/1193048276',
  stats: { likes: 722, comments: 45 },
  createdAt: at(6 * DAY + 3 * HOUR),
  via: '回答了问题',
});

addItem({
  platform: 'bilibili',
  kind: 'video',
  author: 'shiye',
  title: '深夜食堂：一碗酱油拉面的三个细节',
  excerpt: '汤底、油和面温三件事决定了一碗拉面的完成度。在家复刻不追求店里的浓郁，而是把每一步做得干净，最后再放一颗恰到好处的溏心蛋。',
  url: 'https://www.bilibili.com/video/BV1Cx411c7Zq',
  duration: '09:36',
  stats: { views: 210340, likes: 15023, comments: 904, danmaku: 320 },
  createdAt: at(7 * DAY + HOUR),
  via: '投稿了视频',
  read: true,
});

addItem({
  platform: 'zhihu',
  kind: 'article',
  author: 'yanxia',
  title: '把家里的储物间改成临时暗房，第一步是解决排水',
  excerpt: '空间只有两平方米，但足够放下一台放大机和三只盘子。最难的不是遮光，而是让水离开房间。把改造过程、踩过的坑和能省的钱都写下来。',
  url: 'https://zhuanlan.zhihu.com/p/610943276',
  stats: { likes: 388, comments: 26 },
  createdAt: at(8 * DAY + 2 * HOUR),
  via: '发布了文章',
  read: true,
});

addItem({
  platform: 'zhihu',
  kind: 'post',
  author: 'touming',
  title: '关于胶片扫描：大家最后都留下了哪台扫描仪？',
  excerpt: '从平板到店扫，再到自己搭翻拍台，兜兜转转一圈。想听听大家最后留下了什么方案，以及是什么让你停止折腾。预算和片幅也欢迎一起说。',
  url: 'https://www.zhihu.com/pin/1689023310561411072',
  stats: { likes: 96, comments: 84 },
  createdAt: at(10 * DAY),
  via: '发布了想法',
  read: true,
});

addItem({
  platform: 'bilibili',
  kind: 'video',
  author: 'beichuang',
  title: '为什么老电影里的夜景，总有一层温柔的黑',
  excerpt: '从打光、胶片宽容度到洗印工艺，老电影的夜景不是简单地「暗」，而是在黑里保留了可以呼吸的层次。截取几段经典画面，拆开看看。',
  url: 'https://www.bilibili.com/video/BV1Ex411c7Lr',
  cover: '/demo/cover-darkroom.svg',
  duration: '18:32',
  stats: { views: 118200, likes: 7800, comments: 402, danmaku: 145 },
  createdAt: at(12 * DAY),
  via: '投稿了视频',
  read: true,
});

addItem({
  platform: 'zhihu',
  kind: 'answer',
  author: 'wanfeng',
  title: '如何评价「照片是记忆的替代品」这句话？',
  excerpt: '照片不是记忆的容器，更像记忆的索引。它保存的是某个观看角度，而不是当时的全部感受。真正被替代的，可能是我们反复回想的能力。',
  url: 'https://www.zhihu.com/question/19550913/answer/1628309472',
  stats: { likes: 512, comments: 38 },
  createdAt: at(14 * DAY),
  via: '回答了问题',
  read: true,
});

addItem({
  platform: 'bilibili',
  kind: 'post',
  author: 'zhishang',
  title: '一张旧地图上的河岸线，和今天差了四百米',
  excerpt: '把 1947 年的地图叠在现在的街区上，最明显的不是建筑，而是水退去之后留下的空白。那条多出来的四百米，后来变成了仓库、马路和一排梧桐。',
  url: 'https://t.bilibili.com/1124021787311063040',
  cover: '/demo/cover-city.svg',
  stats: { likes: 274, comments: 19 },
  createdAt: at(17 * DAY),
  via: '发布了动态',
  read: true,
});

addItem({
  platform: 'zhihu',
  kind: 'article',
  author: 'yanxia',
  title: '步行笔记：在城市里找一条没有目的的路',
  excerpt: '关掉导航，只沿着树荫和坡度的变化走。走到不认识的街区，再找一家小店坐下来。没有目的地的散步，反而更容易看见城市真正的纹理。',
  url: 'https://zhuanlan.zhihu.com/p/603851422',
  cover: '/demo/cover-walk.svg',
  stats: { likes: 660, comments: 41 },
  createdAt: at(21 * DAY),
  via: '发布了文章',
  read: true,
});

addItem({
  platform: 'bilibili',
  kind: 'video',
  author: 'linjian',
  title: '给一台旧测光表换电池，然后带它去海边',
  excerpt: '这台测光表的读数比手机慢，也比手机安静。换完电池之后带它去海边，对着同一片潮水读了几次光，顺便把胶卷拍完。',
  url: 'https://www.bilibili.com/video/BV1Bx411c7Nv',
  cover: '/demo/cover-sea.svg',
  duration: '11:27',
  stats: { views: 86700, likes: 5401, comments: 202, danmaku: 88 },
  createdAt: at(28 * DAY),
  via: '投稿了视频',
  read: true,
});

const state = {
  version: 1,
  items: Object.fromEntries(items.map((item) => [item.id, item])),
  creators: {},
  meta: {
    feedVersion: 18,
    stateVersion: 7,
    lastBiliSyncAt: at(11 * MINUTE),
    lastZhihuSyncAt: at(2 * HOUR),
    lastSyncAt: at(11 * MINUTE),
    createdAt: at(30 * DAY),
  },
};

const sessions = {
  bilibili: {
    cookies: { SESSDATA: 'demo-session', bili_jct: 'demo-csrf', DedeUserID: '4810021' },
    mid: '4810021',
    name: '林间胶片',
    face: null,
    connectedAt: at(30 * DAY),
    lastSyncAt: at(11 * MINUTE),
    needsReauth: false,
  },
  zhihu: {
    mode: 'bridge',
    name: '暗房笔记',
    avatar: null,
    urlToken: 'anfangbiji',
    connectedAt: at(28 * DAY),
    lastBridgeAt: at(2 * HOUR),
    lastSyncAt: at(2 * HOUR),
    followeeCount: 9,
    needsBridge: false,
  },
};

const config = {
  bridgeToken: crypto.randomBytes(24).toString('hex'),
  createdAt: at(30 * DAY),
  demo: true,
};

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.writeFile(path.join(DATA_DIR, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
await fs.writeFile(path.join(DATA_DIR, 'sessions.json'), JSON.stringify(sessions, null, 2), { encoding: 'utf8', mode: 0o600 });
await fs.writeFile(path.join(DATA_DIR, 'config.json'), JSON.stringify(config, null, 2), 'utf8');

console.log(`[demo] 演示数据已写入 ${DATA_DIR}`);
console.log(`[demo] ${items.length} 条更新 · ${new Set(items.map((item) => `${item.platform}:${item.author.id}`)).size} 位博主 · ${items.filter((item) => !item.read).length} 条未读 · ${items.filter((item) => item.starred).length} 条收藏`);
console.log('[demo] 启动预览：SIFT_DATA_DIR=".tmp/demo" npm run serve');
