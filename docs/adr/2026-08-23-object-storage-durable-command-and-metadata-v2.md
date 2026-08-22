# ADR：对象存储采用结构化元数据与耐久异步命令轨道 v2

- 状态：Proposed
- 日期：2026-08-23
- 决策 Owner：T00（架构/数据库/发布治理）
- 建议 Data Owner：T08 integration（仅建议，仍需人类确认）
- 建议 Technical Owner：T00（共享存储、worker、readiness 与部署合同）
- 影响范围：安全附件元数据、对象存储命令、公开附件 API、SQLite v17 候选、worker、对账与生产门禁
- 非目标：本 ADR 不实施 migration、runtime、API、外部网关、生产切换或 `domain-data-ownership` 变更

## Problem

现有 `secureAttachments` 是全状态 JSON/SQLite collection 中的遗留数组，而不是有稳定键、版本、索引和
分页合同的结构化生产写模型。兼容入口达到 500 条时已经改为在网关调用前失败关闭，避免静默删除
immutable/legal-hold 元数据，但这只把数据丢失风险转换为容量不可用，仍无法提供无损分页、并发 CAS、
精确保留、孤儿检测或大规模回填核对。

现有上传授权、完成、生命周期和下载流程仍在 HTTP 请求路径调用外部网关，并在外部成功后写本地状态。
进程崩溃、超时、重试或本地提交失败会造成外部对象与平台权威元数据分离；当前没有稳定命令 ID、事务
outbox、租约 fencing、有界重试、死信/人工 replay、回执摘要、外部状态查询、abort 或自动对账闭环。
`object-storage-gateway-trust-v1` 已解决应用侧响应来源和绑定验证，但不能证明命令被耐久执行或本地/外部
状态最终收敛。

`secureAttachments` 目前在机器 data-owner 清单中没有 owner。T08 拥有既有 HTTP caller，不等于可以由
进程所有权推断数据所有权。把同步 v1 兼容接口迁移为异步 v2 还会改变状态码、返回形状和客户端时序；
在 data owner 与兼容策略由人类确认前，不能建立 v17 或启用生产晋升。

## Options

1. 保留 500 条失败关闭上限和同步网关调用，只补运维告警；
2. 保留同步 API，在请求路径加入幂等键、补偿调用和本地重试；
3. 采用版本化异步 API v2、SQLite v17 结构化元数据/命令表、事务 enqueue、独立 worker、无损分页和
   持久对账，并在兼容窗口内保留 v1；
4. 直接切换到特定云 SDK 或 PostgreSQL 新服务，一次重写附件 API、存储、worker 和历史数据。

## Advantages

- 方案 1 成本最低，维持当前公共行为；
- 方案 2 客户端改动较少，并能降低部分重复调用；
- 方案 3 把业务提交与网络调用分离，允许同事务登记命令，以稳定 ID、lease fencing、回执摘要和对账
  收敛至少一次执行；结构化权威表支持 keyset 分页、CAS、保留/法务冻结和全量核对；版本化 API 允许
  显式兼容窗口；T08 数据职责与 T00 技术职责可以通过端口分开；
- 方案 4 可更快采用厂商能力或多节点数据库，并消除部分遗留适配层。

## Disadvantages

- 方案 1 保留容量、崩溃窗口和不可对账风险；
- 方案 2 仍在请求路径依赖外部系统，补偿也无法提供跨系统原子性；
- 方案 3 成本较高，需要 migration、回填、双版本协议、worker 运维、对账和客户端迁移；只能提供至少
  一次执行，不能宣称 exactly-once；
- 方案 4 同时跨越 data owner、公共 API、数据库、厂商锁定和部署拓扑，回滚面过大，且厂商与生产
  PostgreSQL 能力尚未由现场确认。

## Migration cost

方案 1 为低但不关闭生产缺口；方案 2 为中且收益有限；方案 3 为中高，需要独立 v17 migration、全量
回填和核对、v1/v2 客户端兼容期、worker/systemd/readiness、容量和恢复演练；方案 4 为极高。

若方案 3 被 Accepted，建议按以下不可跨越阶段实施：

