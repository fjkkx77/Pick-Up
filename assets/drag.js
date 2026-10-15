/* 长按拖动排序（通用组件，不认识业务数据）  v2.0.0（2026-10-15，跟上日程卡片那版）
   出处：日程卡片的长按拖拽（长按 450ms 拿起、同容器同级项换位、让位动画、松手吃 click），
   接着来第二次用时抽成组件；2026-10-15 按日程卡片的线上版整体更新（用户 iPhone 真机试过：「非常完美，我很满意」）。

   拖动时页面怎么滚——两样配套，缺一样都算没做完（用户 2026-10-15 要求记住，配方 feedback_ios_gesture_recipe §4.5）：
     ① 拖到屏幕上下边缘 64px 内页面自己滚：速度＝进入边缘的距离 ÷ 4（每 16.7ms），**按时间算**（按帧算 120Hz 屏会快一倍）；
        拿起后手指先挪过 SLOP 才生效（长按的那张本来就在边缘附近时，不至于一拿起来页面就自己跑）；另一根手指在滚时让给它
     ② 一只手拖、另一只手滑页面：拖动期间 touchmove 全部拦下，按 touch.identifier 分——拖的那根挪卡片，另一根**由组件自己滚页面**，
        松开带惯性（iOS 0.998/ms）、再按下接住；只有拖的那根抬起才算松手
        （v1 是「两指在屏时放行浏览器原生滚动」，但拖动时 body 带 touch-action:none，原生滚动根本起不来，演示页里这条其实不工作）
     两样都**封顶到拿起那一刻的页面底**：被拖的那项往下挪会把页面撑长，不封顶会一直滚进下面的空白（2026-10-15 测出来的）
   位置一律按页面坐标算（手指屏幕 y + 页面滚过的量）：页面怎么滚，被拖的那项都贴在手指下，让位跟着重算；电脑上滚滚轮同样生效。

   松手落位（v2 新增，可选）：FLIP + 带松手速度的弹簧——松手前记下每一项的屏幕位置，宿主按新顺序重画后量新位置，逐项从旧位置弹过去。
   v1 是瞬移，日程卡片用户反馈「收尾时弹一下」（实测一帧跳 57px，整组越过另一组 345px）。
   要这个效果，宿主得给 o.keyOf / o.find（重画后元素是新的，靠稳定的 key 找回来）；不给就和 v1 一样直接到位。
   弹簧：SwiftUI .snappy（response 0.4 / damping 0.86），过冲封顶 14px，采样成关键帧交给 WAAPI（只动 transform，Safari 上走合成器）。

   落点算法（和日程卡片不同的一处）：不按「被拖那张的高度」一格格算（卡片高矮不一时会错位），而是
   往上拖时「被拖那项的上边」越过谁的中线就排到谁前面，往下拖时「下边」越过谁的中线就排到谁后面。 */
