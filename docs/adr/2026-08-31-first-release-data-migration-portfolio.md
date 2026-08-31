# ADR：首发数据引用采用迁移计划闭集与派生读模型分离

- 状态：Accepted
- 日期：2026-08-31
- Owner：T00 数据治理；业务数据 Owner 继续由 `config/domain-data-ownership.json` 决定
- 影响范围：`priority-eight-applications-v1` 中 21 个生产写受阻引用、迁移波次、产品化与发布范围报告

## Problem

首发范围的 API 行为复核和集合 Owner 复核已经归零，但 21 个引用仍被统一描述为“缺版本化合同、迁移和外部证据”。该描述混合了三类事实：19 个已经完成 Owner review 的遗留持久化集合、一个已有 T05 Owner 绑定的 `referrals` 引用，以及一个不应写入数据库的派生 `operationsReadiness` 读模型。此前只有 `researchDatasets` 具备显式 repository migration plan，无法机器证明所有持久化引用均已进入唯一波次，也无法阻止派生读模型被误建为生产表。

## Options

1. 保持单个科研迁移合同，其余引用继续由文档人工跟踪。
2. 把 21 个引用全部当作生产表并直接授权 PostgreSQL 写入。
3. 建立一个闭集 portfolio：19 个 Owner-reviewed legacy 和 `referrals` 各进入唯一的 metadata-only 迁移波次；`operationsReadiness` 明确为非持久派生读模型。19 个遗留集合只晋升到 `repository-plan-ready`，所有生产标志继续为 false。
4. 为每个引用建立独立数据库、worker 和部署单元。

## Advantages

- 方案 3 使首发 21 个受阻引用有且只有一种仓库处置，缺项、重复波次、Owner/分类漂移和派生读模型误持久化都会失败关闭。
- 复用现有 SQLite `state_collections`、PostgreSQL `health_platform.primary_collection_state`、migration control plane、精确核对和回滚门禁，不新增 DDL 或请求路径双写。
- 产品化、数据治理和发布范围可以分别报告 12 个既有 promoted 合同、19 个 Owner-reviewed repository plan、20 个持久化迁移计划和 1 个派生读模型。
- 仓库关键计划缺口归零时，21 个生产写阻断仍保留，避免把“计划完整”误报为“数据已迁移”。

## Disadvantages

- `p0-data-promotions`、migration program 和多个 readiness 投影的条目增加，Owner、合同和波次调整必须同步维护。
- 通用 PostgreSQL collection-state 目标只适合受控 shadow/rehearsal；它不能替代未来按业务负载设计的专用表和索引。
- `repository-plan-ready` 仍没有真实全量数据、容量、故障切换或多实例 CAS 证据，现场工作量不会因本决策消失。

## Migration cost

中等。新增一个 metadata-only portfolio 和失败关闭验证器；扩展现有 migration waves 与 19 个 Owner-reviewed phase；把 readiness、CI、测试和六张地图同步到新统计。没有 SQLite/PostgreSQL schema 变化、数据回填、worker 激活、API 变化或生产切换。回滚时删除 portfolio 接线并恢复单集合计划统计，生产状态始终保持 NO-GO。

## Risk

- 误放行：portfolio、promotion、migration program 和 release scope 共同固定 `productionWriteAllowed=false`、`productionPromotionAllowed=false`、`localExecutionAuthorized=false` 和 `productionCutoverAuthorized=false`。
- 第二事实源：portfolio 只选择既有权威配置和表，不复制业务记录、API 清单或 Owner 决策。
- 读模型误持久化：`operationsReadiness` 必须保持 `derived-read-model`、无 wave、无 promotion，任何漂移由负向测试拒绝。
- 计划与运行脱节：真实 rehearsal、签名核对、独立回滚、PG 多实例、容量/故障切换和现场审批继续作为外部门禁；仓库不得生成或伪造这些证据。

## Recommendation

采用方案 3。`first-release-data-migration-portfolio.v1` 是首发受阻数据引用的唯一迁移计划闭集：20 个持久化引用必须进入唯一波次，1 个派生读模型必须明确不可持久化。19 个 Owner-reviewed legacy 进入 `repository-plan-ready`，`referrals` 继续使用既有 T05 Owner 绑定而不伪装为 P0 promoted，`operationsReadiness` 不进入 migration program。

通过 portfolio 只表示仓库计划完整；21 个引用仍不得生产写入或晋级。任何 migration run、PostgreSQL 主切换、专用 schema、worker 激活或生产 GO 必须继续经过独立实施、外部证据和现场审批。
