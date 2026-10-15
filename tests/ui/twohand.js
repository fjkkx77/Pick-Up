/* 拖动排序的两样配套（drag.js v2，2026-10-15）：一只手拖、另一只手滑页面 / 拖到屏幕边缘自动滚 / 松手弹簧落位
   先起服务：node tests/ui/mock.js <项目目录> 8841
   再跑：    node tests/ui/twohand.js            退出码 0 = 全过
   CDP 两个坑：touchEnd 里列的是「抬起的那几根」手指；Chrome 会吞掉起手 15px 内的 touchmove（iOS 没这层） */
const { open, sleep } = require('./cdp.js');
const BASE = process.env.PU_URL || 'http://127.0.0.1:8841/';
let pass = 0, fail = 0;
const ok = (c, n, x) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ ') + n + (!c && x !== undefined ? '  → ' + JSON.stringify(x) : '')); };
const P = (id, x, y) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 });

// 12 件不分组的事，页面够长
const SEED = `(() => { const M = Model, t = Date.now(), L = [];
  for (let i = 1; i <= 12; i++) { const it = M.newItem('事项' + String(i).padStart(2, '0'), t - i * 6e4, L); L.push(it); }
  localStorage.setItem('pickup.v1', JSON.stringify(L)); return L.length; })()`;
const TOP = `[...document.querySelectorAll('#list > .card, #list > .lsw-item > .card, #list > *')].map(n => { const c = n.matches('.card') ? n : n.querySelector('.card'); return c && c.querySelector('.c-title') ? c.querySelector('.c-title').textContent.trim() : null; }).filter(Boolean)`;

(async () => {
  const c = await open(390, 700, 2);
  const t = (type, pts) => c.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  try {
    await c.goto(BASE);
    await c.ev('localStorage.clear()');
    await c.ev(SEED);
    await c.ev(`localStorage.setItem('pickup.prefs', JSON.stringify({ hintDrag: 1 }))`);
    await c.goto(BASE);
    await sleep(900);
    const order0 = await c.ev(TOP);
    ok(order0.length === 12, '12 件都画出来了', order0);
    const cardOf = title => `[...document.querySelectorAll('#list .card')].find(n => n.querySelector('.c-title') && n.querySelector('.c-title').textContent.trim() === ${JSON.stringify(title)})`;
    const st = title => c.ev(`({drag: document.body.classList.contains('dragging'), y: Math.round(scrollY), top: Math.round(${cardOf(title)}.getBoundingClientRect().top)})`);
    const pick = async (title, scroll) => {
      await c.ev(`window.scrollTo(0, ${scroll || 0})`); await sleep(250);
      const r = await c.ev(`(() => { const r = ${cardOf(title)}.getBoundingClientRect(); return { x: r.left + 60, y: r.top + r.height / 2 }; })()`);
      await t('touchStart', [P(0, r.x, r.y)]); await sleep(650);
      return r;
    };
    const first = order0[0];

    console.log('\n[一只手拖、另一只手滑页面]');
    let r = await pick(first); let s0 = await st(first);
    ok(s0.drag, '长按拿起来了', s0);
    await t('touchStart', [P(0, r.x, r.y), P(1, 330, 620)]);
    for (let i = 1; i <= 15; i++) { await t('touchMove', [P(0, r.x, r.y), P(1, 330, 620 - 20 * i)]); await sleep(30); }
    await sleep(150);
    let s1 = await st(first);
    ok(s1.y - s0.y >= 295 && s1.y - s0.y <= 305, `第二根手指推 300px：页面滚了 ${s1.y - s0.y}px`, { s0, s1 });
    ok(Math.abs(s1.top - s0.top) <= 2, '被拖那张一直贴在第一根手指下', { s0, s1 });
    await t('touchEnd', [P(1, 330, 320)]); await sleep(200);
    ok((await st(first)).drag, '抬起第二根：还拿着（不算松手）');
    const atRelease = (await st(first)).top;
    await t('touchEnd', [P(0, r.x, r.y)]);
    const track = [atRelease];
    for (let i = 0; i < 40; i++) { await sleep(16); track.push((await st(first)).top); }
    await sleep(600);
    const o1 = await c.ev(TOP);
    ok(o1.indexOf(first) >= 2, `抬起拖的那根：落到页面滚过去的位置（第 ${o1.indexOf(first) + 1} 位）`, o1);
    const total = Math.abs(track[track.length - 1] - atRelease);
    let big = 0; for (let i = 1; i < track.length; i++) big = Math.max(big, Math.abs(track[i] - track[i - 1]));
    ok(total < 3 || big / total <= 0.4, `松手滑进格位（最大一帧 ${total ? Math.round(big / total * 100) : 0}% 总位移 ${Math.round(total)}px，瞬移是 100%）`, track.slice(0, 8));
    const saved = await c.ev(`(() => { const L = JSON.parse(localStorage.getItem('pickup.v1')).filter(e => e.type === 'item' && !e.deletedAt).sort((a, b) => a.order - b.order); return L.map(i => i.title); })()`);
    ok(JSON.stringify(saved) === JSON.stringify(o1), '新顺序写进了本地数据', { saved, o1 });

    console.log('\n[第二根手指甩一下：带惯性]');
    const o2 = await c.ev(TOP);
    r = await pick(o2[0]);
    await t('touchStart', [P(0, r.x, r.y), P(1, 330, 620)]);
    for (let i = 1; i <= 6; i++) { await t('touchMove', [P(0, r.x, r.y), P(1, 330, 620 - 40 * i)]); await sleep(16); }
    const a = await st(o2[0]);
    await t('touchEnd', [P(1, 330, 380)]); await sleep(700);
    const b = await st(o2[0]);
    ok(b.drag && b.y > a.y + 40, `松开后惯性又滑了 ${b.y - a.y}px，仍拿着`, { a, b });
    await t('touchEnd', [P(0, r.x, r.y)]); await sleep(1100);

    console.log('\n[拖到屏幕边缘自动滚]');
    const o3 = await c.ev(TOP);
    const maxY = await c.ev(`document.documentElement.scrollHeight - innerHeight`);
    r = await pick(o3[0]);
    for (let i = 1; i <= 10; i++) { await t('touchMove', [P(0, r.x, r.y + (685 - r.y) * i / 10)]); await sleep(20); }
    const e1 = await st(o3[0]); await sleep(800); const e2 = await st(o3[0]);
    ok(e2.y - e1.y > 200, `停在底边 0.8 秒：页面自己滚了 ${e2.y - e1.y}px`, { e1, e2 });
    await sleep(4000);
    const e3 = await st(o3[0]);
    ok(e3.y <= maxY + 1, `一直停在底边：滚到拿起时的页面底就停（${e3.y} ≤ ${maxY}）`, e3);
    await t('touchMove', [P(0, r.x, 350)]); await sleep(100);
    const e4 = await st(o3[0]); await sleep(400); const e5 = await st(o3[0]);
    ok(e5.y === e4.y, '手指回到屏幕中间：停了', { e4, e5 });
    await t('touchEnd', [P(0, r.x, 350)]); await sleep(1100);
    ok(!(await c.ev(`document.body.classList.contains('dragging')`)), '松手：放下了');
    ok(c.errors.length === 0, '没有 JS 报错', c.errors);
  } finally { await c.close(); }
  console.log(`\n${pass} 过 / ${fail} 失败`);
  await sleep(1500); process.exit(fail ? 1 : 0);
})().catch(async e => { console.error(e); await sleep(1500); process.exit(2); });
