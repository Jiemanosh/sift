(function () {
  'use strict';

  var ALLOWED_ORIGINS = ['https://www.zhihu.com', 'https://zhuanlan.zhihu.com'];
  var statusEl = document.getElementById('bridge-status');
  var barEl = document.getElementById('bridge-bar');
  var barFill = barEl ? barEl.querySelector('span') : null;
  var statsEl = document.getElementById('bridge-stats');
  var creatorsEl = document.getElementById('stat-creators');
  var itemsEl = document.getElementById('stat-items');

  var params = new URLSearchParams(location.hash.slice(1));
  var token = params.get('token') || '';
  var ready = false;
  var batches = 0;
  var creators = 0;
  var items = 0;

  function setStatus(text, tone) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', tone === 'error');
    statusEl.classList.toggle('is-ok', tone === 'ok');
  }

  function setProgress(percent, tone) {
    if (!barFill) return;
    barFill.style.width = Math.max(0, Math.min(100, percent)) + '%';
    if (barEl) barEl.classList.toggle('is-ok', tone === 'ok');
  }

  function renderStats() {
    if (!statsEl) return;
    statsEl.hidden = batches === 0;
    if (creatorsEl) creatorsEl.textContent = String(creators);
    if (itemsEl) itemsEl.textContent = String(items);
  }

  function announce() {
    if (!window.opener) return;
    window.opener.postMessage({ sift: 'zhihu-bridge', type: 'ready' }, '*');
  }

  function reply(source, origin, data) {
    try {
      source.postMessage(Object.assign({ sift: 'zhihu-bridge' }, data), origin);
    } catch (error) {
      // The Zhihu tab was closed; nothing else to do.
    }
  }

  if (!/^[a-f0-9]{32,128}$/i.test(token)) {
    setStatus('同步令牌无效。请回到筛，在账号设置里重新打开同步书签。', 'error');
    setProgress(100, 'error');
    return;
  }

  if (!window.opener) {
    setStatus('这个窗口需要由知乎页面上的同步书签打开。请回到筛，按提示重新运行书签。', 'error');
    setProgress(100, 'error');
    return;
  }

  window.addEventListener('message', async function (event) {
    if (ALLOWED_ORIGINS.indexOf(event.origin) === -1) return;
    if (!window.opener || event.source !== window.opener) return;
    var data = event.data;
    if (!data || data.sift !== 'zhihu-bridge') return;

    if (data.type === 'done') {
      if (data.ok) {
        setStatus(data.message || ('同步完成：' + items + ' 条更新。'), 'ok');
        setProgress(100, 'ok');
      } else {
        setStatus('同步没有完成：' + (data.error || '未知错误'), 'error');
        setProgress(100, 'error');
      }
      return;
    }

    if (data.type !== 'payload' || !data.id || !data.payload) return;

    setStatus(batches === 0 ? '正在接收第一批数据…' : ('正在接收数据 · 第 ' + (batches + 1) + ' 批…'));
    setProgress(6 + Math.min(76, batches * 7));

    try {
      var response = await fetch('/api/zhihu/ingest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sift-token': token,
        },
        body: JSON.stringify(data.payload),
      });
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        throw new Error(body.error || ('本地接口返回 HTTP ' + response.status));
      }

      batches += 1;
      items += Number(body.accepted) || 0;
      creators = Math.max(creators, Number(body.creators) || 0);
      renderStats();
      setProgress(6 + Math.min(80, batches * 7));
      setStatus('已接收 ' + batches + ' 批 · ' + items + ' 条更新');

      reply(event.source, event.origin, {
        type: 'result',
        id: data.id,
        ok: true,
        accepted: Number(body.accepted) || 0,
        added: Number(body.added) || 0,
        changed: Number(body.changed) || 0,
        creators: Number(body.creators) || 0,
        errors: Number(body.errors) || 0,
      });
    } catch (error) {
      var message = String((error && error.message) || error || '接收失败');
      setStatus('接收失败：' + message, 'error');
      setProgress(100, 'error');
      reply(event.source, event.origin, {
        type: 'result',
        id: data.id,
        ok: false,
        error: message,
      });
    }
  });

  window.addEventListener('pageshow', function () {
    if (!ready) {
      ready = true;
      announce();
    }
  });

  setStatus('已连接，等待知乎页面发送数据…');
  setProgress(4);
  ready = true;
  announce();
})();
