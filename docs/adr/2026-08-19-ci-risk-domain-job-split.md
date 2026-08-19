# ADR：CI 按风险域拆分并保留聚合必需检查

- 状态：Accepted
- 日期：2026-08-19
- Owner：T00
- 影响范围：GitHub Actions、浏览器 E2E、发布就绪门禁、主线 required check

## Problem

综合 `test` 在一个 runner 上串行执行治理与 API、Chromium 系统依赖安装、36 个浏览器
E2E，以及约 60 项 readiness/report/deployment 命令。前一 ADR 将总预算从 10 分钟提高到
15 分钟，并明确规定若极端网络波动仍耗尽预算，应拆分 job 而不是继续放宽。

PR #125 的 run `32217049257` 两个 attempt 均在 15 分钟处取消。两次治理、架构、专项和
API 回归全部通过；`npx playwright install --with-deps chromium` 随后受 Ubuntu 镜像
访问异常影响运行约 11 分钟，E2E 和全部后续发布检查被跳过。人工重跑没有恢复，说明
单一 job 把三个不同风险域绑定在同一个时间预算和外部依赖故障中。

## Options

1. 维持单一 15 分钟 job，失败时继续人工重跑。
2. 只把 Chromium 安装和 E2E 移到独立 job，其他治理与发布步骤继续串行。
3. 拆为 `governance-api`、`browser-e2e`、`release-readiness` 三个并行 job，并由名称仍为
   `test` 的 fail-closed 聚合 job 统一表达 required check 结果。

## Advantages

- 方案 1 无配置迁移，但不解决已经重复发生的误取消。
- 方案 2 直接隔离外部浏览器依赖，改动较小。
- 方案 3 同时隔离治理/API、浏览器、发布三个风险域，失败定位清楚；Chromium 获得完整
  15 分钟预算，发布检查不再因浏览器下载被跳过；保留 `test` 名称，无需修改分支保护。

## Disadvantages

- 方案 1 依赖人工操作并继续跳过未执行的发布证据。
- 方案 2 的治理/API 与大量发布步骤仍共享串行预算，结构性耦合只解决一部分。
- 方案 3 会重复执行 checkout、Node setup 和 `npm ci`，增加 runner 启动和安装成本；
  workflow 结构与契约测试也更复杂。

## Migration cost

中。只调整 CI 拓扑和治理文档，不增加 npm/GitHub Action 依赖，不修改测试命令、运行时、
API、鉴权、数据库或部署拓扑。需要先以契约测试锁定 job 归属和聚合失败语义，再通过独立
T00 PR 实跑三个风险域，并在合并后刷新被旧 CI 阻塞的 PR。

## Risk

- 原单一 runner 中若存在未声明的临时文件依赖，拆分后会暴露失败；每个 job 必须只依赖
  仓库输入或自己生成的文件，PR 实跑作为最终验证。
- 新增 job 名称本身不是主分支 required check；必须保留聚合名称 `test`，且使用
  `always()` 检查所有上游结果，失败、取消和跳过均不得视为成功。
- Chromium 仍依赖外部软件源，独立预算只能隔离和容纳波动，不能保证外部服务永不失败。
- 并行 job 增加计算量；本决策不顺带引入缓存或新 Action，后续优化需单独评审供应链和
  缓存失效风险。

## Recommendation

采用方案 3。`governance-api` 使用 10 分钟预算，`browser-e2e` 与 `release-readiness`
各使用 15 分钟预算；最终 `test` 聚合 job 使用 5 分钟预算，只在三个上游结果均为
`success` 时成功。区域矩阵和 `complete-unit-test` 保持原预算与命令。

迁移通过独立 T00 PR 完成。不得删除 E2E、跳过 readiness、扩大超时、修改 required
check 或以重复重跑代替修复。回滚为回退本切片提交并恢复前一单体 job；无数据、制品或
运行时恢复步骤。本 ADR supersede `2026-08-19-ci-comprehensive-test-time-budget.md`
中关于单一综合 `test` job 的拓扑决定，15 分钟有界原则继续适用于拆分后的高风险 job。
