# 「接着来」实施计划

> 用户授权"怎么合理怎么来、只负责最后验收"，本计划由我自己在当前会话内顺序执行（不派子代理）。
> 设计稿：`docs/superpowers/specs/2026-09-24-jiezhelai-design.md`

**Goal:** 手机优先的进度记录站：结构化位置 + 断点笔记 + 冷落提醒 + 同步码多设备同步。

**Architecture:** 纯静态前端（无构建）+ Vercel 函数 `api/sync.js` + Upstash Redis。
数据逻辑 `assets/model.js` 是纯函数（浏览器和 Node 都能加载），先写测试再写实现。
项目与记录放同一个列表（`type` 区分），直接复用存档同步内核 `sync-core.js`。

**已查证的外部限制（2026-09-24 官方文档）：**
- Vercel 函数请求/响应体上限 4.5 MB（vercel.com/docs/functions/limitations）
- Upstash 免费版单次请求 10 MB、单条记录 100 MB（upstash.com/docs/redis/troubleshooting/*）
- → 服务端上限定为 3 MB / 20000 条（留足余量；一条记录约 200~300 字节）

---

### Task 1：脚手架
- 建 `assets/`、`api/`、`tests/`、`.gitignore`（`.vercel`、`.env*`）
- 复制 `references/组件_多设备同步/sync-core.js` → `assets/sync-core.js`（不改）
- `api/sync.js` 从日程卡片改编：key 前缀 `pickup:`、盐 `puv1|`、`doc.events` → `doc.items`、上限 3MB/20000
- 提交

### Task 2：model.js（TDD）
测试 `tests/model.test.js`（Node 直接跑）+ `tests/model.html`（双击跑同一套）。先写全部用例、跑红、再实现、跑绿。
用例覆盖：
1. `parseTime`：`2314`→1394、`10530`→3930、`23:14`、`1:05:30`、非法返回 null；`fmtTime` 反向
2. `currentLog`：按 at→id 取最新、忽略墓碑、只看当前 round
3. `bump`（+1）：无记录→各层 1；内层未知总数一直加；内层到头+外层已知未到头→进位；外层未知→等更新+`needNextOuter`；全部到头→等更新+`canFinish`；时间点清空；`prevStatus` 写入
4. `undo`：打墓碑 + 状态还原
5. 两设备离线各 +1 → `mergeEvents` 后两条都在，当前位置取较新
6. `setTotal` 让等更新回到进行中
7. `startRound`：round+1，位置回到「还没开始」
8. `pace`：记录少于 3 条或跨度 < 2 天返回 null；否则给出每天推进量与剩余天数
9. `isStale`：active 且超过阈值
10. `posLabel`：「S3 · 第 7 集 · 23:14」等展示文案
11. checklist：`checked` 快照、完成度
- 提交

### Task 3：store.js
- localStorage 键 `pickup.v1`；偏好（同步码、阈值、当前标签）单独存 `pickup.prefs`，不同步
- 同步调度：防抖 600ms、`syncBusy/syncAgain`、`visibilitychange`/`pagehide` 冲刷、每 30s（可见时）、`online` 时
- URL `#sync=CODE` 读入后立刻抹掉地址栏（二维码搬设置的约定）
- 导出 / 导入 JSON（导入走 merge，不覆盖）
- 提交

### Task 4：界面
- `index.html` + `assets/app.css` + `assets/app.js`
- 首页：顶栏（站名 + 同步状态 + 设置）→ 冷落提醒条 → 状态标签（分段）→ 卡片列表 → 右下「＋」
- 卡片：标题 / 位置大字 / 最新笔记 / 相对时间 / 右侧 +1；左滑 暂停(继续)/完成/删除
- 提示条：`已记到… · 撤销 · 写两句`，5 秒；特殊态给「进入下一季」「标记为看完了」
- 详情 sheet：接着来卡片、位置调节、时间输入、清单、「停在这里」→ 笔记输入、历史、设置
- 新建 sheet：名字 + 模板，focus 同步调用
- 设置 sheet：同步码（生成/输入/二维码）、冷落阈值、导出导入
- 手势从存档搬：`SwipeActions`、`SheetDismiss`、下拉刷新
- 动效按观感配方：材质、按压、入场、回弹曲线；`prefers-reduced-motion`
- 深浅色；安全区；44px 热区；输入框 16px
- 提交

### Task 5：浏览器验证
- 用 `references/组件_浏览器验证脚手架`，脚本放项目 `tests/ui/`（不放 temp）
- 320 / 390 / 430 / 1707 × 浅深：横向溢出、热区 ≥44、文字不被截断
- 流程：新建→+1→撤销→写两句→详情调位置→停在这里→历史删除→左滑完成→标签切换→冷落条
- 同步：本地 mock 服务端（内存）双页面对拉
- 收尾核残留浏览器（只按 RUN_PREFIX）
- 提交

### Task 6：上线
- `gh repo create fjkkx77/Pick-Up --public`，推送
- Vercel 新项目 `pick-up`；Upstash 复用日程卡片那个库（不同 key 前缀），环境变量从日程卡片项目拉取后加到新项目，**不落盘进仓库**
- 从 `git archive` 干净导出部署；线上核：页面、`/api/sync` 探测 configured、真实两端同步
- 域名：沿用 `*.wbztl.xyz` 习惯需在 DNSPod 加记录——外部 DNS 操作，先不做，交付时问用户

### Task 7：收尾
- README（怎么用 + 已验证/未验证）、PROJECT_STATUS.md
- 记忆：新增项目条目、登记可复用资产、更新同步配方复用记录
- 清理临时文件、核残留进程
