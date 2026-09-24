/* 多设备同步内核：只做合并与流程，不碰 DOM、不认识 fetch。
   出处：Schedule-Cards（日程卡片，rc.wbztl.xyz）2026-08，长期日常使用。
   配方（为什么这么设计、服务端怎么写、参数为什么是这些值）见 feedback_device_sync_recipe.md

   为什么要把它抽成"不碰 DOM、不认识 fetch"的一层：
   合并逻辑是整套同步里唯一会悄悄丢数据的地方，必须能脱离浏览器和网络反复跑。
   原项目里它和 render()/fetch 缠在一起，那样只能靠真机对拉来验，错了也看不出来。 */
(() => {
  'use strict';

  /* 墓碑保留 120 天：足够所有设备至少上线同步过一轮，再久就是垃圾 */
  const TOMBSTONE_MS = 120 * 24 * 3600 * 1000;

  const stamp = e => e.updatedAt || e.createdAt || 0;

  /**
   * 按 id 归并两份列表，同一条取 updatedAt 更新的那一份。
   * ⚠️ 这是**逐条**的 last-write-wins，不是整份文档覆盖 ——
   *    整份覆盖会让"两台设备各改一条"变成丢一条。
   */
  function mergeEvents(a, b) {
    const map = Object.create(null);
    const take = list => (list || []).forEach(e => {
      if (!e || typeof e !== 'object' || !e.id) return;   // 脏数据直接跳过，别让它进结果
      const cur = map[e.id];
      if (!cur || stamp(e) > stamp(cur)) map[e.id] = e;
    });
    take(a); take(b);
    return Object.keys(map).map(k => map[k]);
  }

  /** 两份数据是不是一样：按 id+updatedAt 比对。用来判断"要不要上传"，避免空转写 */
  function fingerprint(list) {
    return (list || [])
      .filter(e => e && e.id)
      .map(e => e.id + ':' + stamp(e))
      .sort().join('|');
  }

  /** 活着的那些。所有显示、分组、排序都只看这个 —— 墓碑不该出现在界面上 */
  const liveItems = list => (list || []).filter(e => !e.deletedAt);

  /** 删除 = 打标记，不是从数组里拿走。真删的话另一台设备会把它当"你缺了一条"再加回来 */
  function markDeleted(list, id, now) {
    now = now || Date.now();
    (list || []).forEach(e => {
      if (e.id === id && !e.deletedAt) { e.deletedAt = now; e.updatedAt = now; }
    });
    return list;
  }

  /** 墓碑留够久之后才真正清掉 */
  const pruneTombstones = (list, now) => (list || []).filter(
    e => !e.deletedAt || ((now || Date.now()) - e.deletedAt) < TOMBSTONE_MS);

  /* 顺序用独立的数值字段，不靠数组下标 —— 下标在合并后必然错乱。
     而且每次只动被拖的那一批，不重排整个列表，
     也就不会因为"我这儿重排了"把别人的顺序冲掉 */
  const orderMax = list => (list || []).reduce(
    (m, e) => (typeof e.order === 'number' && e.order > m ? e.order : m), 0);
  const orderMin = list => (list || []).reduce(
    (m, e) => (typeof e.order === 'number' && e.order < m ? e.order : m), 0);

  /** 新建的条目排在最后 */
  const nextOrder = list => orderMax(list) + 1;

  /**
   * 拖动重排：**这批条目原本占着哪些 order 值，就还用这些值**，按新的先后发下去。
   * 好处有两个：只动被拖的那一批（别人的 order 一个没碰），order 值也不会越滚越大。
   * @param {Array} list 全量列表（含墓碑）
   * @param {string[]} idsInNewOrder 被重排的这批条目，按新的显示先后
   */
  function reorderBySlots(list, idsInNewOrder, now) {
    now = now || Date.now();
    const byId = Object.create(null);
    (list || []).forEach(e => { if (e && e.id) byId[e.id] = e; });
    const slots = idsInNewOrder
      .map(id => (byId[id] ? (byId[id].order || 0) : 0))
      .sort((a, b) => a - b);
    idsInNewOrder.forEach((id, i) => {
      const e = byId[id];
      if (e && e.order !== slots[i]) { e.order = slots[i]; e.updatedAt = now; }
    });
    return list;
  }

  /**
   * 手动顺序的比较器。
   * ⚠️ 兜底不能省：两台设备离线**各新建一条**时，`nextOrder()` 都是拿本地算的，
   *    会得出同一个 order 值。只比 order 的话，并列那两条谁在前取决于合并时谁先进 map，
   *    而每台设备都是把自己的列表放在前面合 —— 于是两台屏幕上的顺序不一样。
   *    createdAt / id 是两台设备都认的同一份事实，拿它兜底才能一致。
   */
  const orderCmp = (a, b) =>
    (a.order || 0) - (b.order || 0) ||
    (a.createdAt || 0) - (b.createdAt || 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  /**
   * 跑一次同步。传输层由外部注入，所以这一层可以脱网测。
   *
   * @param {object} o
   * @param {() => Array} o.getLocal        读本地列表
   * @param {(list:Array) => void} o.setLocal  落地（真实项目里这里还要 save() + render()）
   * @param {() => Promise<{version:any, items:Array}>} o.pull
   * @param {(items:Array, baseVersion:any) => Promise<{conflict?:boolean, version:any, items?:Array}>} o.push
   * @param {boolean} [o.dropDemo=true]     开同步时让示例数据退场
   * @returns {Promise<{version:any, pushed:boolean, retried:boolean, landed:boolean}>}
   */
  async function syncOnce(o) {
    const pull = await o.pull();
    const remote = pull.items || [];

    /* 示例数据一律不参与同步：它在每台设备上"看着一样、id 不同"，
       合并只会把 5 条变成 10 条。开了同步就让它退场，本地也清掉、不上传 */
    let local = o.getLocal() || [];
    let landed = false;
    if (o.dropDemo !== false) {
      const real = local.filter(e => !e.demo);
      if (real.length !== local.length) { local = real; o.setLocal(local); landed = true; }
    }

    const before = fingerprint(local);
    let merged = mergeEvents(local, remote);

    if (fingerprint(merged) !== before) {   // 远端有我这儿没有的：先落地，让人立刻看到
      o.setLocal(merged); landed = true;
    }

    if (fingerprint(merged) === fingerprint(remote)) {
      return { version: pull.version, pushed: false, retried: false, landed };
    }

    let res = await o.push(merged, pull.version);
    let retried = false;
    if (res && res.conflict) {              // 另一台设备刚写过：拿它的再合一次，只重试一次
      retried = true;
      merged = mergeEvents(merged, res.items || []);
      o.setLocal(merged); landed = true;
      res = await o.push(merged, res.version);
      if (res && res.conflict) throw new Error('另一台设备正在写入，稍后会自动重试');
    }
    return { version: res.version, pushed: true, retried, landed };
  }

  window.SyncCore = {
    mergeEvents, fingerprint, liveItems, markDeleted, pruneTombstones,
    orderMax, orderMin, nextOrder, reorderBySlots, orderCmp, syncOnce, TOMBSTONE_MS
  };
})();
