# ADR：required test 聚合覆盖全部独立高风险域

- 状态：Accepted
- 日期：2026-09-06
- Owner：T00
- 影响范围：GitHub Actions、地区矩阵、PostgreSQL 合同、治理/API、浏览器 E2E、发布就绪、主线 required check
- 替代：`2026-08-19-ci-risk-domain-job-split.md` 的三上游聚合拓扑

## Problem

主分支以 `complete-unit-test` 和聚合 `test` 为 required checks，但原 `test` 只依赖
`governance-api`、`browser-e2e` 和 `release-readiness`。已经独立执行的 `regional-foundation` 与
`postgres-production-contract` 即使失败、取消或跳过，聚合仍可能成功，分支保护无法表达完整风险域结果。

## Options

1. 保持三上游聚合，依赖维护者人工查看其余 job。
2. 把两个遗漏任务合并回治理/API job。
3. 保持任务隔离，让 required `test` 等待并检查五个高风险上游；`complete-unit-test` 仍独立 required。

## Advantages

- 方案 1 无迁移成本，但存在明确误放行路径。
- 方案 2 缩短依赖图，却重新耦合不同运行环境和失败域。
- 方案 3 不改变各任务内容或 required check 名称，并使失败、取消、跳过都由分支保护稳定感知。

## Disadvantages

- 方案 3 的聚合会等待更多任务，最慢风险域决定最终反馈时间。
- 五个上游名称成为 workflow 合同，重命名必须同步机器测试与本 ADR 的后续替代决策。
- 真实 PostgreSQL 合同没有凭据时仍可能按其自身规则跳过；聚合只能忠实传播 job 结果，不能伪造外部环境。

## Migration cost

低。只修改 `.github/workflows/ci.yml` 的 `needs`、结果环境变量和失败关闭循环，并同步机器契约与当前治理文档；
不改变应用运行时、API、数据库 schema、测试内容、部署拓扑或 required check 名称。

## Risk

- 错误引用 job 名会使聚合无法运行，因此 `test/process-worktree.test.js` 必须锁定五个依赖和五个结果变量。
- 聚合必须使用 `always()`，否则上游失败时自身会被跳过，required check 语义不完整。
- 任一结果只有精确 `success` 才可放行；不得把 `skipped`、`cancelled` 或空值当作成功。
- 本决策不证明真实 PostgreSQL、地区现场、浏览器或发布环境已经验收，生产状态仍为 `NO-GO`。

## Recommendation

采用方案 3。聚合 `test` 同时依赖 `regional-foundation`、`postgres-production-contract`、
`governance-api`、`browser-e2e` 和 `release-readiness`，使用 `always()` 并逐项要求 `success`。
`complete-unit-test` 保持独立 required，不重复并入该聚合。回滚仅回退 workflow、测试和本决策索引；无数据迁移或恢复步骤。
