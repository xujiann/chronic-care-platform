# PostgreSQL 运行时增量同步

## 架构与边界

平台采用 SQLite 事务型 outbox 作为 PostgreSQL 切换前的影子同步通道。业务写入、集合版本更新和 outbox 批次在同一个 SQLite 事务提交；独立 worker 使用批次主键、payload SHA-256 和链式哈希向 PostgreSQL 幂等应用变更。

该能力只用于迁移演练、数据差异核对和切换准备。`STORAGE_ENGINE=postgres` 仍被主进程拒绝，PostgreSQL 不承担生产主存储，除非读写一致性、容量、故障切换、原生备份恢复和正式签字全部通过。

outbox 包含业务集合正文，属于敏感生产数据。SQLite 文件、备份和运行用户必须使用最小权限，不得上传 Git、普通 CI artifact 或非加密共享盘。批次信封不保存 `DATABASE_URL`、数据库用户名、密码或 CA 私钥。

## 启用顺序

1. 使用 `postgres:migration-package -- --mode=full` 在受控目录完成 PostgreSQL 基线装载并验证源摘要和集合计数。
2. 在应用环境设置 `POSTGRES_SYNC_MODE=outbox`、`DATABASE_URL`、`POSTGRES_SSL_MODE=verify-full`，按需要设置 `POSTGRES_CA_FILE`。
3. 重启应用，使 SQLite schema 升级到 v8；确认 `/api/health` 的 `storage.postgresSync.enabled=true`。
4. 部署 `deploy/postgres-sync-worker.service.template` 和 `deploy/postgres-sync-worker.timer.template`，以独立最小权限账号运行。
5. 观察 pending、retry、failed、delivered、oldestPendingAt 和 lastDeliveredAt；failed 必须进入运维事件并人工复核后重试。

## 手工执行

```powershell
$env:POSTGRES_SYNC_MODE="outbox"
$env:POSTGRES_SSL_MODE="verify-full"
npm.cmd run postgres:sync-worker -- --sqlite-file=D:\platform-data\health-city.sqlite --limit=50 --max-attempts=5
```

worker 在队列为空时仍会校验 PostgreSQL 连接配置，但不会输出连接串。远端批次使用 `health_platform.runtime_sync_batches` 去重，集合状态写入 `health_platform.runtime_collection_state`；低版本批次不能覆盖更高版本状态。

## 退出条件

- 全量基线与增量集合计数、摘要连续一致。
- pending/retry 在目标时限内归零，failed 为零。
- 断网、数据库重启、重复批次、乱序批次和 worker 崩溃演练通过。
- PostgreSQL 原生备份、恢复和主从切换达到批准的 RPO/RTO。
- 数据库责任人、平台运维、业务责任方和发布经理完成签字。
