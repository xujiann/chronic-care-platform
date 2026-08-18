# 2026-08-18 T00 治理基线计划

- 分支：`process/t00-governance-baseline-20260818`
- 基线：`origin/main@b1e4898`
- 状态：文档迁移、专项门禁与只读 review 已通过 PR #120 合入主线；全量测试的 1 个主线基线误报已登记
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

第一阶段已通过 PR #120 完成审批并合入主线。

---

## 今日第二阶段：静态内容安全边界

- 分支：`process/t00-static-content-boundary-20260818`
- 基线：`main@58e05e56b2d97952c36aa05355c484821a74733e`
- 决策：静态内容 ADR 方案 3 已获用户审批并标记 Accepted。
- 范围：44 个入口资产盘点；Node/Pages 共用显式发布清单；合成脱敏演示快照；Service Worker 缓存迁移；敏感路径负向测试；文档与治理地图同步。
- 非目标：不改变 API 鉴权语义，不修改数据库、SQLite、migration 或 `data/db.json`，不实施审计链等其他运行时修复。
- 回滚：回退本实现提交并部署前一制品，仅限应急；旧静态暴露风险会恢复，再前滚时需再次提升缓存版本。
- 验证结果：`static:test` 6/6、授权边界 5/5、API 44/44、静态/存储/混合部署 82/82、路由 16/16、架构 36/36、流程 6/6、平台迭代 85/85、部署检查通过。
- 浏览器 E2E：全套首跑 34/36；静态姓名掩码断言同步后与既有超时恢复波动用例定向复跑 2/2 通过。
- `test:all`：第 1–8 批通过；第 9 批 249/250，唯一失败仍为已登记 TEST-004（摘要偶然含 `888888`）；第 10 批单独补跑 225/225 通过。
- 当前状态：实现、门禁和最终只读 review 完成；提交后进入 PR 审批，未合入前不视为生效。
