/* 界面端到端验证（真实窄屏视口 + CDP 真实触摸）
   先起服务：node tests/ui/mock.js <项目目录> 8841
   再跑：    node tests/ui/flow.js            退出码 0 = 全过
   截图在 tests/ui/shots/（已 gitignore），给人眼复核用。 */
const { open, sleep, RUN_PREFIX } = require('./cdp.js');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://127.0.0.1:8841/';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
};

/* ---------- 页面里用的探针 ---------- */
const LAYOUT = `(() => {
  const de = document.documentElement, vw = de.clientWidth;
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[hidden]'); };
  const small = [];
  document.querySelectorAll('button,input,textarea,a[href],.card').forEach(el => {
    if (!vis(el) || el.closest('.lsw-acts')) return;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5 || (r.width < 43.5 && el.type !== 'file')) small.push((el.id || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const outside = [];
  document.querySelectorAll('body *').forEach(el => {
    if (!vis(el) || el.closest('.lsw-acts') || el.closest('#ptr-indicator') || el.id === 'ptr-tip') return;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 0.5 || r.left < -0.5) outside.push((el.id || el.className || el.tagName) + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
  });
  return { vw, sw: de.scrollWidth, small: small.slice(0, 8), outside: outside.slice(0, 8) };
})()`;

async function checkLayout(c, label) {
  const L = await c.ev(LAYOUT);
  ok(L.sw <= L.vw, label + '：无横向溢出', L);
  ok(!L.outside.length, label + '：没有元素伸出视口', L.outside);
  ok(!L.small.length, label + '：可点元素都 ≥44px', L.small);
}

/* 造一批演示数据：各种状态、带时间点、带总数、清单、冷落 */
const SEED = `(() => {
  const M = Model, t = Date.now(), D = 864e5, L = [];
  const add = (title, tpl, ago, f) => { const it = M.newItem(title, tpl, t - ago, L); L.push(it); if (f) f(it); return it; };
  add('漫长的季节', 'drama', 20 * D, it => { it.levels[1].total = 12; it.link = 'https://example.com/show';
    M.stop(L, it, { pos: [1, 5] }, '', t - 6 * D); M.stop(L, it, { pos: [1, 6] }, '', t - 4 * D);
    M.stop(L, it, { pos: [1, 7], time: 1394 }, '男主刚发现真相，下一集开头别跳过，片头后面有关键信息', t - 2 * D); it.tags = ['剧']; });
  add('概率论 第三章', 'book', 40 * D, it => { it.levels[0].total = 8; M.stop(L, it, { pos: [3, 42] }, '条件概率那节例题 3 没看懂，先去翻讲义', t - 30 * D); it.tags = ['学习']; });
  add('写周报', 'task', 3 * D, it => { ['收集本周数据', '写初稿', '发给组长'].forEach(s => M.addStep(it, s, t - 3 * D));
    M.stop(L, it, { checked: [it.steps[0].id] }, '', t - 3600e3); });
  add('Python 网课', 'course', 10 * D, it => { it.levels[0].total = 48; M.stop(L, it, { pos: [12], time: 510 }, '', t - 20 * 60e3); it.tags = ['学习']; });
  add('三体 广播剧', 'drama', 60 * D, it => { M.stop(L, it, { pos: [2, 3] }, '', t - 50 * D); it.status = 'paused'; });
  add('刷题：数据结构', 'quiz', 5 * D, it => { it.levels[0].total = 200; M.stop(L, it, { pos: [37] }, '', t - 26 * 3600e3); });
  localStorage.setItem('pickup.v1', JSON.stringify(L));
  return L.length;
})()`;

async function touchDrag(c, x0, y0, x1, y1, steps, gap) {
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    const x = x0 + (x1 - x0) * i / steps, y = y0 + (y1 - y0) * i / steps;
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    if (gap) await sleep(gap);
  }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(c, sel) {
  const r = await c.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
    el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r) throw new Error('找不到 ' + sel);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
}
const click = (c, sel) => c.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const txt = (c, sel) => c.ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);
const hidden = (c, id) => c.ev(`document.getElementById(${JSON.stringify(id)}).hidden`);
const cardOf = title => `[...document.querySelectorAll('.card')].find(c => c.querySelector('.c-title').textContent === ${JSON.stringify(title)})`;

async function setDark(c, dark) {
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
}

