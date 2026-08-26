# ADR：首发范围遗留集合采用 Owner 归属与生产写策略分离

- 状态：Accepted
- 日期：2026-08-26
- Owner：T00 数据治理；业务 Owner 见 `config/domain-data-ownership.json`
- 影响范围：首发范围 19 个 JSON/SQLite state collection、数据 Owner、reader allowlist、集合治理与生产晋升

## Problem

首发范围引用了 19 个仍处于 `review-required` 的集合。源码审计显示其中既有 T03、T05、T09 等领域的专用命令，也有 `shared`、`runtime`、组合根和全量 state 兼容写入。仅按文件路径或路由 Owner 推断数据 Owner 会把兼容适配器误当业务权威；另一方面，旧集合一旦进入 `domain-data-ownership`，原治理实现会用 `Boolean(policy)` 自动投影为 `productionWriteAllowed=true`，从而把“明确责任方”误报为“具备版本化生产写合同”。这些集合尚无对应 production migration、PostgreSQL 写模型、回填核对、恢复和现场证据。

## Options

1. 保持 19 个集合为 `review-required`，不确认 Owner。
2. 根据实际读写调用点确认唯一业务 Owner 和跨域 readers，同时为本批次增加显式、失败关闭的遗留写策略：Owner 审查完成，但生产写入和生产晋升均为 false；使用冻结摘要保护 Owner、reader、分类、来源证据和写策略。
3. 登记 Owner 后继续沿用“有 Owner 即生产可写”的旧投影。
4. 立即把 19 个集合全部迁入 PostgreSQL 并切换生产写入。

## Advantages

- 方案 2 关闭首发范围的数据责任复核，不把 `shared`、`runtime`、组合根或引用文件自动变成数据 Owner。
- Owner、分类和 reader allowlist 来自实际命令、读取和模块边界；跨域写入被明确记录为待迁移债务。
- `owner-reviewed-legacy` 与既有 `owned-contract` 分离；原 60 个既有写合同保持兼容，新增 19 个集合固定 `productionWriteAllowed=false`。
- 决策摘要和来源引用漂移均失败关闭；删除 write policy、改为 true、篡改 Owner/reader 都有专项负向测试。
- 不改 `data/db.json`、SQLite、schema、公开 API 或部署状态。

## Disadvantages

- `domain-data-ownership` 的 schema 和集合治理摘要增加了一个兼容状态，调用报告的消费者需要理解 `ownerAssigned`、`authoritative` 与 `ownerReviewedLegacy` 的差异。
- 静态源码证据只能证明仓库调用边界，不能证明生产数据质量、实际流量或现场系统已接入。
- 19 个集合仍可通过遗留 JSON/SQLite 兼容路径参与本地功能；Owner 归属不会自动消除跨域直写或全量 state writer。
- 配置内保存来源路径会增加小幅维护成本；重命名调用文件时必须同步评审。

## Migration cost

低到中。升级 owner 清单至 1.2，登记 19 个唯一 Owner、分类、readers、来源证据和 fail-closed write policy；从未知集合 disposition 中移除同名项；扩展既有 collection governance、测试、六张地图和数据库治理文档。没有 DDL、数据回填、双写或生产切换。回滚可撤销本治理切片并恢复 19 个 `review-required`，不会修改业务数据。

## Risk

- Owner 判断错误：冻结摘要覆盖 Owner、reader、分类、来源证据和写策略，专项测试拒绝篡改；后续变更必须重新评审。
- 生产误放行：Owner-reviewed legacy 的生产写和晋升固定为 false，仍要求版本化写合同、migration/rollback、PostgreSQL 和外部现场证据。
- 兼容回归：既有 60 个 owner contract 的写投影保持原值；`blockedLegacy` 总数仍为 189，不把本次责任确认解释为数据迁移完成。
- 跨域写入：例如 T06 对 T05 `countyCollaborationOrders` 的兼容更新仍是债务；本 ADR 只确认 Owner，不授权重构运行时。
- 证据过度解读：源码路径、测试和摘要不是生产回执、审批、容量、恢复或 Go/No-Go 证据。

## Recommendation

采用方案 2。19 个集合进入 `first-release-legacy-owner-review.v1`，逐项保存唯一业务 Owner、最小 reader allowlist 和实际来源证据，并统一使用 `legacy-owner-review-write-policy.v1`。集合治理把它们投影为 `owner-reviewed-legacy`：Owner 已明确，但 `productionWriteAllowed=false`、`productionPromotionAllowed=false`、`migrationRequired=true`。既有明确合同保持既有行为。

任何后续生产晋升必须另行建立版本化写合同、migration、回填/核对、恢复、PostgreSQL 多实例与现场证据；不得仅修改本清单或摘要实现晋升。
