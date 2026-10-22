(function () {
  var code = (location.hash || '').replace(/^#/, '').trim().toUpperCase();
  var valid = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code);
  var origin = location.origin;
  var codeEl = document.getElementById('access-code');
  var urlEl = document.getElementById('server-url');
  var openBtn = document.getElementById('open-app');
  var statusEl = document.getElementById('status');

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.className = isError ? 'status is-error' : 'status';
  }

  function copyValue(value, button) {
    var done = function (ok) {
      button.textContent = ok ? '已复制' : '复制失败';
      setTimeout(function () { button.textContent = '复制'; }, 1800);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(value).then(function () { done(true); }, function () { fallback(); });
      return;
    }
    fallback();
    function fallback() {
      var area = document.createElement('textarea');
      area.value = value;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
      area.remove();
      done(ok);
    }
  }

  urlEl.textContent = origin;
  codeEl.textContent = valid ? code : '未读取到';

  for (var i = 0; i < document.querySelectorAll('button[data-copy]').length; i += 1) {
    (function (button) {
      button.addEventListener('click', function () {
        copyValue(button.getAttribute('data-copy') === 'code' ? code : origin, button);
      });
    })(document.querySelectorAll('button[data-copy]')[i]);
  }

  if (!valid) {
    openBtn.setAttribute('aria-disabled', 'true');
    openBtn.addEventListener('click', function (event) { event.preventDefault(); });
    setStatus('配对链接不完整，请回电脑上的“连接手机”重新扫码。', true);
    return;
  }

  var fallback = origin + '/pair#' + encodeURIComponent(code);
  var intent = 'intent://pair?url=' + encodeURIComponent(origin)
    + '&code=' + encodeURIComponent(code)
    + '#Intent;scheme=sift;package=com.qodercn.sift;'
    + 'S.browser_fallback_url=' + encodeURIComponent(fallback)
    + ';end';
  openBtn.href = intent;
  openBtn.removeAttribute('aria-disabled');
  setStatus('配对码已读取，点上方按钮打开 App。');

  var timer = null;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      clearTimeout(timer);
      setStatus('已切换到筛，请稍候…');
    }
  });
  openBtn.addEventListener('click', function () {
    setStatus('正在打开筛…如果没反应，请手动输入下面的信息。');
    clearTimeout(timer);
    timer = setTimeout(function () {
      setStatus('如果 App 没有自动打开，请长按桌面图标或手动输入下面的信息。', true);
    }, 4000);
  });
})();
