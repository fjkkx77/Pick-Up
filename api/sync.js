/**
 * 接着来 · 跨设备同步接口
 * 改编自日程卡片（Schedule-Cards）的 api/sync.js，协议相同，只是数据字段叫 items。
 *
 * 存储用 Upstash Redis 的 REST 接口，整个文件零依赖（Node 自带 fetch + crypto）。
 * 环境变量两套命名都兼容：
 *   KV_REST_API_URL / KV_REST_API_TOKEN
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *
 * 接口：
 *   GET  /api/sync                 → 探测：这个部署是否配好了同步
 *   GET  /api/sync?code=xxxx       → 取回该同步码下的数据 {ok, version, doc:{items}}
 *   POST /api/sync  {code, baseVersion, doc:{items}}
 *        → baseVersion 与服务端当前版本一致才写入；不一致返回 409 + 服务端最新数据
 */

const crypto = require("crypto");

/* 上限的来历（2026-09-24 查官方文档）：Vercel 函数请求/响应体最大 4.5MB，
   Upstash 免费版单次请求最大 10MB。取 3MB 给响应里的其它字段留余量。
   每次 +1 都会新增一条记录（约 200~300 字节），3MB ≈ 一万多条，天天用也够好几年 */
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_ITEMS = 20000;
const TTL_SECONDS = 400 * 24 * 3600; /* 每次写入续期，长期不用才自动过期 */

function creds(){
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return (url && token) ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redis(command){
  const c = creds();
  const r = await fetch(c.url, {
    method: "POST",
    headers: { Authorization: "Bearer " + c.token, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  if(!r.ok){
    const t = await r.text().catch(() => "");
    throw new Error("存储服务返回 " + r.status + " " + t.slice(0, 200));
  }
  const j = await r.json();
  return j.result;
}

/* 同步码本身不落库，只存它的哈希，拿到数据库也反推不出同步码。
   前缀和盐都跟日程卡片不同：两个站可能共用一个 Redis 库，互不串数据 */
function keyOf(code){
  return "pickup:" + crypto.createHash("sha256").update("puv1|" + code).digest("hex").slice(0, 40);
}

function cleanCode(v){
  const s = String(v == null ? "" : v).trim();
  return /^[A-Za-z0-9\-_]{8,64}$/.test(s) ? s : null;
}

function send(res, status, obj){
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  try{
    if(req.method === "OPTIONS"){ res.status(204); res.end(); return; }

    const configured = !!creds();

    if(req.method === "GET"){
      const raw = (req.query && req.query.code) || "";
      if(!raw) return send(res, 200, { ok: true, configured });   /* 探测用 */
      if(!configured) return send(res, 503, { ok: false, error: "服务端还没配置存储（缺少 Upstash 环境变量）" });

      const code = cleanCode(raw);
      if(!code) return send(res, 400, { ok: false, error: "同步码只能是 8~64 位的字母、数字、- 或 _" });

      const val = await redis(["GET", keyOf(code)]);
      if(!val) return send(res, 200, { ok: true, version: 0, doc: { items: [] }, empty: true });

      let parsed;
      try{ parsed = JSON.parse(val); }
      catch(e){ return send(res, 500, { ok: false, error: "服务端数据损坏" }); }
      return send(res, 200, {
        ok: true,
        version: parsed.version || 0,
        updatedAt: parsed.updatedAt || 0,
        doc: { items: Array.isArray(parsed.items) ? parsed.items : [] }
      });
    }

    if(req.method === "POST"){
      if(!configured) return send(res, 503, { ok: false, error: "服务端还没配置存储（缺少 Upstash 环境变量）" });

      let body = req.body;
      if(typeof body === "string"){
        try{ body = JSON.parse(body); }catch(e){ return send(res, 400, { ok:false, error:"请求体不是合法 JSON" }); }
      }
      if(!body || typeof body !== "object") return send(res, 400, { ok: false, error: "缺少请求体" });

      const code = cleanCode(body.code);
      if(!code) return send(res, 400, { ok: false, error: "同步码只能是 8~64 位的字母、数字、- 或 _" });

      const items = body.doc && Array.isArray(body.doc.items) ? body.doc.items : null;
      if(!items) return send(res, 400, { ok: false, error: "缺少 doc.items" });
      if(items.length > MAX_ITEMS) return send(res, 413, { ok: false, error: "条目数超过上限 " + MAX_ITEMS });

      const payload = JSON.stringify({ items });
      if(Buffer.byteLength(payload, "utf8") > MAX_BODY_BYTES){
        return send(res, 413, { ok: false, error: "数据超过 3MB 上限" });
      }

      const key = keyOf(code);
      const cur = await redis(["GET", key]);
      let curVersion = 0, curDoc = { items: [] };
      if(cur){
        try{
          const p = JSON.parse(cur);
          curVersion = p.version || 0;
          curDoc = { items: Array.isArray(p.items) ? p.items : [] };
        }catch(e){ /* 坏数据直接当作空，让这次写入覆盖掉 */ }
      }

      const base = Number(body.baseVersion || 0);
      if(base !== curVersion){
        /* 另一台设备抢先写了：把最新版还给客户端，让它重新合并后再来一次 */
        return send(res, 409, { ok: false, conflict: true, version: curVersion, doc: curDoc });
      }

      const next = { version: curVersion + 1, updatedAt: Date.now(), items };
      await redis(["SET", key, JSON.stringify(next), "EX", String(TTL_SECONDS)]);
      return send(res, 200, { ok: true, version: next.version, updatedAt: next.updatedAt });
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { ok: false, error: "只支持 GET / POST" });
  }catch(err){
    return send(res, 500, { ok: false, error: String(err && err.message || err) });
  }
};
