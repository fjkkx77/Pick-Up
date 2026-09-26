/* 接着来 · 界面
   数据逻辑都在 model.js（有自检），这里只管画和接线。所有修改走 Store.commit()。 */
(function () {
  'use strict';

  const M = window.Model, S = window.SyncCore;
  const $ = id => document.getElementById(id);
  const now = () => Date.now();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = id => Store.list.find(e => e.id === id && e.type === 'item' && !e.deletedAt);

  const ICO = {
    pause: '<svg class="lsw-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg class="lsw-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l11-7z"/></svg>',
    done: '<svg class="lsw-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    del: '<svg class="lsw-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    x: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    go: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" style="width:16px;height:16px"><path d="M7 17 17 7M8 7h9v9"/></svg>'
  };


  /* ================= 底部弹窗开关 ================= */

  const SHEETS = ['newMask', 'detMask', 'grpMask', 'scaleMask', 'noteMask', 'setMask', 'sortMask', 'gmMask', 'joinMask', 'cfMask', 'dcMask'];
  const anyOpen = () => SHEETS.some(id => !$(id).hidden);
  function lockScroll() { document.documentElement.classList.toggle('locked', anyOpen()); }

  function openSheet(id) {
    const m = $(id);
    m.classList.remove('out');
    m.hidden = false;
    m.querySelector('.sheet').scrollTop = 0;
    lockScroll();
  }
  /** 点按钮关：播退场动画；下拉关闭时手势已经把弹窗拉出屏幕了，直接藏（instant） */
  function closeSheet(id, instant) {
    const m = $(id);
    if (m.hidden) return;
    const done = () => { m.hidden = true; m.classList.remove('out'); lockScroll(); onClosed(id); };
    if (instant || matchMedia('(prefers-reduced-motion:reduce)').matches) { done(); return; }
    m.classList.add('out');
    setTimeout(done, 210);
  }
  function onClosed(id) {
    if (id === 'detMask') { state.detId = null; state.draft = null; }
    if (id === 'cfMask') { state.cf = null; swipe.close(true); }
  }
  SHEETS.forEach(id => $(id).addEventListener('click', e => {
    if (e.target !== $(id)) return;                     // 点遮罩空白处
    if (id === 'detMask' && detDirty()) { askDiscard({ close: () => closeSheet('detMask') }); return; }
    if (id === 'noteMask' && noteDirty()) { askDiscard({ close: () => closeSheet('noteMask') }); return; }
    closeSheet(id);
  }));

  /* ================= 状态 ================= */

  const state = {
    detId: null, draft: null, draftOrig: '',
    noteLog: null, noteItem: null, noteOrig: '', scType: 'counter', scTime: false,
    cf: null, discard: null, staleOpen: false,
    flash: null, firstPaint: true, pendingRender: false, gm: null
  };

  /* ================= 首页 ================= */

  const TAB_OF = s => (s === 'done' || s === 'dropped') ? 'archive' : s;

  function posHTML(it, pos) {
    if (it.kind === 'checklist') {
      const p = M.checkProgress(Store.list, it);
      return p.total ? '<b>' + p.done + '</b><small>/' + p.total + '</small> 步' : '<span class="none">还没有步骤</span>';
    }
    if (it.kind === 'free') return '';
    if (!pos) return '<span class="none">还没开始</span>';
    let h = it.levels.map((l, i) => '第<b>' + pos.pos[i] + '</b>' + (l.total ? '<small>/' + l.total + '</small>' : '') + esc(l.unit))
      .join('<span class="sep">·</span>');
    if (pos.time != null) h += '<span class="tm">' + M.fmtTime(pos.time) + '</span>';
    return h;
  }

  function logLabel(it, log) {
    if (it.kind === 'counter' && log.pos) {
      let s = it.levels.map((l, i) => '第 ' + (log.pos[i] || 1) + ' ' + l.unit).join(' · ');
      if (log.time != null) s += ' · ' + M.fmtTime(log.time);
      return s;
    }
    if (it.kind === 'checklist') {
      const ids = new Set(it.steps.map(s => s.id));
      return '勾了 ' + (log.checked || []).filter(id => ids.has(id)).length + '/' + ids.size + ' 步';
    }
    return '';
  }

  function nextStep(it) {
    const c = M.position(Store.list, it);
    const done = new Set(c ? c.checked : []);
    const s = it.steps.find(x => !done.has(x.id));
    return s ? s.text : '';
  }

  function cardHTML(it, t) {
    const pos = M.position(Store.list, it);
    const note = M.latestNote(Store.list, it);
    const frac = M.fraction(Store.list, it);
    const stale = M.isStale(Store.list, it, t, Store.prefs.staleDays);
    const meta = [];
    meta.push('<span>' + M.relTime(M.lastTouched(Store.list, it), t) + '</span>');
    if (it.status === 'waiting') meta.push('<span class="tag wait">等待中</span>');
    if (it.status === 'paused') meta.push('<span class="tag pause">暂停中</span>');
    if (it.status === 'done') meta.push('<span class="tag done">完成</span>');
    if (it.status === 'dropped') meta.push('<span class="tag pause">放弃</span>');
    if (stale) meta.push('<span class="tag stale">' + Math.floor((t - M.lastTouched(Store.list, it)) / M.DAY) + ' 天没碰</span>');
    if (it.round > 1) meta.push('<span>第 ' + it.round + ' 轮</span>');
    // 回来时最想知道的是「下一步」：有就用它，没有才退回「做到哪」；清单没写字就用第一个没勾的步骤
    let nextTxt = note && note.next ? note.next : '';
    let noteTxt = !nextTxt && note ? note.note : '';
    if (!nextTxt && !noteTxt && it.kind === 'checklist') nextTxt = nextStep(it);
    const plus = it.kind === 'checklist' ? '勾<small>打开</small>' : it.kind === 'free' ? '记<small>一笔</small>' : '+1';
    const plusLabel = it.kind === 'counter' ? '往前记一' + it.levels[it.levels.length - 1].unit : it.kind === 'free' ? '记一笔' : '打开清单';
    const ph = posHTML(it, pos);
    return '<article class="card lsw-item' + (stale ? ' is-stale' : '') + '" data-id="' + it.id + '" tabindex="0" role="button" aria-label="' + esc(it.title) + '">' +
      '<div class="c-main">' +
        '<div class="c-title">' + esc(it.title || '（没起名字）') + '</div>' +
        (ph ? '<div class="c-pos">' + ph + '</div>' : '') +
        (frac != null ? '<div class="bar"><i style="width:' + (frac * 100).toFixed(1) + '%"></i></div>' : '') +
        (nextTxt ? '<div class="c-next"><b>下一步</b>' + esc(nextTxt) + '</div>' : '') +
        (noteTxt ? '<div class="c-note">' + esc(noteTxt) + '</div>' : '') +
        '<div class="c-meta">' + meta.join('') + '</div>' +
      '</div>' +
      '<button type="button" class="c-plus" data-plus="' + it.id + '" aria-label="' + esc(plusLabel) + '">' + plus + '</button>' +
    '</article>';
  }

  /* ---------- 分组堆叠 ---------- */

  const SORT_WORD = { manual: '自定义顺序', recent: '最近碰过的在前', created: '按创建时间' };
  const sortMode = () => Store.prefs.sort || 'manual';
  const isOpenGroup = name => (Store.prefs.expanded || []).includes(name);

  function unitsHTML(units, t) {
    return units.map(u => {
      if (!u.group) return cardHTML(u.items[0], t);
      const n = u.items.length, open = n === 1 || isOpenGroup(u.group);
      return '<section class="group" data-group="' + esc(u.group) + '">' +
        '<div class="group-head" aria-expanded="' + open + '">' +
          '<button type="button" class="g-main" data-gtoggle aria-expanded="' + open + '"><span class="g-name">' + esc(u.group) + '</span><span class="g-count">' + n + '</span></button>' +
          '<button type="button" class="g-more" data-gmenu aria-label="管理分组「' + esc(u.group) + '」">⋯</button>' +
          (n > 1 ? '<button type="button" class="g-chev" data-gtoggle aria-label="展开或收起"><span>▾</span></button>' : '') +
        '</div>' +
        '<div class="stack" data-group="' + esc(u.group) + '">' + u.items.map(i => '<div class="stack-item">' + cardHTML(i, t) + '</div>').join('') + '</div>' +
      '</section>';
    }).join('');
  }

  function toggleGroup(name, force) {
    const ex = (Store.prefs.expanded || []).filter(g => g !== name);
    if (force === true || (force !== false && !isOpenGroup(name))) ex.push(name);
    Store.setPref('expanded', ex);
    $('list').querySelectorAll('.group').forEach(g => {
      if (g.dataset.group !== name) return;
      const open = isOpenGroup(name) || g.querySelectorAll('.stack-item').length === 1;
      g.querySelector('.group-head').setAttribute('aria-expanded', String(open));
      g.querySelector('.g-main').setAttribute('aria-expanded', String(open));
    });
    Stack.layout($('list'), isOpenGroup, true);
  }

  function render() {
    // 拖动进行中不重画：DOM 一换，手里拿着的卡就没了。松手后补一次
    if (drag && drag.active()) { state.pendingRender = true; return; }
    state.pendingRender = false;
    const t = now();
    const all = M.items(Store.list);
    const tab = Store.prefs.tab || 'active';

    const counts = { active: 0, waiting: 0, paused: 0, archive: 0 };
    all.forEach(it => counts[TAB_OF(it.status)]++);
    document.querySelectorAll('#tabs button').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
      b.querySelector('.n').textContent = counts[b.dataset.tab] || '';
    });

    // 冷落提醒：不管在哪个标签都显示（它就是用来把"忘了的"捞回来的）
    const stale = all.filter(it => M.isStale(Store.list, it, t, Store.prefs.staleDays))
      .sort((a, b) => M.lastTouched(Store.list, a) - M.lastTouched(Store.list, b));
    $('stale').hidden = !stale.length;
    if (stale.length) {
      $('staleTxt').textContent = stale.length + ' 件事超过 ' + Store.prefs.staleDays + ' 天没碰了';
      $('staleBtn').setAttribute('aria-expanded', String(state.staleOpen));
      $('staleList').hidden = !state.staleOpen;
      $('staleList').innerHTML = stale.map(it => '<button type="button" class="chip" data-open="' + it.id + '">' + esc(it.title) +
        '<small>' + M.relTime(M.lastTouched(Store.list, it), t) + '</small></button>').join('');
    }

    // 分组被删空 / 改名后，把记在「展开」里的空壳清掉
    const live = M.groupNames(Store.list);
    const ex = (Store.prefs.expanded || []).filter(g => live.includes(g));
    if (ex.length !== (Store.prefs.expanded || []).length) Store.setPref('expanded', ex);

    const shown = all.filter(it => TAB_OF(it.status) === tab);
    const build = arr => unitsHTML(M.groupize(M.sortItems(Store.list, arr, sortMode())), t);

    swipe.forget();
    const list = $('list');
    if (tab === 'archive' && shown.length) {
      const done = shown.filter(i => i.status === 'done'), drop = shown.filter(i => i.status === 'dropped');
      list.innerHTML = (done.length ? '<p class="grp-h">完成 ' + done.length + '</p>' + build(done) : '') +
        (drop.length ? '<p class="grp-h">放弃 ' + drop.length + '</p>' + build(drop) : '');
    } else {
      list.innerHTML = build(shown);
    }
    Stack.layout(list, isOpenGroup, false);
    if (state.firstPaint) {
      list.classList.add('enter');
      list.querySelectorAll('.card').forEach((c, i) => { c.style.animationDelay = Math.min(i, 8) * 45 + 'ms'; });
      setTimeout(() => { list.classList.remove('enter'); list.querySelectorAll('.card').forEach(c => { c.style.animationDelay = ''; }); }, 900);
      state.firstPaint = false;
    }

    const empty = $('empty');
    if (!all.length) {
      empty.className = 'empty';
      empty.innerHTML = '<h2>还没有在进行的事</h2><p>一次做不完的事——学习、工作、项目、爱好……<br>每次停下记一句「做到哪、下一步做什么」，<br>下次打开就能接着来。</p>' +
        '<button type="button" class="btn1" id="emptyNew">记下第一件</button>';
      empty.hidden = false;
    } else if (!shown.length) {
      empty.className = 'empty small';
      const word = { active: '进行中', waiting: '等待中', paused: '暂停', archive: '归档' }[tab];
      empty.innerHTML = '<p>「' + word + '」里现在是空的</p>';
      empty.hidden = false;
    } else empty.hidden = true;

    paintSub();

    if (state.flash) {
      const el = list.querySelector('[data-id="' + state.flash.id + '"]');
      // 新建 / 刚改的那张在收起的一摞里：先把这一组展开，不然看不见
      const shut = el && el.closest('.stack:not(.is-open)');
      if (shut && state.flash.just) toggleGroup(shut.dataset.group, true);
      if (el) {
        if (state.flash.pop) { const p = el.querySelector('.c-pos'); if (p) p.classList.add('pop'); }
        if (state.flash.just) {
          el.classList.add('just');
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
      state.flash = null;
    }

    // 第一次有两件以上时，提示一次能拖
    if (!Store.prefs.hintDrag && all.length >= 2 && sortMode() === 'manual' && tab !== 'archive' && $('toast').hidden && !anyOpen()) {
      Store.setPref('hintDrag', 1);
      setTimeout(() => { if ($('toast').hidden && !anyOpen()) toast('小提示：长按卡片可以拖动排序', null, 4000); }, 700);
    }
  }

  function paintSub() {
    const all = M.items(Store.list);
    const act = all.filter(i => i.status === 'active').length;
    const sy = Store.sync;
    const syncWord = { off: '', syncing: '同步中…', ok: '已同步', error: '同步失败', offline: '离线，联网后自动同步' }[sy.state] || '';
    $('sub').textContent = (all.length ? act + ' 件进行中' : '记下每件事停在哪') + (syncWord ? ' · ' + syncWord : '');
    const dot = $('syncDot');
    dot.hidden = sy.state === 'off';
    dot.className = 'dot ' + ({ ok: 'ok', error: 'err', offline: 'err', syncing: 'busy' }[sy.state] || '');
  }

  /* ---------- 首页交互 ---------- */

  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    Store.setPref('tab', b.dataset.tab);
    state.firstPaint = true;
    render();
    window.scrollTo({ top: 0 });
  });
  $('staleBtn').addEventListener('click', () => { state.staleOpen = !state.staleOpen; render(); });
  $('staleList').addEventListener('click', e => {
    const b = e.target.closest('[data-open]');
    if (b) openDetail(b.dataset.open);
  });
  $('empty').addEventListener('click', e => { if (e.target.id === 'emptyNew') openNew(); });

  $('list').addEventListener('click', e => {
    const tg = e.target.closest('[data-gtoggle]');
    if (tg) { toggleGroup(tg.closest('.group').dataset.group); return; }
    const gm = e.target.closest('[data-gmenu]');
    if (gm) { openGroupMenu(gm.closest('.group').dataset.group); return; }
    // 收起的一摞：点哪儿都是展开（+1 也不接——一摞只露一张，点的是哪条说不清）
    const shut = e.target.closest('.stack:not(.is-open)');
    if (shut) { toggleGroup(shut.dataset.group, true); return; }
    const plus = e.target.closest('[data-plus]');
    if (plus) { onPlus(plus.dataset.plus, plus); return; }
    const card = e.target.closest('.card');
    if (card) openDetail(card.dataset.id);
  });
  $('list').addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) { e.preventDefault(); openDetail(e.target.dataset.id); }
  });
  // 按压反馈：卡片本身不是 <button>，:active 在 iOS 上不可靠，自己挂类
  $('list').addEventListener('pointerdown', e => {
    const shut = e.target.closest('.stack:not(.is-open)');
    if (shut) { shut.classList.add('is-pressed'); return; }          // 按住一摞：整摞往里压一下
    const c = e.target.closest('.card');
    if (c && !e.target.closest('.c-plus')) c.classList.add('press');
  });
  const unpress = () => $('list').querySelectorAll('.card.press, .stack.is-pressed').forEach(c => c.classList.remove('press', 'is-pressed'));
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => $('list').addEventListener(t, unpress, true));

  /* ---------- +1 ---------- */

  function onPlus(id, btn) {
    const it = byId(id);
    if (!it) return;
    if (it.kind === 'checklist') { openDetail(id); return; }
    if (it.kind === 'free') { openNote(it, null); return; }
    const r = Store.commit(list => M.bump(list, it, now()));
    state.flash = { id, pop: true };
    render();
    const nb = $('list').querySelector('[data-plus="' + id + '"]');
    if (nb) { nb.classList.remove('flash'); void nb.offsetWidth; nb.classList.add('flash'); }
    if (btn && navigator.vibrate) navigator.vibrate(8);

    const undo = { label: '撤销', fn: () => { Store.commit(list => M.undo(list, it, r, now())); state.flash = { id, pop: true }; render(); toast('已撤销'); } };
    const inner = it.levels[it.levels.length - 1].unit;
    if (r.log) {
      toast('已记到 ' + M.posLabel(Store.list, it), [undo, { label: '补一句', pri: true, fn: () => openNote(it, r.log) }], 5000);
    } else if (r.hint === 'nextOuter') {
      const outer = it.levels[it.levels.length - 2].unit;
      toast('已经是这一' + outer + '最后一' + inner + '了，先标成「等待中」', [
        { label: '进入下一' + outer, pri: true, fn: () => {
          const r2 = Store.commit(list => M.bumpLevel(list, it, it.levels.length - 2, now()));
          state.flash = { id, pop: true }; render();
          toast('已进入 ' + M.posLabel(Store.list, it), [{ label: '撤销', fn: () => { Store.commit(list => M.undo(list, it, r2, now())); render(); toast('已撤销'); } }], 5000);
        } }, undo], 8000);
    } else if (r.hint === 'finish') {
      toast('已经是最后一' + inner + '了', [
        { label: '标记为完成', pri: true, fn: () => setStatusWithUndo(it, 'done') }, undo], 8000);
    }
  }

  function setStatusWithUndo(it, s, msg) {
    const prev = it.status;
    Store.commit(() => M.setStatus(it, s, now()));
    render();
    toast(msg || ('「' + it.title + '」' + { active: '回到进行中', paused: '已暂停', done: '已标记完成', dropped: '已放弃', waiting: '标成了等待中' }[s]), [
      { label: '撤销', fn: () => { Store.commit(() => M.setStatus(it, prev, now())); render(); toast('已撤销'); } }], 5000);
  }

  /* ---------- 提示条 ---------- */

  let toastTimer = 0;
  function toast(text, actions, ms) {
    const el = $('toast');
    clearTimeout(toastTimer);
    el.classList.remove('out');
    el.hidden = true; void el.offsetWidth; el.hidden = false;      // 重播入场动画
    $('toastTxt').textContent = text;
    const box = $('toastActs');
    box.innerHTML = '';
    (actions || []).forEach(a => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = a.label;
      if (a.pri) b.className = 'pri';
      b.addEventListener('click', () => { hideToast(); a.fn(); });
      box.appendChild(b);
    });
    toastTimer = setTimeout(hideToast, ms || 2600);
  }
  function hideToast() {
    const el = $('toast');
    clearTimeout(toastTimer);
    if (el.hidden) return;
    el.classList.add('out');
    toastTimer = setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 220);
  }
  // 手指按在提示条上时别让它自己消失（正要点撤销，它先没了最气人）
  $('toast').addEventListener('pointerdown', () => { clearTimeout(toastTimer); });
  $('toast').addEventListener('pointerup', () => { toastTimer = setTimeout(hideToast, 2600); });

  /* ================= 新建 ================= */

  function openNew() {
    $('nTitle').value = '';
    openSheet('newMask');
    $('nTitle').focus();          // 必须在点击的同一拍里调用，iOS 才会弹键盘（一日轨道 / 日程卡片都踩过）
  }
  $('fab').addEventListener('click', openNew);
  $('nCancel').addEventListener('click', () => closeSheet('newMask'));
  function createNew() {
    const title = $('nTitle').value.trim();
    if (!title) { $('nTitle').focus(); $('nTitle').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 }); return; }
    const it = Store.commit(list => { const x = M.newItem(title, now(), list); list.push(x); return x; });
    if (Store.prefs.tab !== 'active') Store.setPref('tab', 'active');
    closeSheet('newMask', true);
    state.flash = { id: it.id, just: true };
    render();
    openDetail(it.id, { focusNote: true });      // 建好就直接写「做到哪」，同一拍里 focus 才弹键盘
  }
  $('nOk').addEventListener('click', createNew);
  $('nTitle').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); createNew(); } });

  /* ================= 详情 ================= */

  function freshDraft(it) {
    const cur = M.position(Store.list, it);
    if (it.kind === 'counter') return { pos: cur ? cur.pos.slice() : it.levels.map(() => 1), time: cur ? cur.time : null, timeTxt: cur && cur.time != null ? M.fmtTime(cur.time) : '', note: '', next: '' };
    if (it.kind === 'checklist') return { checked: cur ? cur.checked.slice() : [], note: '', next: '' };
    return { note: '', next: '' };
  }
  function detDirty() {
    return !!state.draft && JSON.stringify(state.draft) !== state.draftOrig;
  }

  function openDetail(id, opt) {
    const it = byId(id);
    if (!it) return;
    opt = opt || {};
    state.detId = id;
    state.draft = freshDraft(it);
    state.draftOrig = JSON.stringify(state.draft);
    $('dTitle').value = it.title;
    $('dNote').value = ''; $('dNext').value = '';
    paintNextHint(it);
    paintResume(it); paintAdjust(it); paintHist(it); paintSettings(it);
    openSheet('detMask');
    if (opt.focusNote) $('dNote').focus();
  }

  /* 「下一步」框里提示上次写的：回来时一眼能对上，又不会预填进去（多半已经做完了） */
  function paintNextHint(it) {
    const n = M.latestNote(Store.list, it);
    $('dNext').placeholder = n && n.next ? '上次写的：' + n.next : '下次回来先干什么';
  }

  function paintResume(it) {
    const t = now();
    const pos = M.position(Store.list, it);
    const note = M.latestNote(Store.list, it);
    const pace = M.pace(Store.list, it, t);
    const ph = posHTML(it, pos);
    let meta = [];
    if (pos) meta.push('上次记录：' + M.relTime(M.lastTouched(Store.list, it), t));
    if (pace) {
      const per = pace.perDay >= 10 ? Math.round(pace.perDay) : Math.round(pace.perDay * 10) / 10;
      meta.push('最近每天约 ' + per + ' ' + pace.unit + (pace.daysLeft != null ? '，照这个速度约 ' + pace.daysLeft + ' 天做完' : ''));
    }
    if (it.round > 1) meta.push('第 ' + it.round + ' 轮');
    const statusWord = { active: '', waiting: '等待中', paused: '暂停中', done: '已完成', dropped: '已放弃' }[it.status];
    $('dResume').innerHTML =
      '<div class="r-k"><span>接着来' + (statusWord ? ' · ' + statusWord : '') + '</span>' +
      (it.link && safeUrl(it.link) ? '<a class="r-go" href="' + esc(safeUrl(it.link)) + '" target="_blank" rel="noopener noreferrer">打开链接' + ICO.go + '</a>' : '') + '</div>' +
      (ph ? '<div class="r-pos">' + ph + '</div>' : '') +
      (note && note.note ? '<div class="r-note">' + esc(note.note) + '</div>' : '') +
      (note && note.next ? '<div class="r-next"><b>下一步</b>' + esc(note.next) + '</div>' : '') +
      (!note && !pos ? '<div class="r-meta">写下做到哪、下一步做什么，点「停在这里」就记下了。</div>' : '') +
      (meta.length ? '<div class="r-meta">' + meta.map(esc).join('<br>') + '</div>' : '');
  }

  /** 链接只放行 http(s)，别让 javascript: 这类东西混进来 */
  function safeUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return /^https?:\/\//i.test(u) ? u : '';
  }

  function paintAdjust(it) {
    const box = $('dAdj');
    const d = state.draft;
    $('dAdjH').hidden = it.kind === 'free';
    box.hidden = it.kind === 'free';
    if (it.kind === 'counter') {
      box.innerHTML = it.levels.map((l, i) =>
        '<div class="row lv" data-lv="' + i + '">' +
          '<span class="u">' + esc(l.unit) + '</span>' +
          '<span class="stepper">' +
            '<button type="button" class="sb" data-step="-1" aria-label="' + esc(l.unit) + '减一"' + (d.pos[i] <= 1 ? ' disabled' : '') + '>−</button>' +
            '<input class="num" data-n="' + i + '" type="text" inputmode="numeric" pattern="[0-9]*" value="' + d.pos[i] + '" aria-label="第几' + esc(l.unit) + '">' +
            '<button type="button" class="sb" data-step="1" aria-label="' + esc(l.unit) + '加一">+</button>' +
          '</span>' +
          '<label class="tot">共<input type="text" inputmode="numeric" pattern="[0-9]*" data-tot="' + i + '" value="' + (l.total || '') + '" placeholder="?" aria-label="一共几' + esc(l.unit) + '">' + esc(l.unit) + '</label>' +
        '</div>').join('') +
        (it.hasTime ? '<div class="row"><span class="u" style="width:2.6em;font-weight:700">时间</span>' +
          '<input class="tm-in" id="dTime" type="text" inputmode="numeric" placeholder="2314" value="' + esc(d.timeTxt) + '" aria-label="看到几分几秒">' +
          '<span class="tm-hint" id="dTimeHint"></span></div>' : '');
      paintTimeHint();
    } else if (it.kind === 'checklist') {
      const on = new Set(d.checked);
      box.innerHTML = it.steps.map(s =>
        '<div class="step" data-step-id="' + s.id + '">' +
          '<button type="button" class="ck" aria-pressed="' + on.has(s.id) + '" aria-label="勾选"><i></i></button>' +
          '<span class="tx">' + esc(s.text) + '</span>' +
          '<button type="button" class="x" data-rm="' + s.id + '" aria-label="删掉这一步">' + ICO.x + '</button>' +
        '</div>').join('') +
        '<div class="row addrow"><input type="text" placeholder="加一步，回车确定" enterkeyhint="done" maxlength="80" aria-label="新的一步">' +
        '<button type="button" class="sb" data-add aria-label="加上">+</button></div>';
    }
  }

  function paintTimeHint() {
    const h = $('dTimeHint');
    if (!h) return;
    const txt = $('dTime').value.trim();
    if (!txt) { h.textContent = '可以不填'; h.className = 'tm-hint'; return; }
    const v = M.parseTime(txt);
    h.textContent = v == null ? '看不懂这个时间' : '= ' + M.fmtTime(v);
    h.className = 'tm-hint' + (v == null ? ' bad' : '');
  }

  function setDraftPos(it, i, v) {
    const d = state.draft;
    const l = it.levels[i];
    v = Math.max(1, Math.floor(v) || 1);
    if (l.total) v = Math.min(v, l.total);
    if (v !== d.pos[i]) {
      d.pos[i] = v;
      for (let k = i + 1; k < d.pos.length; k++) d.pos[k] = 1;     // 换了季，集从头来
      d.time = null; d.timeTxt = '';                                // 换了集，时间点就不作数了
    }
  }

  $('dAdj').addEventListener('click', e => {
    const it = byId(state.detId); if (!it) return;
    const sb = e.target.closest('[data-step]');
    if (sb && it.kind === 'counter') {
      const i = +sb.closest('[data-lv]').dataset.lv;
      setDraftPos(it, i, state.draft.pos[i] + (+sb.dataset.step));
      paintAdjust(it);
      const n = $('dAdj').querySelector('[data-n="' + i + '"]');
      if (n) n.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.2,1.35,.4,1)' });
      return;
    }
    const ck = e.target.closest('.ck');
    if (ck) {
      const sid = ck.closest('[data-step-id]').dataset.stepId;
      const set = new Set(state.draft.checked);
      set.has(sid) ? set.delete(sid) : set.add(sid);
      state.draft.checked = it.steps.map(s => s.id).filter(x => set.has(x));
      ck.setAttribute('aria-pressed', String(set.has(sid)));
      return;
    }
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      const step = it.steps.find(s => s.id === rm.dataset.rm);
      confirmBox('删掉这一步？', '「' + (step ? step.text : '') + '」', '删掉', true, () => {
        Store.commit(() => M.removeStep(it, rm.dataset.rm, now()));
        state.draft.checked = state.draft.checked.filter(x => x !== rm.dataset.rm);
        state.draftOrig = JSON.stringify(Object.assign(JSON.parse(state.draftOrig), { checked: JSON.parse(state.draftOrig).checked.filter(x => x !== rm.dataset.rm) }));
        paintAdjust(it); paintResume(it);
      });
      return;
    }
    if (e.target.closest('[data-add]')) addStepFromInput(it);
  });
  function addStepFromInput(it) {
    const inp = $('dAdj').querySelector('.addrow input');
    const v = inp.value.trim();
    if (!v) { inp.focus(); return; }
    Store.commit(() => M.addStep(it, v, now()));
    paintAdjust(it); paintResume(it);
    $('dAdj').querySelector('.addrow input').focus();
  }
  $('dAdj').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing && e.target.closest('.addrow')) { e.preventDefault(); const it = byId(state.detId); if (it) addStepFromInput(it); }
  });
  $('dAdj').addEventListener('input', e => {
    const it = byId(state.detId); if (!it) return;
    if (e.target.id === 'dTime') {
      state.draft.timeTxt = e.target.value;
      state.draft.time = M.parseTime(e.target.value);
      paintTimeHint();
    }
  });
  $('dAdj').addEventListener('change', e => {
    const it = byId(state.detId); if (!it) return;
    if (e.target.dataset.n != null) {
      const i = +e.target.dataset.n;
      setDraftPos(it, i, parseInt(e.target.value, 10));
      paintAdjust(it);
    } else if (e.target.dataset.tot != null) {
      const i = +e.target.dataset.tot;
      const raw = e.target.value.trim();
      const v = raw === '' ? null : parseInt(raw, 10);
      if (raw !== '' && !(v >= 1)) { e.target.value = it.levels[i].total || ''; return; }
      Store.commit(list => M.setTotal(list, it, i, v, now()));
      if (v && state.draft.pos[i] > v) state.draft.pos[i] = v;
      paintAdjust(it); paintResume(it);
    }
  });
  $('dNote').addEventListener('input', () => { if (state.draft) state.draft.note = $('dNote').value; });
  $('dNext').addEventListener('input', () => { if (state.draft) state.draft.next = $('dNext').value; });

  $('dStop').addEventListener('click', () => {
    const it = byId(state.detId); if (!it) return;
    const d = state.draft;
    if (it.kind === 'counter' && it.hasTime && $('dTime') && $('dTime').value.trim() && d.time == null) {
      $('dTime').focus(); toast('时间没看懂：可以写 2314、23:14 或 1:05:30'); return;
    }
    if (it.kind === 'free' && !d.note.trim() && !d.next.trim()) { $('dNote').focus(); toast('写一句再记吧'); return; }
    Store.commit(list => M.stop(list, it, { pos: d.pos, time: d.time, checked: d.checked }, { note: d.note, next: d.next }, now()));
    state.draft = null;
    closeSheet('detMask');
    state.flash = { id: it.id, pop: true, just: true };
    render();
    const fin = M.finishHint(Store.list, it);
    if (fin && it.kind === 'checklist') {
      toast('每一步都勾完了', [{ label: '标记为完成', pri: true, fn: () => setStatusWithUndo(it, 'done') }], 8000);
    } else toast('记下了' + (M.posLabel(Store.list, it) ? '：' + M.posLabel(Store.list, it) : ''));
  });

  $('dTitle').addEventListener('input', () => {
    const it = byId(state.detId); if (!it) return;
    const v = $('dTitle').value.trim();
    if (!v) return;                                  // 清空时先不存，免得留一个没名字的
    Store.commit(() => { it.title = v; it.updatedAt = now(); });
  });
  $('dTitle').addEventListener('blur', () => {
    const it = byId(state.detId); if (it && !$('dTitle').value.trim()) $('dTitle').value = it.title;
  });
  $('dClose').addEventListener('click', () => {
    if (detDirty()) askDiscard({ close: () => closeSheet('detMask') });
    else closeSheet('detMask');
  });

  function paintHist(it) {
    const logs = M.logsOf(Store.list, it).slice().reverse();
    $('dHistH').textContent = logs.length ? '记录（' + logs.length + ' 条）' : '';
    $('dHistH').hidden = !logs.length;
    $('dHist').innerHTML = logs.map(l => histHTML(it, l, true)).join('');
    const olds = [];
    for (let r = it.round - 1; r >= 1; r--) {
      const ol = M.logsOf(Store.list, it, r).slice().reverse();
      if (ol.length) olds.push('<details class="old"><summary>第 ' + r + ' 轮的记录（' + ol.length + ' 条）</summary><div class="hist">' +
        ol.map(l => histHTML(it, l, false)).join('') + '</div></details>');
    }
    $('dOld').innerHTML = olds.join('');
  }
  function fmtAbs(ts) {
    const d = new Date(ts), n = new Date();
    const p = x => String(x).padStart(2, '0');
    const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return (d.getFullYear() !== n.getFullYear() ? d.getFullYear() + '年' : '') + md + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function histHTML(it, l, canDel) {
    const lab = logLabel(it, l);
    return '<div class="h-it"><div class="h-b"><div class="h-t">' + fmtAbs(l.at) + '</div>' +
      (lab ? '<div class="h-p">' + esc(lab) + '</div>' : '') +
      (l.note ? '<div class="h-n">' + esc(l.note) + '</div>' : '') +
      (l.next ? '<div class="h-n h-next"><b>下一步</b>' + esc(l.next) + '</div>' : '') + '</div>' +
      (canDel ? '<button type="button" class="x" data-dellog="' + l.id + '" aria-label="删掉这条记录">' + ICO.x + '</button>' : '') + '</div>';
  }
  $('dHist').addEventListener('click', e => {
    const b = e.target.closest('[data-dellog]'); if (!b) return;
    const it = byId(state.detId); if (!it) return;
    const log = Store.list.find(x => x.id === b.dataset.dellog);
    confirmBox('删掉这条记录？', fmtAbs(log.at) + (logLabel(it, log) ? ' · ' + logLabel(it, log) : '') + '\n删掉后位置会回到它前一条。', '删掉', true, () => {
      Store.commit(list => S.markDeleted(list, log.id, now()));
      state.draft = freshDraft(it); state.draftOrig = JSON.stringify(state.draft);
      state.draft.note = $('dNote').value; state.draft.next = $('dNext').value;
      paintResume(it); paintAdjust(it); paintHist(it); render();
    });
  });

  function paintSettings(it) {
    const st = ['active', 'waiting', 'paused', 'done', 'dropped'];
    let h = '<div class="seg" id="dStatus">' + st.map(s => '<button type="button" data-st="' + s + '" aria-pressed="' + (it.status === s) + '">' + M.STATUS[s] + '</button>').join('') + '</div>';
    h += '<div class="row"><span class="k" style="flex:none">链接</span><input type="url" id="dLink" inputmode="url" placeholder="相关的网页（可不填）" value="' + esc(it.link || '') + '"></div>';
    h += '<button type="button" class="row btnrow" id="dGroup"><span class="k">分组</span><span class="v">' + (it.group ? esc(it.group) : '不分组') + '</span><span class="chev-r">›</span></button>';
    if (it.kind === 'free') h += '<button type="button" class="row btnrow" id="dAddScale"><span class="k">加一个进度刻度<small>按页数、题数、百分比记，或拆成步骤清单</small></span><span class="chev-r">+</span></button>';
    if (it.kind === 'counter') {
      h += it.levels.map((l, i) => '<div class="row"><span class="k" style="flex:none">第 ' + (i + 1) + ' 层单位</span>' +
        '<input type="text" data-unit="' + i + '" value="' + esc(l.unit) + '" maxlength="4" aria-label="单位名">' +
        (it.levels.length > 1 ? '<button type="button" class="x" data-rmlv="' + i + '" aria-label="去掉这一层">' + ICO.x + '</button>' : '') + '</div>').join('');
      if (it.levels.length < 3) h += '<button type="button" class="row btnrow" id="dAddLv"><span class="k">在最前面再加一层<small>比如「第几章 · 第几页」里的「章」</small></span><span class="chev-r">+</span></button>';
      // 整行都是开关的热区（开关本体只有 32px 高，单独点它不够 44）
      h += '<button type="button" class="row btnrow" id="dHasTime" role="switch" aria-checked="' + !!it.hasTime + '">' +
        '<span class="k">记到几分几秒<small>看视频、听课、听书时有用</small></span><span class="sw" aria-hidden="true"></span></button>';
    }
    if (it.kind !== 'free') h += '<button type="button" class="row btnrow" id="dRmScale"><span class="k">' + (it.kind === 'counter' ? '去掉进度刻度' : '去掉步骤清单') + '<small>只记文字；写过的字和记录都留着</small></span><span class="chev-r">›</span></button>';
    $('dSet').innerHTML = h;
    $('dRound').textContent = '从头再来一遍（开始第 ' + (it.round + 1) + ' 轮）';
  }

  $('dSet').addEventListener('click', e => {
    const it = byId(state.detId); if (!it) return;
    const sb = e.target.closest('[data-st]');
    if (sb) {
      Store.commit(() => M.setStatus(it, sb.dataset.st, now()));
      paintSettings(it); paintResume(it); render();
      return;
    }
    if (e.target.closest('#dHasTime')) {
      Store.commit(() => { it.hasTime = !it.hasTime; it.updatedAt = now(); });
      paintSettings(it); paintAdjust(it);
      return;
    }
    const rl = e.target.closest('[data-rmlv]');
    if (rl) {
      const i = +rl.dataset.rmlv;
      confirmBox('去掉「' + it.levels[i].unit + '」这一层？', '以后只按剩下的层计数。已有的记录不会删，但显示时会少这一层。', '去掉', true, () => {
        Store.commit(() => {
          it.levels.splice(i, 1); it.updatedAt = now();
          // 已有记录的位置跟着去掉这一格，否则层和数字对不上
          Store.list.forEach(l => { if (l.type === 'log' && l.itemId === it.id && Array.isArray(l.pos) && l.pos.length > it.levels.length) { l.pos.splice(i, 1); l.updatedAt = now(); } });
        });
        state.draft.pos.splice(i, 1); state.draftOrig = JSON.stringify(Object.assign(JSON.parse(state.draftOrig), { pos: state.draft.pos.slice() }));
        paintSettings(it); paintAdjust(it); paintResume(it); paintHist(it); render();
      });
      return;
    }
    if (e.target.closest('#dAddScale')) { openScale(); return; }
    if (e.target.closest('#dGroup')) { openGroupPick(it); return; }
    if (e.target.closest('#dRmScale')) {
      confirmBox(it.kind === 'counter' ? '去掉进度刻度？' : '去掉步骤清单？', '以后只记文字。写过的字和记录都留着，再加回来位置也还在。', '去掉', true, () => {
        Store.commit(list => M.setScale(list, it, { type: 'none' }, now()));
        resetDetailForScale(it);
      });
      return;
    }
    if (e.target.closest('#dAddLv')) {
      Store.commit(() => {
        it.levels.unshift({ unit: '组', total: null }); it.updatedAt = now();
        Store.list.forEach(l => { if (l.type === 'log' && l.itemId === it.id && Array.isArray(l.pos)) { l.pos.unshift(1); l.updatedAt = now(); } });
      });
      state.draft.pos.unshift(1); state.draftOrig = JSON.stringify(Object.assign(JSON.parse(state.draftOrig), { pos: state.draft.pos.slice() }));
      paintSettings(it); paintAdjust(it); paintResume(it); paintHist(it); render();
      const u = $('dSet').querySelector('[data-unit="0"]'); if (u) { u.focus(); u.select(); }   // 默认名「组」只是占位，直接让人改
    }
  });

  /** 刻度变了：位置草稿按新刻度重来，文字草稿保留 */
  function resetDetailForScale(it) {
    const keep = { note: $('dNote').value, next: $('dNext').value };
    state.draft = freshDraft(it); state.draftOrig = JSON.stringify(state.draft);
    Object.assign(state.draft, keep);
    paintAdjust(it); paintResume(it); paintHist(it); paintSettings(it); render();
  }

  /* ---------- 加进度刻度 ---------- */

  const UNIT_CHIPS = ['页', '章', '题', '节', '课', '集', '个', '%'];
  function paintScale() {
    document.querySelectorAll('#scType [data-sc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sc === state.scType)));
    $('scCounter').hidden = state.scType !== 'counter';
    $('scCheckDesc').hidden = state.scType !== 'checklist';
    $('scTime').setAttribute('aria-checked', String(state.scTime));
    $('scChips').innerHTML = UNIT_CHIPS.map(u => '<button type="button" class="chip" data-u="' + u + '" aria-pressed="' + ($('scUnit').value.trim() === u) + '">' + u + '</button>').join('');
  }
  function openScale() {
    state.scType = 'counter'; state.scTime = false;
    $('scUnit').value = ''; $('scTotal').value = '';
    paintScale();
    openSheet('scaleMask');
  }
  $('scType').addEventListener('click', e => { const b = e.target.closest('[data-sc]'); if (b) { state.scType = b.dataset.sc; paintScale(); } });
  $('scChips').addEventListener('click', e => {
    const b = e.target.closest('[data-u]'); if (!b) return;
    $('scUnit').value = b.dataset.u;
    if (b.dataset.u === '%' && !$('scTotal').value) $('scTotal').value = '100';
    paintScale();
  });
  $('scUnit').addEventListener('input', paintScale);
  $('scTime').addEventListener('click', () => { state.scTime = !state.scTime; paintScale(); });
  $('scCancel').addEventListener('click', () => closeSheet('scaleMask'));
  $('scOk').addEventListener('click', () => {
    const it = byId(state.detId); if (!it) { closeSheet('scaleMask'); return; }
    if (state.scType === 'counter') {
      const raw = $('scTotal').value.trim();
      const total = raw === '' ? null : parseInt(raw, 10);
      if (raw !== '' && !(total >= 1)) { $('scTotal').focus(); toast('总数要填一个正整数，不知道就空着'); return; }
      Store.commit(list => M.setScale(list, it, { type: 'counter', levels: [{ unit: $('scUnit').value, total }], hasTime: state.scTime }, now()));
    } else {
      Store.commit(list => M.setScale(list, it, { type: 'checklist' }, now()));
    }
    closeSheet('scaleMask', true);
    resetDetailForScale(it);
    if (it.kind === 'checklist') { const a = $('dAdj').querySelector('.addrow input'); if (a) a.focus(); }   // 同一拍 focus，接着加步骤
  });
  $('dSet').addEventListener('change', e => {
    const it = byId(state.detId); if (!it) return;
    if (e.target.id === 'dLink') {
      Store.commit(() => { it.link = e.target.value.trim(); it.updatedAt = now(); });
      paintResume(it);
    } else if (e.target.dataset.unit != null) {
      const i = +e.target.dataset.unit, v = e.target.value.trim();
      if (!v) { e.target.value = it.levels[i].unit; return; }
      Store.commit(() => { it.levels[i].unit = v; it.updatedAt = now(); });
      paintAdjust(it); paintResume(it); paintHist(it); render();
    }
  });

  $('dRound').addEventListener('click', () => {
    const it = byId(state.detId); if (!it) return;
    confirmBox('开始第 ' + (it.round + 1) + ' 轮？', '进度回到「还没开始」。这一轮的 ' + M.logsOf(Store.list, it).length + ' 条记录会留着，在记录下面能看到。', '开始', false, () => {
      Store.commit(() => M.startRound(it, now()));
      state.draft = freshDraft(it); state.draftOrig = JSON.stringify(state.draft);
      paintResume(it); paintAdjust(it); paintHist(it); paintSettings(it); render();
    });
  });
  $('dDel').addEventListener('click', () => {
    const it = byId(state.detId); if (!it) return;
    askDelete(it, () => closeSheet('detMask', true));
  });

  function askDelete(it, after) {
    const n = M.logsOf(Store.list, it).length;
    confirmBox('删除「' + it.title + '」？', n ? '连同它的 ' + n + ' 条记录一起删掉，删了就找不回来了。' : '删了就找不回来了。', '删除', true, () => {
      Store.commit(list => {
        const t = now();
        S.markDeleted(list, it.id, t);
        list.forEach(l => { if (l.type === 'log' && l.itemId === it.id && !l.deletedAt) { l.deletedAt = t; l.updatedAt = t; } });
      });
      if (after) after();
      render();
      toast('已删除「' + it.title + '」');
    });
  }

  /* ================= 写两句 ================= */

  /** log 为 null = 新记一笔（只记文字的事点首页按钮）；否则 = 给刚才 +1 的那条补一句 */
  function openNote(it, log) {
    state.noteItem = it.id;
    state.noteLog = log ? log.id : null;
    const cur = log && Store.list.find(x => x.id === log.id);
    $('noteH').textContent = log ? '补一句' : '记一笔';
    const lab = cur ? logLabel(it, cur) : '';
    $('noteFor').textContent = it.title + (lab ? ' · ' + lab : '');
    $('ntText').value = (cur && cur.note) || '';
    $('ntNext').value = (cur && cur.next) || '';
    const prev = M.latestNote(Store.list, it);
    $('ntNext').placeholder = prev && prev.next && !cur ? '上次写的：' + prev.next : '下次回来先干什么';
    state.noteOrig = JSON.stringify([$('ntText').value, $('ntNext').value]);
    openSheet('noteMask');
    $('ntText').focus();          // 同步 focus，iOS 才弹键盘
  }
  const noteDirty = () => JSON.stringify([$('ntText').value, $('ntNext').value]) !== state.noteOrig;
  $('ntCancel').addEventListener('click', () => closeSheet('noteMask'));
  $('ntOk').addEventListener('click', () => {
    const txt = { note: $('ntText').value, next: $('ntNext').value };
    const empty = !txt.note.trim() && !txt.next.trim();
    const it = byId(state.noteItem);
    const amend = !!state.noteLog;
    if (amend) {
      const log = Store.list.find(x => x.id === state.noteLog);
      if (log) Store.commit(list => M.setNote(list, log.id, txt, now()));
    } else {
      if (empty) { $('ntText').focus(); toast('写一句再记吧'); return; }
      if (it) Store.commit(list => M.stop(list, it, {}, txt, now()));
    }
    closeSheet('noteMask');
    if (it) state.flash = { id: it.id, just: !amend };
    render();
    toast(amend && empty ? '已清空' : '记下了');
  });

  /* ================= 通用确认 / 放弃修改 ================= */

  function confirmBox(title, text, okLabel, danger, onOk) {
    $('cfH').textContent = title;
    $('cfTxt').textContent = text;
    $('cfTxt').style.whiteSpace = 'pre-line';
    $('cfYes').textContent = okLabel;
    $('cfYes').className = 'btn1' + (danger ? ' danger' : '');
    state.cf = onOk;
    openSheet('cfMask');
  }
  $('cfNo').addEventListener('click', () => closeSheet('cfMask'));
  $('cfYes').addEventListener('click', () => {
    const f = state.cf; state.cf = null;
    closeSheet('cfMask', true);
    if (f) f();
  });

  function askDiscard(S) { state.discard = S; openSheet('dcMask'); }
  $('dcKeep').addEventListener('click', () => { state.discard = null; closeSheet('dcMask'); });
  $('dcDrop').addEventListener('click', () => {
    const d = state.discard; state.discard = null;
    closeSheet('dcMask', true);
    if (d) d.close();
  });

  /* ================= 设置与同步 ================= */

  let qrLoaded = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve();
    if (!qrLoaded) qrLoaded = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'assets/qrcode.js'; s.onload = res; s.onerror = () => rej(new Error('二维码组件没加载上'));
      document.head.appendChild(s);
    });
    return qrLoaded;
  }
  const shareUrl = code => location.origin + location.pathname + '#sync=' + code;
  const maskCode = c => c.length > 8 ? c.slice(0, 4) + '••••' + c.slice(-4) : '••••';

  function paintSync() {
    const box = $('syncBox');
    const sy = Store.sync, code = Store.prefs.code;
    if (sy.configured === false && location.protocol === 'file:') {
      box.innerHTML = '<p>现在是直接双击打开的本地文件，没有服务器，同步用不了。数据只存在这个浏览器里。</p>';
      return;
    }
    if (sy.configured === false) {
      box.innerHTML = '<p>这个地址的服务器还没配好同步（缺存储）。数据先存在这台设备上。</p>';
      return;
    }
    if (!code) {
      box.innerHTML = '<p>在两台设备上填<b>同一个同步码</b>，记录就会自动互通。不用注册账号。</p>' +
        '<div class="code-row"><input id="syCode" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="填同步码，或点右边生成" aria-label="同步码">' +
        '<button type="button" class="btn2" id="syGen">生成</button></div>' +
        '<button type="button" class="btn1 wide" id="syOn">开启同步</button>' +
        '<p class="s-foot" style="margin:10px 0 0">同步码相当于密码：知道它的人能看到并修改你的记录，别发给别人。</p>';
      return;
    }
    const word = { syncing: '同步中…', ok: '已同步', error: '同步失败', offline: '现在离线，联网后自动同步', off: '' }[sy.state] || '';
    box.innerHTML =
      '<p><span class="st">' + word + '</span>' + (sy.state === 'ok' && sy.at ? ' · ' + M.relTime(sy.at, now()) : '') + '</p>' +
      (sy.state === 'error' ? '<p class="sync-err">' + esc(sy.error) + '</p>' : '') +
      '<p>同步码：<span class="code-show" id="syShow">' + esc(maskCode(code)) + '</span></p>' +
      '<div class="qr" id="syQr"><p>另一台设备用相机扫这个码，就能接入同一份记录</p></div>' +
      '<div class="btn-line"><button type="button" class="btn2" id="syReveal">显示同步码</button>' +
      '<button type="button" class="btn2" id="syCopy">复制接入链接</button></div>' +
      '<div class="btn-line" style="margin-top:10px"><button type="button" class="btn2" id="syNow">立刻同步</button>' +
      '<button type="button" class="btn2 danger" id="syOff">停止同步</button></div>';
    loadQr().then(() => {
      const q = $('syQr'); if (!q || !window.qrcode) return;
      const qr = window.qrcode(0, 'M'); qr.addData(shareUrl(code)); qr.make();
      const img = new Image(); img.alt = '接入同步的二维码'; img.src = qr.createDataURL(6, 2);
      q.prepend(img);
    }).catch(() => { const q = $('syQr'); if (q) q.innerHTML = '<p>二维码没加载出来，可以用下面的「复制接入链接」。</p>'; });
  }

  $('setBtn').addEventListener('click', () => {
    $('stVal').textContent = Store.prefs.staleDays + ' 天';
    paintSync();
    openSheet('setMask');
    Store.probe().then(paintSync);
  });
  $('sClose').addEventListener('click', () => closeSheet('setMask'));
  $('syncBox').addEventListener('click', e => {
    const id = e.target.closest('button') && e.target.closest('button').id;
    if (id === 'syGen') { $('syCode').value = Store.randomCode(); }
    else if (id === 'syOn') {
      const err = Store.enableSync($('syCode').value);
      if (err) { toast(err); $('syCode').focus(); return; }
      paintSync(); paintSub();
    } else if (id === 'syReveal') {
      const s = $('syShow');
      const shown = s.textContent === Store.prefs.code;
      s.textContent = shown ? maskCode(Store.prefs.code) : Store.prefs.code;
      e.target.textContent = shown ? '显示同步码' : '隐藏同步码';
    } else if (id === 'syCopy') {
      const url = shareUrl(Store.prefs.code);
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
        () => toast('接入链接已复制，发给自己的另一台设备打开就行'),
        () => { window.prompt('复制这条链接：', url); });
    } else if (id === 'syNow') { Store.syncNow(); }
    else if (id === 'syOff') {
      confirmBox('停止同步？', '这台设备上的记录都还在，只是不再和别的设备互通。以后填同一个同步码可以接回来。', '停止', true, () => {
        Store.disableSync(); paintSync(); paintSub();
      });
    }
  });
  $('stMinus').addEventListener('click', () => setStale(-1));
  $('stPlus').addEventListener('click', () => setStale(1));
  function setStale(d) {
    const v = Math.min(90, Math.max(3, (Store.prefs.staleDays || 14) + d));
    Store.setPref('staleDays', v);
    $('stVal').textContent = v + ' 天';
    render();
  }
  $('expBtn').addEventListener('click', () => {
    const blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date(), p = x => String(x).padStart(2, '0');
    a.href = URL.createObjectURL(blob);
    a.download = '接着来-备份-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('备份文件已导出');
  });
  $('impBtn').addEventListener('click', () => $('impFile').click());
  $('impFile').addEventListener('change', () => {
    const f = $('impFile').files[0]; if (!f) return;
    f.text().then(txt => {
      const r = Store.importJSON(txt);
      $('impFile').value = '';
      if (r.error) { toast(r.error); return; }
      render();
      toast(r.same ? '备份里的内容这边都有了，没有变化' : '导入好了，新增 ' + r.added + ' 条');
    });
  });

  /* 扫码带来的同步码 */
  function askJoin(code) {
    $('joinTxt').textContent = '扫码带来了同步码 ' + maskCode(code) + '。接入后，这台设备上已有的记录会和云端那份合并，谁都不会丢。';
    state.join = code;
    openSheet('joinMask');
  }
  $('joinNo').addEventListener('click', () => { state.join = null; closeSheet('joinMask'); });
  $('joinYes').addEventListener('click', () => {
    const err = Store.enableSync(state.join);
    state.join = null;
    closeSheet('joinMask');
    toast(err || '已接入同步，正在拉取记录…');
  });

  /* ================= 选分组 ================= */

  function openGroupPick(it) {
    const names = M.groupNames(Store.list);
    $('grpList').innerHTML = ['<button type="button" class="chip" data-g="" aria-pressed="' + !it.group + '">不分组</button>']
      .concat(names.map(g => '<button type="button" class="chip" data-g="' + esc(g) + '" aria-pressed="' + (it.group === g) + '">' + esc(g) + '</button>')).join('');
    $('grpNew').value = '';
    openSheet('grpMask');
  }
  function pickGroup(name) {
    const it = byId(state.detId); if (!it) { closeSheet('grpMask'); return; }
    name = String(name || '').trim();
    Store.commit(() => M.setGroup(it, name, now()));
    if (name && !isOpenGroup(name)) toggleGroup(name, true);           // 放进去之后那一组展开，免得找不到
    closeSheet('grpMask');
    paintSettings(it);
    render();
    toast(name ? '已放进「' + name + '」' : '已移出分组');
  }
  $('grpList').addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (b) pickGroup(b.dataset.g); });
  $('grpAdd').addEventListener('click', () => {
    const v = $('grpNew').value.trim();
    if (!v) { $('grpNew').focus(); return; }
    pickGroup(v);
  });
  $('grpNew').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('grpAdd').click(); } });
  $('grpCancel').addEventListener('click', () => closeSheet('grpMask'));

  /* ================= 分组菜单 ================= */

  function openGroupMenu(name) {
    state.gm = name;
    const n = M.items(Store.list).filter(i => (i.group || '') === name).length;
    $('gmH').textContent = '分组「' + name + '」· ' + n + ' 件';
    $('gmName').value = name;
    $('gmMerge').hidden = true;
    $('gmTip').textContent = sortMode() === 'manual' ? '长按分组标题可以整组拖动。'
      : '想调整顺序：先把右上角的排序切到「自定义顺序」，再长按分组标题拖动。';
    openSheet('gmMask');
  }
  $('gmName').addEventListener('input', () => {
    const v = $('gmName').value.trim();
    const clash = v && v !== state.gm && M.groupNames(Store.list).includes(v);
    $('gmMerge').hidden = !clash;
    if (clash) $('gmMerge').textContent = '「' + v + '」已经有了，改名后两个分组会合并成一个。';
  });
  $('gmName').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('gmRename').click(); } });
  $('gmRename').addEventListener('click', () => {
    const from = state.gm, to = $('gmName').value.trim();
    if (!to) { $('gmName').focus(); return; }
    if (to === from) { closeSheet('gmMask'); return; }
    const wasOpen = isOpenGroup(from);
    Store.commit(list => M.renameGroup(list, from, to, now()));
    if (wasOpen) toggleGroup(to, true);                                  // 展开状态跟着名字走
    closeSheet('gmMask');
    render();
    toast('已改名为「' + to + '」');
  });
  $('gmDissolve').addEventListener('click', () => {
    const name = state.gm;
    const n = Store.commit(list => M.dissolveGroup(list, name, now()));
    closeSheet('gmMask');
    render();
    toast('已解散「' + name + '」，' + n + ' 件变成不分组');
  });
  $('gmDelete').addEventListener('click', () => {
    const name = state.gm;
    const n = M.items(Store.list).filter(i => (i.group || '') === name).length;
    confirmBox('删除分组「' + name + '」和里面的 ' + n + ' 件事？', '连同它们的记录一起删掉，删了就找不回来了。\n只想取消分组、保留里面的事，用「解散分组」。', '删除', true, () => {
      Store.commit(list => M.deleteGroup(list, name, now()));
      closeSheet('gmMask', true);
      render();
      toast('已删除分组「' + name + '」');
    });
  });

  /* ================= 排序方式 ================= */

  function paintSort() {
    $('sortList').querySelectorAll('[data-sort]').forEach(b => {
      const on = b.dataset.sort === sortMode();
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('role', 'menuitemradio');
      b.querySelector('.ck-r').textContent = on ? '✓' : '';
    });
  }
  $('sortBtn').addEventListener('click', () => { paintSort(); openSheet('sortMask'); });
  $('sortList').addEventListener('click', e => {
    const b = e.target.closest('[data-sort]'); if (!b) return;
    Store.setPref('sort', b.dataset.sort);
    paintSort();
    closeSheet('sortMask');
    state.firstPaint = true;
    render();
    toast('现在按「' + SORT_WORD[b.dataset.sort] + '」排');
  });

  /* ================= 手势 ================= */

  var swipe = SwipeActions({
    root: $('list'), item: '.card', blocked: anyOpen,
    canSwipe: el => !el.closest('.stack:not(.is-open)'),   // 收起的一摞不能滑：一摞只露一张，滑的是哪条说不清
    onLock: () => { if (drag) drag.cancelHold(); },
    actions: el => {
      const it = byId(el.dataset.id); if (!it) return [];
      const a = [];
      if (it.status === 'active' || it.status === 'waiting') a.push({ label: '暂停', icon: ICO.pause, cls: 'lsw-pause', onClick: () => { swipe.close(false); setStatusWithUndo(it, 'paused'); } });
      if (it.status === 'paused' || it.status === 'done' || it.status === 'dropped') a.push({ label: it.status === 'paused' ? '继续' : '恢复', icon: ICO.play, cls: 'lsw-pause', onClick: () => { swipe.close(false); setStatusWithUndo(it, 'active'); } });
      if (it.status !== 'done') a.push({ label: '完成', icon: ICO.done, cls: 'lsw-done', onClick: () => { swipe.close(false); setStatusWithUndo(it, 'done'); } });
      a.push({ label: '删除', icon: ICO.del, cls: 'lsw-del', onClick: () => askDelete(it, () => swipe.close(false)) });
      return a;
    }
  });

  SheetDismiss({
    sheets: () => [
      { mask: $('newMask'), sheet: $('newSheet'), close: () => closeSheet('newMask', true), dirty: () => !!$('nTitle').value.trim() },
      { mask: $('detMask'), sheet: $('detSheet'), close: () => closeSheet('detMask', true), dirty: detDirty },
      { mask: $('grpMask'), sheet: $('grpSheet'), close: () => closeSheet('grpMask', true) },
      { mask: $('scaleMask'), sheet: $('scaleSheet'), close: () => closeSheet('scaleMask', true) },
      { mask: $('noteMask'), sheet: $('noteSheet'), close: () => closeSheet('noteMask', true), dirty: noteDirty },
      { mask: $('setMask'), sheet: $('setSheet'), close: () => closeSheet('setMask', true) },
      { mask: $('sortMask'), sheet: $('sortSheet'), close: () => closeSheet('sortMask', true) },
      { mask: $('gmMask'), sheet: $('gmSheet'), close: () => closeSheet('gmMask', true) },
      { mask: $('joinMask'), sheet: $('joinSheet'), close: () => closeSheet('joinMask', true) },
      { mask: $('cfMask'), sheet: $('cfSheet'), close: () => closeSheet('cfMask', true) },
      { mask: $('dcMask'), sheet: $('dcSheet'), close: () => { state.discard = null; closeSheet('dcMask', true); } }
    ],
    confirmDiscard: S => askDiscard(S)
  });

  /* 长按拖动排序：只在自定义顺序下；同一个容器里的同级项换位
     （顶层 = 散卡 + 分组区块，长按组标题整组移动；展开的组里 = 组内的卡） */
  function dragScope(target) {
    if (Store.prefs.tab === 'archive') return null;
    if (target.closest('.c-plus, .g-more, .g-chev, .lsw-acts')) return null;
    const item = target.closest('.stack-item, #list > .card, #list > .group');
    if (!item) return null;
    if (item.classList.contains('group') && !target.closest('.group-head')) return null;
    const box = item.parentElement;
    if (box.classList.contains('stack') && !box.classList.contains('is-open')) return null;
    const items = [...box.children].filter(n => !n.classList.contains('lsw-acts') && !n.classList.contains('grp-h'));
    return items.length < 2 ? null : { item, box, items };
  }
  var drag = LongPressDrag({
    enabled: () => sortMode() === 'manual',
    blocked: () => anyOpen() || swipe.isOpen(),
    scope: dragScope,
    refused: () => toast('拖动排序要在「自定义顺序」下', [{ label: '切过去', pri: true, fn: () => {
      Store.setPref('sort', 'manual'); render(); toast('已切到自定义顺序，长按卡片就能拖了'); } }], 6000),
    onBegin: () => { swipe.forget(); if (ptr) ptr.gesture.cancel(); unpress(); },
    gap: box => box.classList.contains('stack') ? Stack.GAP : 12,
    commit: items => {
      const ids = items.flatMap(n => n.classList.contains('group')
        ? [...n.querySelectorAll('.stack .card')].map(c => c.dataset.id)
        : [(n.classList.contains('card') ? n : n.querySelector('.card')).dataset.id]);
      Store.commit(list => M.reorder(list, ids, now()));
    },
    cancelled: () => { if (state.pendingRender) render(); else Stack.layout($('list'), isOpenGroup, false); }
  });

  // 字体加载完 / 改窗口大小，卡片高度会变，堆叠要重新量
  let reflow = 0;
  window.addEventListener('resize', () => { clearTimeout(reflow); reflow = setTimeout(() => Stack.layout($('list'), isOpenGroup, false), 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => Stack.layout($('list'), isOpenGroup, false));

  var ptr = PullToRefresh.setupPullToRefresh({
    isBlocked: () => anyOpen() || swipe.active() || swipe.isOpen() || drag.active() || drag.holding(),
    scrollTop: () => window.scrollY,
    /* 刷新 = 先把本机改动同步出去，再按组件默认的「预热 css/js 再 reload」拿新版本 */
    doRefresh: () => {
      const go = () => PullToRefresh.revalidateThenReload();
      if (Store.prefs.code) Store.syncNow().then(go, go); else go();
    }
  });

  /* ================= 启动 ================= */

  Store.init();
  Store.onChange(() => {
    render();
    const it = state.detId && byId(state.detId);
    if (state.detId && !it) { closeSheet('detMask', true); return; }   // 别的设备删掉了
    if (it) { paintResume(it); paintHist(it); }                          // 输入框不重画，免得打断正在输入
  });
  Store.onSync(() => { paintSub(); if (!$('setMask').hidden) paintSync(); });
  render();
  // 「3 分钟前」这类相对时间要走起来；有东西滑开着 / 正按着时跳过，别把手势打断
  setInterval(() => { if (!swipe.isOpen() && !drag.holding() && !anyOpen()) render(); }, 60000);
  if (Store.prefs.pendingCode) {
    const c = Store.prefs.pendingCode;
    delete Store.prefs.pendingCode;
    if (c !== Store.prefs.code) askJoin(c);
  }
  /* 页面已经开着、又在同一个标签页里打开了接入链接：只有 # 后面变了，浏览器不会重新加载，
     init() 里那一次读取就接不到——所以还要听 hashchange */
  window.addEventListener('hashchange', () => {
    const c = Store.takeCodeFromUrl();
    if (c && c !== Store.prefs.code) askJoin(c);
  });
  if (location.protocol !== 'file:') Store.probe();

  window.__app = { render, openDetail, openNew, toast, toggleGroup };   // 给自动化验证用
})();
