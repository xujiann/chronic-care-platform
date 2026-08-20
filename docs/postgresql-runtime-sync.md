# PostgreSQL 运行时增量同步

## 架构与边界

平台采用 SQLite 事务型 outbox 作为 PostgreSQL 切换前的影子同步通道。业务写入、集合版本更新和 outbox 批次在同一个 SQLite 事务提交；独立 worker 使用批次主键、payload SHA-256 和链式哈希向 PostgreSQL 幂等应用变更。

该能力只用于迁移演练、数据差异核对和切换准备。`STORAGE_ENGINE=postgres` 仍被主进程拒绝，PostgreSQL 不承担生产主存储，除非读写一致性、容量、故障切换、原生备份恢复和正式签字全部通过。

outbox 包含业务集合正文，属于敏感生产数据。SQLite 文件、备份和运行用户必须使用最小权限，不得上传 Git、普通 CI artifact 或非加密共享盘。批次信封不保存 `DATABASE_URL`、数据库用户名、密码或 CA 私钥。

## 启用顺序

1. 使用 `postgres:migration-package -- --mode=full` 在受控目录完成 PostgreSQL 基线装载并验证源摘要和集合计数。
2. 在应用环境设置 `POSTGRES_SYNC_MODE=outbox`、`DATABASE_URL`、`POSTGRES_SSL_MODE=verify-full`，按需要设置 `POSTGRES_CA_FILE`。
3. 重启应用，使 SQLite schema 升级到 v10；确认 `/api/health` 的 `storage.postgresSync.enabled=true`。
4. 首次启用时执行一次 `postgres:sync-bootstrap`，把当前集合版本和正文作为受控基线批次写入 outbox；已有 outbox 时命令默认跳过，避免重复基线。
5. 部署同步 worker 与影子核对 service/timer，以独立最小权限账号运行。
6. 观察 pending、retry、failed、delivered、oldestPendingAt、lastDeliveredAt 和 reconciliation；failed 或 mismatched 必须进入运维事件并人工复核。

## 手工执行

```powershell
$env:POSTGRES_SYNC_MODE="outbox"
$env:POSTGRES_SSL_MODE="verify-full"
npm.cmd run postgres:sync-bootstrap -- --sqlite-file=D:\platform-data\health-city.sqlite
npm.cmd run postgres:sync-worker -- --sqlite-file=D:\platform-data\health-city.sqlite --limit=50 --max-attempts=5
npm.cmd run postgres:shadow-reconcile -- --sqlite-file=D:\platform-data\health-city.sqlite --output=D:\platform-logs\postgres-shadow-reconciliation.json --markdown=D:\platform-logs\postgres-shadow-reconciliation.md
```

worker 在队列为空时仍会校验 PostgreSQL 连接配置，但不会输出连接串。默认 schema 为 `health_platform`，可通过只接受小写 SQL identifier 的 `POSTGRES_SCHEMA` 隔离。批次 ID 重放只有在 payload、前序链和链摘要完全一致时才视为幂等；等版本 upsert 必须 digest 相同，等版本 tombstone 必须冲突回滚，低版本批次不能覆盖或删除更高版本状态。

影子核对器通过 `BEGIN READ ONLY` 读取 PostgreSQL，只比较集合名、源版本和 payload SHA-256。SQLite v10 的 `postgres_sync_reconciliations` 仅保存核对汇总、差异类型和摘要，不保存业务正文或数据库凭据；最近一次结果通过 `/api/health`、`/api/metrics` 和仅限卫健管理角色的 `/api/production-database/shadow-reconciliation` 暴露。定时核对模板为 `deploy/postgres-shadow-reconcile.service.template` 与 `deploy/postgres-shadow-reconcile.timer.template`。

## 差异处置闭环

- `GET /api/production-database/shadow-reconciliations` 查询最近 100 次核对历史，`GET /api/production-database/shadow-reconciliations/:id` 查询单次差异摘要。
- `GET /api/production-database/reconciliation-cases` 查询按集合持续归并的差异工单，`GET /api/production-database/reconciliation-cases/:id` 同时返回不可变操作历史。
- `POST /api/production-database/reconciliation-cases/:id/actions` 支持 `assign`、`acknowledge`、`resolve`、`reopen` 和 `comment`；全部接口仅允许卫健管理角色访问，变更同时写入平台安全审计链。
- 工单首次发现为 `open`，确认责任人后进入 `acknowledged`。只有后续 matched 核对确认该集合差异已消失，并提供处理说明与证据引用后，才能进入 `resolved`。
- 已解决集合再次出现差异时自动进入 `reopened`，保留首次发现、最近发现、累计出现次数、清除核对批次和历史动作。
- 工单只保存集合名、差异类型、版本、SHA-256、责任人、备注和证据引用，不保存业务正文、数据库连接信息或凭据。

卫健管理角色可在 `platform.html#production-database-cutover-center` 查看差异工单和最近核对历史，并执行分派、签收、备注、核验关闭和重新打开。界面通过上述受限 API 操作，不在浏览器本地复制工单账本；关闭动作仍由服务端强制校验 matched 核对批次和证据引用。

## SLO 与监控采集

