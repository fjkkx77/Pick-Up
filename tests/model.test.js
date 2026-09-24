/* Node 跑数据逻辑自检：node tests/model.test.js，退出码 0 = 全过 */
globalThis.window = globalThis;
require('../assets/sync-core.js');
require('../assets/model.js');
require('./model.cases.js');

let pass = 0, fail = 0;
const eq = (a, b) => { if (a !== b) throw new Error('期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)); };
const ok = (v, msg) => { if (!v) throw new Error(msg || '断言为假'); };
const t = (name, fn) => {
  try { fn(); pass++; console.log('✓ ' + name); }
  catch (e) { fail++; console.log('✗ ' + name + '\n    ' + e.message); }
};
window.MODEL_CASES(window.Model, window.SyncCore, t, eq, ok);
console.log('\n' + pass + ' 过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