(function (root) {
  'use strict';

  const HOLD = 450;     // 按住多久算「拿起来」
  const SLOP = 10;      // 按住期间手指动超过这么多 = 在滚动 / 滑动，取消长按；拿起后挪过这么多，边缘自动滚才生效
  const EDGE = 64;      // 距上下边多近开始自动滚
  const EAT_MS = 350;   // 松手后吃掉浏览器补发的 click（落位动画更长时延到动画结束）
  const DECEL = 0.998;  // 第二根手指松开后的惯性：每毫秒剩多少速度（iOS UIScrollView 正常减速率）
  const SPRING = { response: 0.4, damping: 0.86, hz: 240, maxMs: 620, maxOvershoot: 14 };

  /**
   * @param {object} o
   * @param {()=>boolean} o.enabled   现在能不能拖（比如只有自定义顺序下能）
   * @param {()=>boolean} o.blocked   有浮层开着、有卡片滑开着 → 整个不接
   * @param {(target:Element)=>({item:Element, box:Element, items:Element[]}|null)} o.scope  按在哪、同级项有哪些
   * @param {(scope)=>void} [o.refused] 能拖的地方长按了、但现在不允许拖（给个提示）
   * @param {()=>void} [o.onBegin]     拿起来的那一刻（让左滑、下拉刷新让位）
   * @param {(items:Element[])=>void} o.commit  松手且位置变了：按新顺序给出同级项（宿主写数据并重画）
   * @param {()=>void} [o.cancelled]   松手但没换位（堆叠里的项要复原位置）
   * @param {(box:Element)=>number} o.gap  同级项之间的间距
   * @param {(el:Element)=>string|null} [o.keyOf]  一项的稳定身份（如 'e:'+卡片id / 'g:'+组名）——给了这个和 find 才有落位弹簧
   * @param {(key:string)=>Element|null} [o.find] 重画后按 key 找回这一项
   */
  function LongPressDrag(o) {
    let timer = 0, on = false, touchId = null, byTouch = false;
    let el = null, items = null, from = 0, to = 0;
    let startY = 0, lastY = 0, startScroll = 0, maxScroll = 0, centers = [], top0 = 0, h0 = 0, shiftH = 0;
    let v = 0, vY = 0, vT = 0;                  // 拖动速度（px/ms，页面坐标，指数平滑），松手交给弹簧
    let edgeRaf = 0, edgeLast = 0, armed = false;
    let finger2 = null, momRaf = 0;             // 第二根手指 {id, y, samples}、它松开后的惯性

    const cancelHold = () => { clearTimeout(timer); timer = 0; };
    const scrollTo = y => window.scrollTo(0, Math.max(0, Math.min(maxScroll, y)));

    /* 记下起手那根手指：pointerId 和 touch.identifier 不是一回事，触屏路径要认后者。
       拖动中再放上来的手指：它负责滚页面（已经有一根在滚就不换），按下去顺带接住正在滑的惯性 */
    document.addEventListener('touchstart', e => {
      if (!on) { if (e.touches.length === 1) touchId = e.changedTouches[0].identifier; return; }
      if (!byTouch || finger2) return;
      for (const t of e.changedTouches) {
        if (t.identifier === touchId) continue;
        stopMomentum();
        finger2 = { id: t.identifier, y: t.clientY, samples: [{ y: t.clientY, t: performance.now() }] };
        break;
      }
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
      maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      v = 0; vY = y; vT = performance.now();
      finger2 = null; stopMomentum(); armed = false;
      centers = items.map(n => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; });
      const r0 = el.getBoundingClientRect();
      top0 = r0.top; h0 = r0.height;
      shiftH = h0 + o.gap(sc.box);
      items.forEach(n => { n.__base = n.style.transform || ''; n.classList.add('drag-sliding'); });
      el.classList.add('drag-lift');
      document.body.classList.add('dragging');
      if (o.onBegin) o.onBegin();
      if (navigator.vibrate) { try { navigator.vibrate(14); } catch (e) { /* 忽略 */ } }
      paint(0);
      edgeLast = performance.now();
      edgeRaf = requestAnimationFrame(edgeTick);
    }

    /* 被拖那项跟着手指走：位移按页面坐标（手指挪了多少 + 页面滚了多少） */
    function update() {
      const offset = (lastY - startY) + (window.scrollY - startScroll);
      const now = performance.now(), pageY = startY + offset, dt = now - vT;
      if (dt >= 4) { v = 0.4 * (pageY - vY) / dt + 0.6 * v; vY = pageY; vT = now; }   // 同一帧连来两个事件不算，否则速度虚高
      const top = top0 + offset, bottom = top + h0;
      let k = 0;
      centers.forEach((cc, i) => {
        if (i < from && top >= cc) k++;            // 原本在上面的：我的上边还没越过它的中线 → 它仍在我前面
        else if (i > from && bottom > cc) k++;     // 原本在下面的：我的下边越过了它的中线 → 它排到我前面
      });
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

    /* ① 边缘自动滚 */
    function edgeTick(now) {
      if (!on) { edgeRaf = 0; return; }
      const dt = Math.min(48, now - edgeLast); edgeLast = now;
      if (!armed && Math.abs(lastY - startY) > SLOP) armed = true;
      if (armed && !finger2 && !momRaf) {          // 另一只手正在滚、或者它的惯性还没停：交给它
        const vh = window.innerHeight;
        let d = 0;
        if (lastY < EDGE) d = -(EDGE - lastY) / 4;
        else if (lastY > vh - EDGE) d = (lastY - (vh - EDGE)) / 4;
        if (d) { const b = window.scrollY; scrollTo(b + d * dt / 16.7); if (window.scrollY !== b) update(); }
      }
      edgeRaf = requestAnimationFrame(edgeTick);
    }

    /* ② 第二根手指松开后的惯性 */
    function stopMomentum() { if (momRaf) { cancelAnimationFrame(momRaf); momRaf = 0; } }
    function momentum(speed) {
      stopMomentum();
      if (Math.abs(speed) < 0.05) return;
      let last = performance.now();
      const step = now => {
        const dt = Math.min(32, now - last); last = now;
        speed *= Math.pow(DECEL, dt);
        const b = window.scrollY;
        scrollTo(b + speed * dt);
        if (on) update();
        if (Math.abs(speed) < 0.02 || window.scrollY === b) { momRaf = 0; return; }   // 慢到看不出、或滚到头了
        momRaf = requestAnimationFrame(step);
      };
      momRaf = requestAnimationFrame(step);
    }

    /* 松手落位：FLIP + 弹簧（宿主给了 keyOf / find 才做） */
    function springPts(distance, velocity) {
      const w0 = 2 * Math.PI / SPRING.response, z = SPRING.damping, wd = w0 * Math.sqrt(1 - z * z), stepS = 1 / SPRING.hz;
      const sample = v0 => {
        const B = (v0 + z * w0) / wd, out = [];
        for (let i = 0; ; i++) {
          const t = i * stepS; if (t >= SPRING.maxMs / 1000) break;
          const u = Math.exp(-z * w0 * t) * (Math.cos(wd * t) + B * Math.sin(wd * t));
          out.push(1 - u); if (t > 0.1 && Math.abs(u) < 0.002) break;
        }
        return out;
      };
      const over = a => (Math.max(...a) - 1) * Math.abs(distance);
      const v0 = distance ? (velocity * 1000) / distance : 0;
      let pts = sample(v0);
      if (over(pts) > SPRING.maxOvershoot) {      // 0 速度一定不过冲：二分找一个刚好不超的初速度
        let lo = 0, hi = v0;
        for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2, c = sample(mid); if (over(c) > SPRING.maxOvershoot) hi = mid; else { lo = mid; pts = c; } }
      }
      pts[pts.length - 1] = 1;                     // 最后一点钉死，精确落位
      return { ms: Math.round(Math.max(120, (pts.length - 1) * stepS * 1000)), pts };
    }
    function land(before, liftKey, speed) {
      const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !document.body.animate) return 0;
      let longest = 0;
      Object.keys(before).forEach(k => {
        const n = o.find(k);
        if (!n) return;
        const d = before[k] - n.getBoundingClientRect().top;
        if (Math.abs(d) < 0.5) return;            // 本来就在位的不动
        const lift = k === liftKey, sp = springPts(d, lift ? speed : 0);
        const base = n.style.transform || '';     // 堆叠里的项本身带 transform，在它上面叠偏移
        const frames = sp.pts.map((p, i) => ({ offset: i / (sp.pts.length - 1), transform: (base ? base + ' ' : '') + 'translate3d(0,' + (d * (1 - p)).toFixed(2) + 'px,0)' }));
        if (lift) n.classList.add('drag-landing');
        const a = n.animate(frames, { duration: sp.ms, easing: 'linear' });
        if (lift) a.onfinish = a.oncancel = () => n.classList.remove('drag-landing');
        if (sp.ms > longest) longest = sp.ms;
      });
      return longest;
    }

    function end(commit) {
      if (!on) return;
      cancelAnimationFrame(edgeRaf); edgeRaf = 0;
      stopMomentum(); finger2 = null;             // 落位动画按此刻的屏幕位置算，页面再滑会让它落偏
      const speed = performance.now() - vT > 100 ? 0 : v;   // 停住超过 100ms 再松手：不带速度
      const canLand = !!(o.keyOf && o.find);
      const before = {}, liftKey = canLand ? o.keyOf(el) : null;
      if (canLand) items.forEach(n => { const k = o.keyOf(n); if (k) before[k] = n.getBoundingClientRect().top; });
      items.forEach(n => { n.classList.remove('drag-sliding'); n.style.transform = n.__base || ''; delete n.__base; });
      el.classList.remove('drag-lift');
      document.body.classList.remove('dragging');
      const f = from, t = to, list = items.slice();
      on = false; el = null; items = null;
      document.body.classList.add('just-dragged');
      if (commit && t !== f) {
        const [m] = list.splice(f, 1);
        list.splice(t, 0, m);
        o.commit(list);
      } else if (o.cancelled) o.cancelled();
      const ms = canLand ? land(before, liftKey, speed) : 0;
      setTimeout(() => document.body.classList.remove('just-dragged'), Math.max(EAT_MS, ms));
    }

    /* 鼠标路径 */
    document.addEventListener('pointermove', e => {
      if (!on || byTouch) return;                 // 触屏由 touchmove 按手指编号驱动，这里再跟会被第二根手指拽走
      e.preventDefault(); lastY = e.clientY; update();
    }, { passive: false });
    document.addEventListener('pointerup', () => { if (on && !byTouch) end(true); });
    document.addEventListener('pointercancel', () => { if (on && !byTouch) end(false); });

    /* 触屏路径：浏览器一旦判定「这是滚动」就发 pointercancel 掐掉指针流，所以改由 touch 事件驱动 */
    const pick = (list, id) => { for (const t of list) if (t.identifier === id) return t; return null; };
    document.addEventListener('touchmove', e => {
      if (!on || !byTouch) return;
      if (e.cancelable) e.preventDefault();       // 浏览器自己的滚动和双指缩放一律挡掉，第二根手指的滚动由下面自己做
      const a = pick(e.touches, touchId), b = finger2 ? pick(e.touches, finger2.id) : null;
      if (b) {
        const dy = b.clientY - finger2.y, now = performance.now();
        finger2.y = b.clientY;
        finger2.samples.push({ y: b.clientY, t: now });
        while (finger2.samples.length > 2 && now - finger2.samples[0].t > 100) finger2.samples.shift();
        if (dy) scrollTo(window.scrollY - dy);    // 手指往上推＝页面往下滚，和平常滑动一样
      }
      if (a) lastY = a.clientY;
      update();                                   // 拖的那根没动、只是页面滚了，也要重算
    }, { passive: false });
    const touchEnd = cancel => e => {
      if (!on || !byTouch) return;
      for (const t of e.changedTouches) {
        if (finger2 && t.identifier === finger2.id) {
          const s = finger2.samples; let speed = 0;
          if (s.length >= 2 && performance.now() - s[s.length - 1].t < 80) {
            const f0 = s[0], f1 = s[s.length - 1];
            if (f1.t > f0.t) speed = -(f1.y - f0.y) / (f1.t - f0.t);   // px/ms，正数＝页面往下滚
          }
          finger2 = null;
          if (!cancel) momentum(speed);
        } else if (t.identifier === touchId) {   // 只有拖的那根抬起才算松手
          end(!cancel);
          return;
        }
      }
    };
    document.addEventListener('touchend', touchEnd(false));
    document.addEventListener('touchcancel', touchEnd(true));
    /* 电脑上滚滚轮：跟着重算，也封顶 */
    window.addEventListener('scroll', () => {
      if (!on || byTouch) return;
      if (window.scrollY > maxScroll + 1) { scrollTo(maxScroll); return; }
      update();
    }, { passive: true });

    /* 拖完浏览器会补一个 click，吃掉，否则一松手就打开详情 */
    document.addEventListener('click', e => {
      if (document.body.classList.contains('just-dragged')) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    return { active: () => on, holding: () => !!timer, cancelHold };
  }

  root.LongPressDrag = LongPressDrag;
})(typeof window !== 'undefined' ? window : globalThis);
