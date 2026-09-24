/* 下拉刷新组件：原样取自 references/组件_下拉刷新/pull-to-refresh.html（配方 feedback_pull_to_refresh_recipe.md v1.7），参数没动。 */
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

  // 默认刷新：先把同源 css/js 校验一遍（没变就是 304，很便宜），再 reload。
  // 直接 reload 的话，Chrome 只校验 HTML，子资源在 max-age 内照用旧缓存（2026-09-11 实测）。
  // 最多等 2.5 秒，超时照样刷新。
  function revalidateThenReload() {
    var done = false;
    function go() { if (!done) { done = true; location.reload(); } }
    if (typeof fetch !== 'function' || typeof Promise !== 'function') { go(); return; }
    var nodes = document.querySelectorAll('link[rel="stylesheet"][href], script[src]'), urls = [];
    for (var i = 0; i < nodes.length; i++) {
      try {
        var u = new URL(nodes[i].getAttribute('href') || nodes[i].getAttribute('src'), location.href);
        if (u.origin === location.origin && urls.indexOf(u.href) < 0) urls.push(u.href);
      } catch (e) {}
    }
    setTimeout(go, 2500);
    Promise.all(urls.map(function (u) { return fetch(u, { cache: 'no-cache' }).catch(function () {}); })).then(go, go);
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
    var tipTimer = null;

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
      // 留一下 spinner 再动手，否则松手瞬间白屏，看起来像卡死
      setTimeout(function () {
        // 没有 Service Worker 的页面，断网时 reload 会变成浏览器错误页 = 把应用弄没了
        if (navigator.onLine === false) {
          showTip('当前没有网络，先不刷新了。等有网了再拉一次。');
          gesture.cancelRefresh(); settle(); return;
        }
        (options.doRefresh || revalidateThenReload)(function () {
          // 传给 doRefresh 的"我不刷新了"回调：软刷新场景用得上
          gesture.cancelRefresh(); settle();
        }, showTip);
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
      if (gesture.move(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchend', function () { gesture.end(); }, { passive: true });
    // touchcancel 不能接 end()：拉够阈值时被系统打断会误触发刷新
    document.addEventListener('touchcancel', function () { gesture.cancel(); }, { passive: true });

    return { gesture: gesture, showTip: showTip, paint: paint, settle: settle };
  }

  global.PullToRefresh = { createPullGesture: createPullGesture, setupPullToRefresh: setupPullToRefresh,
                           revalidateThenReload: revalidateThenReload,
                           thresholdFor: thresholdFor, DEADZONE: DEADZONE, DAMPING: DAMPING, MAX_PULL: MAX_PULL };
})(window);
