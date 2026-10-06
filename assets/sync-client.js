/* 多设备同步 · 调度层（sync-client.js）  v1.0.0
   ─────────────────────────────────────────────────────────────
   什么时候同步、和服务端怎么说话、同步码存哪、状态是什么——都在这一层。
   合并算法不在这儿，在 sync-core.js（这一层只调用它的 syncOnce）。界面不在这儿，在 sync-panel.js。

   出处：日程卡片（rc.wbztl.xyz）2026-08 的同步调度，长期日常使用；
         2026-10-06 在「接着来」照它重做后抽成通用件（比出处多修了两处，见 README「和出处的差别」）。
   配方：feedback_device_sync_recipe.md §3 §4 §5
   ⚠️ 这是**存档正本**。项目里的副本要和它逐字节一致；改了这里要同步到 README「已部署副本」里列的每一处，
      再跑 工具_存档维护/check_component_copies.py。别只改项目里那份。

   用法：
     const client = SyncClient.create({
       api: 'api/sync', field: 'items',
       getLocal: () => list,
       setLocal: l => { list = l; save(); render(); },     // 落地要连带存盘 + 重绘
     });
     client.start();                                        // 挂上切走 / 切回 / 焦点 / 联网 / 定时 这些时机
     改完数据后： client.schedule();                         // 防抖 600ms 再同步 */
