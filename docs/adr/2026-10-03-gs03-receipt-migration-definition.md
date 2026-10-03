# ADR-GS03-S1-001 转诊回调回执迁移定义与隔离验证

- 状态：Accepted
- 有效范围：仅 S1 未装配定义与隔离验证
- 日期：2026-10-03
- 批准依据：用户在已审 S1 方案后要求“继续开发”；独立准入审查确认可承接此具体范围。
- Owner：T08 仅本片回执数据语义；T00 迁移与组合技术。正式生产 data owner、完整存储权威仍待父 ADR 审定。
- 任务：GOV-028 准入与实验收尾；DATA-009 独立迁移定义与专项。

## Problem

TEST-026 合成模型经 PR330 集成，不能证明平台真实 migration、ledger 和 v15 审计结构兼容。S1 交付可用于后续正式装配的迁移定义，并使用真实迁移执行器在一次性合成库验证。父 CALLBACK/STORAGE ADR 继续 Proposed；本决策只提供未装配定义例外，不接受其全部未决事项。

## Options

1. 继续修改测试 helper：成本低，但无法验证真实 migration 内容指纹与升级。
2. 未装配 migration 定义加隔离专项：选择本方案，显式拼接注册表验证，正式 head 保持 19。
3. 立即装配并接回调：跨 Owner、身份、留存和全写者前置未完成，不属于本次范围。

## Advantages

复用真实 `applySqliteMigrations` 的事务、连续版本、ledger checksum 和冻结历史指纹，可验证拟议结构且不改变应用启动。各文件有唯一作者。

## Disadvantages

未装配定义不是可运行回调，也不能证明授权、业务与审计共事务。以后正式装配仍需核 schema head、完整合同和所有冲突写者。

## Migration cost

只允许新增 `src/platform/storage/gs03-callback-receipt-migration.js` 与 `test/gs03-callback-receipt-migration.test.js`。定义拟议后继 20，前置 19；不加入 `SQLITE_MIGRATIONS`、自动发现、server 或启动路径。后续 head 漂移须拒绝并重审，不覆盖历史版本。测试仅显式追加该定义运行真实 runner。

### Schema 合同

唯一表 `gs03_callback_receipts`，STRICT。字段如下；所有字段 NOT NULL，不接收患者正文、原始 key、报文或凭据。

| 字段 | 约束 |
|---|---|
| receipt_id | TEXT 主键，非空、无 NUL/首尾空白，UTF8 最多128字节 |
| namespace_digest、key_digest、intent_digest | TEXT，精确64位小写十六进制 |
| contract_id | TEXT，仅 referral-feedback-callback、referral-schedule-callback、referral-report-callback |
| contract_version、intent_digest_version | INTEGER，均固定2；仅定义本片结构，不决定真实 principal 来源 |
| target_id、authorization_id | TEXT，非空、无 NUL/首尾空白，UTF8 最多240字节；确切引用由后续事务端口核业务语义 |
| result_status | TEXT，固定 committed；不保存完整响应 |
| recorded_at_ms | INTEGER，0至8640000000000000，事务内记录时间，不称精确 COMMIT 时间 |
| security_stream、access_stream | TEXT，分别固定 securityEvents、dataAccessLogs |
| security_audit_event_id、access_audit_event_id | TEXT，非空、无 NUL/首尾空白，UTF8 最多240字节；分别与对应 stream 外键引用真实 v15 audit_delivery_source_events(stream,source_event_id) |

唯一键为 namespace_digest、contract_id、contract_version、key_digest。UPDATE/DELETE 永远拒绝。INSERT 先拒绝重复主键或唯一键，使 recursive_triggers 关闭时 INSERT OR REPLACE 也不能删旧回执再插入。无 TTL、删除接口、key 复用、旧事件回填或新 JSON collection。外键约束需调用连接提前启用，定义应核此条件；迁移执行器独占 BEGIN/COMMIT，定义仅建结构及验证，不自行提交。

全部 DDL 位于受内容指纹覆盖的函数内；验证函数也入 fingerprintDependencies。导出创建/验证函数及冻结候选 migration，apply 调用创建再验证。验证核确切 table/index/trigger SQL、列与外键结构；缺少或改写任一结构失败关闭，不能靠 IF NOT EXISTS 伪修复漂移。默认注册表与 head 19/41表不变；合成显式候选库才到拟议20/42表。

namespace_digest 与 key_digest 均为 SHA-256 的小写 hex 输出；intent_digest_version=2 声明拟议 v2 意图算法标识，摘要字段同为 SHA-256。DDL只检查存储形状，规范化输入和真实 principal 映射由后续正式合同与端口负责。

## Risk

FK 只证明审计引用存在，不证明其业务主体、成功语义、真实授权或同事务写入；后续必须另验。身份和外部 scope、全部写者接线、正式保留/隐私删除、legacy 名单/截止、历史对账和恢复目标继续阻断相应正式阶段。候选库不得交给旧 runtime。回滚停止验证并清理自有测试目录，保留失败日志；不 DROP 现库、不删业务/审计/回执。

## Recommendation

按上述 S1 实施，开发 A 唯一写定义，开发 B 唯一写专项；协调者只写治理/ADR/地图，独立审查者只读。源与测试在独立 `process/t00-gs03-s1-schema-20261003` 工作树，因本片是共享 migration 技术定义由 T00 负责，不作为 T00 大任务夹带领域回调业务。

### PLAN

目标为定义与真实迁移机制兼容。先准入、专项、独审，再组合冻结并串行运行适用中央/标准/全发现门禁。验收覆盖空库、v19及受支持历史版本升级、重跑、DDL/ledger失败回滚、内容checksum和结构漂移、每字段NULL/类型/长度/NUL/摘要边界、唯一性、UPDATE/DELETE/REPLACE拒绝、外键拒绝与真实v15历史链不变、无旧事件回填、默认registry和启动依赖不接线。

无 HTTP、repository、UoW、现库执行、生产或本候选推送合并授权。GS-03 未建设、六域 NO-GO。完成后提供精确提交、独审和测试证据；正式装配另立 Accepted 决策和任务。
