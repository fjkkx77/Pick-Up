/* 长按拖动排序（通用组件，不认识业务数据）
   出处：日程卡片的长按拖拽（长按 450ms 拿起、同容器同级项换位、让位动画、松手吃 click），
   加上教程站那边踩出来的两条（feedback_ios_gesture_recipe §4.5）：
     · 拖到屏幕上下边缘 64px 内自动滚，速度 距离/4
     · 另一只手指可以滚页面：只拦拖动那根手指（两指在屏时不 preventDefault），页面滚了位移自动补偿
   和日程卡片不同的一处：落点不按「被拖那张的高度」一格格算，而是拿它的中心和其它每一项的原始中心比——
   卡片高矮不一时（这里有的带进度条、有的带两行字）日程卡片那种算法会错位。 */
(function (root) {
  'use strict';

  const HOLD = 450;     // 按住多久算「拿起来」
  const SLOP = 10;      // 按住期间手指动超过这么多 = 在滚动 / 滑动，取消长按
  const EDGE = 64;      // 距上下边多近开始自动滚
  const EAT_MS = 350;   // 松手后吃掉浏览器补发的 click

  /**
   * @param {object} o
   * @param {()=>boolean} o.enabled   现在能不能拖（比如只有自定义顺序下能）
   * @param {()=>boolean} o.blocked   有浮层开着、有卡片滑开着 → 整个不接
   * @param {(target:Element)=>({item:Element, box:Element, items:Element[]}|null)} o.scope  按在哪、同级项有哪些
   * @param {(scope)=>void} [o.refused] 能拖的地方长按了、但现在不允许拖（给个提示）
   * @param {()=>void} [o.onBegin]     拿起来的那一刻（让左滑、下拉刷新让位）
   * @param {(items:Element[])=>void} o.commit  松手且位置变了：按新顺序给出同级项
   * @param {()=>void} [o.cancelled]   松手但没换位（堆叠里的项要复原位置）
   * @param {(box:Element)=>number} o.gap  同级项之间的间距
   */
  function LongPressDrag(o) {
    let timer = 0, on = false, touchId = null, byTouch = false;
    let el = null, items = null, from = 0, to = 0;
    let startY = 0, lastY = 0, startScroll = 0, centers = [], shiftH = 0, raf = 0;

    const cancelHold = () => { clearTimeout(timer); timer = 0; };

    /* 记下起手那根手指：pointerId 和 touch.identifier 不是一回事，触屏路径要认后者 */
    document.addEventListener('touchstart', e => {
      if (!on && e.touches.length === 1) touchId = e.changedTouches[0].identifier;
    }, { capture: true, passive: true });

    document.addEventListener('pointerdown', e => {
      if (on) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (o.blocked()) return;
      const sc = o.scope(e.target);
      if (!sc) return;
      const x0 = e.clientX, y0 = e.clientY, touch = e.pointerType === 'touch';
      cancelHold();
      timer = setTimeout(() => {
        timer = 0;
        if (o.enabled()) begin(sc, y0, touch);
        else if (o.refused) o.refused(sc);
      }, HOLD);
      const watch = ev => { if (Math.abs(ev.clientY - y0) > SLOP || Math.abs(ev.clientX - x0) > SLOP) cancelHold(); };
      const stop = () => {
        cancelHold();
        document.removeEventListener('pointermove', watch);
        document.removeEventListener('pointerup', stop);
        document.removeEventListener('pointercancel', stop);
      };
      document.addEventListener('pointermove', watch);
      document.addEventListener('pointerup', stop);
      document.addEventListener('pointercancel', stop);
    }, true);

    function begin(sc, y, touch) {
      on = true; byTouch = touch;
      el = sc.item; items = sc.items;
      from = to = items.indexOf(el);
      startY = lastY = y; startScroll = window.scrollY;
      centers = items.map(n => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; });
      shiftH = el.getBoundingClientRect().height + o.gap(sc.box);
      items.forEach(n => { n.__base = n.style.transform || ''; n.classList.add('drag-sliding'); });
      el.classList.add('drag-lift');
      document.body.classList.add('dragging');
      if (o.onBegin) o.onBegin();
      if (navigator.vibrate) { try { navigator.vibrate(14); } catch (e) { /* 忽略 */ } }
      paint(0);
      raf = requestAnimationFrame(tick);
    }

    /* 被拖那张跟着手指走（加上页面滚过的距离——另一只手滚页面、或边缘自动滚时，它要留在手指下面） */
    function update() {
      const offset = (lastY - startY) + (window.scrollY - startScroll);
      const c = centers[from] + offset;
      let k = 0;
      centers.forEach((cc, i) => { if (i !== from && cc < c) k++; });
      to = k;
      paint(offset);
    }
    function paint(offset) {
      items.forEach((n, i) => {
        let s = 0;
        if (n === el) s = offset;
        else if (from < to && i > from && i <= to) s = -shiftH;      // 被拖的往下走，中间这些往上让
        else if (from > to && i >= to && i < from) s = shiftH;       // 往上走，中间这些往下让
        n.style.transform = (n.__base ? n.__base + ' ' : '') + 'translate3d(0,' + s.toFixed(1) + 'px,0)';
      });
    }
    function tick() {
      if (!on) return;
      const vh = window.innerHeight;
      let d = 0;
      if (lastY < EDGE) d = -(EDGE - lastY) / 4;
      else if (lastY > vh - EDGE) d = (lastY - (vh - EDGE)) / 4;
      if (d) { window.scrollBy(0, d); update(); }
      raf = requestAnimationFrame(tick);
    }

    function end(commit) {
      if (!on) return;
      cancelAnimationFrame(raf);
      items.forEach(n => { n.classList.remove('drag-sliding'); n.style.transform = n.__base || ''; delete n.__base; });
      el.classList.remove('drag-lift');
      document.body.classList.remove('dragging');
      const f = from, t = to, list = items.slice();
      on = false; el = null; items = null;
      document.body.classList.add('just-dragged');
      setTimeout(() => document.body.classList.remove('just-dragged'), EAT_MS);
      if (commit && t !== f) {
        const [m] = list.splice(f, 1);
        list.splice(t, 0, m);
        o.commit(list);
      } else if (o.cancelled) o.cancelled();
    }

    /* 鼠标路径 */
    document.addEventListener('pointermove', e => {
      if (!on || byTouch) return;
      e.preventDefault(); lastY = e.clientY; update();
    }, { passive: false });
    document.addEventListener('pointerup', () => { if (on && !byTouch) end(true); });
    document.addEventListener('pointercancel', () => { if (on && !byTouch) end(false); });

    /* 触屏路径：浏览器一旦判定「这是滚动」就发 pointercancel 掐掉指针流，所以改由 touch 事件驱动。
       只认起手那根手指；两根手指在屏时放行，让另一只手去滚页面 */
    const mine = list => [...list].find(t => t.identifier === touchId);
    document.addEventListener('touchmove', e => {
      if (!on || !byTouch) return;
      const t = mine(e.touches);
      if (!t) return;
      if (e.touches.length === 1 && e.cancelable) e.preventDefault();
      lastY = t.clientY; update();
    }, { passive: false });
    document.addEventListener('touchend', e => { if (on && byTouch && mine(e.changedTouches)) end(true); });
    document.addEventListener('touchcancel', e => { if (on && byTouch && mine(e.changedTouches)) end(false); });
    window.addEventListener('scroll', () => { if (on) update(); }, { passive: true });

    /* 拖完浏览器会补一个 click，吃掉，否则一松手就打开详情 */
    document.addEventListener('click', e => {
      if (document.body.classList.contains('just-dragged')) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    return { active: () => on, holding: () => !!timer, cancelHold };
  }

  root.LongPressDrag = LongPressDrag;
})(window);