1. 人类确认 `secureAttachments` 的 data owner 和 v1/v2 兼容策略；更新机器 owner 合同；
2. 追加单主题 SQLite v17，并同步 PostgreSQL 候选 DDL。候选表为 `secure_attachment_records`、
   `object_storage_commands`、`object_storage_command_receipts`、`object_storage_reconciliation_cases` 和
   `object_storage_reconciliation_actions`；历史 migration 不修改；
3. 从遗留集合全量回填，拒绝重复 ID、无效版本、缺失关键绑定和摘要不一致；保存行数/摘要/孤儿核对，
   支持备份恢复或明确前滚恢复；
4. 回填核对通过后冻结遗留 `secureAttachments` 写入。结构化表成为唯一写权威源；禁止请求路径双写；
5. 发布版本化异步 API v2：命令创建返回 `202 + commandId + statusUrl`，状态查询/人工 replay 使用稳定
   错误与授权范围。v1 仅按获批兼容策略保留或弃用；
6. 启用独立 worker：稳定幂等键、pending/leased/delivered/dead-letter、lease owner/token hash/version/
   expiry fencing、有界退避、digest-only 错误/回执和有审计的人工 replay；
7. 列表采用 scope-bound、版本化 keyset cursor 和固定 high-water mark；不得用数组切片或 offset 造成
   插入/删除期间遗漏；
8. 对账 worker 分页扫描本地权威记录和外部 provider 状态，支持 signed status/receipt、abort/capability
   查询，持久化差异 case/action，禁止自动覆盖法务冻结或删除事实；
9. readiness 只在 migration/backfill/freeze、worker、队列积压/死信、分页、对账、备份恢复、外部签名
   能力和现场证据全部满足时才允许 production promotion。默认保持 `NO-GO`。

## Risk

- Data owner 误认会把技术路由所有权当成事实所有权；必须由人类确认后才能修改
  `config/domain-data-ownership.json`；
- v1 同步响应与 v2 异步 `202` 语义不兼容；必须由调用方 owner 选择并批准兼容/弃用策略，不能由本
  ADR 猜测；
- 回填可能遇到重复 ID、历史缺字段、legal-hold 冲突或已淘汰对象；任何不一致应失败关闭并生成脱敏
  核对项，不能截断或跳过；
- 请求路径双写会重新引入本地/外部不一致；唯一允许的写入是业务/命令同事务，网络调用在事务外 worker；
- stale worker 可能覆盖新租约；所有完成、失败和 replay 必须匹配完整 fencing 条件；
- 不稳定分页会遗漏法定留存记录；cursor 必须绑定查询范围、排序、版本和 high-water mark；
- provider 幂等、状态、abort、KMS/WORM、扫描、备份与容量能力仍需要签名证据和现场验收；
- SQLite v17 只适合当前单主机闭环，不等于生产 PostgreSQL 多节点主存储已就绪；
- readiness 若使用硬编码常量会在外部证据补齐后仍需改代码，或被配置误放行；后续实现必须由可验证
  外部证据驱动并默认拒绝，且不能把仓库测试当现场证据。

## Recommendation

建议选择方案 3，但保持 `Proposed`，当前不授权实现。建议由 T08 integration 作为附件元数据与命令业务
语义的 data owner，由 T00 作为共享结构化存储、worker、分页基础设施、对账和 readiness/deployment 的
technical owner；这两个角色必须通过版本化端口连接，T00 不取得业务数据所有权。

建议兼容路径为并行发布 v2 异步 API，v1 在有界窗口内保持现有形状且生产默认不扩容；是否保留同步
v1、何时弃用及各调用方迁移顺序仍需人类批准。机器决策/行动台账
`config/object-storage-architecture-decision.json` 是本提案的唯一治理投影：在 ADR 未 Accepted、data owner
或兼容策略未确认时，v17、runtime/API 实施及 production promotion 标志必须全部为 `false`，所有实现
行动保持 `blocked-until-accepted`。`npm run object-storage:architecture-governance:verify` 在 CI 中失败关闭。

Acceptance 之后也不得一次性实施全部阶段；每个 migration/runtime/API/部署切片需要独立计划、测试、
回滚和 review。真实端点、凭据、桶/KMS/WORM/扫描、provider 签名能力、容量、备份恢复与现场验收始终
属于外部边界，仓库不得伪造生产 GO。
