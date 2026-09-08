# ADR：影像质控采用耐久命令与异步对账闭环

- 状态：Proposed
- 日期：2026-09-07
- Owner：T06（影像质控领域语义）+ T00（schema/migration、runtime composition、worker、CI 与部署）
- 基线：`origin/main@99bdfb27a4051192bffc828d45d58f5d991e8e44`

## Problem

现有影像质控请求先向 FHIR 写入 DiagnosticReport，再提交本地影像与质控记录。虽然系统已校验回执、
区分明确拒绝与未知结果，并在未知结果或本地提交失败时禁止盲重试，但仍没有耐久命令、幂等键、聚合版本
CAS、机构资源范围、DiagnosticReport 回读、worker、可运维告警或人工对账台账。浏览器内存锁和一次 HTTP
错误响应不能跨页面、进程或故障恢复，也不能证明一条命令只产生一次外部副作用。

## Options

1. 保持同步外调，只增强页面提示和人工 runbook。
2. 在现有 JSON 状态中追加对账数组，并继续由请求路径同步外调。
3. 建立版本化耐久 QC command/outbox；本地事务先保存命令与待投递事实，独立 worker 写 FHIR，使用稳定
   幂等标识、回执校验、租约 fencing、有界重试和外部回读进入可审计对账状态。
4. 直接同时切换 PostgreSQL 主存储、重构影像聚合并上线多实例 worker。

## Advantages

- 方案 3 把用户请求与外部副作用解耦，避免“外部成功后本地业务写失败”的同步双写窗口。
- `command_id + actor/institution scope + request digest` 可以拒绝同键异载荷并精确重放首次公共响应。
- 聚合版本 CAS 防止并发质控覆盖；worker lease owner/token/version/expiry 可阻止陈旧 worker 完成状态。
- DiagnosticReport 使用由命令 ID 派生的稳定业务 identifier，并在写入或回读时核验 study、结论、评分摘要
  和有效时间，减少重复资源和错误归属。
- pending、publishing、confirmed、rejected、unknown、reconciliation-required、completed、dead-letter 状态
  可建立指标、SLO、告警、runbook、人工复核与不可变操作记录。

## Disadvantages

- 需要新的 schema/migration、仓储端口、worker 与部署单元，跨越 T06/T00/Data Owner 边界。
- FHIR 的条件创建或业务 identifier 查询能力取决于供应方；若不能保证幂等，仍只能实现至少一次投递。
- 外部成功后 worker 在本地完成前崩溃仍会出现未知窗口，必须依赖安全回读和人工复核，不能凭重试次数猜测。
- 历史 `imageCloudStudies` 与 `imageCloudQualityReviews` 是 legacy non-authoritative 集合，迁移与双轨兼容会
  增加读取和回滚复杂度。
- 完整观测需要低基数指标、脱敏 trace、告警路由和现场值守，不应把日志文本当作完成证据。

## Migration cost

高。建议新增单主题 migration，而不是修改历史 migration：

- `imaging_qc_commands`：command ID、study ID、institution scope、actor 摘要、request digest、聚合版本、
  状态、版本、时间戳和稳定错误码；不保存 token、endpoint 或原始 provider error。
- `imaging_qc_outbox`：command ID、资源业务 identifier、payload digest、due time、attempt、lease version、
  lease expiry、receipt digest 与终态；源码字段不可被 worker 改写。
- `imaging_qc_reconciliation_ledger`：append-only 的观察、人工决定、理由与审批引用摘要。
- 首次迁移只导入能证明来源与机构范围的历史记录；无法证明的记录隔离为 review-required，不能合成成功。
- 应用升级顺序为 expand schema → 只读/双读校验 → 命令写入与 worker 关闭 → 现场演练 → 单独批准 worker。
  请求路径双写与直接生产启用都不属于 migration 步骤。

## Risk

- 幂等 identifier 若未绑定 institution、study 和 payload digest，可能把不同质控错误合并。
- 回读只看到同一资源 ID 不足以证明本命令完成；必须校验业务 identifier、study linkage、结果与摘要。
- worker 网络调用不得持有数据库事务；完成写必须以 lease fencing 和 command version CAS 为条件。
- unknown 不能自动提升为 confirmed；只有可信写回执或受认证回读结果可进入 confirmed。
- 人工“确认完成”必须职责分离、记录 actor/reason/evidence reference，并禁止编辑历史 ledger。
- 低基数指标不得包含居民标识、检查号、DiagnosticReport ID 或 provider 原始 message。
- schema 或 worker 失败时必须失败关闭，生产继续 `NO-GO`；本地仓库证据不等于外部现场验收。

## Recommendation

推荐方案 3，但本 ADR 保持 Proposed，当前不得实施。先由 T06 固化领域状态、幂等绑定与对账判定规则，
由 T00/Data Owner 评审 schema、事务边界、migration、runtime composition、worker profile 与生产门禁；再由
安全、临床和运维共同批准最小外部 payload、人工职责分离、指标/SLO/告警和 runbook。

### 建议协议

1. HTTP 只创建或重放耐久 command，返回 `202 queued` 或同一 command 的稳定投影，不直接调用 FHIR。
2. 同一 actor/institution/key 与相同 digest 精确重放；同键异载荷返回稳定 409。study 聚合使用版本 CAS。
3. worker 使用稳定 DiagnosticReport identifier 做条件写；超时后先回读，禁止立即再次产生未知副作用。
4. 可信 receipt/readback 必须绑定 command、study、institution、结论、评分摘要与资源版本；否则进入
   `reconciliation-required`。
5. 人工复核只能在明确证据与职责分离下推进状态；系统不得以本地 dashboard 字段相符自动关闭命令。

### 观测与门禁

- 指标：queue depth/age、publish attempt/outcome、unknown age、reconciliation backlog/age、dead letter、
  lease conflict、CAS conflict；均为低基数。
- SLO 建议由运维批准后再定，例如 command age、unknown 最大停留时间与人工响应时间；仓库不得虚构阈值。
- strict readiness 必须验证 schema head、worker 配置、FHIR capability、签名/认证、幂等/回读联调、告警、
  runbook、备份恢复与 rollback drill；任何一门缺失即 `NO-GO`。

### Rollback

在 worker 未获生产批准前，可关闭 worker 与新命令 capability，保留 command/outbox/ledger 作为只读证据；
不得删除已确认的外部资源、重写 ledger 或回退 schema 后遗失待处理命令。回退应用必须仍能读取或导出未完成
队列，随后以前滚修复为主。若已产生外部结果，只能通过受控对账或业务补偿处理，禁止盲目再次提交。

### 待人工决策

1. FHIR 供应方是否支持受认证 DiagnosticReport identifier 查询、条件创建和版本读取？
2. command/outbox 的唯一 Data Owner、保留期、归档与敏感等级是什么？
3. institution scope 如何从 study 的权威机构事实绑定并在 replay 前重验？
4. 哪些证据允许 unknown → confirmed/rejected，谁有权执行人工关闭或 replay？
5. SQLite 单主机是否仅作演练，还是先批准为非生产耐久实现；PostgreSQL 主切换的独立边界是什么？
6. worker 激活、停用、排空、升级与回滚由谁负责，哪些 SLO/告警与现场演练是生产前必需？