(function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const CODE_RE = /^[A-Za-z0-9\-_]{8,64}$/;

  /* 同步码默认存在自己的 localStorage 键里（和出处一样：{on, code, at}）。
     宿主已经有一份偏好存储、想放一起的，传 opts.prefs = { get(k), set(k, v) }，k 是 'on' | 'code' | 'at' */
  function localPrefs(key) {
    let d = {};
    try { d = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { d = {}; }
    return {
      get: k => d[k],
      set: (k, v) => { d[k] = v; try { localStorage.setItem(key, JSON.stringify(d)); } catch (e) { /* 无痕模式等 */ } }
    };
  }

  class Unsupported extends Error {}

  function create(opts) {
    const o = Object.assign({
      api: 'api/sync',
      field: 'items',        // 服务端 doc 里那份列表叫什么（日程卡片是 'events'）
      space: '',             // 同一个同步码下的分区（配方 §5 第 5 条）；默认分区留空
      debounce: 600,         // 配方 §7：连续输入时不发，停手就传
      interval: 30000,       // 页面可见时多久拉一次
      dropDemo: false,       // 宿主有示例数据（demo:true）就开，开同步时让它退场
      key: 'sync-client-v1', // 默认偏好存储的键；传了 prefs 就不用
      fetch: (u, i) => root.fetch(u, i)   // 测试时注入假服务端
    }, opts || {});
    if (typeof o.getLocal !== 'function' || typeof o.setLocal !== 'function') throw new Error('SyncClient 需要 getLocal / setLocal');
    const prefs = o.prefs || localPrefs(o.key);
    const Core = o.core || root.SyncCore;

    /* state：off | syncing | ok | error | offline | unsupported */
    const st = { state: 'off', error: '', at: +prefs.get('at') || 0, version: 0, configured: null };
    const subs = [];
    let busy = false, again = false, timer = 0, running = null, started = false;
    /* 有没有还没传上去的本机改动——页面被切走时只在有的时候才冲，免得每次锁屏都白发一趟 */
    let pending = false;

    const code = () => String(prefs.get('code') || '');
    const active = () => !!(prefs.get('on') && code());
    const emit = () => subs.forEach(f => { try { f(st); } catch (e) { console.error(e); } });
    const setState = (s, err) => { st.state = s; st.error = err || ''; emit(); };

    const spaceQ = () => o.space ? '&space=' + encodeURIComponent(o.space) : '';
    /* 旧服务端会**静默忽略**不认识的 space、把默认那份还回来——不核对就会把分区数据写进主数据（配方 §5 第 5 条，变异测试实测过） */
    const checkSpace = j => { if (o.space && j && j.space !== o.space) throw new Error('服务端不认识这份数据的分区'); };

    async function readJSON(r) { try { return await r.json(); } catch (e) { return null; } }

    async function pull() {
      const r = await o.fetch(o.api + '?code=' + encodeURIComponent(code()) + spaceQ() + '&_=' + Date.now(), { cache: 'no-store' });
      if (r.status === 404) throw new Unsupported('当前地址不支持同步');   // 比如直接打开的静态页，没有 /api
      const j = await readJSON(r);
      if (r.status !== 200 || !j || !j.ok) throw new Error((j && j.error) || ('读取失败 ' + r.status));
      checkSpace(j);
      return { version: j.version, items: (j.doc && j.doc[o.field]) || [] };
    }

    async function push(items, base) {
      const doc = {}; doc[o.field] = items;
      const payload = { code: code(), baseVersion: base, doc };
      if (o.space) payload.space = o.space;
      const body = JSON.stringify(payload);
      /* keepalive 让请求在页面被关掉之后也能发完（浏览器限制 64KB，超了就走普通请求） */
      const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body };
      if (body.length < 60000) init.keepalive = true;
      const r = await o.fetch(o.api, init);
      const j = await readJSON(r);
      if (j) checkSpace(j);
      if (r.status === 409 && j) return { conflict: true, version: j.version, items: (j.doc && j.doc[o.field]) || [] };
      if (r.status !== 200 || !j || !j.ok) throw new Error((j && j.error) || ('上传失败 ' + r.status));
      return { version: j.version };
    }

    /* 正在同步时再叫一次：排队再跑一轮，并且**返回正在跑的那一趟**——
       直接 return 的话，调用方（下拉刷新「先同步再刷新」、测试）会以为同步完了，其实还在半路。
       2026-09-26 在「接着来」对线上跑双设备用例时抓到（本地太快碰不上） */
    function syncNow() {
      if (!active()) return Promise.resolve();
      if (busy) { again = true; return running; }
      if (root.navigator && navigator.onLine === false) { setState('offline'); return Promise.resolve(); }
      busy = true; clearTimeout(timer); setState('syncing');
      running = (async () => {
        try {
          do {
            again = false;
            pending = false;          // 这一轮会把此刻本机的全部改动带上去；这期间再改的会把它重新置上
            const res = await Core.syncOnce({ dropDemo: o.dropDemo, getLocal: o.getLocal, setLocal: o.setLocal, pull, push });
            st.version = res.version;
          } while (again);
          if (!active()) { setState('off'); return; }   // 同步半路被关掉了，别再显示「已同步」
          st.at = Date.now(); prefs.set('at', st.at);
          setState('ok');
        } catch (e) {
          pending = true;             // 没传上去，下次切走时还要冲
          if (e instanceof Unsupported) setState('unsupported', e.message);
          else setState('error', String(e && e.message || e));
        } finally { busy = false; }
      })();
      return running;
    }

    /** 本机数据改了就调这个：防抖后同步 */
    function schedule() {
      if (!active()) return;
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(syncNow, o.debounce);
    }

    /* 页面被切走 / 关掉时，把还没发出去的改动立刻冲出去——
       否则「手机上改完马上锁屏」这一下，改动就要等到下次打开才传得上去 */
    function flush() {
      if (!active() || !pending) return;
      clearTimeout(timer);
      syncNow();
    }

    /** 开启（或换）同步码：本机数据会和云端那份合并，不会覆盖。返回错误文字，成功返回 null */
    function enable(c) {
      c = String(c || '').trim();
      if (!CODE_RE.test(c)) return '同步码要 8~64 位，只能用字母、数字、- 和 _';
      if (c !== code()) { st.at = 0; prefs.set('at', 0); }
      prefs.set('code', c); prefs.set('on', true);
      st.version = 0;
      syncNow();
      return null;
    }
    /** 关闭同步：本机数据和同步码都留着，只是不再互通 */
    function disable() {
      prefs.set('on', false);
      clearTimeout(timer); pending = false;
      setState('off');
    }

    /** 不带同步码 GET 一次：探测这个部署有没有配好存储 */
    async function probe() {
      try {
        const r = await o.fetch(o.api + '?_=' + Date.now(), { cache: 'no-store' });
        const j = await r.json();
        st.configured = !!(j && j.ok && j.configured);
      } catch (e) { st.configured = false; }
      emit();
      return st.configured;
    }

    /** 挂上同步时机（只挂一次）：打开、切回、获得焦点、联网、每 30 秒（只在页面可见时）各拉一次；要走时把没发出去的冲掉 */
    function start() {
      if (started) return; started = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush(); else syncNow();
      });
      root.addEventListener('pagehide', flush);
      root.addEventListener('focus', () => syncNow());
      root.addEventListener('online', () => syncNow());
      root.addEventListener('offline', () => { if (active()) setState('offline'); });
      setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, o.interval);
      if (active()) { setState('syncing'); syncNow(); }
    }

    return {
      start, syncNow, schedule, flush, enable, disable, probe, active,
      get code() { return code(); },
      status: st,                         // 同一个对象，一直是最新的（state / error / at / version / configured）
      onState: f => { subs.push(f); },
      hasPending: () => pending
    };
  }

  /* 照日程卡片：16 位小写字母 + 数字，每 4 位一个 -，去掉容易看混的 l/o/0/1 */
  function randomCode() {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    const buf = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(buf);
    else for (let j = 0; j < 16; j++) buf[j] = Math.floor(Math.random() * 256);
    let out = '';
    for (let i = 0; i < 16; i++) { out += abc[buf[i] % abc.length]; if (i === 3 || i === 7 || i === 11) out += '-'; }
    return out;
  }

  /** 相对时间：「刚刚 / 3 分钟前 / 2 小时前 / 5 天前」（和出处一致） */
  function timeAgo(ts, now) {
    if (!ts) return '';
    const s = Math.floor(((now || Date.now()) - ts) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return Math.floor(s / 86400) + ' 天前';
  }

  /** 一句话状态（标题下那一行、面板里的「状态」都用它） */
  function statusText(client, now) {
    const s = client.status;
    if (!client.active()) return '未开启';
    return {
      syncing: '同步中…',
      ok: '已同步' + (s.at ? ' · ' + timeAgo(s.at, now) : ''),
      error: '同步失败：' + s.error,
      offline: '现在离线，联网后自动同步',
      unsupported: '当前地址不支持同步',
      off: '未开启'
    }[s.state] || '';
  }
  const isBad = client => ['error', 'unsupported', 'offline'].includes(client.status.state);

  root.SyncClient = { create, randomCode, timeAgo, statusText, isBad, CODE_RE, VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
