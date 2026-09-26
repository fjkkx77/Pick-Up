/* 分组 3D 堆叠布局
   算法和参数原样取自日程卡片（rc.wbztl.xyz，index.html 的 layoutStacks / place，2026-09 多轮调过），
   只把依赖（视图、展开状态）改成参数传进来。

   结构约定：.stack[data-group] > .stack-item（绝对定位，只靠 transform 移动）> .card
   收起时：每往后一层退 DEPTH 像素（真 3D 透视），并反解平移量让每层底边正好比上一层多露 PEEK 像素——
   卡片高矮不一也能得到同样的露出量，不按某一档写死。 */
(function (root) {
  'use strict';

  const PERSPECTIVE = 880;   // 透视距离（写到 .stack 上，保证和下面的算式同源）
  const DEPTH = 150;         // 每往后一层退多远（z 轴）——空间感的来源
  const TILT = 1.15;         // 每层轻微歪一点，像随手叠上去的
  const DIM = .07;           // 每往后一层压多少暗色
  const VISIBLE = 3;         // 收起时最多露几层
  const PEEK = 26;           // 收起时每层露出多少（日程卡片的卡片视图值）
  const GAP = 12;            // 展开时卡片间距（和首页 .list 的 gap 一致）

  function place(el, o) {
    el.style.transform = 'translate3d(0,' + o.y.toFixed(2) + 'px,' + o.z.toFixed(1) + 'px) rotate(' + (o.tilt || 0).toFixed(2) + 'deg)';
    el.style.opacity = o.op.toFixed(2);
    el.style.filter = o.blur ? 'blur(' + o.blur + 'px)' : '';
    el.style.setProperty('--dim', o.dim.toFixed(3));
    el.style.pointerEvents = o.pe;
    el.style.zIndex = String(o.z9);
    el.style.transitionDelay = o.delay ? o.delay + 'ms' : '0ms';
    el.setAttribute('data-layer', String(o.layer));
    // 压在下面看不见的那几张，别让键盘 Tab 还能聚焦进去
    el.querySelectorAll('button,[tabindex]').forEach(b => { b.tabIndex = o.pe === 'none' ? -1 : 0; });
  }

  /**
   * @param {Element} box 包含若干 .stack 的容器
   * @param {(name:string)=>boolean} isOpen 这一组现在是不是展开的
   * @param {boolean} animate 展开/收起时要动画（带错开）；首次渲染、改尺寸时直接就位
   */
  function layout(box, isOpen, animate) {
    const stacks = box.querySelectorAll('.stack');
    if (!stacks.length) return;
    if (!animate) box.classList.add('no-anim');
    stacks.forEach(stack => {
      const items = [...stack.children].filter(n => n.classList.contains('stack-item'));
      const n = items.length;
      if (!n) return;
      const open = n === 1 || isOpen(stack.getAttribute('data-group'));   // 只有一张时没有「一摞」可言
      const h = items.map(i => i.offsetHeight);                            // 先量完再写，避免反复重排
      stack.style.perspective = PERSPECTIVE + 'px';
      stack.classList.toggle('is-open', open);
      let total;
      if (open) {
        let y = 0;
        items.forEach((it, i) => {
          place(it, { y, z: 0, tilt: 0, dim: 0, blur: 0, op: 1, pe: 'auto', z9: n - i, layer: i, delay: animate ? i * 62 : 0 });
          y += h[i] + GAP;
        });
        total = y - GAP;
      } else {
        /* k = P / (P + 深度) 是第 L 层的投影缩放；灭点在这一摞顶边，
           要让第 L 层底边比第一层低 L*PEEK：ty = (h0 + L*PEEK) / k - h[i] */
        items.forEach((it, i) => {
          const L = Math.min(i, VISIBLE);
          const k = PERSPECTIVE / (PERSPECTIVE + L * DEPTH);
          place(it, {
            y: (h[0] + L * PEEK) / k - h[i], z: -L * DEPTH, tilt: (i % 2 ? 1 : -1) * L * TILT,
            dim: L * DIM, blur: L >= 2 ? 1.4 : 0,
            op: i < VISIBLE ? 1 : 0, pe: i < VISIBLE ? 'auto' : 'none',   // 露出来的边也能点（点了 = 展开）
            z9: n - i, layer: i, delay: animate ? (n - 1 - i) * 40 : 0
          });
        });
        total = h[0] + Math.min(n - 1, VISIBLE - 1) * PEEK;
      }
      stack.style.height = total + 'px';
    });
    if (!animate) { void box.offsetHeight; box.classList.remove('no-anim'); }
  }

  root.Stack = { layout, PEEK, GAP, VISIBLE };
})(window);
