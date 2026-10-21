/* 下拉刷新组件：原样取自 references/组件_下拉刷新/pull-to-refresh.html（配方 feedback_pull_to_refresh_recipe.md v2.0），参数没动。 */
(function (global) {
  'use strict';

  var DEADZONE = 16;    // 起手死区（px，手指位移）：按下瞬间的抖动不算下拉
  var DAMPING  = 0.42;  // 阻尼：手指位移 × 它 = 指示器位移
  var MAX_PULL = 120;   // 指示器最多下移这么多

  // 阈值不写死像素：写死的话小屏上"手指要走的距离占屏高的比例"会明显偏重。
  // 按屏高推导后 844px 屏算出 84、568px 屏算出 57，手指行程都稳定在 ≈26% 屏高。
  function thresholdFor(h){ return Math.min(100, Math.max(56, h * 0.1)); }

  // 手势内核：只做算术和状态流转，不碰 DOM——这样才能像下面自检那样把十来个
  // 手势用例跑一遍，不用起浏览器、不用真手指。
  function createPullGesture(env) {
    var isBlocked = env.isBlocked || function(){ return false; };
    var scrollTop = env.scrollTop || function(){ return 0; };
    var viewportHeight = env.viewportHeight || function(){ return 800; };
    var onPaint = env.onPaint || function(){};
    var onSettle = env.onSettle || function(){};
    var onTrigger = env.onTrigger || function(){};

    var startX = 0, startY = 0, pulling = false, locked = false, distance = 0, refreshing = false;
    function threshold(){ return thresholdFor(viewportHeight()); }

    return {
      start: function (x, y, touchCount) {
        // 多指（缩放）不管；有浮层不管；不在顶部不管
        if (refreshing || touchCount !== 1 || isBlocked() || scrollTop() > 0) { pulling = false; return false; }
        startX = x; startY = y; pulling = true; locked = false; distance = 0;
        return true;
      },
      // 返回 true = 这次滑动归下拉刷新，调用方必须 preventDefault
      move: function (x, y) {
        if (!pulling || refreshing) return false;
        var dx = x - startX, dy = y - startY;
        if (!locked) {
          if (Math.abs(dy) < DEADZONE && Math.abs(dx) < DEADZONE) return false;            // 死区内继续观察
          if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { pulling = false; return false; }   // 上滑/横滑 → 整次弃权
          locked = true;
        }
        // 拉到一半改主意往上滑：必须交还控制权，否则用户会觉得"页面卡住滚不动"
        if (dy <= 0 || scrollTop() > 0) { pulling = false; locked = false; distance = 0; onSettle(); return false; }
        distance = Math.min((dy - DEADZONE) * DAMPING, MAX_PULL);
        onPaint(distance);
        return true;
      },
      end: function () {
        // 只在死区里观察过、没真进入下拉的，当这次手势没发生过
        if (!pulling || !locked || refreshing) { pulling = false; locked = false; return false; }
        pulling = false; locked = false;
        if (distance < threshold()) { distance = 0; onSettle(); return false; }
        refreshing = true;
        onTrigger(threshold());
        return true;
      },
      // 触摸被系统打断（来电、系统手势 → touchcancel）：当没拉过，收回指示器，绝不触发刷新（v1.7 加）
      cancel: function () {
        var wasPulling = pulling && locked;
        pulling = false; locked = false;
        if (refreshing) return;
        distance = 0;
        if (wasPulling) onSettle();
      },
      cancelRefresh: function () { refreshing = false; distance = 0; }, // 断网被拦下来之后要能再用
      getDistance: function () { return distance; },
      isRefreshing: function () { return refreshing; },
      threshold: threshold
    };
  }

  // 先把这一页本身 + 同源 css/js 都拿一遍（没变就是 304，很便宜），ms（默认 6 秒）内全部完整拿到才 go()；
  // 有一个失败 / 超时就 fail()，不刷新（v2.0）。
  // 拿 css/js 是因为 Chrome 的 reload 只校验 HTML，子资源在 max-age 内照用旧缓存（2026-09-11 实测）；
  // 以前「最多等 2.5 秒、超时照样刷新」在慢网下会卡死 / 白屏（2026-10-19 日程卡片用户截图），所以拿不到就别刷
  var SAFE_RELOAD_MS = 6000;
  function safeReload(go, fail, ms) {
    if (typeof fetch !== 'function' || typeof Promise !== 'function') { go(); return; }
    var urls = [location.href.split('#')[0]];
    var nodes = document.querySelectorAll('link[rel="stylesheet"][href], script[src]');
    for (var i = 0; i < nodes.length; i++) {
      try {
        var u = new URL(nodes[i].getAttribute('href') || nodes[i].getAttribute('src'), location.href);
        if (u.origin === location.origin && urls.indexOf(u.href) < 0) urls.push(u.href);
      } catch (e) {}
    }
    var ac = typeof AbortController === 'function' ? new AbortController() : null;
    var settled = false, timer = null;
    function finish(good) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (good) go(); else { if (ac) ac.abort(); fail(); }
    }
    var limit = ms || SAFE_RELOAD_MS, t0 = Date.now();
    function fire() {
      // 晚了 3 秒以上才到点、而且这会儿页面看得见＝检查途中页面在后台被冻过（锁屏 / 切走又回来）：
      // 冻住那段不算，重新计时，免得一回来就误报「网络不好」（审查指出）
      if (Date.now() - t0 > limit + 3000 && !document.hidden) { t0 = Date.now(); timer = setTimeout(fire, limit); return; }
      finish(false);
    }
    timer = setTimeout(fire, limit);
    Promise.all(urls.map(function (u, i) {
      // 正文也要读完才算拿到（响应头先到、正文卡住也是卡住）；页面本身要回 2xx 才刷（回错误页就别跳过去），css/js 只要服务器有回应就算网络通（某个文件本来就 404 的话刷新后也一样缺，不能因此永远说「网络不好」）
      return fetch(u, { cache: 'no-cache', signal: ac ? ac.signal : undefined })
        .then(function (r) { if (i === 0 && !r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
    })).then(function () { finish(true); }, function () { finish(false); });
  }
  var NET_TIP = '网络不好，这次没刷新。稍后再拉一次。';
  // 默认刷新：检查网络，通了就重新加载，不通就提示。自己写 doRefresh 的（比如先同步），最后调它就行，别抄一份（审查指出）
  function defaultRefresh(giveUp, showTip, reloadNow) {
    safeReload(reloadNow, function () { showTip(NET_TIP); giveUp(); });
  }

  // DOM 装配。options 里三个都可以按项目替换：
  //   isBlocked() / scrollTop() / doRefresh()
  function setupPullToRefresh(options) {
    options = options || {};
    var indicator = document.getElementById('ptr-indicator');
    var tip = document.getElementById('ptr-tip');
    if (!indicator) return null;

    var isBlocked = options.isBlocked || function () { return false; };
    var scrollTop = options.scrollTop || function () { return window.scrollY; };
    var tipTimer = null, unlockTimer = null;
    var reloading = false;   // 真正发起了整页重新加载（刷新态里先检查网络的那几秒不算）
    // 第几次下拉（v2.1）：兜底解锁 / 作罢之后，上一次还没回来的检查一律作废。不然锁屏回来时检查被重新计时、跟 10 秒兜底错开，
    // 转圈先收了、过几秒页面又突然刷新或冒出「网络不好」，甚至作用到下一次下拉上（审查指出）
    var attempt = 0;
    // 检查那几秒里用户动过表单（真实的输入 / 勾选，isTrusted）：整页重新加载会把它冲掉，就不刷了（v2.1，审查指出）
    var edited = false;
    function onEdit(e) { if (e.isTrusted && gesture.isRefreshing() && !reloading) edited = true; }
    document.addEventListener('input', onEdit, true);
    document.addEventListener('change', onEdit, true);
    // 兜底：重新加载被取消或一直卡着时，10 秒后解锁，别让页面永远滑不动
    function armUnlock() {
      clearTimeout(unlockTimer);
      unlockTimer = setTimeout(function () { if (gesture.isRefreshing()) giveUp(); }, 10000);
    }
    // "我不刷新了"：网络不好 / 软刷新做完 / 改主意了 / 兜底到点
    function giveUp() { attempt++; reloading = false; clearTimeout(unlockTimer); gesture.cancelRefresh(); settle(); }
    function reloadNow() {
      // 检查网络那几秒页面是能用的：这期间用户要是打开了浮层、开始输入，这时整页重新加载会把它冲掉——作罢（审查指出）
      if (isBlocked() || edited) { giveUp(); return; }
      reloading = true;
      // 兜底从真正开始重新加载算起：检查网络可能已经用掉 6 秒，不重算的话重新加载只剩 3~4 秒就被解锁，
      // iOS 冻住的旧页面又能滑出空白（审查指出）
      armUnlock();
      location.reload();
    }

    function showTip(msg) {
      if (!tip) return;
      tip.textContent = msg; tip.hidden = false;
      requestAnimationFrame(function(){ tip.classList.add('show'); });
      clearTimeout(tipTimer);
      tipTimer = setTimeout(function () {
        tip.classList.remove('show');
        setTimeout(function(){ tip.hidden = true; }, 300);
      }, 3200);
    }
    function paint(d) {
      indicator.classList.remove('ptr-animate');
      indicator.style.transform = 'translateY(' + d + 'px)';
      indicator.style.opacity = String(Math.min(1, d / (gesture.threshold() * 0.8)));
      indicator.classList.toggle('ptr-ready', d >= gesture.threshold());
    }
    function settle() {
      indicator.classList.add('ptr-animate');
      indicator.style.transform = 'translateY(0)';
      indicator.style.opacity = '0';
      indicator.classList.remove('ptr-ready', 'ptr-loading');
    }
    function trigger(threshold) {
      indicator.classList.add('ptr-animate', 'ptr-loading');
      indicator.style.transform = 'translateY(' + threshold + 'px)';
      armUnlock();
      var my = ++attempt; edited = false;
      // 交给这一次检查的三个回调：这一次已经作废（兜底到点 / 作罢 / 又拉了一次）就什么都不做
      function live(fn) { return function () { if (my === attempt) return fn.apply(null, arguments); }; }
      // 留一下 spinner 再动手，否则松手瞬间白屏，看起来像卡死
      setTimeout(function () {
        if (my !== attempt) return;
        // 没有 Service Worker 的页面，断网时 reload 会变成浏览器错误页 = 把应用弄没了
        if (navigator.onLine === false) {
          showTip('当前没有网络，先不刷新了。等有网了再拉一次。');
          giveUp(); return;
        }
        // 传给 doRefresh：giveUp（我不刷新了）、showTip、reloadNow（要整页重新加载就调它，别直接 location.reload）
        (options.doRefresh || defaultRefresh)(live(giveUp), live(showTip), live(reloadNow));
      }, 260);
    }

    var gesture = createPullGesture({
      isBlocked: isBlocked,
      scrollTop: scrollTop,
      viewportHeight: function () { return window.innerHeight; },
      onPaint: paint, onSettle: settle, onTrigger: trigger
    });

    document.addEventListener('touchstart', function (e) {
      gesture.start(e.touches[0].clientX, e.touches[0].clientY, e.touches.length);
    }, { passive: true });
    // 必须 passive:false，否则 preventDefault 无效，页面会跟着一起动
    document.addEventListener('touchmove', function (e) {
      // 整页重新加载中锁住滚动：iOS Safari 发起重新加载后、新页面画出来之前会冻结绘制，
      // 这时还能滑，滑出来的区域是一片空白（配方 v1.8）。前面检查网络那几秒页面是活的，照常能滑（v2.0）
      if (reloading) { e.preventDefault(); return; }
      if (gesture.move(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', function () { gesture.end(); }, { passive: true });
    // touchcancel 不能接 end()：拉够阈值时被系统打断会误触发刷新
    document.addEventListener('touchcancel', function () { gesture.cancel(); }, { passive: true });

    return { gesture: gesture, showTip: showTip, paint: paint, settle: settle };
  }

  global.PullToRefresh = { createPullGesture: createPullGesture, setupPullToRefresh: setupPullToRefresh,
                           safeReload: safeReload, defaultRefresh: defaultRefresh, NET_TIP: NET_TIP,
                           thresholdFor: thresholdFor, DEADZONE: DEADZONE, DAMPING: DAMPING, MAX_PULL: MAX_PULL };
})(window);
