# ADR：生产 API 目录从现有授权清单派生并默认拒绝

- 状态：Accepted
- 日期：2026-08-22
- Owner：T00 集成治理；T01–T09 复核各自领域条目
- 影响范围：路由治理、API 授权矩阵、CI、六张地图和 API 变更流程

## Problem

主线已有模块化路由清单和 `api-authorization-matrix-v2`，能够扫描 `requireApiRole` 声明并锁定高风险接口，但没有把字面路由条件与授权声明按唯一 method/path 合并的生产 API 目录，也没有统一记录幂等分类与生产状态。手工新增完整 JSON 会复制近 600 个接口事实并迅速漂移；直接把授权矩阵称为生产目录，又会漏掉自定义 session/callback 鉴权入口，并忽略重复声明、运行时策略、幂等和外部证据边界。

## Options

1. 人工维护独立的完整 API JSON 清单，由 owner 在每次路由变化时同步更新。
2. 直接扩展授权矩阵，把授权声明、唯一接口、幂等和生产证据全部混为一个模型。
3. 保留授权矩阵作为声明级事实，新增只读派生目录，按 method/path 聚合并补充幂等观察、内部复核状态和固定生产 `NO-GO`。

## Advantages

- 方案 1 结构直观，可由人工精细填写。
- 方案 2 文件和命令最少。
- 方案 3 复用现有 `routeSourceFiles`、授权矩阵、高风险覆盖和 owner 结果，不复制路由事实；同时保留声明 variant，能够明确暴露静态解析和幂等复核缺口。
- 派生目录不写数据库、报告或发布物，输出可重建且不携带运行时敏感数据。

## Disadvantages

- 方案 1 会形成第二套权威清单，漏改或冲突难以及时发现。
- 方案 2 会把声明级与 endpoint 级语义混合，重复条件分支和 action 级授权难以表达。
- 方案 3 仍依赖静态启发式；动态变量、请求体分支和跨函数幂等实现不能完全解析，owner 必须继续做行为复核。
- 目录为所有接口保持 `NO-GO`，不能提供“仓库检查通过即上线”的便捷捷径。

## Migration cost

低到中等。新增一个派生脚本、专项负向测试、package 命令和 `governance-api` CI 步骤；同步 ADR、操作文档和六张地图。不改变 HTTP method/path、路由顺序、运行时依赖、响应、数据库 schema、集合或部署拓扑。

## Risk

- 字符串源码扫描可能把邻近代码的标记归入当前 handler，或漏掉跨函数实现；因此 `source-marker-observed` 只是一项待行为测试核验的观察结果，不能证明幂等。
- 同一 endpoint 的多个 body/action 分支可能具有不同角色和范围；目录必须保留 variants，不能只输出合并角色后宣称细粒度授权完成。
- 动态 path/role 若被猜测为字面值，会产生虚假安全结论；未解析项必须保留 `runtime-policy` 阻断。
- 目录数量会随真实路由变化；当前门禁同时锁定经评审的精确基线，并校验目录与授权矩阵及字面路由清单两类输入源的并集相等。真实增删路由时必须由 owner 同步评审并显式更新基线，不能只改绝对数字绕过集合校验。
- 真实 provider、证书、网络、数据库、安全评估、灾备和现场签字仍不在仓库证明范围内。

## Recommendation

采用方案 3。`api-authorization-matrix-v2` 保持声明级输入，`production-api-catalog-v1` 作为唯一 endpoint 级派生目录。每个条目必须包含 method/path/owner/auth/roles-or-scope/idempotency/production status，并保留全部源码声明。

安全方法标为 `not-required-safe-method`；写方法只记录 `source-marker-observed` 或 `not-observed`，不得自动升级为“幂等已证明”。所有条目固定 `NO-GO`、`productionReady=false` 和外部证据阻断。CI 必须拒绝目录缺失、重复、授权/范围/幂等分类不完整及任何生产放行状态回流。

回滚可删除派生脚本、命令和 CI 步骤，不需要数据回滚；现有授权矩阵与路由实现保持不变。若未来引入 AST 或显式路由合同，应以新的 ADR 迁移输入源，并在兼容期比较两套输出后再替换，不能直接删除现有门禁。
