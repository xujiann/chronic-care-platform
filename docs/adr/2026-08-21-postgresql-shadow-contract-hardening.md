# ADR：PostgreSQL shadow 合同强化

- 状态：Accepted
- 日期：2026-08-21
- Owner：T00（存储组合与发布门禁）+ T01（会话/身份仓储）

## Problem

硬编码 schema、宽松 batch 重放和等版本覆盖会让多实例演练错误地接受冲突内容。

## Options

1. 维持单 schema/last-write-wins；2. 新建平行 PostgreSQL runtime；3. 在现有仓储与 shadow relay 中加入 schema、CAS 和 digest 冲突合同。

## Advantages / Disadvantages

方案 3 保持现有模块和 productionPrimary 边界，并能事务回滚冲突；代价是 worker 多一次 `FOR UPDATE` 查询及更严格的旧批次兼容。

## Migration cost / Risk / Recommendation

迁移成本是部署显式 schema 与重新演练冲突案例。主要风险是旧等版本漂移批次现在失败；推荐保留原始批次证据、清零差异工单后再进入外部 PG 合同门禁。

## Decision

- `POSTGRES_SCHEMA` 必须是小写 SQL identifier；session、身份审计仓储、primary-read rehearsal、shadow worker 和 reconciliation 统一使用验证后的 schema，默认 `health_platform`。
- 注入 pool 由调用方拥有；主线生产适配器运行时允许通过 `pools.shared` 显式共享同一 pool，repository `close` 不关闭借用 pool。
- `runtime_sync_batches.batch_id` 冲突必须在同一事务内精确比较 `payload_sha256`、`previous_chain_hash`、`chain_hash`；内容不同返回 `POSTGRES_SYNC_BATCH_ID_CONFLICT` 并回滚。
- upsert 等版本只允许相同 payload digest 幂等；不同 digest 返回 `POSTGRES_SYNC_VERSION_CONFLICT`。delete tombstone 在等版本时同样冲突，仅能删除更低版本数据；更高版本保持不变。
- SQLite outbox 状态更新使用 pending/retry CAS，终态不会被陈旧 worker 覆盖；错误仅持久化稳定 code。
- 目标 schema probe 与 shadow/reconciliation 健康合成仍只证明 rehearsal 能力，`productionPrimary=false`。
- 迁移包实际创建 `${POSTGRES_SCHEMA}.auth_security_state`，应用运行账号不执行 PostgreSQL DDL；会话与认证安全状态借用组合根同一长期 pool。CI 使用临时 PostgreSQL 16 实例验证 schema probe、跨连接 OTP/限流原子性及 shadow 等版本冲突回滚。

外部环境仍可通过 `POSTGRES_URL` 重跑同一真实合同；本 ADR 不授权主读、双写或切流。