/* =============== 1. 功能流程（390） =============== */
async function flow() {
  console.log('\n[功能流程 390×844]');
  const c = await open(390, 844, 2);
  await c.goto(BASE);
  await c.ev('localStorage.clear()');
  await c.goto(BASE);

  ok(!(await hidden(c, 'empty')) && (await txt(c, '#empty')).includes('还没有在进行的事'), '空状态有引导');
  // 同一段 eval 里点完立刻读焦点：延迟聚焦会读到 body（iOS 弹不出键盘的那类 bug）
  ok(await c.ev(`document.getElementById('emptyNew').click(), document.activeElement.id`) === 'nTitle', '点「记下第一件」→ 同一拍里聚焦到名字输入框');
  await sleep(400);
  await c.vshot(path.join(SHOTS, 'flow-new.png'));
  await c.ev(`document.getElementById('nTitle').value = '漫长的季节'`);
  await click(c, '#nOk');
  await sleep(450);
  ok(!(await hidden(c, 'detMask')) && (await hidden(c, 'newMask')), '建好后直接打开详情');
  ok((await txt(c, '#dResume')).includes('还没开始'), '新的一项显示「还没开始」');

  // 填总集数 12、调到第 7 集、时间 2314、写笔记，停在这里
  await c.ev(`(() => { const t = document.querySelector('[data-tot="1"]'); t.value = '12'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await c.ev(`(() => { const n = document.querySelector('[data-n="1"]'); n.value = '7'; n.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await c.ev(`(() => { const t = document.getElementById('dTime'); t.value = '2314'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  ok((await txt(c, '#dTimeHint')) === '= 23:14', '时间点 2314 解析成 23:14', await txt(c, '#dTimeHint'));
  await c.ev(`(() => { const n = document.getElementById('dNote'); n.value = '男主发现真相'; n.dispatchEvent(new Event('input')); })()`);
  await c.vshot(path.join(SHOTS, 'flow-detail.png'));
  await click(c, '#dStop');
  await sleep(500);
  let pos = await c.ev(`${cardOf('漫长的季节')}.querySelector('.c-pos').textContent`);
  ok(pos.includes('7') && pos.includes('/12') && pos.includes('23:14'), '停在这里 → 卡片显示第 7/12 集 23:14', pos);
  ok((await c.ev(`${cardOf('漫长的季节')}.querySelector('.c-note').textContent`)) === '男主发现真相', '卡片显示最新笔记');

  // +1、撤销
  await tap(c, '[data-plus]');
  await sleep(300);
  pos = await c.ev(`${cardOf('漫长的季节')}.querySelector('.c-pos').textContent`);
  ok(pos.includes('8') && !pos.includes('23:14'), '+1 → 第 8 集，时间点清空', pos);
  ok((await txt(c, '#toastTxt')).startsWith('已记到'), '+1 后有「已记到」提示条', await txt(c, '#toastTxt'));
  await c.vshot(path.join(SHOTS, 'flow-toast.png'));
  await c.ev(`[...document.querySelectorAll('#toastActs button')].find(b => b.textContent === '撤销').click()`);
  await sleep(300);
  pos = await c.ev(`${cardOf('漫长的季节')}.querySelector('.c-pos').textContent`);
  ok(pos.includes('7') && pos.includes('23:14'), '撤销 → 回到第 7 集 23:14', pos);

  // +1 → 写两句
  await tap(c, '[data-plus]');
  await sleep(250);
  ok(await c.ev(`[...document.querySelectorAll('#toastActs button')].find(b => b.textContent === '写两句').click(), document.activeElement.id`) === 'ntText', '「写两句」→ 同一拍里聚焦到笔记框');
  await c.ev(`document.getElementById('ntText').value = '第八集节奏变快'`);
  await click(c, '#ntOk');
  await sleep(400);
  ok((await c.ev(`${cardOf('漫长的季节')}.querySelector('.c-note').textContent`)) === '第八集节奏变快', '写两句 → 卡片笔记更新');

  // 到头：调到 12/12 → +1 → 等更新（季数未知，不猜）→ 进入下一季
  await c.ev(`${cardOf('漫长的季节')}.click()`);
  await sleep(450);
  await c.ev(`(() => { const n = document.querySelector('[data-n="1"]'); n.value = '12'; n.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click(c, '#dStop');
  await sleep(450);
  await tap(c, '[data-plus]');
  await sleep(300);
  ok((await txt(c, '#toastTxt')).includes('最后一集'), '第 12/12 集再 +1 → 提示已是最后一集', await txt(c, '#toastTxt'));
  ok((await txt(c, '[data-tab="waiting"] .n')) === '1', '状态变「等更新」（标签计数 1）');
  await c.ev(`[...document.querySelectorAll('#toastActs button')].find(b => b.textContent.startsWith('进入下一')).click()`);
  await sleep(300);
  await click(c, '[data-tab="active"]');
  await sleep(200);
  pos = await c.ev(`${cardOf('漫长的季节')}.querySelector('.c-pos').textContent`);
  ok(/第\s*2\s*季/.test(pos.replace(/\s+/g, ' ')) || pos.replace(/\s/g, '').startsWith('第2季'), '进入下一季 → 第 2 季第 1 集', pos);

  // 清单
  await click(c, '#fab');
  await sleep(350);
  await c.ev(`document.getElementById('nTitle').value = '写周报'`);
  await click(c, '[data-tpl="task"]');
  ok(await c.ev(`document.getElementById('nOk').click(), document.activeElement.closest('.addrow') !== null`), '清单建好后聚焦到「加一步」');
  await sleep(400);
  for (const s of ['收集数据', '写初稿', '发出去']) {
    await c.ev(`(() => { const i = document.querySelector('#dAdj .addrow input'); i.value = ${JSON.stringify(s)};
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  }
  ok(await c.ev(`document.querySelectorAll('#dAdj .step').length`) === 3, '回车加了 3 步');
  await c.ev(`document.querySelectorAll('#dAdj .ck')[0].click(); document.querySelectorAll('#dAdj .ck')[1].click();`);
  await click(c, '#dStop');
  await sleep(450);
  pos = await c.ev(`${cardOf('写周报')}.querySelector('.c-pos').textContent`);
  ok(pos.replace(/\s/g, '') === '2/3步', '勾两步 → 卡片 2/3 步', pos);
  ok((await c.ev(`${cardOf('写周报')}.querySelector('.c-note').textContent`)) === '下一步：发出去', '清单卡片显示下一步');

  // 左滑 → 暂停
  await c.ev(`${cardOf('写周报')}.scrollIntoView({ block: 'center' })`);
  const r = await c.ev(`(() => { const b = ${cardOf('写周报')}.getBoundingClientRect(); return { x: b.right - 90, y: b.top + b.height / 2 }; })()`);
  await touchDrag(c, r.x, r.y, r.x - 230, r.y, 10, 16);
  await sleep(400);
  const acts = await c.ev(`[...document.querySelectorAll('.lsw-acts.is-open .lsw-btn')].map(b => b.textContent)`);
  ok(JSON.stringify(acts) === JSON.stringify(['暂停', '完成', '删除']), '左滑露出 暂停/完成/删除', acts);
  await c.vshot(path.join(SHOTS, 'flow-swipe.png'));
  await c.ev(`[...document.querySelectorAll('.lsw-acts.is-open .lsw-btn')][0].click()`);
  await sleep(400);
  ok((await txt(c, '[data-tab="paused"] .n')) === '1', '点暂停 → 暂停标签 1 项');

  // 下拉关闭详情（没改东西，直接关）
  await c.ev(`${cardOf('漫长的季节')}.click()`);
  await sleep(500);
  const sh = await c.ev(`(() => { const b = document.getElementById('detSheet').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 30 }; })()`);
  await touchDrag(c, sh.x, sh.y, sh.x, sh.y + 320, 12, 30);
  await sleep(500);
  ok(await hidden(c, 'detMask'), '详情往下拉 → 关闭');

  // 改过位置再下拉 → 先问
  await c.ev(`${cardOf('漫长的季节')}.click()`);
  await sleep(500);
  await c.ev(`document.querySelector('#dAdj [data-step="1"]').click()`);
  await touchDrag(c, sh.x, sh.y, sh.x, sh.y + 320, 12, 30);
  await sleep(450);
  ok(!(await hidden(c, 'dcMask')) && !(await hidden(c, 'detMask')), '改过位置再下拉 → 弹「放弃这次调整？」，详情还在');
  await click(c, '#dcDrop');
  await sleep(350);
  ok(await hidden(c, 'detMask'), '选放弃 → 详情关闭');

  // 删除（详情里）
  await click(c, '[data-tab="paused"]');
  await sleep(200);
  await c.ev(`${cardOf('写周报')}.click()`);
  await sleep(450);
  await click(c, '#dDel');
  await sleep(300);
  ok((await txt(c, '#cfH')).includes('写周报'), '删除确认文案带名字', await txt(c, '#cfH'));
  await click(c, '#cfYes');
  await sleep(400);
  ok(await c.ev(`!${cardOf('写周报')}`) && await hidden(c, 'detMask'), '确认后删除，详情关闭');

  ok(c.errors.length === 0, '整个流程没有 JS 报错', c.errors);
  c.close();
}

/* =============== 2. 多宽度 × 深浅色 布局 =============== */
async function layouts() {
  for (const [w, h] of [[320, 568], [390, 844], [430, 932], [1707, 960]]) {
    for (const dark of [false, true]) {
      const tag = w + (dark ? '-dark' : '-light');
      console.log('\n[布局 ' + tag + ']');
      const c = await open(w, h, w > 900 ? 1 : 2);
      await setDark(c, dark);
      await c.goto(BASE);
      await c.ev('localStorage.clear()');
      await c.ev(SEED);
      await c.goto(BASE);
      await sleep(900);
      ok(await c.ev(`getComputedStyle(document.querySelector('.card')).borderRadius`) === '20px', '样式表已加载');
      ok(!(await hidden(c, 'stale')) && (await txt(c, '#staleTxt')).includes('超过 14 天'), '冷落提醒条出现', await txt(c, '#staleTxt'));
      await checkLayout(c, '首页');
      await c.vshot(path.join(SHOTS, tag + '-home.png'));
      // 冷落展开
      await click(c, '#staleBtn');
      await sleep(300);
      await checkLayout(c, '冷落展开');
      // 详情
      await c.ev(`${cardOf('漫长的季节')}.click()`);
      await sleep(500);
      await checkLayout(c, '详情');
      ok((await txt(c, '#dResume')).includes('去看'), '详情有「去看」链接');
      ok(/每天约/.test(await txt(c, '#dResume')), '详情显示速度估计', await txt(c, '#dResume'));
      await c.vshot(path.join(SHOTS, tag + '-detail.png'));
      await c.ev(`document.getElementById('detSheet').scrollTop = 99999`);
      await sleep(200);
      await c.vshot(path.join(SHOTS, tag + '-detail-bottom.png'));
      await checkLayout(c, '详情滚到底');
      await click(c, '#dClose'); await sleep(350);
      // 清单详情
      await c.ev(`${cardOf('写周报')}.click()`);
      await sleep(500);
      await checkLayout(c, '清单详情');
      await click(c, '#dClose'); await sleep(350);
      // 新建
      await click(c, '#fab'); await sleep(450);
      await checkLayout(c, '新建');
      await c.vshot(path.join(SHOTS, tag + '-new.png'));
      await click(c, '#nCancel'); await sleep(350);
      // 设置（未开同步 / 开同步）
      await click(c, '#setBtn'); await sleep(700);
      await checkLayout(c, '设置·未同步');
      await c.ev(`document.getElementById('syGen').click(); document.getElementById('syOn').click();`);
      await sleep(1200);
      await checkLayout(c, '设置·已同步');
      ok((await txt(c, '#syncBox')).includes('已同步'), '开启同步后显示已同步', await txt(c, '#syncBox'));
      ok(await c.ev(`!!document.querySelector('#syQr img') && document.querySelector('#syQr img').naturalWidth > 0`), '二维码生成出来了');
      await c.vshot(path.join(SHOTS, tag + '-settings.png'));
      await click(c, '#sClose'); await sleep(350);
      // 提示条
      await c.ev(`document.querySelector('[data-plus]').click()`);
      await sleep(400);
      await checkLayout(c, '提示条');
      const fabR = await c.ev(`(() => { const a = document.getElementById('fab').getBoundingClientRect(), b = document.getElementById('toast').getBoundingClientRect(); return { overlap: !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right) }; })()`);
      ok(!fabR.overlap, '提示条不压住 ＋ 按钮', fabR);
      if (w > 900) {
        const g = await c.ev(`(() => { const f = document.getElementById('fab').getBoundingClientRect(), l = document.getElementById('list').getBoundingClientRect(); return { fabLeft: f.left, listRight: l.right }; })()`);
        ok(g.fabLeft >= g.listRight, '宽屏：＋ 按钮在内容列外侧，不压卡片', g);
      }
      // 各标签页
      for (const tab of ['waiting', 'paused', 'archive']) {
        await click(c, '[data-tab="' + tab + '"]'); await sleep(250);
        await checkLayout(c, '标签 ' + tab);
      }
      ok(c.errors.length === 0, '没有 JS 报错', c.errors);
      c.close();
    }
  }
}

/* =============== 3. 两台设备同步 =============== */
async function syncTest() {
  console.log('\n[两台设备同步]');
  const A = await open(390, 844, 1), B = await open(390, 844, 1);
  await A.goto(BASE); await A.ev('localStorage.clear()'); await A.ev(SEED); await A.goto(BASE);
  await B.goto(BASE); await B.ev('localStorage.clear()');
  const code = 'flowtest' + Date.now().toString(36);
  await A.ev(`Store.enableSync(${JSON.stringify(code)})`);
  await sleep(1200);
  ok(await A.ev('Store.sync.state') === 'ok', 'A 开同步并上传', await A.ev('Store.sync'));

  // 已经开着页面、在同一个标签页里打开接入链接（只有 # 变了，不会重新加载）
  await B.goto(BASE);
  await B.ev(`location.hash = 'sync=' + ${JSON.stringify(code)}`);
  await sleep(500);
  ok(!(await hidden(B, 'joinMask')) && await B.ev('location.hash') === '', '页面开着时打开接入链接 → 也会问，并抹掉地址栏');
  await click(B, '#joinNo'); await sleep(350);
  ok(await B.ev('Store.prefs.code') === '', '选「不接入」→ 不写入同步码');

  // B 用扫码链接新打开（相机扫码是这种）：要先确认，确认后地址栏里的码被抹掉
  await B.goto('about:blank');
  await B.goto(BASE + '#sync=' + code);
  await sleep(500);
  ok(!(await hidden(B, 'joinMask')), 'B 打开扫码链接 → 先问「接入同步？」');
  ok(await B.ev('location.hash') === '', '地址栏里的同步码已抹掉');
  ok(await B.ev('Store.prefs.code') === '', '没确认之前不写入同步码');
  await click(B, '#joinYes');
  await sleep(1500);
  ok(await B.ev(`document.querySelectorAll('.card').length`) === await A.ev(`document.querySelectorAll('.card').length`), 'B 接入后拿到 A 的全部卡片');

  // 两边都离线各 +1 同一项，再各自同步 → 两条记录都在
  await A.ev(`Store.setPref('code', ''); Store.commit(l => Model.bump(l, Model.items(l).find(i => i.title === '刷题：数据结构'), Date.now()))`);
  await sleep(20);
  await B.ev(`Store.setPref('code', ''); Store.commit(l => Model.stop(l, Model.items(l).find(i => i.title === '刷题：数据结构'), { pos: [50] }, 'B 上做到 50', Date.now()))`);
  await A.ev(`Store.setPref('code', ${JSON.stringify(code)})`); await B.ev(`Store.setPref('code', ${JSON.stringify(code)})`);
  await A.ev('Store.syncNow()'); await B.ev('Store.syncNow()'); await A.ev('Store.syncNow()');
  await sleep(300);
  const cnt = s => s.ev(`(() => { const it = Model.items(Store.list).find(i => i.title === '刷题：数据结构'); return { logs: Model.logsOf(Store.list, it).length, pos: Model.posLabel(Store.list, it) }; })()`);
  const a = await cnt(A), b = await cnt(B);
  ok(a.logs === 3 && b.logs === 3, '各自离线记的两条都在（原 1 条 + A 的 +1 + B 的停在这里）', { a, b });
  ok(a.pos === b.pos && a.pos.includes('50'), '两边当前位置一致，取较新的一条', { a, b });

  // 删除能同步过去
  await A.ev(`(() => { const it = Model.items(Store.list).find(i => i.title === '三体 广播剧'); Store.commit(l => SyncCore.markDeleted(l, it.id, Date.now())); })()`);
  await A.ev('Store.syncNow()'); await B.ev('Store.syncNow()');
  ok(await B.ev(`!Model.items(Store.list).some(i => i.title === '三体 广播剧')`), 'A 删掉的，B 同步后也没了');
  await B.ev('Store.syncNow()'); await A.ev('Store.syncNow()');
  ok(await A.ev(`!Model.items(Store.list).some(i => i.title === '三体 广播剧')`), '删掉的不会被 B 加回来');

  if (/127\.0\.0\.1|localhost/.test(BASE)) {      // 线上没有 __kv 探针，只在本地测
    const kv = await (await fetch(BASE + '__kv')).json();
    ok(!JSON.stringify(Object.keys(kv)).includes(code), '服务端只存同步码的哈希');
  }
  ok(A.errors.length === 0 && B.errors.length === 0, '没有 JS 报错', A.errors.concat(B.errors));
  A.close(); B.close();
}

(async () => {
  const only = process.argv[2];
  try {
    if (!only || only === 'flow') await flow();
    if (!only || only === 'sync') await syncTest();
    if (!only || only === 'layout') await layouts();
  } catch (e) { fail++; console.log('✗ 脚本异常：' + (e && e.stack || e)); }
  console.log('\n' + pass + ' 过 / ' + fail + ' 失败   （本次浏览器前缀 ' + RUN_PREFIX + '）');
  process.exit(fail ? 1 : 0);
})();
