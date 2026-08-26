# 数据库 Schema 基线

> 实施分支快照：基于 `origin/main@be0c691`。这是源代码定义清单，不代表生产数据库已部署或已迁移。

## 1. Schema Head

- SQLite migration 注册表：v1–v16，位于 `src/platform/storage/sqlite-migrations.js`。
- 运行时公开常量：`STORAGE_SCHEMA_VERSION = SQLITE_SCHEMA_HEAD = 16`。
- migration ledger：`schema_migrations`。
- v1–v14 ledger checksum 保持历史兼容，源码内容由冻结 SHA-256 保护；v15+ ledger checksum 为内容 SHA-256。
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
| 15 | append-only continuous audit source | `audit_delivery_source_events`、stream/time 索引和禁止 UPDATE/DELETE 触发器 |
| 16 | durable chronic followup dispatch outbox | `chronic_followup_dispatch_outbox`、`chronic_followup_dispatch_replays`、due/lease 索引和不可变 source/replay 触发器 |

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

## 4. 已知边界

- v1–v14 现场 ledger 无法追溯当年实际执行源码，因此不得重算或改写历史行；冻结注册表防止今后源码漂移。
- schema fingerprint 用于确定性比较空库与受支持升级 fixture，不替代生产数据核对、备份或现场迁移证据。
- 专项 SQLite 表不共享同一个版本台账，不能纳入主 schema head。
- v15 只将严格验证通过的当前审计窗口登记为 `historical_baseline`，不声称恢复已淘汰历史；v16 从现存内嵌随访 outbox 回填，仍需生产核对和前滚恢复证据。
- DATA-003 不改变 schema head、表、列、索引、trigger 或 migration。当前 252 个 JSON/SQLite state
  collection 名称由治理 CLI 只读核对：60 个既有可写 owner 合同、19 个完成 owner 审查但生产
  不可写的 legacy 合同、3 个系统集合、169 个 `review-required`、1 个 `legacy-quarantined`；
  所有生产晋升仍需版本化写合同、新 migration/回滚与现场证据。

## 5. 慢病随访耐久投递 v16

`chronic_followup_dispatch_outbox` 以 `event_id` 唯一、`source_sha256` 不可变，状态仅允许
`pending/leased/delivered/dead-letter`。租约保存 owner、token SHA-256、version 和 expiry；完成/失败必须
同时匹配全部 fencing 条件且未过期。回执只保存绑定摘要与 `accepted|delivered`，错误只保存规范化 code/digest。
`chronic_followup_dispatch_replays` 保存 replay key、actor、reason 和 binding 摘要，禁止更新/删除。

`server.js` 在 followups 的 SQLite 状态写事务内调用 enqueue/一致性 hook；回滚同时撤销业务状态和 outbox
插入。真实 PostgreSQL 对应表、全量迁移、供应方回执、备份恢复和现场验收不在 v16 内，生产仍 NO-GO。

## 6. SQLite v17 对象存储预留（Proposed，未实施）

`OBJ-ADR-002` 为结构化附件元数据、耐久对象存储命令/回执和持久对账提出 v17 候选，但当前注册表
head、运行时常量与 ledger 仍精确为 v16；仓库没有 v17 migration、表、索引、trigger、回填或
PostgreSQL 对应 DDL。候选表名和实施阶段只存在于 Proposed ADR，不构成 schema 事实。

机器台账预留 v17 并由 `object-storage:architecture-governance:verify` 核对当前 head=16；若其他主题先占用
v17，必须重新评审本提案而不能改写迁移历史。只有 ADR Accepted、`secureAttachments` data owner 与 v1/v2
兼容策略经人类确认后，才可另开 migration 切片；届时必须同步空库/历史升级/重跑/失败回滚、全量
count/digest/orphan 核对、遗留写冻结和生产恢复证据。当前 production promotion 保持 false。
