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

---

## 2026-08-18 T06 临床五子域第一切片

- 分支：`process/t06-clinical-five-subdomains-20260818`
- 基线：`origin/main@58e05e56b2d97952c36aa05355c484821a74733e`
- 决策：采用模块化单体内五个可治理子域；方向已获用户批准。
- 范围：Accepted ADR、五子域机器注册表、API/数据/依赖盘点、跨子域契约、禁止依赖门禁、测试与地图同步。
- 非目标：不移动路由，不改 API/鉴权/schema/数据库/组合根/CI/部署，不创建微服务。
- 回滚：整提交回退；无 migration、数据写入或运行时状态变化。
- 下一切片：从急救子域选择一个已被特征测试保护的用例，定义最小端口并迁移；中央数据 Owner 与 CI 入口交 T00 handoff。

### 验收结果

- `process:verify`、`routes:check`、`routes:test`、`architecture:test` 均通过。
- 五子域专项回归 203/203 通过；新增治理测试 6/6 通过。
- `npm run check` 通过；锁文件依赖安装后 PostgreSQL 失败文件 11/11 通过。
- `test:all` 第 1–8、10 批通过；第 9 批 249/250，通过项之外仅有既有 `resident-mini-program-stage4` 哈希文本误报：构建产物的 SHA-256 摘要偶然包含 `123456`，被口令文本扫描误判。本 T06 切片不跨域修改 T04/T00 发布脚本。
- 主线仍缺少统一的 `build`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:smoke` 入口，继续按 `CURRENT_ARCHITECTURE.md` 的 T00 治理债务处理。

## 2026-08-18 T06 急救首个用例迁移

- 目标：将 `GET /api/emergency/dashboard` 的组合逻辑移到急救目标源码根。
- 范围：特征测试、`emergency-dashboard-query.v1`、旧路由兼容委托、注册表和地图同步。
- 非目标：不改路由顺序、公开协议、鉴权角色、数据、审计、运行时依赖清单、CI 或部署。
- 端口：`buildEmergencyDashboard`、`readBloodCoordination`；跨域契约仍为 `blood-emergency-coordination.v1` 兼容适配。
- 回滚：回退本切片提交即可恢复路由内联组合；无 migration 或数据恢复步骤。
- 下一切片：血液 dashboard 特征测试与最小查询端口。

### 验收结果

- 急救专项测试 84/84、路由测试 16/16、架构测试 36/36 通过；`npm run check` 通过。
- `process:verify -- --base=4d65eb1` 与 `process:verify -- --base=origin/main` 均通过，0 个所有权违规；临床五子域机器治理报告通过，API 路由字面量计数和各子域归属未漂移。
- `test:all` 第 1–8 批通过；第 9 批 250/251，仅命中已登记的 TEST-004 SHA-256 文本误报；被中断的第 10 批单独补跑 225/225 通过。
- 未改 API 响应、鉴权角色、数据库 schema、审计、路由顺序、中央运行时依赖清单、CI 或部署配置。
