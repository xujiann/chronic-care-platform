# 源目标持久身份与绑定

- 状态：Accepted

- 决策：ADR-OPS-045，Accepted，2026-09-22 用户批准。
- 任务：GOV-019 / OPS-045；基线 origin/main@828893ac059326e6bfda537e1d16e5f50cac3b9d。

## 范围与合同

只新增源目标持久身份/绑定、版本化迁移及隔离合成测试。不接 checkpoint、relay、业务请求、生产或真实历史数据；不改变原六字段 commitment，不新增依赖。

SQLite v19 仅建空 source_identity/source_genesis 结构，不修改历史迁移及 schema creator 指纹。initializeSqliteOutboxSourceIdentity 自有事务，只允许 state_collections、postgres_sync_outbox、postgres_sync_commit_receipts、storage_events 及两张身份表全空时随机生成 UUID；重复初始化明确拒绝。首批 commitSqliteBoundOutboxTransaction 在业务/outbox/receipt/event 同一事务固定 genesis；缺身份拒绝，绝不补历史。身份/genesis 禁止 UPDATE/DELETE/REPLACE。旧 wrapper 在已初始化源也遵循相同约束，不得绕过。未初始化 legacy wrapper 保持旧语义，不宣称绑定能力。

loadBoundSqliteOutboxBatches 同一独立只读快照核验持久身份、genesis、完整链及游标，返回深冻结 envelope：sourceIdentity(schemaVersion=sqlite-outbox-source.v1,sourceInstanceId,createdAt,genesis{outboxSequence,batchId,chainHash})、batch、原 commitment。resolveBrandedSourceEnvelope 只接受该 loader 私有 WeakMap 登记的完整原始对象。复制、JSON 或手工拼接均拒绝，同一原始对象允许重放。品牌仅限制同进程来源端口，不是密码学认证或跨进程协议。

PG 新增独立 v1 迁移/校验 ledger，旧正式 DDL 不改。迁移仅建空结构；initializeTargetIdentity 显式空目标生成 UUID，primary_collection_state / primary_storage_batches 及身份/绑定必须为空；bindSource 显式接受 expectedTargetId、namespace=health_platform、真实 sourceEnvelope，在空业务目标固定不可变源身份及 genesis。初始化/绑定私有路径，不开放 bypass 参数。

applyBoundCommittedOutbox(envelope,{expectedTargetId,namespace}) 在 SERIALIZABLE/既有 advisory lock 内先校实际目标、namespace、源身份/genesis，再做 duplicate/CAS。已迁移库的旧 apply、直接 driver.transaction 同样受 gate，无 binding 拒绝。绑定事务 collection changes/batch 记录必须精确对应品牌 envelope，不得借正确身份写其他批次。

## 兼容与防降级边界

未迁移旧库保留旧接口语义，不宣称身份保护。任一身份 marker 存在就要求全部结构/head/checksum 完整，读取异常或缺失拒绝。driver 观察已迁移后 sticky 要求绑定；实例构造时固定 requireBoundIdentity=true 或显式 binding 即使 marker 全缺也拒绝，不能逐次关闭。新进程且管理员删除全部 marker 无法与旧库区分，必须保留外部 requireBoundIdentity 配置才能排除此降级；本轮不接线生产。完整物理克隆会复制 UUID/genesis，本能力不能识别；恶意管理员/同进程代码不在证明范围。

## 单写与验收

A 单写 SQLite identity、receipt wrapper/loader、追加 migration 及对应三份测试；B 单写 PG migration/SQL、driver/contract 及四份测试；协调者单写治理、文档、真实集成夹具/用例/入口和必要 head 兼容断言；审查者只读。精确路径以 lifecycle 总账为准。

验收：空库初始化、重启稳定、错源/目标/namespace/genesis、缺失/漂移、历史拒绝、旧入口及 duplicate 绕过、失败零业务/账本写、迁移重跑/指纹/故障回滚；真实 SQLite/PG 独立连接绑定竞争。保留已有 23 项 live 测试，显式 CI 不得 skip。独立审查后冻结，必需重型门禁串行，精确 CI 后依已有授权保护集成。不用旧 CI 或本地 skip 替代新真实证据。

## 恢复与风险

停止新调用并保留身份/绑定/业务事实，不自动 DROP/rebind/补证；已升级库不得交旧 runtime，恢复须受控前滚或备份恢复。仅清理本轮自建随机合成测试库。生产 TLS、容量/灾备、跨进程证明、完整克隆识别及现场签署外置，六域生产 NO-GO 保持。
