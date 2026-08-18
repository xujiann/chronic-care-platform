# 2026-08-18 T00 治理基线计划

- 分支：`process/t00-governance-baseline-20260818`
- 基线：`origin/main@b1e4898`
- 状态：文档迁移、专项门禁与只读 review 完成；全量测试存在 1 个已定位的主线基线误报，待提交审批
- Owner：T00

## 目标

在独立主线工作树中迁移并重新验证第一版工程治理材料，不覆盖现有 T00–T09 规则，不实施运行时代码修复。

## 范围

- 六张主线 AS-IS 地图；
- 体检、治理、路线图、模块/接口/测试保护；
- schema、数据库标准、核心定义；
- ADR 台账和 Proposed 安全决策；
- 对主线现有 AGENTS/路由工作流做兼容补充。

## 非目标

- 不改 `server.js`、路由、身份、审计、Service Worker 或页面代码。
- 不改 package scripts、依赖、CI、schema、migration、数据库和 `data/db.json`。
- 不生成或修改报告、PDF、归档和发布制品。
- 不 push、不创建 PR、不 merge，除非另有明确授权。

## 验证

- 文档链接和 ADR 必填段落；
- 主线事实重新采样；
- `npm run process:verify`；
- `npm run routes:check`、`routes:test`；
- `npm run architecture:test`、`process:test`；
- 如无新运行时代码，完整 `test:all` 依据时间和副作用评估后执行或明确未运行。

## 验证结果

- `npm ci`：通过。
- `npm run process:verify -- --base=origin/main`：通过，0 个所有权违规。
- `npm run process:test`：6/6 通过。
- `npm run routes:check`：通过；`npm run routes:test`：16/16 通过。
- `npm run architecture:test`：36/36 通过。
- `npm run platform:iterations:test`：85/85 通过。
- `npm run check`：通过。
- `npm run test:all`：前 8 批通过，第 9 批 235/236 通过，第 10 批单独补跑 221/221 通过；唯一失败为 `resident-mini-program-stage4.test.js` 的发布制品演示凭证扫描。
- 失败根因：`release-manifest.json` 的 `deterministicSourceDigest` 恰好包含字符串 `888888`，正则把 SHA-256 摘要误判为演示验证码；源资产扫描本身通过。本任务按批准边界只登记，不修改脚本、测试或运行时代码。
- 文档相对链接、ADR 必填段落、`git diff --check`：通过。
- 受保护数据、SQLite、生成报告、归档和发布制品：无变更。

## 完成条件

- 没有旧分支数字冒充主线事实；
- 不重复已有 mainline/modular-monolith ADR；
- 主线所有权和生产 NO-GO 不被降级；
- Git diff 仅含批准的治理文档；
- review 无未处理 P0/P1 文档一致性问题。

当前仅剩提交/PR 方向确认；不自动 commit、push、创建 PR 或 merge。
