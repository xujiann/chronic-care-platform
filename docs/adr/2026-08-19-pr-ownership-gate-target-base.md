# ADR：PR 所有权门禁跟随目标集成分支

- 状态：Accepted
- 日期：2026-08-19
- Owner：T00
- 影响范围：GitHub Actions、process 分支所有权校验、PR 交付基线

## Problem

`main` 已由 Accepted ADR 定义为唯一集成主干，但 CI 只为特定的
`process/t00-*-baseline-*` 分支显式使用 `origin/main`。其他从最新 main 创建的
`process/*` 分支仍由 `process:verify` 默认对比固定 `baselineTag`。当 main 在该标签
之后继续演进时，门禁会把 main 已有的跨进程文件误算为当前 PR 变更，产生与 PR
实际 diff 不一致的越权结果。PR #122 证明该问题会在真实交付中阻断正确的 T06 变更。

## Options

1. 维持固定 `baselineTag` 作为所有 process PR 的默认 CI 比较基线。
2. 所有 process PR 均使用 GitHub 事件提供的目标分支作为 CI 比较基线；固定标签继续用于可复现工作树和发布证据。
3. 要求所有从最新 main 创建的领域分支改名为 T00 baseline 分支，以复用现有例外。

## Advantages

- 方案 1 无需修改 CI，固定标签便于重复比较。
- 方案 2 使所有权检查与 GitHub 实际 PR diff、唯一集成主干和最新 main 开发流程一致，同时保留固定标签的发布用途。
- 方案 3 改动最少，现有特殊条件可继续工作。

## Disadvantages

- 方案 1 会随着 main 演进持续产生假阳性，并阻断合法领域 PR。
- 方案 2 依赖 GitHub PR base ref；workflow 必须正确引用、获取并引用远端目标分支。
- 方案 3 会伪造进程 Owner，绕过而不是修复所有权语义，并使审计记录失真。

## Migration cost

低。修改一个 CI shell 条件，增加确定性 workflow 契约测试，更新 PR 模板与治理文档。
不涉及业务代码、依赖、数据迁移、部署拓扑或运行时状态。

## Risk

- 若目标 ref 解析错误，比较范围可能过宽或验证命令失败；CI 使用 GitHub 提供的
  `GITHUB_BASE_REF`，变量全程加引号并显式 fetch 远端 ref。
- push 到 main 时不存在 PR base ref；main 本身由 `process:verify` 识别为 T00 集成分支并跳过领域所有权比较。
- 该决策不允许降低 required checks，也不改变固定标签的发布证据和恢复点语义。

## Recommendation

采用方案 2。对所有 `process/*` PR 读取 `GITHUB_BASE_REF`，缺省仅回退到唯一集成
分支 `main`，fetch 后以 `origin/<base>` 调用 `process:verify`。删除仅匹配 T00 baseline
命名的例外。增加测试锁定该条件、远端 fetch、显式 `--base` 和 PR 模板的真实基线字段。

迁移期间先由独立 T00 PR 合入 main，再更新被旧门禁阻断的领域 PR 并重跑 CI。
回滚只需回退该 T00 提交；不得通过改名领域分支、删除检查或扩大 T00 权限来绕过门禁。
