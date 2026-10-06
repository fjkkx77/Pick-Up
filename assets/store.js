/* 接着来 · 存储与同步调度
   数据：localStorage 'pickup.v1'（items + logs 同一个列表，会同步）
   偏好：localStorage 'pickup.prefs'（同步码、冷落天数、当前标签……每台设备自己的，不同步）
   同步调度用存档组件 assets/sync-client.js（references/组件_多设备同步/，和日程卡片 rc.wbztl.xyz 同一套做法）。
   ⚠️ sync-core.js / sync-client.js / sync-panel.js / sync-panel.css 是存档正本的逐字节副本，别在这里改——
      去存档改、跑它的 panel-demo.html 自检，再拷过来（见存档 README「怎么升级」）。 */
(function (root) {
  'use strict';

  const KEY = 'pickup.v1', PKEY = 'pickup.prefs';

  const S = root.SyncCore;
  let list = [];
  /* syncOn 和 code 分开存（照日程卡片）：关掉同步时同步码还留在框里，想接回去点一下就行 */
  let prefs = { code: '', syncOn: false, syncAt: 0, staleDays: 14, tab: 'active', sort: 'manual', expanded: [], hintDrag: 0 };
  const subs = [];

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
    if (!writeJSON(KEY, list)) client.status.error ='本机存储写不进去（可能是无痕模式或空间满了）';
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

  /* 同步码 / 开关 / 上次同步时间放在本站自己的偏好里（pickup.prefs 的 code / syncOn / syncAt），
     这样老用户升级后不用重新填码（load() 里有「有码 = 开着」的迁移） */
  const PREF_MAP = { code: 'code', on: 'syncOn', at: 'syncAt' };
  const client = root.SyncClient.create({
    api: 'api/sync', field: 'items',
    getLocal: () => list,
    setLocal: l => { list = l; migrate(); persist(); emit(); },
    prefs: { get: k => prefs[PREF_MAP[k]], set: (k, v) => setPref(PREF_MAP[k], v) }
  });
  const schedule = () => client.schedule();

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
    if (load()) persist();                              // 迁移过就落盘；开着同步的话下面 start() 会传上去
    client.status.at = prefs.syncAt || 0;               // client 建得比 load() 早，补一下上次同步时间
    /* 另一个标签页改了数据：直接读进来（同一台设备上两个标签页别互相覆盖） */
    window.addEventListener('storage', e => { if (e.key === KEY) { if (load()) persist(); emit(); } });
    client.start();                                     // 打开 / 切回 / 焦点 / 联网 / 每 30 秒拉取，切走时冲刷
  }

  root.Store = {
    init, commit, setPref, exportJSON, importJSON, client,
    syncNow: () => client.syncNow(), enableSync: c => client.enable(c), disableSync: () => client.disable(),
    active: () => client.active(), probe: () => client.probe(),
    get list() { return list; }, get prefs() { return prefs; }, get sync() { return client.status; },
    onChange: f => subs.push(f), onSync: f => client.onState(f)
  };
})(window);
