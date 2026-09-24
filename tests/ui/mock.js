/* 本地测试服务器：静态文件 + 真实的 api/sync.js（接一个内存版的 Upstash REST 替身）
   node tests/ui/mock.js <站点目录> <端口> [--no-redis]
   改编自 references/组件_浏览器验证脚手架/mock.js：那边的 /api 是日程卡片专用的假接口，
   这里换成直接跑项目自己的 api/sync.js，服务端代码也一起被测到。 */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.argv[2], PORT = +(process.argv[3] || 8841);
const NO_REDIS = process.argv.includes('--no-redis');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const kv = {};   // 内存 Redis
if (!NO_REDIS) {
  process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:' + PORT + '/__redis';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'local-test';
}
const handler = require(path.join(ROOT, 'api', 'sync.js'));

function readBody(q) { return new Promise(r => { let b = ''; q.on('data', d => b += d); q.on('end', () => r(b)); }); }

http.createServer(async (q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/__redis') {
    const cmd = JSON.parse(await readBody(q) || '[]');
    let result = null;
    if (cmd[0] === 'GET') result = kv[cmd[1]] == null ? null : kv[cmd[1]];
    if (cmd[0] === 'SET') { kv[cmd[1]] = cmd[2]; result = 'OK'; }
    s.writeHead(200, { 'content-type': 'application/json' });
    return s.end(JSON.stringify({ result }));
  }
  if (u.pathname === '/__kv') {          // 测试脚本用来看服务端存了什么
    s.writeHead(200, { 'content-type': 'application/json' });
    return s.end(JSON.stringify(kv));
  }
  if (u.pathname === '/api/sync') {
    const raw = await readBody(q);
    const req = { method: q.method, query: Object.fromEntries(u.searchParams), body: raw || undefined, headers: q.headers };
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { s.setHeader(k, v); },
      end(b) { s.statusCode = this.statusCode; s.end(b); }
    };
    return handler(req, res);
  }
  let rel; try { rel = decodeURIComponent(u.pathname); } catch (_) { rel = u.pathname; }
  let f = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  try { if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch (_) {}
  fs.readFile(f, (e, d) => {
    if (e) { s.writeHead(404); return s.end('404'); }
    s.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    s.end(d);
  });
}).listen(PORT, () => console.log('mock on ' + PORT + (NO_REDIS ? '（无存储）' : '')));
