/* 造一批演示数据：大部分只记文字；数字刻度（单层 / 两层 / 带时间点 / %）和清单只是其中几件；还有暂停、冷落 */
const SEED = `(() => {
  const M = Model, t = Date.now(), D = 864e5, L = [];
  const add = (title, ago, scale, f) => { const it = M.newItem(title, t - ago, L); L.push(it); if (scale) M.setScale(L, it, scale, t - ago); if (f) f(it); return it; };
  add('毕业论文', 20 * D, null, it => {
    M.stop(L, it, {}, { note: '第二章文献综述写完初稿', next: '补 3 篇 2024 年以后的文献' }, t - 3 * D);
    M.stop(L, it, {}, { note: '找到两篇，第三篇还没找到合适的', next: '去知网按「多模态 检索」再搜一轮，然后开始写第三章方法部分' }, t - 5 * 3600e3);
    it.group = '学习'; });
  add('排查登录超时', 2 * D, null, it => {
    M.stop(L, it, {}, { note: '已排除网络和数据库，怀疑是 token 缓存过期时间配错', next: '看 redis 里 session 的 TTL' }, t - 26 * 3600e3); it.group = '工作'; });
  add('概率论复习', 40 * D, { type: 'counter', levels: [{ unit: '章', total: 8 }, { unit: '页', total: null }] }, it => {
    M.stop(L, it, { pos: [3, 42] }, { note: '条件概率例题 3 没看懂', next: '先翻讲义再做例题 3' }, t - 30 * D); it.group = '学习'; });
  add('写周报', 3 * D, { type: 'checklist' }, it => { ['收集本周数据', '写初稿', '发给组长'].forEach(x => M.addStep(it, x, t - 3 * D));
    M.stop(L, it, { checked: [it.steps[0].id] }, '', t - 3600e3); it.group = '工作'; });
  add('Python 网课', 10 * D, { type: 'counter', levels: [{ unit: '节', total: 48 }], hasTime: true }, it => {
    it.link = 'https://example.com/course';
    M.stop(L, it, { pos: [9] }, '', t - 6 * D); M.stop(L, it, { pos: [10] }, '', t - 4 * D);
    M.stop(L, it, { pos: [12], time: 510 }, { note: '', next: '装饰器那节从 8:30 接着看' }, t - 20 * 60e3); it.group = '学习'; });
  add('刷题：数据结构', 5 * D, { type: 'counter', levels: [{ unit: '题', total: 200 }] }, it => { M.stop(L, it, { pos: [37] }, '', t - 26 * 3600e3); });
  add('装修预算', 8 * D, { type: 'counter', levels: [{ unit: '%', total: 100 }] }, it => { M.stop(L, it, { pos: [60] }, { note: '水电报价拿到了', next: '问木工报价' }, t - 2 * D); });
  add('《漫长的季节》', 60 * D, { type: 'counter', levels: [{ unit: '集', total: 12 }], hasTime: true }, it => { M.stop(L, it, { pos: [7], time: 1394 }, '', t - 50 * D); it.status = 'paused'; });
  localStorage.setItem('pickup.v1', JSON.stringify(L));
  return L.length;
})()`;
module.exports = { SEED };
