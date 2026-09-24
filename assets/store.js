/* 接着来 · 存储与同步调度
   数据：localStorage 'pickup.v1'（items + logs 同一个列表，会同步）
   偏好：localStorage 'pickup.prefs'（同步码、冷落天数、当前标签……每台设备自己的，不同步）
   同步时机照配方 feedback_device_sync_recipe.md §4：防抖 600ms、不并发写、切走时立刻冲、可见时每 30 秒 */
(function (root) {
  'use strict';

  const KEY = 'pickup.v1', PKEY = 'pickup.prefs';
  const API = 'api/sync';
  const CODE_RE = /^[A-Za-z0-9\-_]{8,64}$/;

  const S = root.SyncCore;
  let list = [];
  let prefs = { code: '', staleDays: 14, tab: 'active', tag: '' };
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
    Object.assign(prefs, readJSON(PKEY, {}));
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

  const sync = { state: 'off', error: '', at: 0, version: 0, configured: null };
  let busy = false, again = false, timer = 0;

  function syncEmit() { syncSubs.forEach(f => { try { f(sync); } catch (e) { console.error(e); } }); }
  function setState(s, err) { sync.state = s; sync.error = err || ''; syncEmit(); }

  async function api(method, body) {
    const url = method === 'GET' ? API + '?code=' + encodeURIComponent(prefs.code) + '&_=' + Date.now() : API;
    const r = await fetch(url, {
      method, cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let j = null;
    try { j = await r.json(); } catch (e) { /* 下面按状态码报 */ }
    return { status: r.status, j };
  }

  async function runOnce() {
    const res = await S.syncOnce({
      dropDemo: false,
      getLocal: () => list,
      setLocal: l => { list = l; persist(); emit(); },
      pull: async () => {
        const { status, j } = await api('GET');
        if (status !== 200 || !j || !j.ok) throw new Error((j && j.error) || ('服务器返回 ' + status));
        return { version: j.version, items: j.doc.items };
      },
      push: async (items, base) => {
        const { status, j } = await api('POST', { code: prefs.code, baseVersion: base, doc: { items } });
        if (status === 409 && j) return { conflict: true, version: j.version, items: j.doc.items };
        if (status !== 200 || !j || !j.ok) throw new Error((j && j.error) || ('服务器返回 ' + status));
        return { version: j.version };
      }
    });
    sync.version = res.version;
  }

  async function syncNow() {
    if (!prefs.code) { setState('off'); return; }
    if (busy) { again = true; return; }
    if (navigator.onLine === false) { setState('offline'); return; }
    busy = true; clearTimeout(timer); setState('syncing');
    try {
      do { again = false; await runOnce(); } while (again);
      sync.at = Date.now(); setState('ok');
    } catch (e) {
      setState('error', String(e && e.message || e));
    } finally { busy = false; }
  }

  function schedule() {
    if (!prefs.code) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 600);
  }

  /** 开启（或换）同步码：本机数据会和云端那份合并，不会覆盖 */
  function enableSync(code) {
    code = String(code || '').trim();
    if (!CODE_RE.test(code)) return '同步码只能是 8~64 位的字母、数字、- 或 _';
    setPref('code', code);
    syncNow();
    return null;
  }
  function disableSync() { setPref('code', ''); setState('off'); }

  function randomCode() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';   // 去掉了容易看错的 0O1lI
    const b = new Uint8Array(12); crypto.getRandomValues(b);
    return Array.from(b, x => a[x % a.length]).join('');
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

  /** 扫码打开的链接带 #sync=码：读进来就立刻从地址栏抹掉（不留在历史记录里） */
  function takeCodeFromUrl() {
    const m = /[#&]sync=([A-Za-z0-9\-_]{8,64})/.exec(location.hash || '');
    if (!m) return null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 忽略 */ }
    return m[1];
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
    const before = S.fingerprint(list);
    const merged = S.mergeEvents(list, clean);
    const changed = merged.length - list.length;
    commit(() => { list = merged; });
    return { added: changed, same: S.fingerprint(merged) === before };
  }

  function init() {
    load();
    const c = takeCodeFromUrl();
    if (c) { prefs.pendingCode = c; }
    document.addEventListener('visibilitychange', () => {
      if (!prefs.code) return;
      syncNow();                         // 切走：把没发出去的改动冲掉；切回：拉别的设备的改动
    });
    window.addEventListener('pagehide', () => { if (prefs.code) syncNow(); });
    window.addEventListener('online', () => { if (prefs.code) syncNow(); });
    window.addEventListener('offline', () => { if (prefs.code) setState('offline'); });
    setInterval(() => { if (prefs.code && document.visibilityState === 'visible') syncNow(); }, 30000);
    /* 另一个标签页改了数据：直接读进来（同一台设备上两个标签页别互相覆盖） */
    window.addEventListener('storage', e => { if (e.key === KEY) { load(); emit(); } });
    if (prefs.code) syncNow();
  }

  root.Store = {
    init, commit, setPref, syncNow, enableSync, disableSync, randomCode, probe, takeCodeFromUrl,
    exportJSON, importJSON, CODE_RE,
    get list() { return list; }, get prefs() { return prefs; }, get sync() { return sync; },
    onChange: f => subs.push(f), onSync: f => syncSubs.push(f)
  };
})(window);