`/api/metrics` 在 `storage.postgresSync.slo` 输出结构化目标、指标与当前违反项；`/api/metrics/prometheus` 输出 Prometheus 0.0.4 文本格式。两个端点均仅允许卫健管理角色访问，文本指标只有计数、时长和开关状态，不包含集合名、业务正文、SHA-256、连接串或凭据。

默认上线阈值可通过环境变量调整：

- `POSTGRES_SYNC_BACKLOG_SLO_MAX=20`：pending 与 retry 批次总量上限。
- `POSTGRES_SYNC_PENDING_AGE_SLO_SECONDS=300`：最老待处理批次允许停留时长。
- `POSTGRES_RECONCILIATION_AGE_SLO_SECONDS=600`：最近一次只读核对允许陈旧时长。
- `POSTGRES_RECONCILIATION_OPEN_CASES_SLO_MAX=0`：允许未关闭差异工单数。

Prometheus 指标包括 `health_platform_postgres_sync_backlog`、`health_platform_postgres_sync_oldest_pending_age_seconds`、`health_platform_postgres_reconciliation_age_seconds`、`health_platform_postgres_reconciliation_unresolved_cases`、`health_platform_postgres_sync_failed_batches` 和 `health_platform_postgres_sync_slo_breaches`。仅当 `POSTGRES_SYNC_MODE=outbox` 时评估违反项；禁用影子同步不会制造误告警。

## PostgreSQL 主读取演练

影子核对连续一致后，可在受控环境设置 `POSTGRES_PRIMARY_READ_MODE=rehearsal`，执行 `npm.cmd run postgres:primary-read-rehearsal`。演练使用 `REPEATABLE READ + READ ONLY` 事务读取 `health_platform.runtime_collection_state`，逐集合验证 payload SHA-256、源版本、必需集合和 SQLite 影子基线，然后在内存中重建完整平台状态快照。

- `GET /api/production-database/primary-read-rehearsal` 仅向卫健管理角色返回配置状态、事务级别和生产边界。
- `POST /api/production-database/primary-read-rehearsal` 仅在 `POSTGRES_SYNC_MODE=outbox`、SQLite 基线、`DATABASE_URL` 和演练模式全部就绪时执行，并要求填写操作说明。
- API、CLI JSON 和 Markdown 报告只返回集合计数、校验字节数、版本范围和快照摘要，不返回业务 payload、连接串或凭据。
- `POSTGRES_PRIMARY_READ_MAX_COLLECTIONS` 和 `POSTGRES_PRIMARY_READ_MAX_BYTES` 限制单次读取规模，避免错误配置导致无界内存占用。

演练通过只证明 PostgreSQL 影子库可在一致性事务中重建经过摘要校验的完整状态。它不会设置 `STORAGE_ENGINE=postgres`，不会启用 PostgreSQL 写主库、自动切换或生产就绪标记；正式主存储仍需领域表转换、容量与故障切换、原生备份恢复和现场签字。

## 生产数据库适配器

`postgres-production-adapter.js` 提供独立异步适配层，避免把异步 PostgreSQL 驱动硬塞入现有同步状态调用。适配器具备以下生产控制：

- 主读取使用 `REPEATABLE READ + READ ONLY`，验证全部集合 payload SHA-256 后返回状态和集合版本。
- 主写入使用 `SERIALIZABLE`、事务级 advisory lock、`FOR UPDATE` 和全集合 `expectedVersions`，任何缺失版本或版本漂移均拒绝提交，并避免空表首写或并发批次造成摘要链分叉。
- 写入复用链式批次摘要，并在 `runtime_primary_write_audit` 记录操作者、原因、前后快照摘要和变更计数，不保存业务正文或数据库凭据。
- `npm.cmd run postgres:adapter-status` 输出无凭据配置状态；`npm.cmd run postgres:adapter-verify` 以只读事务验证运行表、状态表和主写审计表。
- `GET /api/production-database/adapter` 仅向卫健管理角色暴露安全状态和事务能力，不返回连接串或证据正文。

写能力必须同时配置 `POSTGRES_ADAPTER_MODE=rehearsal`、`POSTGRES_PRODUCTION_WRITE_MODE=evidence-gated`、`POSTGRES_CUTOVER_APPROVAL_ID`、`POSTGRES_BACKUP_EVIDENCE_ID` 和 `POSTGRES_RTO_RPO_EVIDENCE_ID`，调用方还必须显式传入写许可、操作者、原因和完整预期版本。上述门禁只允许开展受控适配器验收，不会自动修改主服务的 `STORAGE_ENGINE`，也不会把 `productionPrimary` 或 `runtimeCutoverEnabled` 标记为真。

## 退出条件

- 全量基线与增量集合计数、摘要连续一致。
- pending/retry 在目标时限内归零，failed 为零。
- open、acknowledged 和 reopened 差异工单归零，关闭工单均有 matched 核对批次和处置证据。
- 断网、数据库重启、重复批次、乱序批次和 worker 崩溃演练通过。
- PostgreSQL 原生备份、恢复和主从切换达到批准的 RPO/RTO。
- 数据库责任人、平台运维、业务责任方和发布经理完成签字。
