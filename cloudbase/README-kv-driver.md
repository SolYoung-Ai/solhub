# 存储驱动切换（PostgreSQL → 文档型数据库）

这份文档是「让 CloudBase 账单从每月 ~5 万点降到几千点」的操作手册。
代码已经做完，**线上默认仍走 PostgreSQL**，切不切只取决于环境变量 `KV_DRIVER`。

## 为什么会有这一层

认证与目录数据全部通过 `env.PROFILES` 的 Workers KV 接口读写，真正的数据库由
`cloudbase/functions/solhub-auth/kv.cjs` 决定：

| 驱动 | 文件 | 计费方式 | 一个月（当前负载） |
|---|---|---|---|
| `pg`（默认） | `kv-pg.cjs` | 实例按 0.2 核常驻，342 点/核时 | ≈ 4.9 万点 |
| `nosql` | `kv-nosql.cjs` | 按调用次数 200 点/万次 + 容量 | ≈ 1~2 千点 |

数据量只有 0.4MB / 十来个键，PG 那 0.2 核从月初跑到月末，跟有没有人访问无关 ——
这就是账单的大头。

## 前置条件

一个 CloudBase 环境只能有一种数据库实例（创建时决定）。当前环境
`solyoung-d4gpp1f7s4e075f6d` 是 **PostgreSQL 版**，所以切 `nosql` 必须：

1. 新建一个**文档型数据库**环境（控制台 → 新建环境 → 数据库选「文档型」）；
2. 新环境会拿到新的环境 ID 与默认域名 —— 前端基址、网关路由都要跟着改。

> 在这一步之前，代码侧不会产生任何变化。`KV_DRIVER` 不设就是 `pg`。

## 切换步骤

### 1. 建新环境与集合

- 控制台新建环境，记下 **环境 ID** 和 **API Key**（环境级）。
- 建两个集合：`kv`、`kv_backup`（代码里 `ready()` 也会尝试自动创建，但控制台先建好更稳）。
- 建索引（不建能跑，只是全表扫）：
  - `kv`：`key` 升序
  - `kv_backup`：`taken_on` 升序 + `key` 升序

### 2. 配置新环境的函数环境变量

除原有的全部变量外，**必须多设两个**：

| 变量 | 值 |
|---|---|
| `KV_DRIVER` | `nosql` |
| `TCB_ENV` | 新环境 ID |
| `CLOUDBASE_APIKEY` | 新环境 API Key |

其余保持与老环境一致：`CORS_MODE=self`、`MOUNT_PATH=/api`、`ADMIN_EMAILS`、
`DM_ACCESS_KEY_ID` / `DM_ACCESS_KEY_SECRET` / `DM_SENDER`、`GITHUB_CLIENT_ID` /
`GITHUB_CLIENT_SECRET`、`GITHUB_PAT`（可选）。

### 3. 部署函数

```bash
node scripts/sync-cloudbase-fn.mjs
cd cloudbase/functions
printf '\n\n' | tcb fn code update solhub-auth   -e <新环境ID>
printf '\n\n' | tcb fn code update solhub-hot    -e <新环境ID>
printf '\n\n' | tcb fn code update solhub-cron   -e <新环境ID>
```

`solhub-hot` 与 `solhub-cron` 的定时触发器也要在新环境重建：

- `hot-30min`：`0 */30 * * * * *`
- `backup-daily`：每天 03:30

### 4. 搬数据

```bash
# 只看会搬多少条，不写
node scripts/migrate-kv-to-nosql.mjs --from <老环境ID> --to <新环境ID> --dry

# 真搬（幂等，可重复跑）
TCB_KEY_FROM=<老环境APIKey> TCB_KEY_TO=<新环境APIKey> \
node scripts/migrate-kv-to-nosql.mjs --from <老环境ID> --to <新环境ID>
```

搬完在新环境跑一次备份验证：

```bash
tcb fn invoke solhub-cron -e <新环境ID> --params '{"action":"backup"}'
```

返回里 `driver` 应该是 `nosql`，`rows` 与老环境导出的条数一致。

### 5. 切前端

- 网关：新环境建 HTTP 网关路由 `/api`（`enableSafeDomain=false`，与老环境一致）。
- 前端：把 `PUBLIC_SOLHUB_API` 改成新环境的网关地址（`src/lib/api-base.ts` 的默认值），
  或直接在 `.env` 里设好后重新构建。
- 推送后等 Actions 发布。

### 6. 验收清单

| 检查项 | 期望 |
|---|---|
| `GET /me`（带 Cookie） | 200，用户信息完整 |
| `GET /community` | 产品条数与老环境一致 |
| `GET /hosted/list` | 13 个工具 |
| `GET /hot?limit=20` | 有热点，`lang=zh` |
| `GET /quotes` | 7 个指数 + 比特币 |
| 登录一次（邮箱验证码） | 能收到邮件、能登录出来 |
| `invoke solhub-cron {"action":"purge","dryRun":true}` | 返回过期键统计，不报错 |

### 7. 观察期与销毁

新环境稳定跑 **7 天**、账单曲线确认降下来后，再去控制台销毁老 PG 环境。

> 销毁前注意：老环境里还有 `lunasol_projects` / `lunasol_chat_conversations`
> 两张表（LunaSol 项目的数据，不属于 SolHub）。销毁 = 数据不可恢复。
> 已在 `backups/lunasol-2026-11-22.json.gz` 留过一份，但请确认那边不再需要。

## 回滚

**销毁老环境之前**，回滚是改一个变量的事：

1. 前端 `PUBLIC_SOLHUB_API` 改回老地址；
2. 或者在新环境把 `KV_DRIVER` 改回 `pg`（前提是新环境也是 PG 版 —— 一般不是）。

老环境在销毁前一直可读，所以最坏情况就是切回旧地址，损失 = 切换窗口内写入的新数据
（验证码、会话）。建议在低峰期切，且切换前先跑一次老环境备份。

## 本地自检

不依赖真实数据库，在内存里跑完整语义：

```bash
node scripts/check-kv-driver.mjs
```

覆盖：单键读写、中文与特殊字符 key、TTL 过期、前缀扫描不串味、cursor 翻页、
备份幂等、恢复、清理过期键、元信息读写。改过驱动或切换前都该跑一遍。

## 已知边界

- 文档库单次查询上限 1000 条，`list()` 已按 999+1 处理。
- 单文档上限 16MB；当前最大的键是 `hot:v1`（约 200KB），安全。
- 备份快照按天存进同一个库（`kv_backup` 集合），一天一份、保留 30 天，
  存储占用约 30 × 0.4MB ≈ 12MB，仍在免费额度内。
- 驱动不做「跨环境双写」，切换是单向的；回滚靠改地址。
