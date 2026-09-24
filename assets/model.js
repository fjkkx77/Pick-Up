/* 接着来 · 数据逻辑（纯函数层：不碰 DOM、不认识 fetch、不读系统时间——now 一律由调用方传入）
   浏览器和 Node 都能加载；自检见 tests/model.cases.js。

   数据全在一个列表里，靠 type 区分：
     item —— 一件事（剧/书/任务），存「是什么」，不存「做到哪」
     log  —— 一条断点记录，只追加不修改；当前位置 = 当前这一刷里最新的那条
   为什么位置不存在 item 上：两台设备离线各 +1 时，逐条 last-write-wins 会丢掉一边；
   改成追加记录后，合并就是取并集，谁也不覆盖谁。 */
(function (root) {
  'use strict';

  const DAY = 864e5;

  const TEMPLATES = {
    drama:  { label: '追剧', kind: 'counter', levels: [['季', null], ['集', null]], hasTime: true },
    book:   { label: '读书', kind: 'counter', levels: [['章', null], ['页', null]], hasTime: false },
    course: { label: '网课', kind: 'counter', levels: [['节', null]], hasTime: true },
    quiz:   { label: '刷题', kind: 'counter', levels: [['题', null]], hasTime: false },
    task:   { label: '任务', kind: 'checklist' },
    other:  { label: '其它', kind: 'free' }
  };

  const STATUS = {
    active: '进行中', waiting: '等更新', paused: '暂停', done: '已完成', dropped: '弃坑'
  };

  let seq = 0;
  function uid(now) {
    seq = (seq + 1) % 1296;
    return (now || Date.now()).toString(36) + seq.toString(36).padStart(2, '0') +
      Math.random().toString(36).slice(2, 7);
  }

  /* ---------- 时间点 ---------- */

  /** 「2314」→ 23:14、「10530」→ 1:05:30、「23:14」「1:05:30」都认；分/秒 ≥60 视为输错 */
  function parseTime(s) {
    s = String(s == null ? '' : s).trim().replace(/：/g, ':');
    if (!s) return null;
    let parts;
    if (/^\d+(:\d{1,2}){1,2}$/.test(s)) parts = s.split(':').map(Number);
    else if (/^\d{1,6}$/.test(s)) {
      const d = s.padStart(s.length <= 2 ? 2 : (s.length <= 4 ? 4 : 6), '0');
      parts = d.length === 2 ? [0, +d] : d.length === 4 ? [+d.slice(0, 2), +d.slice(2)]
        : [+d.slice(0, 2), +d.slice(2, 4), +d.slice(4)];
    } else return null;
    if (parts.length === 2) parts.unshift(0);
    const [h, m, sec] = parts;
    if (m >= 60 || sec >= 60) return null;
    return h * 3600 + m * 60 + sec;
  }

  function fmtTime(t) {
    if (t == null || isNaN(t)) return '';
    const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    const p = n => String(n).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
  }

  /* ---------- 查询 ---------- */

  const isItem = e => e && e.type === 'item' && !e.deletedAt;
  const items = list => (list || []).filter(isItem);

  /** 记录的先后：先比 at，再比 id —— 两台设备都认的同一份事实，算出来的「最新」才一致 */
  const cmpLog = (a, b) => (a.at - b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  function logsOf(list, item, round) {
    const r = round == null ? item.round : round;
    return (list || []).filter(e => e && e.type === 'log' && !e.deletedAt &&
      e.itemId === item.id && e.round === r).sort(cmpLog);
  }

  function currentLog(list, item) {
    const l = logsOf(list, item);
    return l.length ? l[l.length - 1] : null;
  }

  /** 当前位置；这一刷还没有任何记录时是 null（界面上显示「还没开始」） */
  function position(list, item) {
    const c = currentLog(list, item);
    if (!c) return null;
    if (item.kind === 'counter') {
      const pos = (c.pos || []).slice(0, item.levels.length);
      while (pos.length < item.levels.length) pos.push(1);   // 事后加了一层：新层从 1 起
      return { pos, time: c.time == null ? null : c.time };
    }
    if (item.kind === 'checklist') return { checked: (c.checked || []).slice() };
    return {};
  }

  function latestNote(list, item) {
    const l = logsOf(list, item);
    for (let i = l.length - 1; i >= 0; i--) if (l[i].note) return l[i];
    return null;
  }

  function lastTouched(list, item) {
    const c = currentLog(list, item);
    return Math.max(item.createdAt || 0, c ? c.at : 0);
  }

  /* ---------- 新建 ---------- */

  function newItem(title, tplKey, now, list) {
    const tpl = TEMPLATES[tplKey] || TEMPLATES.other;
    const order = (list || []).reduce((m, e) =>
      (e && typeof e.order === 'number' && e.order > m ? e.order : m), 0) + 1;
    const it = {
      id: uid(now), type: 'item', title: String(title || '').trim(), tpl: tplKey,
      kind: tpl.kind, status: 'active', round: 1,
      link: '', tags: [],
      createdAt: now, updatedAt: now, order
    };
    if (tpl.kind === 'counter') {
      it.levels = tpl.levels.map(([unit, total]) => ({ unit, total }));
      it.hasTime = !!tpl.hasTime;
    }
    if (tpl.kind === 'checklist') it.steps = [];
    return it;
  }

  function touch(item, now) { item.updatedAt = now; }

  function makeLog(list, item, data, note, now, prevStatus) {
    const log = {
      id: uid(now), type: 'log', itemId: item.id, round: item.round, at: now,
      note: note || '', prevStatus: prevStatus || null, updatedAt: now
    };
    if (item.kind === 'counter') { log.pos = data.pos.slice(); log.time = data.time == null ? null : data.time; }
    if (item.kind === 'checklist') log.checked = (data.checked || []).slice();
    list.push(log);
    return log;
  }

  /* ---------- 计数的前进规则 ---------- */

  /** 从 pos 往前走一步的结果：{pos} 走得动；{hint:'nextOuter'} 外层总数未知、不猜；{hint:'finish'} 全到头 */
  function stepFrom(levels, pos) {
    const L = levels.length, p = pos.slice();
    const can = i => levels[i].total == null || p[i] < levels[i].total;
    if (can(L - 1)) { p[L - 1]++; return { pos: p }; }
    for (let j = L - 2; j >= 0; j--) {
      if (levels[j].total == null) return { hint: 'nextOuter' };
      if (p[j] < levels[j].total) {
        p[j]++;
        for (let k = j + 1; k < L; k++) p[k] = 1;
        return { pos: p };
      }
    }
    return { hint: 'finish' };
  }

  /** 首页的 +1。返回 {log, hint, prevStatus, statusChanged}；撤销时整个传回 undo() */
  function bump(list, item, now) {
    const prev = item.status;
    if (item.kind === 'checklist') return { log: null, hint: 'open', prevStatus: prev };
    if (item.kind === 'free') return { log: null, hint: 'note', prevStatus: prev };
    const cur = position(list, item);
    const step = cur ? stepFrom(item.levels, cur.pos) : { pos: item.levels.map(() => 1) };
    if (step.hint) {
      /* 走不动了：不新增记录（位置没变），只把状态改成「等更新」，提示条给出下一步按钮 */
      const changed = item.status !== 'waiting';
      if (changed) { item.status = 'waiting'; touch(item, now); }
      return { log: null, hint: step.hint, prevStatus: prev, statusChanged: changed };
    }
    let ps = null;
    if (item.status !== 'active' && item.status !== 'done') { ps = prev; item.status = 'active'; touch(item, now); }
    const log = makeLog(list, item, { pos: step.pos, time: null }, '', now, ps);
    return { log, hint: null, prevStatus: prev, statusChanged: !!ps };
  }

  /** 某一层直接 +1（「进入下一季」），比它细的层归 1 */
  function bumpLevel(list, item, idx, now) {
    const prev = item.status;
    const cur = position(list, item);
    const p = cur ? cur.pos.slice() : item.levels.map(() => 1);
    p[idx] = (cur ? p[idx] + 1 : 1);
    for (let k = idx + 1; k < p.length; k++) p[k] = 1;
    let ps = null;
    if (item.status === 'waiting' || item.status === 'paused') { ps = prev; item.status = 'active'; touch(item, now); }
    const log = makeLog(list, item, { pos: p, time: null }, '', now, ps);
    return { log, hint: null, prevStatus: prev, statusChanged: !!ps };
  }

  /** 详情页「停在这里」：把调好的位置 + 笔记记成一条 */
  function stop(list, item, data, note, now) {
    let ps = null;
    if (item.status === 'paused') { ps = 'paused'; item.status = 'active'; touch(item, now); }
    const log = makeLog(list, item, data || {}, note, now, ps);
    if (item.status === 'waiting' && item.kind === 'counter' && canAdvance(list, item)) {
      log.prevStatus = 'waiting'; item.status = 'active'; touch(item, now);
    }
    return log;
  }

  function canAdvance(list, item) {
    if (item.kind !== 'counter') return true;
    const cur = position(list, item);
    return !cur || !stepFrom(item.levels, cur.pos).hint;
  }

  /** 该不该在界面上给出「标记为看完了」 */
  function finishHint(list, item) {
    if (item.status === 'done') return null;
    if (item.kind === 'checklist') {
      const p = checkProgress(list, item);
      return p.total && p.done === p.total ? 'finish' : null;
    }
    if (item.kind === 'counter') {
      const cur = position(list, item);
      return cur && stepFrom(item.levels, cur.pos).hint === 'finish' && item.status === 'waiting' ? 'finish' : null;
    }
    return null;
  }

  function undo(list, item, r, now) {
    if (r.log) {
      const log = list.find(e => e.id === r.log.id);
      if (log && !log.deletedAt) { log.deletedAt = now; log.updatedAt = now; }
      if (r.log.prevStatus) { item.status = r.log.prevStatus; touch(item, now); }
    } else if (r.statusChanged) {
      item.status = r.prevStatus; touch(item, now);
    }
  }

  function setNote(list, logId, note, now) {
    const log = list.find(e => e.id === logId);
    if (log) { log.note = String(note || ''); log.updatedAt = now; }
    return log;
  }

  function setTotal(list, item, idx, total, now) {
    item.levels[idx].total = total == null || total === '' ? null : Math.max(1, Math.floor(+total));
    touch(item, now);
    if (item.status === 'waiting' && canAdvance(list, item)) item.status = 'active';
  }

  function setStatus(item, s, now) { item.status = s; touch(item, now); }

  function startRound(item, now) { item.round = (item.round || 1) + 1; item.status = 'active'; touch(item, now); }

  /* ---------- 清单 ---------- */

  function addStep(item, text, now) {
    const s = { id: uid(now), text: String(text || '').trim() };
    item.steps.push(s); touch(item, now);
    return s;
  }
  function removeStep(item, id, now) { item.steps = item.steps.filter(s => s.id !== id); touch(item, now); }

  function checkProgress(list, item) {
    const ids = new Set((item.steps || []).map(s => s.id));
    const c = currentLog(list, item);
    const done = c ? (c.checked || []).filter(id => ids.has(id)).length : 0;
    return { done, total: ids.size };
  }

  /* ---------- 展示 ---------- */

  function posParts(list, item) {
    const cur = position(list, item);
    if (!cur) return null;
    return item.levels.map((l, i) => ({ n: cur.pos[i], total: l.total, unit: l.unit }));
  }

  function posLabel(list, item) {
    if (item.kind === 'checklist') {
      const p = checkProgress(list, item);
      return p.total ? p.done + '/' + p.total + ' 步' : '还没有步骤';
    }
    const cur = position(list, item);
    if (!cur) return '还没开始';
    if (item.kind === 'free') return '';
    const s = item.levels.map((l, i) =>
      '第 ' + cur.pos[i] + (l.total ? '/' + l.total : '') + ' ' + l.unit).join(' · ');
    return cur.time != null ? s + ' · ' + fmtTime(cur.time) : s;
  }

  function relTime(t, now) {
    const d = Math.max(0, now - t);
    if (d < 60e3) return '刚刚';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
    if (d < DAY) return Math.floor(d / 3600e3) + ' 小时前';
    if (d < 2 * DAY) return '昨天';
    if (d < 30 * DAY) return Math.floor(d / DAY) + ' 天前';
    if (d < 365 * DAY) return Math.floor(d / (30 * DAY)) + ' 个月前';
    return Math.floor(d / (365 * DAY)) + ' 年前';
  }

  /* ---------- 冷落 / 速度 ---------- */

  function isStale(list, item, now, days) {
    return item.status === 'active' && now - lastTouched(list, item) > days * DAY;
  }

  /** 把多层位置摊平成「第几个最细单位」。某层以内有总数未知的，就摊不平，返回 null */
  function linear(levels, pos) {
    let lin = pos[levels.length - 1], size = 1;
    for (let j = levels.length - 2; j >= 0; j--) {
      const t = levels[j + 1].total;
      if (t == null) return pos.slice(0, j + 1).every(v => v === 1) ? lin : null;
      size *= t;
      lin += (pos[j] - 1) * size;
    }
    return lin;
  }

  /** 两条记录之间推进了几个最细单位；折算不了返回 null（不当 0，也不当正数）。
      外层都相同时直接减最细层——否则每季集数未知时，第 2 季以后的推进会全部漏掉 */
  function advance(levels, a, b) {
    const L = levels.length;
    if (a.slice(0, L - 1).every((v, i) => v === b[i])) return b[L - 1] - a[L - 1];
    const x = linear(levels, a), y = linear(levels, b);
    return x == null || y == null ? null : y - x;
  }

  /** 完成比例（给进度条用）。总数有一层不知道就不给——瞎画一个比例比不画更误导 */
  function fraction(list, item) {
    if (item.kind === 'checklist') {
      const p = checkProgress(list, item);
      return p.total ? p.done / p.total : null;
    }
    if (item.kind !== 'counter' || !item.levels.every(l => l.total != null)) return null;
    const cur = position(list, item);
    if (!cur) return 0;
    const end = linear(item.levels, item.levels.map(l => l.total));
    return Math.min(1, linear(item.levels, cur.pos) / end);
  }

  /* 速度只看最近 30 天：太久以前的节奏已经不代表现在。30 是初始值，没有依据，用一段时间再调 */
  const PACE_WINDOW_DAYS = 30;

  function pace(list, item, now) {
    if (item.kind !== 'counter') return null;
    const logs = logsOf(list, item).filter(l => l.at >= now - PACE_WINDOW_DAYS * DAY);
    if (logs.length < 3) return null;
    const span = (logs[logs.length - 1].at - logs[0].at) / DAY;
    if (span < 2) return null;
    let adv = 0;
    for (let i = 1; i < logs.length; i++) {
      const d = advance(item.levels, logs[i - 1].pos, logs[i].pos);
      if (d > 0) adv += d;
    }
    if (!adv) return null;
    const perDay = adv / span;
    const unit = item.levels[item.levels.length - 1].unit;
    let daysLeft = null;
    if (item.levels.every(l => l.total != null)) {
      const cur = linear(item.levels, logs[logs.length - 1].pos);
      const end = linear(item.levels, item.levels.map(l => l.total));
      daysLeft = Math.max(0, Math.ceil((end - cur) / perDay - 1e-9));
    }
    return { perDay, unit, daysLeft };
  }

  root.Model = {
    TEMPLATES, STATUS, DAY, PACE_WINDOW_DAYS, uid,
    parseTime, fmtTime,
    items, logsOf, currentLog, position, latestNote, lastTouched,
    newItem, bump, bumpLevel, stop, undo, setNote, setTotal, setStatus, startRound,
    canAdvance, finishHint,
    addStep, removeStep, checkProgress,
    posParts, posLabel, relTime, isStale, pace, fraction
  };
})(typeof window !== 'undefined' ? window : globalThis);
