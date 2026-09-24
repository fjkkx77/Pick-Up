/* 数据逻辑自检用例。Node（tests/model.test.js）和浏览器（tests/model.html）跑的是同一份。
   t(name, fn)：fn 里抛错即失败。eq/ok 是断言。M = Model，S = SyncCore */
(function (root) {
  root.MODEL_CASES = function (M, S, t, eq, ok) {
    const D = 864e5;
    const T0 = Date.UTC(2026, 8, 1, 12);           // 固定起点，结果不随运行时间变

    function drama(list, opt) {
      const it = M.newItem('某剧', T0, list);
      M.setScale(list, it, { type: 'counter', levels: (opt && opt.levels) || [{ unit: '季', total: null }, { unit: '集', total: null }], hasTime: true }, T0);
      list.push(it);
      return it;
    }

    /* ---------- 时间点 ---------- */
    t('parseTime：纯数字按 分秒 / 时分秒 理解', () => {
      eq(M.parseTime('2314'), 23 * 60 + 14);
      eq(M.parseTime('10530'), 3600 + 5 * 60 + 30);
      eq(M.parseTime('45'), 45);
      eq(M.parseTime('830'), 8 * 60 + 30);
    });
    t('parseTime：带冒号、全角冒号、空白', () => {
      eq(M.parseTime('23:14'), 1394);
      eq(M.parseTime(' 1:05:30 '), 3930);
      eq(M.parseTime('23：14'), 1394);
    });
    t('parseTime：非法输入返回 null（秒/分 ≥60、空、字母）', () => {
      eq(M.parseTime(''), null);
      eq(M.parseTime('abc'), null);
      eq(M.parseTime('12:75'), null);
      eq(M.parseTime('1275'), null);
    });
    t('fmtTime：不满一小时 m:ss，满一小时 h:mm:ss', () => {
      eq(M.fmtTime(1394), '23:14');
      eq(M.fmtTime(3930), '1:05:30');
      eq(M.fmtTime(5), '0:05');
      eq(M.fmtTime(null), '');
    });

    /* ---------- 新建与模板 ---------- */
    t('newItem：新建默认只记文字，不带任何刻度；有 id / type / round / 同步字段', () => {
      const list = [];
      const it = M.newItem('  学 Python ', T0, list);
      eq(it.type, 'item'); eq(it.kind, 'free'); eq(it.round, 1); eq(it.status, 'active'); eq(it.title, '学 Python');
      ok(!it.levels && !it.steps);
      ok(it.id && it.createdAt === T0 && it.updatedAt === T0 && typeof it.order === 'number');
    });
    t('只记文字的事点 +1 → 提示去写一笔，不产生记录', () => {
      const list = []; const it = M.newItem('x', T0, list); list.push(it);
      const r = M.bump(list, it, T0 + 1);
      eq(r.hint, 'note'); eq(r.log, null); eq(M.logsOf(list, it).length, 0);
    });
    t('setScale：加数字刻度 / 换成清单 / 去掉，都更新 updatedAt', () => {
      const list = []; const it = M.newItem('x', T0, list); list.push(it);
      M.setScale(list, it, { type: 'counter', levels: [{ unit: ' 页 ', total: 300 }], hasTime: false }, T0 + 1);
      eq(it.kind, 'counter'); eq(it.levels[0].unit, '页'); eq(it.levels[0].total, 300); eq(it.updatedAt, T0 + 1);
      M.setScale(list, it, { type: 'counter', levels: [{ unit: '', total: null }] }, T0 + 2);
      eq(it.levels[0].unit, '个');                         // 单位没填给个兜底，别出现「第 3 」
      M.setScale(list, it, { type: 'checklist' }, T0 + 3);
      eq(it.kind, 'checklist'); ok(Array.isArray(it.steps));
      M.setScale(list, it, { type: 'none' }, T0 + 4);
      eq(it.kind, 'free'); eq(it.updatedAt, T0 + 4);
    });
    t('先只记文字、后来才加刻度 → 位置是「还没开始」，不是凭空的第 1', () => {
      const list = []; const it = M.newItem('x', T0, list); list.push(it);
      M.stop(list, it, {}, { note: '读到一半', next: '从例题开始' }, T0 + 1);
      M.setScale(list, it, { type: 'counter', levels: [{ unit: '页', total: null }] }, T0 + 2);
      eq(M.position(list, it), null);
      eq(M.posLabel(list, it), '还没开始');
      eq(M.latestNote(list, it).next, '从例题开始');     // 文字照样在
      M.bump(list, it, T0 + 3);
      eq(M.position(list, it).pos.join(','), '1');
    });
    t('位置取「最新一条带位置的记录」：之后只写文字的记录不会把位置冲掉', () => {
      const list = []; const it = drama(list);
      M.stop(list, it, { pos: [1, 4] }, '', T0);
      list.push({ id: 'txt', type: 'log', itemId: it.id, round: 1, at: T0 + 5, note: '只写了字', next: '', updatedAt: T0 + 5 });
      eq(M.position(list, it).pos.join(','), '1,4');
      eq(M.latestNote(list, it).note, '只写了字');
      eq(M.lastTouched(list, it), T0 + 5);
    });
    t('去掉刻度后文字记录还在，位置相关的记录也不删', () => {
      const list = []; const it = drama(list);
      M.stop(list, it, { pos: [1, 4] }, { note: 'a', next: 'b' }, T0);
      M.setScale(list, it, { type: 'none' }, T0 + 1);
      eq(M.logsOf(list, it).length, 1); eq(M.latestNote(list, it).next, 'b');
      eq(M.posLabel(list, it), '');
    });
    t('stop 的文字：字符串 = 做到哪；对象 = 做到哪 + 下一步；latestNote 认任一非空', () => {
      const list = []; const it = drama(list);
      const a = M.stop(list, it, { pos: [1, 1] }, '旧写法', T0);
      eq(a.note, '旧写法'); eq(a.next, '');
      M.stop(list, it, { pos: [1, 2] }, { note: '', next: '先查配置' }, T0 + 1);
      eq(M.latestNote(list, it).next, '先查配置');
      M.stop(list, it, { pos: [1, 3] }, { note: '  ', next: ' ' }, T0 + 2);    // 全空白不算
      eq(M.latestNote(list, it).next, '先查配置');
      // 导入的备份 / 别的设备同步来的数据不一定经过 stop() 的 trim，直接塞一条全空白的
      list.push({ id: 'ws', type: 'log', itemId: it.id, round: 1, at: T0 + 9, pos: [1, 4], note: '   ', next: ' \t ', updatedAt: T0 + 9 });
      eq(M.latestNote(list, it).next, '先查配置');
    });

    /* ---------- +1 ---------- */
    t('还没开始时 +1 → 各层都是 1', () => {
      const list = []; const it = drama(list);
      eq(M.position(list, it), null);
      const r = M.bump(list, it, T0 + 1000);
      eq(r.log.pos.join(','), '1,1');
      eq(M.position(list, it).pos.join(','), '1,1');
    });
    t('内层总数未知：一直往上加', () => {
      const list = []; const it = drama(list);
      for (let i = 0; i < 30; i++) M.bump(list, it, T0 + i * 1000);
      eq(M.position(list, it).pos.join(','), '1,30');
      eq(it.status, 'active');
    });
    t('+1 会清空时间点', () => {
      const list = []; const it = drama(list);
      M.stop(list, it, { pos: [1, 3], time: 600 }, '', T0);
      M.bump(list, it, T0 + 1000);
      eq(M.position(list, it).time, null);
      eq(M.position(list, it).pos.join(','), '1,4');
    });
    t('内层到头 + 外层已知且没到头 → 进下一季、集归 1', () => {
      const list = [];
      const it = drama(list, { levels: [{ unit: '季', total: 3 }, { unit: '集', total: 12 }] });
      M.stop(list, it, { pos: [1, 12] }, '', T0);
      const r = M.bump(list, it, T0 + 1000);
      eq(r.log.pos.join(','), '2,1'); eq(r.hint, null); eq(it.status, 'active');
    });
    t('内层到头 + 外层总数未知 → 不猜：变等更新 + 提示进入下一季，不新增记录', () => {
      const list = [];
      const it = drama(list, { levels: [{ unit: '季', total: null }, { unit: '集', total: 12 }] });
      M.stop(list, it, { pos: [3, 12] }, '', T0);
      const n = M.logsOf(list, it).length;
      const r = M.bump(list, it, T0 + 1000);
      eq(r.log, null); eq(r.hint, 'nextOuter'); eq(it.status, 'waiting'); eq(r.prevStatus, 'active');
      eq(M.logsOf(list, it).length, n);
      eq(M.position(list, it).pos.join(','), '3,12');
    });
    t('全部到头 → 变等更新 + 提示「标记为看完了」，不自动完成', () => {
      const list = [];
      const it = drama(list, { levels: [{ unit: '季', total: 2 }, { unit: '集', total: 10 }] });
      M.stop(list, it, { pos: [2, 10] }, '', T0);
      const r = M.bump(list, it, T0 + 1000);
      eq(r.hint, 'finish'); eq(it.status, 'waiting'); ok(it.status !== 'done');
    });
    t('单层计数（刷题）到总数后再 +1 → finish 提示', () => {
      const list = []; const it = M.newItem('刷题', T0, list); list.push(it);
      M.setScale(list, it, { type: 'counter', levels: [{ unit: '题', total: 2 }] }, T0);
      M.bump(list, it, T0 + 1); M.bump(list, it, T0 + 2);
      eq(M.position(list, it).pos.join(','), '2');
      eq(M.bump(list, it, T0 + 3).hint, 'finish');
    });
    t('进入下一季（外层 +1）→ 内层归 1', () => {
      const list = [];
      const it = drama(list, { levels: [{ unit: '季', total: null }, { unit: '集', total: 12 }] });
      M.stop(list, it, { pos: [3, 12], time: 100 }, '', T0);
      M.bump(list, it, T0 + 1);                       // 等更新
      const r = M.bumpLevel(list, it, 0, T0 + 2);
      eq(r.log.pos.join(','), '4,1'); eq(r.log.time, null);
      eq(it.status, 'active');                        // 进了下一季自然又在进行中
      eq(r.log.prevStatus, 'waiting');
    });
    t('+1 顺带改状态时，记录里存 prevStatus', () => {
      const list = []; const it = drama(list);
      it.status = 'paused';
      const r = M.bump(list, it, T0 + 1);
      eq(it.status, 'active'); eq(r.log.prevStatus, 'paused');
      const r2 = M.bump(list, it, T0 + 2);
      eq(r2.log.prevStatus, null);                    // 没改状态就不存
    });

    /* ---------- 撤销 ---------- */
    t('撤销 = 打墓碑；位置回到上一条', () => {
      const list = []; const it = drama(list);
      M.bump(list, it, T0 + 1); const r = M.bump(list, it, T0 + 2);
      M.undo(list, it, r, T0 + 3);
      eq(M.position(list, it).pos.join(','), '1,1');
      const log = list.find(e => e.id === r.log.id);
      ok(log.deletedAt === T0 + 3 && log.updatedAt === T0 + 3);
    });
    t('撤销会把状态一起还原（有记录 / 无记录两种）', () => {
      const list = [];
      const it = drama(list, { levels: [{ unit: '季', total: null }, { unit: '集', total: 2 }] });
      it.status = 'paused';
      const r1 = M.bump(list, it, T0 + 1);
      M.undo(list, it, r1, T0 + 2); eq(it.status, 'paused');
      M.stop(list, it, { pos: [1, 2] }, '', T0 + 3); it.status = 'active';
      const r2 = M.bump(list, it, T0 + 4);            // 到头，无记录，变 waiting
      eq(it.status, 'waiting');
      M.undo(list, it, r2, T0 + 5); eq(it.status, 'active');
    });

    /* ---------- 最新一条的判定 ---------- */
    t('currentLog：按 at 取最新，at 相同按 id（与数组先后无关），忽略墓碑与其它刷', () => {
      const list = []; const it = drama(list);
      const a = M.stop(list, it, { pos: [1, 1] }, 'a', T0);
      const b = M.stop(list, it, { pos: [1, 2] }, 'b', T0);
      a.id = 'log-b'; b.id = 'log-a';                  // 故意让 id 顺序和插入顺序相反
      eq(M.currentLog(list, it).note, 'a');
      list.reverse();                                   // 另一台设备合并后数组次序不同
      eq(M.currentLog(list, it).note, 'a');
      S.markDeleted(list, 'log-b', T0 + 1);
      eq(M.currentLog(list, it).note, 'b');
      list.push(Object.assign({}, b, { id: 'zzz', round: 2, at: T0 + 99, deletedAt: undefined }));
      eq(M.currentLog(list, it).round, 1);
    });

    /* ---------- 同步合并 ---------- */
    t('两台设备离线各 +1 → 合并后两条记录都在，当前位置取较新的', () => {
      const base = []; const it = drama(base);
      M.stop(base, it, { pos: [1, 5] }, '', T0);
      const phone = JSON.parse(JSON.stringify(base));
      const pc = JSON.parse(JSON.stringify(base));
      M.bump(phone, phone[0], T0 + 1000);             // 手机 → 1,6
      const pcIt = pc[0];
      M.stop(pc, pcIt, { pos: [1, 7], time: 300 }, '电脑上看到这', T0 + 2000);
      const merged = S.mergeEvents(phone, pc);
      eq(M.logsOf(merged, it).length, 3);
      const cur = M.position(merged, merged.find(e => e.id === it.id));
      eq(cur.pos.join(','), '1,7'); eq(cur.time, 300);
    });
    t('撤销（墓碑）能同步到另一台，不会被加回来', () => {
      const a = []; const it = drama(a);
      const r = M.bump(a, it, T0 + 1);
      const b = JSON.parse(JSON.stringify(a));
      M.undo(a, it, r, T0 + 2);
      const m = S.mergeEvents(b, a);
      eq(M.position(m, m.find(e => e.id === it.id)), null);
    });

    /* ---------- 改总数 / 二刷 / 状态 ---------- */
    t('改总数：等更新且当前位置能继续往下 → 回到进行中', () => {
      const list = [];
      const it = drama(list, { levels: [{ unit: '季', total: 1 }, { unit: '集', total: 10 }] });
      M.stop(list, it, { pos: [1, 10] }, '', T0);
      M.bump(list, it, T0 + 1); eq(it.status, 'waiting');
      M.setTotal(list, it, 1, 12, T0 + 2);
      eq(it.status, 'active'); eq(it.levels[1].total, 12); eq(it.updatedAt, T0 + 2);
    });
    t('改总数：等更新但仍然到头 → 保持等更新', () => {
      const list = [];
      const it = drama(list, { levels: [{ unit: '季', total: 1 }, { unit: '集', total: 10 }] });
      M.stop(list, it, { pos: [1, 10] }, '', T0);
      M.bump(list, it, T0 + 1);
      M.setTotal(list, it, 0, 1, T0 + 2);
      eq(it.status, 'waiting');
    });
    t('二刷：round+1，位置回到「还没开始」，一刷记录保留', () => {
      const list = []; const it = drama(list);
      M.bump(list, it, T0 + 1); M.bump(list, it, T0 + 2);
      it.status = 'done';
      M.startRound(it, T0 + 3);
      eq(it.round, 2); eq(it.status, 'active');
      eq(M.position(list, it), null);
      eq(M.logsOf(list, it, 1).length, 2);
      M.bump(list, it, T0 + 4);
      eq(M.position(list, it).pos.join(','), '1,1');
      eq(M.logsOf(list, it).length, 1);
    });
    t('setStatus 更新 updatedAt', () => {
      const list = []; const it = drama(list);
      M.setStatus(it, 'dropped', T0 + 5);
      eq(it.status, 'dropped'); eq(it.updatedAt, T0 + 5);
    });

    /* ---------- 笔记 ---------- */
    t('写两句：给刚才那条补笔记，latestNote 取最近一条非空笔记', () => {
      const list = []; const it = drama(list);
      M.stop(list, it, { pos: [1, 1] }, '开头很慢', T0);
      const r = M.bump(list, it, T0 + 1);
      eq(M.latestNote(list, it).note, '开头很慢');     // 最新一条没写笔记，往前找
      M.setNote(list, r.log.id, { note: '男主发现真相', next: '下集开头别跳' }, T0 + 2);
      eq(M.latestNote(list, it).note, '男主发现真相'); eq(M.latestNote(list, it).next, '下集开头别跳');
      eq(list.find(e => e.id === r.log.id).updatedAt, T0 + 2);
    });

    /* ---------- 清单 ---------- */
    t('清单：勾选状态存在记录里，进度 = 已勾/总数，全勾完提示 finish', () => {
      const list = []; const it = M.newItem('写周报', T0, list); list.push(it);
      M.setScale(list, it, { type: 'checklist' }, T0);
      M.addStep(it, '收集数据', T0); M.addStep(it, '写初稿', T0); M.addStep(it, '发出去', T0);
      eq(M.checkProgress(list, it).done, 0);
      const ids = it.steps.map(s => s.id);
      M.stop(list, it, { checked: [ids[0]] }, '', T0 + 1);
      eq(M.checkProgress(list, it).done, 1); eq(M.checkProgress(list, it).total, 3);
      eq(M.finishHint(list, it), null);
      M.stop(list, it, { checked: ids }, '', T0 + 2);
      eq(M.finishHint(list, it), 'finish');
      eq(M.posLabel(list, it), '3/3 步');
    });
    t('清单：删掉的步骤不计入进度', () => {
      const list = []; const it = M.newItem('x', T0, list); list.push(it);
      M.setScale(list, it, { type: 'checklist' }, T0);
      M.addStep(it, 'a', T0); M.addStep(it, 'b', T0);
      M.stop(list, it, { checked: [it.steps[0].id] }, '', T0 + 1);
      M.removeStep(it, it.steps[0].id, T0 + 2);
      eq(M.checkProgress(list, it).done, 0); eq(M.checkProgress(list, it).total, 1);
    });

    /* ---------- 展示文案 ---------- */
    t('posLabel：还没开始 / 多层 / 带总数 / 带时间点', () => {
      const list = []; const it = drama(list);
      eq(M.posLabel(list, it), '还没开始');
      M.stop(list, it, { pos: [3, 7], time: 1394 }, '', T0);
      eq(M.posLabel(list, it), '第 3 季 · 第 7 集 · 23:14');
      it.levels[1].total = 12;
      eq(M.posLabel(list, it), '第 3 季 · 第 7/12 集 · 23:14');
    });
    t('relTime：刚刚 / 分钟 / 小时 / 昨天 / 天 / 个月', () => {
      eq(M.relTime(T0 - 20e3, T0), '刚刚');
      eq(M.relTime(T0 - 5 * 60e3, T0), '5 分钟前');
      eq(M.relTime(T0 - 3 * 3600e3, T0), '3 小时前');
      eq(M.relTime(T0 - 1 * D - 60e3, T0), '昨天');
      eq(M.relTime(T0 - 3 * D - 60e3, T0), '3 天前');
      eq(M.relTime(T0 - 65 * D, T0), '2 个月前');
    });

    /* ---------- 冷落 / 速度 ---------- */
    t('isStale：只看进行中；按最后碰过的时间', () => {
      const list = []; const it = drama(list);
      ok(!M.isStale(list, it, T0 + 13 * D, 14));
      ok(M.isStale(list, it, T0 + 15 * D, 14));
      M.bump(list, it, T0 + 10 * D);
      ok(!M.isStale(list, it, T0 + 15 * D, 14));
      it.status = 'paused';
      ok(!M.isStale(list, it, T0 + 60 * D, 14));
    });
    t('pace：记录太少或跨度太短 → null', () => {
      const list = []; const it = drama(list);
      M.bump(list, it, T0); M.bump(list, it, T0 + 3 * D);
      eq(M.pace(list, it, T0 + 3 * D), null);            // 只有 2 条
      const l2 = []; const i2 = drama(l2);
      M.bump(l2, i2, T0); M.bump(l2, i2, T0 + 3600e3); M.bump(l2, i2, T0 + 7200e3);
      eq(M.pace(l2, i2, T0 + 7200e3), null);             // 跨度不到 2 天
    });
    t('pace：每天推进量 + 剩余天数（总数已知时）', () => {
      const list = [];
      const it = drama(list, { levels: [{ unit: '季', total: 1 }, { unit: '集', total: 40 }] });
      for (let i = 0; i < 11; i++) M.bump(list, it, T0 + i * D); // 10 天推进 10 集，到第 11 集
      const p = M.pace(list, it, T0 + 10 * D);
      eq(Math.round(p.perDay * 10) / 10, 1); eq(p.unit, '集');
      eq(p.daysLeft, 29);                                // 40 - 11 = 29 集
    });
    t('pace：跨季时按每季集数折算；总数未知时不给剩余天数', () => {
      const list = [];
      const it = drama(list, { levels: [{ unit: '季', total: null }, { unit: '集', total: 10 }] });
      M.stop(list, it, { pos: [1, 8] }, '', T0);
      M.stop(list, it, { pos: [2, 2] }, '', T0 + 2 * D);  // 8 → 12，推进 4 集
      M.stop(list, it, { pos: [2, 6] }, '', T0 + 4 * D);  // 再 4 集
      const p = M.pace(list, it, T0 + 4 * D);
      eq(p.perDay, 2); eq(p.daysLeft, null);
    });
    t('pace：每季集数未知时，同一季内的推进照样算（第 2 季以后不能漏）', () => {
      const list = []; const it = drama(list);               // 季、集总数都未知
      M.stop(list, it, { pos: [1, 2] }, '', T0);
      M.stop(list, it, { pos: [1, 6] }, '', T0 + 1 * D);     // +4
      M.stop(list, it, { pos: [2, 1] }, '', T0 + 2 * D);     // 跨季：折算不了，跳过
      M.stop(list, it, { pos: [2, 5] }, '', T0 + 4 * D);     // +4
      eq(M.pace(list, it, T0 + 4 * D).perDay, 2);            // 8 集 / 4 天
    });
    t('pace：往回改的位置不算推进，也不会把折算不了的当 0', () => {
      const list = []; const it = drama(list);
      M.stop(list, it, { pos: [2, 5] }, '', T0);
      M.stop(list, it, { pos: [1, 3] }, '', T0 + 1 * D);     // 改错了往回调
      M.stop(list, it, { pos: [1, 9] }, '', T0 + 2 * D);     // +6
      eq(M.pace(list, it, T0 + 2 * D).perDay, 3);
    });
    t('fraction：总数都已知才给比例；清单按勾选；其余 null', () => {
      const list = [];
      const it = drama(list, { levels: [{ unit: '季', total: 2 }, { unit: '集', total: 10 }] });
      eq(M.fraction(list, it), 0);                          // 还没开始 = 0
      M.stop(list, it, { pos: [2, 5] }, '', T0);
      eq(M.fraction(list, it), 15 / 20);
      it.levels[0].total = null;
      eq(M.fraction(list, it), null);
      const w = M.newItem('x', T0, list); list.push(w);
      M.setScale(list, w, { type: 'checklist' }, T0);
      eq(M.fraction(list, w), null);                        // 没有步骤
      M.addStep(w, 'a', T0); M.addStep(w, 'b', T0);
      M.stop(list, w, { checked: [w.steps[0].id] }, '', T0 + 1);
      eq(M.fraction(list, w), 0.5);
    });
    t('lastTouched：取最新记录时间，没有记录用创建时间', () => {
      const list = []; const it = drama(list);
      eq(M.lastTouched(list, it), T0);
      M.bump(list, it, T0 + 5);
      eq(M.lastTouched(list, it), T0 + 5);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
