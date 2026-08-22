# ADR：JSON/SQLite State Collection 的 Owner 与隔离治理

- 状态：Accepted
- 日期：2026-08-22
- Owner：T00 / 数据治理
- 影响范围：JSON/SQLite state collection 清单、数据 owner、源码使用证据、CI 与生产晋升

## Problem

当前 `data/db.json` 有 252 个顶层集合，`config/domain-data-ownership.json` 有 87 个 owner
合同，但只有 60 个合同集合存在于当前快照；另有 3 个既有系统集合，剩余 189 个集合没有
可证明的数据 owner。旧治理报告用统一的 `legacy-non-authoritative` 默认值覆盖这些集合，能阻止
生产写入，却不能区分源码仍引用与仅存在于种子的集合，也不能在新增、删除、重复登记、源码使用
漂移或错误 owner 时要求 review。把引用它的 route/process owner 直接当成数据 owner 会混淆源码
责任和数据权威，尤其会让 `shared`、`state-data` 等兼容边界获得不应有的所有权。

## Options

1. 保持统一的未注册默认策略，不建立逐集合状态和实际使用门禁。
2. 扩展现有 `collection-governance` 唯一链路：数据 owner 只取现有 owner/system 合同；从受跟踪
   运行时源码派生精确引用和 process owner 证据；对无 owner 集合显式登记
   `review-required` 或 `legacy-quarantined`，并在 CI 校验完整性、唯一性、使用漂移、共享边界和
   生产晋升失败关闭。
3. 根据文件路径或名称自动为所有集合分配数据 owner，并立即登记为生产候选。

## Advantages

- 方案 2 对 252/252 个当前集合给出机器状态，同时不伪造 189 个未知 owner。
- 继续以 `domain-data-ownership` 为唯一数据 owner 权威，process owner 只作为 review 证据，
  不形成第二份 owner 真相。
- 新集合、删除后的陈旧登记、重复状态、owner 冲突和源码引用变化都会使 CI 失败；生产晋升始终
  为 `false`，仓库检查不能替代 migration、回滚、现场审批或 PostgreSQL 证据。
- 保留现有报告/产品化调用接口和 JSON/SQLite 运行时行为，不修改 schema、数据或公开 API。

## Disadvantages

- 静态精确标识符引用只能证明“源码可见”，不能证明运行时读写频率、数据质量或生产必要性。
- 188 个 `review-required` 集合仍需各数据 owner 分批确认，治理状态完整不等于 owner 已补齐。
- 新源码引用可能要求同步移动隔离状态；这是有意的 review 成本。
- 运行时源码清单依赖 Git 跟踪文件，脱离仓库的发布包不能单独执行该 CI 级核验。

## Migration cost

低到中。复用既有模块、脚本、owner/process 清单和核心定义文档，新增一个只记录未明确集合状态的
治理配置、CI 验证和负向测试。无 DDL、数据回填、运行时双写或生产切换；回滚只需撤销本治理切片，
不会触碰 `data/db.json` 或数据库。

## Risk

- 将静态引用误称为实际生产使用会过度推断，因此报告明确使用 `source-referenced`/`seed-only`，
  不输出“活跃”结论。
- process owner 候选可能被误当数据 owner，因此每项固定 `ownerInferenceAllowed=false`，未知 owner
  保持 `unassigned`。
- 仅靠登记隔离状态可能掩盖长期债务，因此 DATA-003 只关闭“未分类”缺口，189 个集合的 owner
  确认/归档/迁移继续作为分批债务。
- 仓库证据若被用来授权生产会造成严重风险，因此所有集合的 `productionPromotionAllowed` 固定为
  `false`，生产仍为 `NO-GO`。

## Recommendation

采用方案 2。`config/domain-data-ownership.json` 继续是数据 owner 唯一事实，
`config/process-workstreams.json` 只提供源码责任证据，`CORE_DATA_DEFINITIONS.md` 只提供
closed-world 概念匹配。`config/state-collection-governance.json` 只登记无 owner 集合的 review/隔离
状态，不复制 owner。当前 252 个集合分类为：60 个快照内 owner 合同、3 个系统集合、188 个
`review-required`、1 个 `legacy-quarantined`；另有 27 个 owner 合同目前不在快照。任何晋升必须先
进入 owner 清单，补分类、reader、版本化写合同、migration/rollback，并另行取得生产证据与批准。
