/* 手势组件：SwipeActions（左滑操作）+ SheetDismiss（下拉关闭底部弹窗）
   原样取自 references/组件_iOS手势/ios-gestures.html（配方 feedback_ios_gesture_recipe.md），未改参数。 */
function SwipeActions(o){
  var DEAD = 10;          /* 起手死区 */
  var EDGE = 28;          /* 屏幕左右边缘让给系统手势 */
  var OVER = 0.3;         /* 拉过头的阻尼 */
  var OPEN_AT = 0.35;     /* 从关着拉开：过按钮总宽的 35% 就停在打开；从开着推回：推回超过 35% 就收起 */
  var g = null, open = null, eatUntil = 0;

  /* 滑完浏览器可能补一个 click。守卫必须自己过期（450ms）：preventDefault 过 touchmove 后
     浏览器往往根本不补 click，挂着不走会把下一次真实点击吃掉。按钮层上的点击永远放行 */
  function eat(){ eatUntil = Date.now() + 450; }
  document.addEventListener("click", function(e){
    if(eatUntil && Date.now() < eatUntil && !e.target.closest(".lsw-acts")){
      eatUntil = 0; e.stopPropagation(); e.preventDefault();
    }
  }, true);

  function set(el, x, anim){
    el.classList.toggle("lsw-anim", !!anim);
    el.style.transform = x ? "translate3d(" + x.toFixed(1) + "px,0,0)" : "";
  }
  /* 按钮层只在滑动时临时插进 DOM（插在条目前面，靠 DOM 顺序被条目盖住），收回就拆掉——
     平时页面结构不变，别的依赖选择器的逻辑（拖拽排序、堆叠）都不用改 */
  function mount(el){
    var host = el.parentElement, list = o.actions(el);
    if(!host || !list || !list.length) return null;
    /* 按钮层用 offsetTop/offsetLeft + right 定位，参照物必须是 host。host 是 static 时参照物会变成更外层，
       手机上列表≈屏宽碰巧对得上，宽屏上按钮直接飞出屏幕（2026-09-14 存档自检在 1280 宽抓到：x=1592）。
       别指望复用的人记得设，组件自己补 */
    if(getComputedStyle(host).position === "static") host.style.position = "relative";
    var acts = document.createElement("div");
    acts.className = "lsw-acts";
    list.forEach(function(a){
      var b = document.createElement("button");
      b.type = "button"; b.className = "lsw-btn " + (a.cls || "");
      b.innerHTML = (a.icon || "") + '<span class="lsw-txt"></span>';
      b.querySelector(".lsw-txt").textContent = a.label;
      b.addEventListener("click", function(){ a.onClick(el); });
      acts.appendChild(b);
    });
    acts.style.top = el.offsetTop + "px";
    acts.style.height = el.offsetHeight + "px";
    acts.style.right = (host.clientWidth - el.offsetLeft - el.offsetWidth) + "px";
    host.insertBefore(acts, el);
    return {acts:acts, w:acts.offsetWidth + 8};     /* 条目停在：按钮总宽 + 8px 缝 */
  }
  function close(anim){
    if(!open) return;
    var x = open; open = null;
    x.acts.classList.remove("is-open");
    if(anim === false){ set(x.el, 0, false); x.acts.remove(); return; }
    set(x.el, 0, true);
    setTimeout(function(){
      if(open && open.acts === x.acts) return;
      x.el.classList.remove("lsw-anim"); x.acts.remove();
    }, 320);
  }

  document.addEventListener("touchstart", function(e){
    g = null;
    if(e.touches.length !== 1 || (o.blocked && o.blocked())) return;
    var t = e.target;
    if(open && t.closest(".lsw-acts")) return;               /* 点露出来的按钮，交给它的 click */
    var el = t.closest(o.item);
    if(el && !o.root.contains(el)) el = null;
    if(open && open.el !== el){                               /* 点别处先收回；点的是另一条就只算收回 */
      close(true); if(el) eat(); return;
    }
    if(!el || (o.canSwipe && !o.canSwipe(el))) return;
    var x = e.touches[0].clientX, vw = document.documentElement.clientWidth;
    var fromOpen = !!(open && open.el === el);
    if(!fromOpen && (x < EDGE || x > vw - EDGE)) return;
    g = {el:el, x0:x, y0:e.touches[0].clientY, fromOpen:fromOpen, locked:false, pos:0, w:0, acts:null};
  }, {passive:true});

  document.addEventListener("touchmove", function(e){
    if(!g || !e.touches[0]) return;
    var dx = e.touches[0].clientX - g.x0, dy = e.touches[0].clientY - g.y0;
    if(!g.locked){
      if(Math.abs(dx) < DEAD && Math.abs(dy) < DEAD) return;
      if(Math.abs(dx) <= Math.abs(dy)){ if(g.fromOpen) close(true); g = null; return; }   /* 纵向不归我 */
      if(!g.fromOpen && dx > 0){ g = null; return; }                                    /* 关着的往右滑没意义 */
      g.locked = true;
      if(o.onLock) o.onLock();          /* 让宿主取消长按计时之类的（日程卡片里是 dragCancelHold） */
      if(g.fromOpen){ g.acts = open.acts; g.w = open.w; open = null; }
      else{ var m = mount(g.el); if(!m){ g = null; return; } g.acts = m.acts; g.w = m.w; }
      g.acts.classList.remove("is-open");
    }
    e.preventDefault();
    var pos = (g.fromOpen ? -g.w : 0) + dx;
    if(pos > 0) pos = pos * OVER;
    else if(pos < -g.w) pos = -g.w + (pos + g.w) * OVER;
    g.pos = pos;
    set(g.el, pos, false);
  }, {passive:false});

  function end(cancel){
    if(!g) return;
    var x = g; g = null;
    if(!x.locked){ if(x.fromOpen && !cancel){ close(true); eat(); } return; }   /* 轻点开着的那条 = 收回 */
    eat();
    var stay = !cancel && (x.fromOpen ? x.pos < -x.w * (1 - OPEN_AT) : x.pos < -x.w * OPEN_AT);
    open = {el:x.el, acts:x.acts, w:x.w};
    if(stay){ set(x.el, -x.w, true); x.acts.classList.add("is-open"); }
    else close(true);
  }
  document.addEventListener("touchend", function(){ end(false); }, {passive:true});
  document.addEventListener("touchcancel", function(){ end(true); }, {passive:true});
  window.addEventListener("scroll", function(){ if(open && !g) close(true); }, {passive:true});
  window.addEventListener("resize", function(){ close(false); });

  return {
    close: close,
    forget: function(){ open = null; g = null; },     /* 宿主整块重建列表 DOM 时调用 */
    active: function(){ return !!(g && g.locked); },  /* 给下拉刷新的 blocked() 用 */
    isOpen: function(){ return !!open; }              /* 给长按拖拽用：有条目开着时别起拖拽 */
  };
}
function SheetDismiss(o){
  var DEAD = 10;
  var busy = false, timer = 0, g = null, eatIn = null, eatUntil = 0;

  /* 只吞"落在刚才被拉的那个弹窗里"的补发 click，350ms。
     不能用全局守卫：拉掉弹窗后立刻点页面上的按钮（比如 ＋）会被吞，表现成"点了没反应" */
  document.addEventListener("click", function(e){
    if(eatIn && Date.now() < eatUntil && eatIn.contains(e.target)){ eatIn = null; e.stopPropagation(); e.preventDefault(); }
  }, true);

  function reset(S){ S.sheet.style.transition = ""; S.sheet.style.transform = ""; S.mask.style.transition = ""; S.mask.style.backgroundColor = ""; }
  function top(){ var L = o.sheets(); for(var i = L.length - 1; i >= 0; i--) if(!L[i].mask.hidden) return L[i]; return null; }

  document.addEventListener("touchstart", function(e){
    g = null;
    if(busy || e.touches.length !== 1 || (o.blocked && o.blocked())) return;
    var S = top(); if(!S) return;
    var t = e.target;
    if(!S.sheet.contains(t)) return;                       /* 按在遮罩上的，交给"点空白关闭" */
    if(o.skip && t.closest(o.skip)) return;                /* 弹窗里自己会滚的下拉列表等 */
    for(var n = t; n && n !== S.mask; n = n.parentElement){ if(n.scrollTop > 0) return; }   /* 内容没在顶：是在滚内容 */
    var p = e.touches[0];
    g = {S:S, x0:p.clientX, y0:p.clientY, locked:false, dy:0, h:0, samples:[]};
  }, {passive:true});

  document.addEventListener("touchmove", function(e){
    if(!g || !e.touches[0]) return;
    var p = e.touches[0], dx = p.clientX - g.x0, dy = p.clientY - g.y0;
    if(!g.locked){
      if(dy <= 0 || Math.abs(dx) > Math.abs(dy)){ if(Math.abs(dx) >= DEAD || Math.abs(dy) >= DEAD) g = null; return; }
      /* 死区里就先挡住浏览器回弹：iOS 回弹一旦开始，后面的 touchmove 就拦不住了 */
      if(e.cancelable) e.preventDefault();
      if(dy < DEAD) return;
      g.locked = true;
      clearTimeout(timer);
      g.h = g.S.sheet.getBoundingClientRect().height;
      var ae = document.activeElement;
      if(ae && g.S.sheet.contains(ae) && ae.blur) ae.blur();   /* 拉的时候收键盘，跟系统 sheet 一样 */
    }
    if(e.cancelable) e.preventDefault();
    var y = dy - DEAD, now = performance.now();
    g.samples.push({y:p.clientY, t:now});
    while(g.samples.length > 2 && now - g.samples[0].t > 100) g.samples.shift();
    g.dy = y;
    g.S.sheet.style.transition = "none";
    g.S.sheet.style.transform = "translate3d(0," + y.toFixed(1) + "px,0)";
    g.S.mask.style.transition = "none";
    g.S.mask.style.backgroundColor = "rgba(12,16,22," + (0.42 * Math.max(0, 1 - y / g.h)).toFixed(3) + ")";
  }, {passive:false});

  function end(cancel){
    if(!g) return;
    var x = g; g = null;
    if(!x.locked) return;
    var S = x.S;
    eatIn = S.mask; eatUntil = Date.now() + 350;
    /* 距离阈值跟着弹窗高度走：矮的确认框拉 80 就够，高的编辑框到 22%（封顶 160） */
    var far = x.dy > Math.min(160, Math.max(80, x.h * 0.22));
    var s0 = x.samples[0], s1 = x.samples[x.samples.length - 1];
    var span = (s0 && s1) ? s1.t - s0.t : 0;
    var v = span >= 30 ? (s1.y - s0.y) / span : 0;       /* px/ms */
    if(s1 && performance.now() - s1.t > 100) v = 0;      /* 停住再松手不算甩 */
    var go = !cancel && (far || (v > 0.6 && x.dy > 30));
    S.sheet.style.transition = "transform .28s cubic-bezier(.2,.8,.3,1)";
    S.mask.style.transition = "background-color .28s ease";
    if(go && S.dirty && S.dirty()){
      S.sheet.style.transform = ""; S.mask.style.backgroundColor = "";
      timer = setTimeout(function(){ reset(S); }, 300);
      o.confirmDiscard(S);
      return;
    }
    if(go){
      busy = true;
      S.sheet.style.transform = "translate3d(0," + Math.ceil(x.h + 24) + "px,0)";
      S.mask.style.backgroundColor = "rgba(12,16,22,0)";
      setTimeout(function(){ S.close(); reset(S); busy = false; }, 280);
    }else{
      S.sheet.style.transform = ""; S.mask.style.backgroundColor = "";
      timer = setTimeout(function(){ reset(S); }, 300);
    }
  }
  document.addEventListener("touchend", function(){ end(false); }, {passive:true});
  document.addEventListener("touchcancel", function(){ end(true); }, {passive:true});
  return { active: function(){ return !!(g && g.locked); } };
}
