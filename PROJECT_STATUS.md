# PROJECT_STATUS · 接着来

> 跨会话交接用。换会话接手这个项目，先读这份，再读 README 和 `docs/superpowers/specs/`。
> 最后更新：2026-09-24

## 现状

- **已上线**：https://pick-up-inky.vercel.app/ （Vercel 项目 `pick-up`，团队 `goghv739-9607s-projects`，已关联 GitHub，push 即部署——2026-09-24 实测自动部署生效）
- 仓库：`fjkkx77/Pick-Up`（public），本地 `Desktop\AI\VibeCoding\接着来\`，分支 `main`
- 自有域名 `jzl.wbztl.xyz`：**Vercel 侧已加好，DNSPod 的 CNAME 还没加**（值见 README 末尾）
- 测试：`tests/model.test.js` 36 条、`tests/ui/flow.js` 394 条（功能 27 + 同步 13 + 布局 354），全绿

## 用户给的约束（不写在代码里）

- 用户原始痛点四个都有：忘位置 / 忘思路 / 忘了这件事 / 嫌记录麻烦——**每个新功能先问它服务哪一条**
- 手机和电脑都用 → 同步是刚需；用户选了「同步码免登录」而不是账号（怕记录门槛高）
- 用户授权「怎么合理怎么来，只负责最后验收」；真机手感未验（见 README 第四节）

## 关键决策（改之前先想清楚）

1. **位置由记录推导，不存在 item 上**：两台设备离线各 +1 时，逐条 last-write-wins 会丢一边。记录只追加、撤销 = 墓碑。
2. **item 和 log 放同一个列表**（`type` 区分）：直接复用存档同步内核的 `syncOnce`，不用改内核。
3. **走不动时不猜**：外层总数未知时 +1 到头 → 等更新 + 让用户点「进入下一季」；全部到头也不自动完成。
4. **冷落 14 天、速度窗口 30 天**是没有依据的起步值——用户用一段时间后按实际节奏调。
5. Upstash 与日程卡片共用（键前缀 `pickup:` + 盐 `puv1|`）。**日程卡片那边的 Upstash 集成如果轮换令牌，这边会断**——要去 Vercel 更新 `pick-up` 的两个环境变量。
6. 服务端上限 3MB / 20000 条：依据是 Vercel 函数请求体 4.5MB、Upstash 单请求 10MB（2026-09-24 查官方文档）。

## 待办（按价值排）

- [ ] DNSPod 加 CNAME `jzl → cdb929a3f1cb535c.vercel-dns-017.com`，然后 `vercel domains verify jzl.wbztl.xyz`
- [ ] 用户真机验收：键盘弹出、左滑/下拉手感、相机扫码接入、不挂代理能否打开
- [ ] 添加到主屏幕：现在只有 `icon.svg`，iOS 需要 180×180 的 `apple-touch-icon.png`；没做 manifest
- [ ] 记录越积越多：3MB 上限大约一万多条；真到那一步再做「旧记录压缩」（同一项只保留每天最后一条）

## 部署注意

- **别在工作区直接 `vercel deploy`**：`vercel link` 会在工作区生成 `.env.local`（已 gitignore，本次已删）。手动部署从 `git archive HEAD | tar -x` 的干净导出里跑，并先删掉导出目录里被 link 生成的 `.env.local`。
- `.vercelignore` 排除了 `tests/ui`、`docs`、`.env*`；部署后核 `/.env.local` 应 404。
