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
    // 收起的一摞里的东西不单独算：那里点哪儿都是「展开整摞」，热区是整摞（远大于 44）；后面几层被 3D 透视缩小了
    if (!vis(el) || el.closest('.lsw-acts') || el.closest('.stack:not(.is-open)')) return;
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

const { SEED } = require('./seed.js');

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
const setVal = (c, sel, v, evt) => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)};
  e.dispatchEvent(new Event(${JSON.stringify(evt || 'input')}, { bubbles: true })); })()`);
const toastBtn = (c, label) => c.ev(`[...document.querySelectorAll('#toastActs button')].find(b => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
const cardTxt = (c, title, part) => c.ev(`(${cardOf(title)}.querySelector(${JSON.stringify(part)}) || {}).textContent || ''`);

async function flow() {
  console.log('\n[功能流程 390×844]');
  const c = await open(390, 844, 2);
  await c.goto(BASE);
  await c.ev('localStorage.clear()');
  await c.goto(BASE);

  ok(!(await hidden(c, 'empty')) && (await txt(c, '#empty')).includes('还没有在进行的事'), '空状态有引导');
  ok(!(await txt(c, '#empty')).match(/剧|集|季/), '引导文案不带看剧的说法', await txt(c, '#empty'));
  ok(await c.ev(`document.getElementById('emptyNew').click(), document.activeElement.id`) === 'nTitle', '点「记下第一件」→ 同一拍里聚焦到名字');
  ok(await c.ev(`!document.querySelector('#newSheet [data-tpl]')`), '新建只问名字，不再选场景模板');
  await sleep(400);
  await c.vshot(path.join(SHOTS, 'flow-new.png'));

  // 建好 → 直接进详情，而且光标已经在「做到哪了」
  await c.ev(`document.getElementById('nTitle').value = '毕业论文'`);
  ok(await c.ev(`document.getElementById('nOk').click(), document.activeElement.id`) === 'dNote', '建好 → 详情，同一拍聚焦到「做到哪了」');
  await sleep(450);
  ok(await c.ev(`document.getElementById('dAdj').hidden`), '只记文字的事：没有「调整位置」那一块');
  await setVal(c, '#dNote', '第二章写完初稿');
  await setVal(c, '#dNext', '补 3 篇新文献');
  await c.vshot(path.join(SHOTS, 'flow-detail-free.png'));
  await click(c, '#dStop');
  await sleep(500);
  ok((await cardTxt(c, '毕业论文', '.c-next')) === '下一步补 3 篇新文献', '卡片显示「下一步」', await cardTxt(c, '毕业论文', '.c-next'));
  ok((await cardTxt(c, '毕业论文', '.c-plus')).startsWith('记'), '只记文字的事，卡片按钮是「记一笔」而不是 +1');
  ok(!(await cardTxt(c, '毕业论文', '.c-pos')), '只记文字的事，卡片上没有位置那一行');

  // 首页「记一笔」
  ok(await c.ev(`${cardOf('毕业论文')}.querySelector('.c-plus').click(), document.activeElement.id`) === 'ntText', '点「记一笔」→ 同一拍聚焦');
  ok((await c.ev(`document.getElementById('ntNext').placeholder`)).includes('补 3 篇新文献'), '「下一步」框提示上次写的');
  await setVal(c, '#ntNext', '开始写第三章');
  await click(c, '#ntOk');
  await sleep(400);
  ok((await cardTxt(c, '毕业论文', '.c-next')).endsWith('开始写第三章'), '记一笔 → 卡片「下一步」更新');
  ok(await c.ev(`Model.logsOf(Store.list, Model.items(Store.list).find(i => i.title === '毕业论文')).length`) === 2, '记一笔新增了一条记录');

  // 给它加数字刻度：页，共 300
  await c.ev(`${cardOf('毕业论文')}.click()`);
  await sleep(450);
  await click(c, '#dAddScale');
  await sleep(400);
  ok(!(await hidden(c, 'scaleMask')), '点「加一个进度刻度」→ 弹出刻度面板');
  await click(c, '#scChips [data-u="页"]');
  await setVal(c, '#scTotal', '300');
  await c.vshot(path.join(SHOTS, 'flow-scale.png'));
  await click(c, '#scOk');
  await sleep(400);
  ok(!(await c.ev(`document.getElementById('dAdj').hidden`)) && await c.ev(`document.querySelectorAll('#dAdj .lv').length`) === 1, '加上后详情出现一层「页」的调整');
  ok((await txt(c, '#dResume')).includes('还没开始'), '先前只记文字，加刻度后位置是「还没开始」');
  ok((await txt(c, '#dResume')).includes('开始写第三章'), '先前写的字还在');
  await setVal(c, '[data-n="0"]', '42', 'change');
  await click(c, '#dStop');
  await sleep(450);
  let pos = await cardTxt(c, '毕业论文', '.c-pos');
  ok(pos.replace(/\s/g, '') === '第42/300页', '卡片显示 第 42/300 页', pos);
  ok(await c.ev(`!!${cardOf('毕业论文')}.querySelector('.bar i')`), '总数已知 → 有进度条');
  ok((await cardTxt(c, '毕业论文', '.c-plus')) === '+1', '有了数字刻度，按钮变成 +1');

  // +1 / 撤销 / 补一句
  await tap(c, `[data-plus="${await c.ev(`${cardOf('毕业论文')}.dataset.id`)}"]`);
  await sleep(300);
  ok((await cardTxt(c, '毕业论文', '.c-pos')).includes('43'), '+1 → 43');
  await toastBtn(c, '撤销');
  await sleep(300);
  ok((await cardTxt(c, '毕业论文', '.c-pos')).includes('42'), '撤销 → 回到 42');
  await c.ev(`${cardOf('毕业论文')}.querySelector('.c-plus').click()`);
  await sleep(250);
  ok(await c.ev(`[...document.querySelectorAll('#toastActs button')].find(b => b.textContent === '补一句').click(), document.activeElement.id`) === 'ntText', '「补一句」→ 同一拍聚焦');
  ok((await txt(c, '#noteH')) === '补一句', '面板标题是「补一句」');
  await setVal(c, '#ntNext', '43 页的图重画');
  await click(c, '#ntOk');
  await sleep(400);
  ok((await cardTxt(c, '毕业论文', '.c-next')).endsWith('43 页的图重画'), '补一句 → 卡片下一步更新');

  // 再加一层（在最前面），默认名「组」只是占位 → 自动选中让人改
  await c.ev(`${cardOf('毕业论文')}.click()`);
  await sleep(450);
  ok(await c.ev(`document.getElementById('dAddLv').click(), document.activeElement.dataset.unit`) === '0', '加一层后光标直接在新单位名上');
  await setVal(c, '[data-unit="0"]', '章', 'change');
  await setVal(c, '[data-n="1"]', '300', 'change');
  await click(c, '#dStop');
  await sleep(450);
  await c.ev(`${cardOf('毕业论文')}.querySelector('.c-plus').click()`);
  await sleep(300);
  ok((await txt(c, '#toastTxt')).includes('这一章最后一页'), '页到头、章数未知 → 不猜，提示', await txt(c, '#toastTxt'));
  ok((await txt(c, '[data-tab="waiting"] .n')) === '1', '状态变「等待中」');
  await toastBtn(c, '进入下一');
  await sleep(300);
  await click(c, '[data-tab="active"]');
  await sleep(200);
  pos = await cardTxt(c, '毕业论文', '.c-pos');
  ok(pos.replace(/\s/g, '').startsWith('第2章·第1/300页'), '进入下一章 → 第 2 章第 1 页', pos);

  // 清单
  await click(c, '#fab');
  await sleep(350);
  await c.ev(`document.getElementById('nTitle').value = '写周报'`);
  await click(c, '#nOk');
  await sleep(450);
  await click(c, '#dAddScale');
  await sleep(350);
  await click(c, '#scType [data-sc="checklist"]');
  ok(await c.ev(`document.getElementById('scCounter').hidden`), '选「拆成步骤」→ 数字选项收起');
  ok(await c.ev(`document.getElementById('scOk').click(), !!document.activeElement.closest('.addrow')`), '加上清单 → 光标在「加一步」');
  await sleep(400);
  for (const x of ['收集数据', '写初稿', '发出去']) {
    await c.ev(`(() => { const i = document.querySelector('#dAdj .addrow input'); i.value = ${JSON.stringify(x)};
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  }
  ok(await c.ev(`document.querySelectorAll('#dAdj .step').length`) === 3, '回车加了 3 步');
  await c.ev(`document.querySelectorAll('#dAdj .ck')[0].click(); document.querySelectorAll('#dAdj .ck')[1].click();`);
  await click(c, '#dStop');
  await sleep(450);
  ok((await cardTxt(c, '写周报', '.c-pos')).replace(/\s/g, '') === '2/3步', '勾两步 → 2/3 步');
  ok((await cardTxt(c, '写周报', '.c-next')).endsWith('发出去'), '清单没写字 → 下一步显示第一个没勾的步骤');

  // 去掉刻度：回到只记文字，记录都在
  await c.ev(`${cardOf('写周报')}.click()`);
  await sleep(450);
  await click(c, '#dRmScale');
  await sleep(300);
  await click(c, '#cfYes');
  await sleep(400);
  ok(await c.ev(`document.getElementById('dAdj').hidden`) && !!(await c.ev(`document.getElementById('dAddScale')`)), '去掉清单 → 调整区消失，又能「加一个进度刻度」');
  ok(await c.ev(`Model.logsOf(Store.list, Model.items(Store.list).find(i => i.title === '写周报')).length`) === 1, '去掉刻度不删记录');
  await click(c, '#dClose');
  await sleep(350);
  ok((await cardTxt(c, '写周报', '.c-plus')).startsWith('记'), '去掉后卡片按钮回到「记一笔」');

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

  // 下拉关闭；写了字再拉会先问
  await c.ev(`${cardOf('毕业论文')}.click()`);
  await sleep(500);
  const sh = await c.ev(`(() => { const b = document.getElementById('detSheet').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + 30 }; })()`);
  await touchDrag(c, sh.x, sh.y, sh.x, sh.y + 320, 12, 30);
  await sleep(500);
  ok(await hidden(c, 'detMask'), '详情往下拉 → 关闭');
  await c.ev(`${cardOf('毕业论文')}.click()`);
  await sleep(500);
  await setVal(c, '#dNext', '随手写了点');
  await touchDrag(c, sh.x, sh.y, sh.x, sh.y + 320, 12, 30);
  await sleep(450);
  ok(!(await hidden(c, 'dcMask')) && !(await hidden(c, 'detMask')), '写了字再下拉 → 先问「放弃这次调整？」');
  await click(c, '#dcDrop');
  await sleep(350);
  ok(await hidden(c, 'detMask'), '选放弃 → 关闭');

  // 删除
  await click(c, '[data-tab="paused"]');
  await sleep(200);
  await c.ev(`${cardOf('写周报')}.click()`);
  await sleep(450);
  await click(c, '#dDel');
  await sleep(300);
  ok((await txt(c, '#cfH')).includes('写周报'), '删除确认文案带名字');
  await click(c, '#cfYes');
  await sleep(400);
  ok(await c.ev(`!${cardOf('写周报')}`) && await hidden(c, 'detMask'), '确认后删除');

  // 全站用词不再带场景
  const words = await c.ev(`document.body.innerText + [...document.querySelectorAll('[placeholder]')].map(e => e.placeholder).join('')`);
  ok(!/追剧|看完了|去看|等更新|弃坑|二刷|刷）|季/.test(words), '界面上不再出现看剧专用的词', (words.match(/追剧|看完了|去看|等更新|弃坑|二刷|季/g) || []));
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
      await checkLayout(c, '首页（分组收起）');
      await c.vshot(path.join(SHOTS, tag + '-home.png'));
      await c.ev(`__app.toggleGroup('学习', true); __app.toggleGroup('工作', true)`);
      await sleep(900);
      await checkLayout(c, '首页（分组展开）');
      ok(await c.ev(`[...document.querySelectorAll('.stack')].every(s => { const it = [...s.children]; const last = it[it.length - 1].getBoundingClientRect();
        return last.bottom <= s.getBoundingClientRect().bottom + 1; })`), '展开后每一摞的高度装得下所有卡（不和下面的内容重叠）');
      await c.vshot(path.join(SHOTS, tag + '-home-open.png'));
      await c.ev(`__app.toggleGroup('学习', false); __app.toggleGroup('工作', false)`);
      await sleep(700);
      // 冷落展开
      await click(c, '#staleBtn');
      await sleep(300);
      await checkLayout(c, '冷落展开');
      // 详情
      await c.ev(`__app.toggleGroup('学习', true)`); await sleep(700);   // 这两张在「学习」那一摞里，收起时点了只会展开
      await c.ev(`${cardOf('Python 网课')}.click()`);
      await sleep(500);
      ok(!(await hidden(c, 'detMask')), '详情确实打开了');
      await checkLayout(c, '详情');
      ok((await txt(c, '#dResume')).includes('打开链接'), '详情有「打开链接」');
      ok(/每天约/.test(await txt(c, '#dResume')), '详情显示速度估计', await txt(c, '#dResume'));
      await c.vshot(path.join(SHOTS, tag + '-detail.png'));
      await c.ev(`document.getElementById('detSheet').scrollTop = 99999`);
      await sleep(200);
      await c.vshot(path.join(SHOTS, tag + '-detail-bottom.png'));
      await checkLayout(c, '详情滚到底');
      await click(c, '#dClose'); await sleep(350);
      // 清单详情
      await c.ev(`__app.toggleGroup('工作', true)`); await sleep(700);
      await c.ev(`${cardOf('写周报')}.click()`);
      await sleep(500);
      ok((await c.ev(`document.getElementById('dTitle').value`)) === '写周报', '清单详情确实打开了');
      await checkLayout(c, '清单详情');
      await click(c, '#dClose'); await sleep(350);
      await c.ev(`${cardOf('毕业论文')}.click()`);
      await sleep(500);
      ok(!(await hidden(c, 'detMask')) && (await c.ev(`document.getElementById('dTitle').value`)) === '毕业论文', '只记文字的详情确实打开了');
      await checkLayout(c, '只记文字的详情');
      await c.vshot(path.join(SHOTS, tag + '-detail-free.png'));
      await click(c, '#dAddScale'); await sleep(450);
      await checkLayout(c, '加刻度面板');
      await c.vshot(path.join(SHOTS, tag + '-scale.png'));
      await click(c, '#scCancel'); await sleep(350);
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
      await c.ev(`${cardOf('刷题：数据结构')}.querySelector('.c-plus').click()`);
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

  // 分组和顺序会同步；排序方式、展开状态是各自设备的偏好，不同步
  await A.ev(`(() => { const L = Store.list, its = Model.items(L), t = Date.now();
    Store.commit(l => { Model.setGroup(its.find(i => i.title === '装修预算'), '生活', t);
      Model.reorder(l, [its.find(i => i.title === '刷题：数据结构').id, its.find(i => i.title === '毕业论文').id], t); }); })()`);
  await A.ev(`Store.setPref('sort', 'recent')`);
  await A.ev('Store.syncNow()'); await B.ev('Store.syncNow()');
  const view = s => s.ev(`Model.groupize(Model.sortItems(Store.list, Model.items(Store.list), 'manual')).map(u => u.group ? '[' + u.group + ':' + u.items.map(i => i.title).join('/') + ']' : u.items[0].title).join(' | ')`);
  ok(await view(A) === await view(B) && (await view(B)).includes('[生活:装修预算]'), 'A 改的分组和顺序，B 同步后一样', await view(B));
  ok(await B.ev(`Store.prefs.sort || 'manual'`) === 'manual', 'A 的排序方式不会同步到 B');

  // 删除能同步过去
  await A.ev(`(() => { const it = Model.items(Store.list).find(i => i.title === '《漫长的季节》'); Store.commit(l => SyncCore.markDeleted(l, it.id, Date.now())); })()`);
  await A.ev('Store.syncNow()'); await B.ev('Store.syncNow()');
  ok(await B.ev(`!Model.items(Store.list).some(i => i.title === '《漫长的季节》')`), 'A 删掉的，B 同步后也没了');
  await B.ev('Store.syncNow()'); await A.ev('Store.syncNow()');
  ok(await A.ev(`!Model.items(Store.list).some(i => i.title === '《漫长的季节》')`), '删掉的不会被 B 加回来');

  if (/127\.0\.0\.1|localhost/.test(BASE)) {      // 线上没有 __kv 探针，只在本地测
    const kv = await (await fetch(BASE + '__kv')).json();
    ok(!JSON.stringify(Object.keys(kv)).includes(code), '服务端只存同步码的哈希');
  }
  ok(A.errors.length === 0 && B.errors.length === 0, '没有 JS 报错', A.errors.concat(B.errors));
  A.close(); B.close();
}

/* =============== 4. 分组 + 拖动排序（390） =============== */
const units = c => c.ev(`[...document.querySelectorAll('#list > *')].map(n => n.classList.contains('group')
  ? '[' + n.dataset.group + ':' + [...n.querySelectorAll('.stack .c-title')].map(t => t.textContent).join('/') + ']'
  : n.querySelector('.c-title').textContent).join(' | ')`);
const centerOf = (c, js) => c.ev(`(() => { const el = ${js}; el.scrollIntoView({ block: 'center' });
  const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
const groupHead = name => `[...document.querySelectorAll('#list > .group')].find(g => g.dataset.group === ${JSON.stringify(name)}).querySelector('.g-name')`;
/* 长按 hold 毫秒后再移动：CDP 真实触摸，逐步移动（带间隔，像真手指） */
async function longDrag(c, from, to, opt) {
  opt = opt || {};
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  await sleep(opt.hold || 650);
  const steps = opt.steps || 14;
  for (let i = 1; i <= steps; i++) {
    await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }] });
    await sleep(opt.gap || 25);
  }
  if (opt.beforeEnd) await opt.beforeEnd();
  await c.send('Input.dispatchTouchEvent', { type: opt.cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  await sleep(500);
}

async function groups() {
  console.log('\n[分组 + 拖动排序 390×844]');
  const c = await open(390, 844, 2);
  await c.goto(BASE);
  await c.ev('localStorage.clear()');
  await c.ev(SEED);
  await c.ev(`localStorage.setItem('pickup.prefs', JSON.stringify({ hintDrag: 1 }))`);   // 首次提示另外测
  await c.goto(BASE);
  await sleep(900);

  ok((await units(c)) === '[学习:毕业论文/概率论复习/Python 网课] | [工作:排查登录超时/写周报] | 刷题：数据结构 | 装修预算', '同组聚成一摞，默认自定义顺序', await units(c));
  ok(await c.ev(`!document.querySelector('.group[data-group="学习"] .stack').classList.contains('is-open')`), '分组默认收起');
  ok(await c.ev(`!document.getElementById('tags')`), '标签筛选条已经去掉');

  // 收起的一摞：点卡片 / 点 +1 都只是展开，不打开详情、不记录
  const logs0 = await c.ev(`Store.list.filter(e => e.type === 'log').length`);
  await c.ev(`document.querySelector('.group[data-group="学习"] .stack-item .c-plus').click()`);
  await sleep(700);
  ok(await c.ev(`document.querySelector('.group[data-group="学习"] .stack').classList.contains('is-open')`), '点收起的一摞 → 展开');
  ok(await hidden(c, 'noteMask') && await hidden(c, 'detMask') && (await c.ev(`Store.list.filter(e => e.type === 'log').length`)) === logs0, '收起时点到的 +1 / 记一笔 不生效');
  ok(await c.ev(`JSON.parse(localStorage.getItem('pickup.prefs')).expanded.includes('学习')`), '展开状态记在本机偏好里');
  const tops = await c.ev(`[...document.querySelectorAll('.group[data-group="学习"] .stack-item')].map(i => Math.round(i.getBoundingClientRect().top))`);
  ok(tops[0] < tops[1] && tops[1] < tops[2], '展开后三张依次往下排开', tops);

  // 收起的一摞不能左滑
  const work = await centerOf(c, `document.querySelector('.group[data-group="工作"] .stack-item .card')`);
  await touchDrag(c, work.x + 60, work.y, work.x - 170, work.y, 10, 16);
  await sleep(400);
  ok(await c.ev(`!document.querySelector('.lsw-acts.is-open')`), '收起的一摞不能左滑');

  // 顶层拖动：「装修预算」拖到「刷题」上面
  const a = await centerOf(c, `${cardOf('装修预算')}`);
  const b = await c.ev(`(() => { const r = ${cardOf('刷题：数据结构')}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 10 }; })()`);
  await longDrag(c, a, b);
  ok((await units(c)).endsWith('装修预算 | 刷题：数据结构'), '长按拖动：装修预算 挪到 刷题 上面', await units(c));
  ok(await hidden(c, 'detMask'), '拖完松手不会打开详情');
  const orderSaved = await c.ev(`(() => { const L = JSON.parse(localStorage.getItem('pickup.v1')).filter(e => e.type === 'item' && !e.deletedAt);
    const o = t => L.find(i => i.title === t).order; return o('装修预算') < o('刷题：数据结构'); })()`);
  ok(orderSaved, '新顺序写进了本地数据（order 字段）');

  // 组内拖动：Python 网课 拖到最前
  const py = await centerOf(c, `${cardOf('Python 网课')}`);
  const first = await c.ev(`(() => { const r = ${cardOf('毕业论文')}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 5 }; })()`);
  await longDrag(c, py, first, { steps: 18 });
  ok((await units(c)).startsWith('[学习:Python 网课/毕业论文/概率论复习]'), '展开的组里拖动：Python 网课 到最前', await units(c));

  // 整组拖动：长按「工作」标题拖到「学习」上面
  const wh = await centerOf(c, groupHead('工作'));
  const lh = await c.ev(`(() => { const r = ${groupHead('学习')}.getBoundingClientRect(); return { x: r.left + 20, y: r.top - 10 }; })()`);
  await longDrag(c, wh, lh, { steps: 20 });
  ok((await units(c)).startsWith('[工作:排查登录超时/写周报] | [学习:'), '长按组标题 → 整组挪到最前，组内先后不变', await units(c));

  // 拖到屏幕底边 → 页面自动往下滚
  await c.ev('window.scrollTo(0, 0)');
  await sleep(200);
  const top1 = await c.ev(`(() => { const r = document.querySelector('#list > .group .g-name').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
  const y0 = await c.ev('window.scrollY');
  const before = await units(c);
  let y1 = 0;
  await longDrag(c, top1, { x: top1.x, y: 830 }, { steps: 10, cancel: true, beforeEnd: async () => { await sleep(900); y1 = await c.ev('window.scrollY'); } });
  ok(y1 > y0 + 100, '拖到屏幕底边会自动往下滚', { y0, y1 });
  ok((await units(c)) === before, '拖动被系统打断（touchcancel）→ 顺序不变、全部复原', await units(c));
  ok(await c.ev(`!document.body.classList.contains('dragging') && !document.querySelector('.drag-lift')`), '打断后拖动状态清干净');

  // 非自定义顺序：长按给提示，点「切过去」
  await click(c, '#sortBtn');
  await sleep(350);
  await click(c, '#sortList [data-sort="recent"]');
  await sleep(450);
  ok(await c.ev(`JSON.parse(localStorage.getItem('pickup.prefs')).sort`) === 'recent', '排序切到「最近碰过」');
  const any = await centerOf(c, `document.querySelector('#list > .card')`);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [any] });
  await sleep(650);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  ok((await txt(c, '#toastTxt')).includes('自定义顺序'), '非自定义顺序下长按 → 提示', await txt(c, '#toastTxt'));
  await toastBtn(c, '切过去');
  await sleep(300);
  ok(await c.ev(`JSON.parse(localStorage.getItem('pickup.prefs')).sort`) === 'manual', '点「切过去」→ 回到自定义顺序');

  // 详情里选分组：刷题 → 学习
  await c.ev(`${cardOf('刷题：数据结构')}.click()`);
  await sleep(450);
  await click(c, '#dGroup');
  await sleep(350);
  ok(await c.ev(`[...document.querySelectorAll('#grpList .chip')].map(b => b.textContent).join(',')`) === '不分组,工作,学习', '分组面板列出 不分组 + 已有分组');
  await c.ev(`[...document.querySelectorAll('#grpList .chip')].find(b => b.textContent === '学习').click()`);
  await sleep(400);
  ok((await txt(c, '#dGroup .v')) === '学习', '详情里分组显示「学习」');
  await click(c, '#dClose');
  await sleep(350);
  ok((await units(c)).includes('刷题：数据结构]'), '刷题 进了学习这一组', await units(c));

  // 新建分组
  await c.ev(`${cardOf('装修预算')}.click()`);
  await sleep(450);
  await click(c, '#dGroup');
  await sleep(350);
  await setVal(c, '#grpNew', '生活');
  await click(c, '#grpAdd');
  await sleep(400);
  await click(c, '#dClose');
  await sleep(350);
  ok((await units(c)).includes('[生活:装修预算]'), '新建分组「生活」并放进去', await units(c));

  // 分组菜单：改名成已有的名字 = 合并
  await c.ev(`[...document.querySelectorAll('#list > .group')].find(g => g.dataset.group === '生活').querySelector('.g-more').click()`);
  await sleep(350);
  await setVal(c, '#gmName', '工作');
  ok(!(await hidden(c, 'gmMerge')), '改成已有的名字 → 提示会合并');
  await click(c, '#gmRename');
  await sleep(400);
  ok((await units(c)).includes('[工作:排查登录超时/写周报/装修预算]'), '合并后「工作」有 3 件', await units(c));
  // 解散
  await c.ev(`[...document.querySelectorAll('#list > .group')].find(g => g.dataset.group === '工作').querySelector('.g-more').click()`);
  await sleep(350);
  await click(c, '#gmDissolve');
  await sleep(400);
  ok(!(await units(c)).includes('[工作:') && (await units(c)).includes('排查登录超时'), '解散后组没了，里面的事还在');
  // 连同删除
  const n0 = await c.ev(`Model.items(Store.list).length`);
  await c.ev(`[...document.querySelectorAll('#list > .group')].find(g => g.dataset.group === '学习').querySelector('.g-more').click()`);
  await sleep(350);
  await click(c, '#gmDelete');
  await sleep(300);
  ok((await txt(c, '#cfH')).includes('学习'), '连同删除要二次确认，文案带组名');
  await click(c, '#cfYes');
  await sleep(450);
  ok((await c.ev(`Model.items(Store.list).length`)) === n0 - 4 && !(await units(c)).includes('[学习:'), '确认后整组 4 件都删了', n0);
  ok(c.errors.length === 0, '没有 JS 报错', c.errors);
  c.close();

  // 旧数据迁移：tags → group，并且写回本地
  console.log('\n[标签 → 分组 迁移]');
  const d = await open(390, 844, 1);
  await d.goto(BASE);
  await d.ev('localStorage.clear()');
  await d.ev(`localStorage.setItem('pickup.v1', JSON.stringify([
    { id: 'old1', type: 'item', title: '旧的一件', kind: 'free', status: 'active', round: 1, tags: ['工作', '重要'], createdAt: 1, updatedAt: 1, order: 1 },
    { id: 'old2', type: 'item', title: '旧的两件', kind: 'free', status: 'active', round: 1, tags: [], createdAt: 2, updatedAt: 2, order: 2 }]))`);
  await d.goto(BASE);
  await sleep(700);
  const saved = await d.ev(`JSON.parse(localStorage.getItem('pickup.v1'))`);
  ok(saved[0].group === '工作' && !('tags' in saved[0]) && saved[0].updatedAt > 1, '旧标签变成分组、写回本地、updatedAt 更新（会同步出去）', saved[0]);
  ok(saved[1].group === '' && !('tags' in saved[1]), '没有标签的变成不分组');
  ok((await units(d)).includes('[工作:旧的一件]'), '首页按分组显示');
  ok(d.errors.length === 0, '没有 JS 报错', d.errors);
  d.close();
}

(async () => {
  const only = process.argv[2];
  try {
    if (!only || only === 'flow') await flow();
    if (!only || only === 'sync') await syncTest();
    if (!only || only === 'groups') await groups();
    if (!only || only === 'layout') await layouts();
  } catch (e) { fail++; console.log('✗ 脚本异常：' + (e && e.stack || e)); }
  console.log('\n' + pass + ' 过 / ' + fail + ' 失败   （本次浏览器前缀 ' + RUN_PREFIX + '）');
  process.exit(fail ? 1 : 0);
})();
