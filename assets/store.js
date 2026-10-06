/* 接着来 · 存储与同步调度
   数据：localStorage 'pickup.v1'（items + logs 同一个列表，会同步）
   偏好：localStorage 'pickup.prefs'（同步码、冷落天数、当前标签……每台设备自己的，不同步）
   同步照日程卡片（rc.wbztl.xyz）的做法，配方见 feedback_device_sync_recipe.md §4：
   防抖 600ms、不并发写、切走时把没发出去的改动冲掉、切回 / 获得焦点 / 联网 / 可见时每 30 秒拉一次 */
(function (root) {
  'use strict';

  const KEY = 'pickup.v1', PKEY = 'pickup.prefs';
  const API = 'api/sync';
  const CODE_RE = /^[A-Za-z0-9\-_]{8,64}$/;

  const S = root.SyncCore;
  let list = [];
  /* syncOn 和 code 分开存（照日程卡片）：关掉同步时同步码还留在框里，想接回去点一下就行 */
  let prefs = { code: '', syncOn: false, syncAt: 0, staleDays: 14, tab: 'active', sort: 'manual', expanded: [], hintDrag: 0 };
  const subs = [], syncSubs = [];

  function readJSON(k, fb) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  function load() {
    const d = readJSON(KEY, null);
    list = Array.isArray(d) ? d.filter(e => e && e.id && (e.type === 'item' || e.type === 'log')) : [];
    list = S.pruneTombstones(list);
    const saved = readJSON(PKEY, {});
    Object.assign(prefs, saved);
    delete prefs.tag;                                   // 「标签筛选」已被分组取代
    delete prefs.pendingCode;                           // 旧版扫码接入留下的，已不用
    /* 旧版没有 syncOn：那时「有同步码」就等于开着同步 */
    if (typeof saved.syncOn !== 'boolean') prefs.syncOn = !!prefs.code;
    if (!Array.isArray(prefs.expanded)) prefs.expanded = [];
    return migrate();
  }

  /* 旧数据的「标签」→「分组」（2026-09-26）。本机、别的设备同步来的、导入的备份都要过一遍：
     旧版本的设备可能还在写 tags。改了就返回 true，调用方负责存盘/同步 */
  function migrate() {
    return !!(root.Model && root.Model.migrateTags(list, Date.now()));
  }

  function persist() {
    if (!writeJSON(KEY, list)) sync.error = '本机存储写不进去（可能是无痕模式或空间满了）';
  }

  function emit() { subs.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }

  /** 所有修改都走这里：改 → 存 → 重绘 → 排队同步 */
  function commit(fn) {
    const r = fn(list);
    persist(); emit(); schedule();
    return r;
  }

  function setPref(k, v) { prefs[k] = v; writeJSON(PKEY, prefs); }

  /* ---------------- 同步 ---------------- */

  /* state：off | syncing | ok | error | offline | unsupported */
  const sync = { state: 'off', error: '', at: 0, version: 0, configured: null };
  let busy = false, again = false, timer = 0;
  /* 有没有还没传上去的本机改动——页面被切走时只在有的时候才冲，免得每次锁屏都白发一趟 */
  let pending = false;

  const active = () => !!(prefs.syncOn && prefs.code);

  function syncEmit() { syncSubs.forEach(f => { try { f(sync); } catch (e) { console.error(e); } }); }
  function setState(s, err) { sync.state = s; sync.error = err || ''; syncEmit(); }

  class Unsupported extends Error {}

  async function pull() {
    const r = await fetch(API + '?code=' + encodeURIComponent(prefs.code) + '&_=' + Date.now(), { cache: 'no-store' });
    if (r.status === 404) throw new Unsupported('当前地址不支持同步');   // 比如直接打开的静态页，没有 /api
    let j = null;
    try { j = await r.json(); } catch (e) { /* 下面按状态码报 */ }
    if (r.status !== 200 || !j || !j.ok) throw new Error((j && j.error) || ('读取失败 ' + r.status));
    return { version: j.version, items: (j.doc && j.doc.items) || [] };
  }

  async function push(items, base) {
    const body = JSON.stringify({ code: prefs.code, baseVersion: base, doc: { items } });
    /* keepalive 让请求在页面被关掉之后也能发完（浏览器限制 64KB，超了就走普通请求）——照日程卡片 */
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
    if (body.length < 60000) opts.keepalive = true;
    const r = await fetch(API, opts);
    let j = null;
    try { j = await r.json(); } catch (e) { /* 下面按状态码报 */ }
    if (r.status === 409 && j) return { conflict: true, version: j.version, items: (j.doc && j.doc.items) || [] };
    if (r.status !== 200 || !j || !j.ok) throw new Error((j && j.error) || ('上传失败 ' + r.status));
    return { version: j.version };
  }

  async function runOnce() {
    const res = await S.syncOnce({
      dropDemo: false,
      getLocal: () => list,
      setLocal: l => { list = l; migrate(); persist(); emit(); },
      pull, push
    });
    sync.version = res.version;
  }

  /* 正在同步时再叫一次：排队再跑一轮，并且**返回正在跑的那一趟**——
     原来这里直接 return，调用方（下拉刷新「先同步再刷新」、测试）以为同步完了，其实还在半路。
     2026-09-26 对线上跑双设备用例时抓到（本地太快碰不上） */
  let running = null;
  function syncNow() {
    if (!active()) return Promise.resolve();
    if (busy) { again = true; return running; }
    if (navigator.onLine === false) { setState('offline'); return Promise.resolve(); }
    busy = true; clearTimeout(timer); setState('syncing');
    running = (async () => {
      try {
        do {
          again = false;
          pending = false;            // 这一轮会把此刻本机的全部改动带上去；这期间再改的会把它重新置上
          await runOnce();
        } while (again);
        if (!active()) { setState('off'); return; }   // 同步半路被关掉了，别再显示「已同步」
        sync.at = Date.now(); setPref('syncAt', sync.at);
        setState('ok');
      } catch (e) {
        pending = true;               // 没传上去，下次切走时还要冲
        if (e instanceof Unsupported) setState('unsupported', e.message);
        else setState('error', String(e && e.message || e));
      } finally { busy = false; }
    })();
    return running;
  }

  function schedule() {
    if (!active()) return;
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 600);
  }

  /* 页面被切走 / 关掉时，把还没发出去的改动立刻冲出去——
     否则「手机上改完马上锁屏」这一下，改动就要等到下次打开才传得上去 */
  function flush() {
    if (!active() || !pending) return;
    clearTimeout(timer);
    syncNow();
  }

  /** 开启（或换）同步码：本机数据会和云端那份合并，不会覆盖。返回错误文字，成功返回 null */
  function enableSync(code) {
    code = String(code || '').trim();
    if (!CODE_RE.test(code)) return '同步码要 8~64 位，只能用字母、数字、- 和 _';
    if (code !== prefs.code) { sync.at = 0; setPref('syncAt', 0); }
    setPref('code', code); setPref('syncOn', true);
    sync.version = 0;
    syncNow();
    return null;
  }
  /** 关闭同步：本机数据和同步码都留着，只是不再互通 */
  function disableSync() {
    setPref('syncOn', false);
    clearTimeout(timer); pending = false;
    setState('off');
  }

  /* 照日程卡片：16 位小写字母 + 数字，每 4 位一个 -，去掉容易看混的 l/o/0/1 */
  function randomCode() {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    const buf = new Uint8Array(16); crypto.getRandomValues(buf);
    let out = '';
    for (let i = 0; i < 16; i++) { out += abc[buf[i] % abc.length]; if (i === 3 || i === 7 || i === 11) out += '-'; }
    return out;
  }

  async function probe() {
    try {
      const r = await fetch(API + '?_=' + Date.now(), { cache: 'no-store' });
      const j = await r.json();
      sync.configured = !!(j && j.ok && j.configured);
    } catch (e) { sync.configured = false; }
    syncEmit();
    return sync.configured;
  }

  /* ---------------- 导出 / 导入 ---------------- */

  function exportJSON() {
    return JSON.stringify({ app: 'pickup', v: 1, exportedAt: Date.now(), items: list }, null, 1);
  }
  /** 导入走合并：同一条取更新的那份，不会把现有的冲掉。返回新增/更新了几条 */
  function importJSON(text) {
    let d;
    try { d = JSON.parse(text); } catch (e) { return { error: '文件不是合法的 JSON' }; }
    const arr = Array.isArray(d) ? d : (d && d.items);
    if (!Array.isArray(arr)) return { error: '文件里没找到数据' };
    const clean = arr.filter(e => e && e.id && (e.type === 'item' || e.type === 'log'));
    if (root.Model) root.Model.migrateTags(clean, Date.now());
    const before = S.fingerprint(list);
    const merged = S.mergeEvents(list, clean);
    const changed = merged.length - list.length;
    commit(() => { list = merged; });
    return { added: changed, same: S.fingerprint(merged) === before };
  }

  function init() {
    if (load()) persist();                              // 迁移过就落盘；开着同步的话下面 syncNow 会传上去
    sync.at = prefs.syncAt || 0;
    /* 照日程卡片：打开、切回、获得焦点、联网、每 30 秒（只在页面可见时）各拉一次；要走时把没发出去的冲掉 */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(); else syncNow();
    });
    window.addEventListener('pagehide', flush);
    window.addEventListener('focus', () => syncNow());
    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => { if (active()) setState('offline'); });
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 30000);
    /* 另一个标签页改了数据：直接读进来（同一台设备上两个标签页别互相覆盖） */
    window.addEventListener('storage', e => { if (e.key === KEY) { if (load()) persist(); emit(); } });
    if (active()) { setState('syncing'); syncNow(); }
  }

  root.Store = {
    init, commit, setPref, syncNow, enableSync, disableSync, randomCode, probe, active,
    exportJSON, importJSON, CODE_RE,
    get list() { return list; }, get prefs() { return prefs; }, get sync() { return sync; },
    onChange: f => subs.push(f), onSync: f => syncSubs.push(f)
  };
})(window);
