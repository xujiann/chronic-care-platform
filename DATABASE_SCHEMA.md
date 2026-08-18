# 数据库 Schema 基线

> 快照：`main@b1e4898`。这是源代码定义清单，不代表生产数据库已部署或已迁移。

## 1. Schema Head

- SQLite migration 数组：v1–v14。
- 运行时公开常量：`STORAGE_SCHEMA_VERSION = 11`（与实际 head 不一致）。
- migration ledger：`schema_migrations`。
- PostgreSQL：5 份跟踪 SQL，共 13 张显式候选表；另有脚本生成的迁移包/MPI 结构。

## 2. SQLite Migration 台账

| 版本 | 名称 | 主要对象 |
|---:|---|---|
| 1 | collection state and storage events | `state_collections`、`storage_events` |
| 2 | collection versions/index | version 列、updated_at index |
| 3 | identity mirrors | resident/account/member/person index |
| 4 | personal record mirror | `personal_records` |
| 5 | business workflow mirrors | chronic/followup/claim/certificate |
| 6 | service/county mirrors | care order/medication/county workflow |
| 7 | governance/research/accessibility | 4 张治理镜像表 |
| 8 | PostgreSQL sync outbox | `postgres_sync_outbox` |
| 9 | shadow reconciliation | `postgres_sync_reconciliations` |
| 10 | reconciliation workflow | case/action 表 |
| 11 | durable auth sessions | `auth_sessions` |
| 12 | public-health signal keys | modernization idempotency keys |
| 13 | respiratory lifecycle replay | request/event/audit key 表 |
| 14 | official exchange replay | receipt/audit key 表 |

完整表分组与关系见 `DATA_MODEL.md`。

## 3. PostgreSQL 台账

| 文件 | Schema 责任 |
|---|---|
| `deploy/postgres-primary-storage-schema.sql` | collection 主存储 batch/state |
| `deploy/identity-security-audit-postgres.sql` | 身份安全审计 stream/control/command/event |
| `deploy/insurance-payment-postgres.sql` | aggregate/command/outbox |
| `deploy/referral-delivery-postgres.sql` | referral outbox/replay |
| `deploy/emergency-signal-delivery-postgres.sql` | emergency outbox/replay |

生产应用前必须校验 TLS、schema 权限、唯一约束、迁移 ledger、回滚和核对证据。

## 4. 已知偏差

- v14/v11 版本不一致。
- migration checksum 不覆盖 migration 代码。
- migration 仍内嵌 28k 行 `server.js`。
- 没有独立、确定性的 schema fingerprint 基线。
- 专项 SQLite 表不共享同一个版本台账。
