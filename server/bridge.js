const TEMPLATE = String.raw`(function () {
  'use strict';
  var TOKEN = '__TOKEN__';
  var DASHBOARD = '__ORIGIN__';
  var RECEIVER_ORIGIN = DASHBOARD.replace(/\/+$/, '');
  var RECEIVER_URL = RECEIVER_ORIGIN + '/zhihu-bridge.html?t=' + Date.now() + '#token=' + encodeURIComponent(TOKEN);
  var RECEIVER_NAME = 'sift-zhihu-receiver';
  var receiver = null;
  var receiverReady = false;
  var receiverWaiters = [];
  var pending = {};
  var seq = 0;
  var host = location.hostname;
  if (host !== 'www.zhihu.com' && host !== 'zhuanlan.zhihu.com') {
    window.alert('请在知乎页面运行这个同步书签。');
    return;
  }
  if (window.__SIFT_SYNCING__) {
    window.alert('筛的知乎同步正在进行，请稍候。');
    return;
  }
  window.__SIFT_SYNCING__ = true;
  var existing = document.querySelectorAll('[data-sift-bridge]');
  for (var e = 0; e < existing.length; e += 1) existing[e].remove();

  var panel = document.createElement('div');
  panel.setAttribute('data-sift-bridge', '1');
  panel.innerHTML = '<div style="position:fixed;right:22px;bottom:22px;z-index:2147483647;width:330px;box-sizing:border-box;background:#fbf8f0;color:#1d1b17;border:1px solid #1d1b17;box-shadow:0 18px 50px rgba(29,27,23,.22);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #d9d3c5;">' +
    '<strong style="font-size:14px;letter-spacing:.08em;">筛 · 知乎同步</strong>' +
    '<button type="button" id="sift-close" aria-label="关闭" style="border:0;background:transparent;color:#6d675b;font-size:20px;line-height:1;cursor:pointer;padding:0 2px;">×</button>' +
    '</div>' +
    '<div style="padding:14px;">' +
    '<div id="sift-status" style="font-size:12.5px;line-height:1.7;color:#6d675b;min-height:40px;">准备中…</div>' +
    '<div style="height:3px;background:#e7e1d4;margin-top:12px;overflow:hidden;"><div id="sift-bar" style="height:3px;width:2%;background:#c84630;transition:width .25s ease;"></div></div>' +
    '<button type="button" id="sift-open-receiver" style="display:none;width:100%;margin-top:10px;padding:8px 10px;border:1px solid #c84630;background:#c84630;color:#fff;font:600 12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif;cursor:pointer;">打开本地接收页</button>' +
    '<div style="font-size:11px;line-height:1.6;color:#938b7d;margin-top:10px;">数据只发送到这台电脑。接收窗口会自动打开，同步完成后自动关闭。</div>' +
    '</div>' +
    '</div>';
  document.body.appendChild(panel);

  var statusEl = panel.querySelector('#sift-status');
  var barEl = panel.querySelector('#sift-bar');
  var closeEl = panel.querySelector('#sift-close');
  var openReceiverEl = panel.querySelector('#sift-open-receiver');
  var closed = false;
  closeEl.onclick = function () {
    closed = true;
    if (receiver && !receiver.closed) {
      try { receiver.close(); } catch (error) {}
    }
    panel.remove();
  };

  function setStatus(text, pct, tone) {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = tone === 'error' ? '#a53020' : tone === 'success' ? '#2e6b45' : '#6d675b';
    }
    if (barEl) {
      barEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
      barEl.style.background = tone === 'error' ? '#a53020' : tone === 'success' ? '#2e6b45' : '#c84630';
    }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function fail(message) {
    var error = new Error(message);
    error.__fatal = true;
    return error;
  }

  async function api(path) {
    var response = await fetch('https://www.zhihu.com' + path, {
      credentials: 'include',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'x-requested-with': 'fetch'
      }
    });
    var text = await response.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }
    if (response.status === 403 || response.status === 401 || (data && data.error && data.error.need_login)) {
      throw fail('知乎要求安全验证或登录已失效。请先在知乎完成验证并登录，然后重新运行书签。');
    }
    if (!response.ok) {
      var detail = (data && (data.error && data.error.message || data.message)) || ('HTTP ' + response.status);
      throw new Error('知乎接口失败：' + detail);
    }
    if (data && data.error) throw new Error(data.error.message || '知乎接口返回错误');
    return data || {};
  }

  function setReceiverButton(visible) {
    if (openReceiverEl) openReceiverEl.style.display = visible ? 'block' : 'none';
  }

  function openReceiver(quiet) {
    if (receiver && !receiver.closed) return true;
    receiverReady = false;
    try {
      var width = 520;
      var height = 440;
      var left = Math.max(0, Math.round((screen.width - width) / 2));
      var top = Math.max(0, Math.round((screen.height - height) / 2));
      receiver = window.open(
        RECEIVER_URL,
        RECEIVER_NAME,
        'popup=yes,width=' + width + ',height=' + height + ',left=' + left + ',top=' + top
      );
    } catch (error) {
      receiver = null;
    }
    if (!receiver) {
      setReceiverButton(true);
      if (!quiet) setStatus('浏览器拦截了本地接收页。请点击下方按钮继续。', 8, 'error');
      return false;
    }
    setReceiverButton(false);
    if (!quiet) setStatus('本地接收页已打开，继续同步…', 8);
    return true;
  }

  function ensureReceiver() {
    if (receiverReady && receiver && !receiver.closed) return Promise.resolve();
    if (receiver && receiver.closed) {
      receiver = null;
      receiverReady = false;
    }
    if (!receiver) {
      setReceiverButton(true);
      setStatus('浏览器拦截了本地接收页。请点击下方「打开本地接收页」继续。', 8, 'error');
    }
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(fail('本地接收页没有响应。请确认筛正在运行，然后重新运行书签。'));
      }, 60000);
      receiverWaiters.push(function () {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  window.addEventListener('message', function (event) {
    if (event.origin !== RECEIVER_ORIGIN) return;
    if (!receiver || event.source !== receiver) return;
    var data = event.data;
    if (!data || data.sift !== 'zhihu-bridge') return;

    if (data.type === 'ready') {
      receiverReady = true;
      var waiters = receiverWaiters.splice(0);
      for (var i = 0; i < waiters.length; i += 1) waiters[i]();
      return;
    }

    if (data.type === 'result' && data.id) {
      var job = pending[data.id];
      if (!job) return;
      delete pending[data.id];
      clearTimeout(job.timer);
      if (data.ok) job.resolve(data);
      else job.reject(new Error(data.error || '本地接收页拒绝了数据'));
    }
  });

  if (openReceiverEl) {
    openReceiverEl.onclick = function () {
      openReceiver(false);
    };
  }

  async function post(payload) {
    await ensureReceiver();
    if (!receiver || receiver.closed) {
      throw fail('本地接收页已关闭。请重新运行同步书签。');
    }
    return new Promise(function (resolve, reject) {
      var id = 'b' + (++seq);
      var timer = setTimeout(function () {
        delete pending[id];
        reject(fail('本地接收页没有响应。请确认筛正在运行，然后重新运行书签。'));
      }, 45000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      try {
        receiver.postMessage({
          sift: 'zhihu-bridge',
          type: 'payload',
          id: id,
          payload: payload
        }, RECEIVER_ORIGIN);
      } catch (error) {
        clearTimeout(timer);
        delete pending[id];
        reject(error);
      }
    });
  }

  function finishReceiver(ok, message) {
    if (!receiver || receiver.closed || !receiverReady) return;
    try {
      receiver.postMessage({
        sift: 'zhihu-bridge',
        type: 'done',
        ok: ok,
        message: ok ? message : '',
        error: ok ? '' : message
      }, RECEIVER_ORIGIN);
    } catch (error) {}
  }

  function closeReceiver(delay) {
    if (!receiver) return;
    setTimeout(function () {
      try { if (receiver && !receiver.closed) receiver.close(); } catch (error) {}
    }, delay || 0);
  }

  window.addEventListener('beforeunload', function () {
    try { if (receiver && !receiver.closed) receiver.close(); } catch (error) {}
  });

  openReceiver(true);

  async function mapLimit(items, limit, worker) {
    var results = new Array(items.length);
    var cursor = 0;
    var runners = [];
    for (var i = 0; i < Math.min(limit, items.length); i += 1) {
      runners.push((async function () {
        while (cursor < items.length) {
          var index = cursor;
          cursor += 1;
          results[index] = await worker(items[index], index);
        }
      })());
    }
    await Promise.all(runners);
    return results;
  }

  function countOf(data) {
    return data && data.data && data.data.length ? data.data.length : 0;
  }

  function shortCreator(creator) {
    return {
      url_token: creator.url_token,
      name: creator.name,
      avatar_url: creator.avatar_url,
      headline: creator.headline || ''
    };
  }

  (async function run() {
    try {
      setStatus('确认知乎登录状态…', 2);
      var me = await api('/api/v4/me');
      if (!me || !me.url_token) throw fail('没有读到知乎登录态。请先在知乎登录，然后重试。');

      setStatus('读取关注列表…', 5);
      var followees = [];
      var offset = 0;
      var total = 0;
      while (offset < 400 && !closed) {
        var page = await api('/api/v4/members/' + encodeURIComponent(me.url_token) + '/followees?offset=' + offset + '&limit=20&include=data[*].answer_count,articles_count,follower_count');
        var data = (page && page.data) || [];
        for (var i = 0; i < data.length; i += 1) followees.push(shortCreator(data[i]));
        total = (page && page.paging && page.paging.totals) || total;
        offset += data.length;
        setStatus('读取关注列表 ' + followees.length + (total ? ' / ' + total : '') + '…', 5 + Math.min(7, followees.length / 40));
        if (!data.length || (page.paging && page.paging.is_end)) break;
        await sleep(180);
      }
      if (!followees.length) throw fail('关注列表为空，或知乎没有返回关注者。');
      if (closed) return;

      await post({ account: me, followees: followees });
      setStatus('已读取 ' + followees.length + ' 位关注者，开始同步更新…', 12);

      var done = 0;
      var totalItems = 0;
      var chunkSize = 6;
      for (var start = 0; start < followees.length && !closed; start += chunkSize) {
        var chunk = followees.slice(start, start + chunkSize);
        var results = await mapLimit(chunk, 2, async function (creator) {
          var itemPayload = { creator: creator };
          try {
            var activities = await api('/api/v4/members/' + encodeURIComponent(creator.url_token) + '/activities?limit=10&offset=0');
            itemPayload.activities = activities;
            if (countOf(activities) === 0) {
              itemPayload.answers = await api('/api/v4/members/' + encodeURIComponent(creator.url_token) + '/answers?limit=4&offset=0&sort_by=created');
              itemPayload.articles = await api('/api/v4/members/' + encodeURIComponent(creator.url_token) + '/articles?limit=4&offset=0&sort_by=created');
              itemPayload.pins = await api('/api/v4/members/' + encodeURIComponent(creator.url_token) + '/pins?limit=4&offset=0');
            }
          } catch (error) {
            if (error && error.__fatal) throw error;
            itemPayload.error = String(error && error.message || error);
          }
          return itemPayload;
        });
        var payloadCreators = results.filter(function (item) { return item && !item.error; });
        if (payloadCreators.length) {
          var response = await post({ creators: payloadCreators });
          totalItems += response.accepted || 0;
        }
        done += chunk.length;
        setStatus('同步 ' + done + ' / ' + followees.length + ' 位关注者 · 已收录 ' + totalItems + ' 条', 12 + Math.round((done / followees.length) * 86));
        await sleep(220);
      }
      if (closed) return;

      setStatus('完成：' + followees.length + ' 位关注者，' + totalItems + ' 条更新。回到筛查看。', 100, 'success');
      finishReceiver(true, '同步完成：' + followees.length + ' 位关注者，' + totalItems + ' 条更新。');
      var link = document.createElement('a');
      link.href = DASHBOARD;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '打开我的信息筛 →';
      link.style.cssText = 'display:inline-block;margin-top:10px;color:#c84630;font-weight:600;text-decoration:none;border-bottom:1px solid #c84630;padding-bottom:2px;';
      if (statusEl && statusEl.parentNode) statusEl.parentNode.appendChild(link);
    } catch (error) {
      var message = String(error && error.message || error);
      setStatus('同步失败：' + message + ' 可在本页完成验证后重新运行书签。', 100, 'error');
      finishReceiver(false, message);
    } finally {
      window.__SIFT_SYNCING__ = false;
      closeReceiver(6000);
    }
  })();
})();`;

export function buildBridge({ origin, token }) {
  const endpoint = `${origin}/api/zhihu/ingest`;
  const script = TEMPLATE
    .replaceAll('__TOKEN__', token)
    .replaceAll('__ORIGIN__', origin);
  const compact = script.replace(/\n\s*/g, ' ').replace(/\s{2,}/g, ' ');
  return {
    endpoint,
    script,
    compact,
    bookmarklet: `javascript:${compact}`,
  };
}
