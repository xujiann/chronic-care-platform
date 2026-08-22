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
- 迁移复验基线：`main@29e01ce7e72fa32464038dbe1ebcddd230f48f1e`
- 决策：静态内容 ADR 方案 3 已获用户审批并标记 Accepted。
- 范围：44 个入口资产盘点；Node/Pages 共用显式发布清单；合成脱敏演示快照；Service Worker 缓存迁移；敏感路径负向测试；文档与治理地图同步。
- 非目标：不改变 API 鉴权语义，不修改数据库、SQLite、migration 或 `data/db.json`，不实施审计链等其他运行时修复。
- 回滚：回退本实现提交并部署前一制品，仅限应急；旧静态暴露风险会恢复，再前滚时需再次提升缓存版本。
- 验证结果：`static:test` 6/6、授权边界 5/5、API 44/44、静态/存储/混合部署 82/82、路由 16/16、架构 36/36、流程 6/6、平台迭代 85/85、部署检查通过。
- 浏览器 E2E：全套首跑 34/36；静态姓名掩码断言同步后与既有超时恢复波动用例定向复跑 2/2 通过。
- `test:all`：第 1–8 批通过；第 9 批 249/250，唯一失败仍为已登记 TEST-004（摘要偶然含 `888888`）；第 10 批单独补跑 225/225 通过。
- 当前状态：已通过 PR #121 合入 `main@6c18221`，静态内容安全边界已在主线生效。

### 最新 main 迁移复验

- 已合并 `main@29e01ce`（PR #125 的 TEST-004 修复），仅 `TODAY_PLAN.md` 与 ADR 台账发生文本冲突，按双方已生效事实保留后完成迁移。
- `static:test` 6/6、HTTP/API/存储/混合部署回归 131/131、浏览器 E2E 36/36、路由 16/16、架构 36/36、流程 8/8、平台迭代 85/85、`check` 与 `deploy:check` 均通过。
- `test:all` 10/10 批全部通过，TEST-004 不再误报；生产依赖审计为 0 个漏洞。
- `process:verify -- --base=origin/main` 检查 43 个变更文件，0 个所有权违规；未修改数据库、SQLite、migration、`data/db.json`、生成报告或归档制品。
- 主线验收：PR #121 的 8 项检查全部通过；合并后 CI 与 Pages 均在 `main@6c18221` 成功。
- 当前状态：本方向已完成；后续新增静态入口、模板例外或公开数据字段必须继续通过 manifest、脱敏和负向测试门禁。

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

## 2026-08-18 T06 血液首个用例迁移

- 目标：将 `GET /api/blood-system` 的 Dashboard 组合和机构范围投影移到血液目标源码根。
- 范围：特征测试、`blood-dashboard-query.v1`、旧路由兼容委托、注册表和地图同步。
- 非目标：不改公开协议、鉴权角色、候选集合 Owner、schema、审计、运行时依赖清单、CI 或部署。
- 端口：`buildBloodDashboard`、`normalizeTransactionState`；保留 GET 中既有的交易数组内存补齐顺序，但不调用持久化写入。
- 回滚：回退本切片提交即可恢复路由内联组合；无 migration 或数据恢复步骤。
- 下一切片：影像公开 Dashboard 特征测试与最小查询端口。

### 验收结果

- 新增查询/路由/治理专项 15/15、血液相关 17 个文件 79/79、路由测试 16/16、架构测试 36/36 通过；`routes:check` 检查 64 个文件通过，`npm run check` 通过。
- readiness 已改为同时验证旧路由委托和新查询投影；新增缺少查询投影时 fail-closed 的负向测试，readiness 3/3 通过。
- `process:verify -- --base=21ddd3c` 与 `process:verify -- --base=origin/main` 均通过，0 个所有权违规；临床五子域机器治理报告仍为 136 个 API 字面路径、9 个登记集合、66 个候选集合和 3 个跨域契约。
- `test:all` 第 1–8 批通过；第 9 批 246/247，仅命中已登记 TEST-004 SHA-256 文本误报；第 10 批单独补跑 238/238 通过。
- 未运行不存在的 `build`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:smoke` 标准入口；该缺口仍由 T00 的 TEST-001 处理。

## 2026-08-18 T06 影像首个用例迁移

- 目标：将 `GET /api/imaging-cloud` 的构建、脱敏和公开投影移到影像目标源码根。
- 范围：特征测试、`imaging-dashboard-query.v1`、公开响应净化归位、旧导出兼容、注册表和地图同步。
- 非目标：不改角色、居民范围、安全/访问审计语义、公开字段、schema、运行时依赖清单、CI 或部署。
- 端口：`buildImagingDashboard`、`redactSensitiveResponse`；公开响应策略由影像子域维护，HTTP 适配器保留居民范围和审计持久化。
- 回滚：回退本切片提交即可恢复路由内联组合和原净化函数位置；无 migration 或数据恢复步骤。
- 下一切片：体检 Dashboard 特征测试与最小查询端口。

### 验收结果

- 新增查询/路由/治理专项 17/17、影像相关 12 个文件 49/49、影像 readiness 27/27 通过；readiness 仍明确为正式 `NO-GO`，未把代码就绪冒充现场生产就绪。
- 路由测试 16/16、架构测试 36/36 通过；`routes:check` 检查 64 个文件通过，`npm run check` 通过。
- `process:verify -- --base=f998d97` 与 `process:verify -- --base=origin/main` 均通过，0 个所有权违规；临床五子域机器治理报告仍为 136 个 API 字面路径、9 个登记集合、66 个候选集合和 3 个跨域契约。
- `test:all` 第 1–8 批通过；第 9 批 250/251，仅命中已登记 TEST-004 SHA-256 文本误报；被中断的第 10 批 35 个文件单独补跑 244/244 通过。
- 未运行不存在的 `build`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:smoke` 标准入口；该缺口仍由 T00 的 TEST-001 处理。
- 未改公开 API、鉴权角色、数据库 schema、居民范围、安全/访问审计顺序、中央运行时依赖清单、CI 或部署配置。

## 2026-08-19 T06 体检首个用例迁移

- 晨检：`origin/main@58e05e5` 未变化，主线 CI/Pages 通过；开放 PR #121 检查全绿、无 review decision；当前 T06 分支无 PR且工作树起始干净。
- 目标：将 `GET /api/physical-exams` 的 Overview 构建、生产 readiness 和角色投影移到体检目标源码根。
- 范围：特征测试、`physical-examination-dashboard-query.v1`、旧路由兼容委托、readiness 机器门禁、注册表和地图同步。
- 非目标：不改路由顺序、公开协议、鉴权角色、居民范围、审计/脱敏顺序、候选集合 Owner、schema、CI、依赖或部署。
- 端口：`buildPhysicalExamOverview`、`buildPhysicalExamReadiness`；授权集合、生产标志、访问审计持久化和最终脱敏保留在 HTTP/平台适配层。
- 风险：citizen 投影若漂移可能暴露联调或网关明细；审计与脱敏重排可能改变失败语义。因此用特征测试锁定字段和调用顺序。
- 回滚：回退本切片提交即可恢复路由内联构建；无 migration 或数据恢复步骤。
- 下一切片：质量安全 Dashboard 特征测试与最小只读查询端口。

### 验收结果

- 重构前特征测试 7/7 通过；重构后新增查询/路由测试 11/11、查询/路由/治理专项 17/17、体检相关核心回归 27/27、`physical-examination:test` 21/21 通过。
- 路由测试 16/16、架构测试 36/36 通过；`routes:check` 检查 64 个文件通过，`npm run check` 通过。
- `process:verify -- --base=201cfd9` 与 `process:verify -- --base=origin/main` 均通过，0 个所有权违规；临床五子域机器治理报告仍为 136 个 API 字面路径、9 个登记集合、66 个候选集合和 3 个跨域契约。
- `test:all` 第 1–8 批通过；第 9 批 246/247，仅命中已登记 TEST-004 SHA-256 文本误报；第 10 批 37 个文件单独补跑 253/253 通过。全量清单共 397 个测试文件，失败测试位于索引 354，剩余清单已全部覆盖。
- 未运行不存在的 `build`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:smoke` 标准入口；该缺口仍由 T00 的 TEST-001 处理。
- 未改公开 API、鉴权角色、数据库 schema、居民范围、访问审计与脱敏顺序、中央运行时依赖清单、CI 或部署配置。
---

## 2026-08-19 T00 PR 所有权基线修复

- 分支：`process/t00-ci-pr-base-20260819`
- 基线：`origin/main@58e05e56b2d97952c36aa05355c484821a74733e`
- 问题：普通 `process/*` PR 的 CI 默认对比固定旧标签，最新 main 分支会把主线已有文件误判为跨进程越权。
- 决策：PR 所有权门禁使用 `GITHUB_BASE_REF` 指向的目标集成分支；固定 `baselineTag` 继续服务于可复现工作树和发布证据。
- 范围：CI workflow、回归测试、Accepted ADR、PR 模板和治理文档同步。
- 非目标：不改变进程 Owner、required checks、业务代码、运行时、数据库、API、鉴权、审计或部署产物。
- 风险：错误或未引用的 base ref 可能扩大比较范围；通过固定 PR 触发目标、引用远端 ref、shell 引号和回归测试控制。
- 回滚：回退本切片提交即可恢复原条件；无数据或制品恢复步骤。
- 后续：本 T00 修复合入 main 后，更新 T06 PR #122 并重跑 CI。

### 验收结果

- 重构前 workflow 契约测试 6/7，通过项之外的新测试按预期失败；修复后 `process:test` 7/7 通过。
- workflow YAML 解析通过；使用 Git for Windows Bash 真实执行 process PR 分支、`GITHUB_BASE_REF=main` 和显式远端基线路径通过。系统 WSL Bash 不可用，已使用 CI 同类 Bash 语义验证；本机未安装 `actionlint`。
- `process:verify -- --base=origin/main` 与 T00 默认基线验证均通过，0 个所有权违规；`routes:check` 检查 64 个文件、`routes:test` 16/16、`architecture:test` 36/36、`platform:iterations:test` 85/85、`npm run check` 均通过。
- `test:all` 第 1–8 批通过；第 9 批 235/236，仅命中已登记 TEST-004 SHA-256 文本误报；第 10 批 28 个文件单独补跑 221/221。全量清单共 388 个测试文件，失败测试位于索引 345，失败点后的清单已全部覆盖。
- 未运行不存在的 `build`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:smoke` 标准入口；该缺口仍由 TEST-001 跟踪。
- 未改业务代码、API、鉴权、审计、数据库、schema、migration、依赖、required checks 或部署产物；受保护数据和生成制品无变更。

---

## 2026-08-19 T00 综合 CI 时间预算修复

- 分支：`process/t00-ci-timeout-20260819`
- 基线：`origin/main@faad45c792609e14b097400b054a2e0858b78f24`
- 问题：PR #122 合并后的 main CI 两次在综合 `test` 的 10 分钟硬上限处取消；已完成步骤没有测试失败，取消均发生在浏览器 E2E。
- 决策：仅把综合 `test` 调整为 15 分钟；区域矩阵继续为 5 分钟，complete-unit-test 继续为 10 分钟。
- 范围：CI workflow、配置回归测试、Accepted ADR、依赖地图和技术债同步。
- 非目标：不拆分 job，不改变 required checks、测试命令、业务代码、API、鉴权、数据库、依赖或部署产物。
- 风险：更长预算会延迟真实挂起的反馈；通过固定 15 分钟上限、保持专项 job 较短及后续 CI-001 拆分债务控制。
- 回滚：回退本 T00 提交即可恢复 10 分钟；无数据、制品或运行时恢复步骤。

### 验收结果

- 回归测试按预期先红后绿：修改 workflow 前 `process:test` 7/8，仅新增时间预算契约失败；调整后 8/8 通过。workflow YAML 解析及 `git diff --check` 通过。
- `process:verify -- --base=origin/main` 通过，7 个变更文件、0 个所有权违规；`routes:check` 检查 64 个文件、`routes:test` 16/16、`architecture:test` 36/36、`platform:iterations:test` 85/85、`npm run check` 均通过。
- `npm ci` 成功。`test:all` 第 1–8 批通过；第 9 批 246/247，仅命中已登记 TEST-004 的确定性 SHA-256 文本误报；第 10 批 37 个文件单独补跑 253/253 通过。全量清单共 397 个测试文件，失败测试及相关 8 个源文件、发布脚本均与 `origin/main` 一致。
- 未运行不存在的 `build`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:smoke` 标准入口；该缺口仍由 TEST-001 跟踪。
- 未改业务代码、API、鉴权、审计、数据库、schema、migration、依赖、required checks 或部署产物；GitHub Actions 结果在 PR 与合并后 main 验证中留证。

---

## 2026-08-19 T00 TEST-004 结构化制品扫描修复

- 分支：`process/t00-test004-structured-scan-20260819`
- 基线：`origin/main@dcfbed160d415104a012c8b1da43bc41e7b86134`
- Owner：T00；方向依据：ROADMAP 优先级 11、TECH_DEBT TEST-004 及用户批准的下一审批建议。
- 问题：居民小程序发布检查把整个 JSON 制品当作文本扫描；Windows 工作树生成的 `deterministicSourceDigest` 恰好包含 `888888`，导致安全软件候选误报失败。
- 方案：JSON 制品只递归扫描语义字符串值，并仅在 `sha256`、`deterministicSourceDigest` 字段包含合法 64 位十六进制摘要时跳过；非 JSON 制品继续按原文本规则扫描。真实 `123456`、`888888` 或 `DEMO-MOBILE` 字符串仍必须失败。
- 备选：保留全文扫描并接受重跑会继续误报；只排除当前摘要文本容易依赖具体哈希；建立通用制品扫描框架会扩大本次范围。选择最小的结构化递归检查。
- 范围：发布脚本、阶段四回归测试、第四阶段说明、路线图、技术债和当天计划。
- 非目标：不改小程序业务代码、平台壳字段、公开 CLI/产物结构、API、鉴权、数据库、依赖、CI、required checks 或部署拓扑。
- 风险：跳过字段过宽会漏报真实凭据；因此忽略集合只包含两个精确摘要键、值还必须满足 SHA-256 格式，并用语义字段及伪造摘要负向 fixture 锁定 fail-closed 行为。
- 迁移与回滚：无 schema、数据或制品迁移；回退本切片提交即可恢复原扫描方式。
- 验收：先确认基线 8/9 失败，再以摘要正例和真实演示凭据负例驱动修复；运行居民小程序专项、process/routes/architecture/platform/check、`test:all` 及 PR/main CI。

### 验收结果

- 测试先行按预期先红后绿：基线阶段四 8/9，仅摘要误报失败；新增回归后旧实现 8/10，分别因缺少结构化扫描器和既有误报失败；修复后阶段四 10/10、居民小程序专项 56/56 通过。
- 摘要 fixture 中 `deterministicSourceDigest` 命中 `888888`、`sha256` 命中 `123456` 均放行；语义字符串中的 `888888`、`123456`、`DEMO-MOBILE`、伪造的非摘要 `sha256` 和非 JSON 文本均拒绝。扫描器只忽略两个精确摘要键下合法的 64 位十六进制摘要值。
- 中文门禁和居民小程序 readiness 通过；独立发布命令返回 `softwareReady: true`、`productionReady: false`，保持正式平台与五类外部服务的 NO-GO 阻断；居民小程序 E2E 13/13 通过并正常释放测试端口。
- `process:verify -- --base=origin/main` 通过，6 个变更文件、0 个所有权违规；`process:test` 8/8、`routes:check` 64 个文件、`routes:test` 16/16、`architecture:test` 36/36、`platform:iterations:test` 85/85、`npm run check` 与 `deploy:check` 均通过。
- `npm ci` 成功；`test:all` 共 397 个测试文件、10/10 批全部通过，原第 9 批 TEST-004 误报不再出现，第 10 批 253/253 通过。
- 未运行不存在的 `build`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:smoke` 标准入口；该缺口仍由 TEST-001 跟踪。
- 未改 API、鉴权、审计、数据库、schema、migration、依赖、CI、required checks、产物结构或部署拓扑；系统临时目录之外无生成制品变更。

---

## 2026-08-19 T00 CI 风险域作业拆分

- 分支：`process/t00-ci-browser-job-20260819`
- 基线：`origin/main@dcfbed160d415104a012c8b1da43bc41e7b86134`
- 状态：PR #126 已合入 `main@02624d9`；PR 与合并后 main 的 GitHub Actions、Pages 均通过
- Owner：T00

### 问题与证据

PR #125 的综合 `test` 在两个 attempt 中均达到 15 分钟硬上限。两次均已通过治理、
架构、专项和 API 回归，随后 `npx playwright install --with-deps chromium` 因 Ubuntu
镜像访问异常运行约 11 分钟后被取消，浏览器 E2E 与后续约 60 项发布检查全部跳过。
这满足上一份时间预算 ADR 的升级条件：不得继续增加超时或依赖人工重跑，应按风险域拆分。

### 批准范围

- 将治理/架构/专项/API 门禁迁入 `governance-api` job。
- 将 Chromium 安装和 `npm run test:e2e` 迁入独立 `browser-e2e` job。
- 将部署、数据库、安全、报告、发布制品与依赖审计迁入 `release-readiness` job。
- 新增 fail-closed 聚合 job，继续使用必需检查名称 `test`，只有三个上游 job 全部
  `success` 才成功。
- 新增 Accepted ADR、确定性 workflow 契约测试，并同步路线图、依赖地图和技术债。

### 非目标

- 不删除、跳过或放宽任何测试和发布门禁，不继续增加 15 分钟风险域预算。
- 不修改 GitHub 分支保护中的 `complete-unit-test`、`test` required check 名称。
- 不增加 npm 或 GitHub Action 依赖，不引入浏览器缓存，不改变 Playwright 命令。
- 不修改业务运行时、API、鉴权、审计、数据库、schema、migration 或部署拓扑。
- 不修改 TEST-004 分支和 PR #125 的代码提交。

### 风险、迁移与回滚

- 三个 job 各自执行 checkout、Node setup 和 `npm ci`，会增加少量 runner 启动与安装成本；
  换取并行执行、故障隔离和完整门禁覆盖。
- 拆分可能暴露步骤之间未声明的临时文件依赖；通过本地逐链验证和 GitHub PR 实跑验证。
- `test` 聚合使用 `always()`，上游失败、取消或跳过均 fail-closed，不得把取消误报为成功。
- 回滚为回退本切片提交，恢复单一 15 分钟综合 job；不涉及数据或运行时恢复。

### 测试与完成条件

- 先新增 workflow 契约测试并确认旧配置失败，再实施 job 拆分至测试通过。
- 验证 workflow YAML、`process:verify`、`process:test`、`routes:check`、`routes:test`、
  `architecture:test`、`platform:iterations:test`、`npm run check` 和 `npm run test:all`。
- 执行完整 `npm run test:e2e` 和部署检查；不得提交生成报告或发布制品。
- 创建独立 Draft PR，确认三个风险域 job 与聚合 `test` 在 GitHub Actions 实际通过后再合并。
- 合并后刷新 PR #125，确认 TEST-004 在新 CI 拓扑下全绿。

### 本地验收结果

- 测试先行：旧 workflow 下 `process:test` 7/8，仅新增拆分契约按预期失败；实施后
  `process:test` 8/8、workflow 相关合计 10/10 通过。
- workflow YAML 解析与 `git diff --check` 通过；聚合 test 的 `always()`、三个 needs
  结果和非 success 时 `exit 1` 均由契约测试锁定。
- `process:verify -- --base=origin/main` 通过，9 个预期文件、2 个 T00 保护文件、0 违规。
- `routes:check` 检查 64 个文件，`routes:test` 16/16、`architecture:test` 36/36、
  `platform:iterations:test` 85/85、`npm run check` 和 `npm run deploy:check` 均通过。
- 完整 `npm run test:e2e` 36/36 通过，覆盖居民、角色、越权、移动端和跨门户旅程。
- `npm run test:coverage` 194/194 通过；server.js 行 85.18%、函数 87.37%、分支 56.47%。
- `test:all` 前 8 批通过，第 9 批 246/247，仅为主线已登记且由 PR #125 修复的
  TEST-004 Windows SHA-256 文本误报；第 10 批 37 个文件单独补跑 253/253 通过。
- `npm audit --omit=dev --registry=https://registry.npmjs.org`：0 漏洞。本机用户级
  npmmirror 不实现 audit endpoint，因此未把镜像 404 误报为依赖漏洞。
- 不存在统一 `build`、`lint`、`typecheck`、`test:unit`、`test:integration`、
  `test:smoke` 入口，继续由 TEST-001 跟踪；本任务未伪造这些命令。
- 未修改业务代码、API、鉴权、审计、数据库、schema、migration、依赖、分支保护或
  部署拓扑；受保护数据和生成制品无跟踪变更。Linux Chromium 在 PR 与 main runner
  均安装成功，browser-e2e、complete-unit-test 和聚合 test 全部通过。

---

## 2026-08-19 T00 静态安全边界合并后治理收口

- 分支：`process/t00-governance-closeout-20260819`
- 基线：`origin/main@6c182218cddebb639904b6537b351386dfbeeb67`
- 目标：把 PR #121 已合入、PR/main CI 与 Pages 已通过的事实同步到治理入口、六张地图、路线图、技术债和 Accepted ADR。
- 范围：仅治理 Markdown；SEC-001、SEC-002 从未决 P0 移入已关闭，并保留仓库历史分类的 DATA-006 残余风险。
- 非目标：不修改运行时代码、API、鉴权、审计语义、数据库、schema、migration、依赖、CI、部署配置或生成制品。
- 回滚：回退本纯文档提交即可；不涉及数据、缓存、服务或发布制品恢复。

### 验收结果

- `process:verify -- --base=origin/main`：11 个文档文件、0 个所有权违规；`git diff --check` 通过。
- `process:test` 8/8、`routes:check` 64 个文件、`routes:test` 16/16、`architecture:test` 36/36、`platform:iterations:test` 85/85 通过。
- `npm run check`、`npm run deploy:check` 通过；`npm run test:all` 10/10 批全部通过。
- 未修改受保护数据、SQLite、数据库文件、报告、PDF、归档或发布制品。

---

## 2026-08-19 T00 SEC-003 审计链失败语义 ADR

- 分支：`process/t00-audit-chain-semantics-adr-20260819`
- 基线：`origin/main@c41e8c0eb45c1ed090279738e3ac6b82bd9a91d3`
- 目标：基于只读实现、测试和种子采样形成审计链失败语义、兼容迁移与回滚边界。
- 证据：验证器在组合根与留存脚本重复；`linkBroken` 不影响 `passed`；普通字段哈希漂移可能通过；部分 API 在验证前重封访问日志。
- 采样：跟踪种子的安全事件 120 行、访问日志 10 行均无当前哈希或链接漂移；该结果不替代外部环境 preflight。
- 推荐：版本化严格验证 + 原始摘要封存 + 经独立审批的一次性旧链基线迁移；禁止读取时静默重封。
- 状态：仅建立 Proposed ADR，等待 T00、T01、审计/留存 Owner 决策；不授权运行时实现。
- 非目标：不改 API、鉴权、审计数据、数据库、schema、migration、依赖、CI、部署配置或生成制品。
- 回滚：回退本纯文档提交即可；不存在数据或运行时恢复步骤。

### 验收结果

- `process:verify -- --base=origin/main`：8 个文档文件、0 个所有权违规；ADR 必填章节和 `git diff --check` 通过。
- `process:test` 8/8、`routes:check` 64 个文件、`routes:test` 16/16、`architecture:test` 36/36、`platform:iterations:test` 85/85 通过。
- `npm run check`、`npm run deploy:check` 通过；`npm run test:all` 10/10 批全部通过。
- 未修改运行时、API、数据库、审计行、受保护数据、报告、PDF、归档或发布制品。

---

## 2026-08-20 T00 SQLite migration 与核心 Schema 冻结实施

- 分支：`process/t00-sqlite-migration-governance-20260820`
- 基线：`origin/main@a15d10dc67a7fd89540d3073ece34b5d8c7b942e`
- 决策：执行 Accepted ADR `2026-08-18-sqlite-migration-and-core-schema-freeze`，两个审批方向均已通过。
- 目标：关闭 DATA-001/002，把 v1–v14 从组合根迁入独立连续注册表，冻结历史定义并统一公开 schema head v14。
- 范围：migration registry/runner、`server.js` 委托、部署/生产就绪/发布门禁、因单一新增注册表依赖而精确校准的组合根 require 预算、专项测试和治理文档。
- 非目标：不修改 `data/db.json`、SQLite/WAL/SHM、PostgreSQL、业务数据、API 字段形状、鉴权、审计语义、依赖或部署拓扑。

### 兼容、风险与回滚

- v1–v14 继续使用既有 `version:name` ledger checksum，避免拒绝已部署数据库；源码由固定内容 SHA-256 独立保护。
- v15+ 才把内容 SHA-256 写入 ledger；runner 在迁移前拒绝非连续 ledger、名称或 checksum 漂移。
- 每个 migration 与 ledger 插入在同一事务内；失败回滚不留下半结构或版本行。
- 机械对比 `origin/main` 的内联 v1–v14 与新注册表（仅忽略新增指纹依赖元数据）完全相等：19,148 字符，SHA-256 `72a2e54a1943d2c6b7cd5bc94855461583b96d8c0da82bb874a5e3b0619c4832`。
- 回滚代码提交即可恢复旧 runner；已存在 v1–v14 无数据变更。若未来已执行 v15+，必须使用对应前滚/恢复方案，不能改写历史 migration。

### 测试先行与完成条件

- 先新增空库、v11 升级、重跑、冻结指纹、ledger 漂移、未来 v15 checksum、失败回滚和 storageMeta v14 测试；旧实现按预期因模块缺失及版本 11 失败。
- 实施后专项 migration/storage 测试 8/8、部署/readiness/release/static 契约测试 90/90 已通过。
- `process:verify` 校验 27 个预期文件、2 个 T00 保护文件、0 越界；`process:test` 8/8、`routes:check` 64 个文件、`routes:test` 16/16、`architecture:test` 36/36、`platform:iterations:test` 85/85 通过。
- `npm run check`、`npm run deploy:check` 通过；全量 Node `test:all` 10/10 批全部通过、0 失败。
- 安装与 Playwright 1.61 lockfile 匹配的 Chromium 1228 到用户缓存后，CI 等价模式 E2E 36/36 通过；该安装不产生仓库 diff。
- Windows 系统 Chrome 模式完整套件有一个既有顺序/共享服务状态问题（35/36），但该 spec 独立 13/13、单例 1/1 且 CI Chromium 36/36；已登记 TEST-005，不混改本切片业务代码。
- 完成前继续执行只读 review、依赖审计和最终 diff 检查，并确认无受保护数据或生成制品进入 diff。

---

## 2026-08-20 T00 TEST-001 标准工程门禁实施

- 分支：`process/t00-standard-engineering-gates-20260820`。
- 基线：`origin/main@026762fc9a5854f4b5dc953e0563372380f9221e`。
- 审批：TEST-001 方案、`eslint 9.39.5`、`typescript 7.0.2`、
  `@types/node 22.20.1` 三个开发依赖及 CI 映射均已明确通过。
- 范围：六个标准 npm 入口、测试分类配置、隔离 smoke、CI/Pages 映射、契约测试和治理文档。
- 非目标：不改应用运行时、API、鉴权、审计、数据库、schema、migration、数据或部署拓扑；
  `test:all` 自动发现语义不变。
- 构建：标准 build 委托既有静态发布 allowlist，默认写入系统临时目录；Pages 只向
  runner 临时目录发布净化制品。
- 测试分类：根测试共 402 个文件，unit 338、integration 64，二者无交集且并集完整；
  smoke 精选 2 个文件并使用临时数据目录和随机端口。
- CI：complete-unit-test 运行 unit/integration，governance-api 运行
  lint/typecheck/smoke，release-readiness 与 Pages 运行 build；required check 名称与
  fail-closed 聚合不变。
- 静态基线：lint 仅对 3 个遗留文件保留精确规则例外；typecheck 先覆盖 6 个治理/安全
  文件。遗留例外和约 174 秒的超大 API 集成测试已登记 TEST-006。
- 测试先行：新增契约在旧实现下 0/6，实施后目标测试 10/10；旧 Pages 直连构建断言和
  hybrid readiness 已同步为可验证的标准构建委托链。
- 已通过：`npm run build`、`npm run lint`、`npm run typecheck`、
  `npm run test:unit`、`npm run test:integration`、`npm run test:smoke`；完整依赖树与
  生产依赖 audit 最终均为 0 vulnerabilities；`test:all` 402 个文件、11/11 批通过，
  `deploy:check` 通过。
- 覆盖门禁首次运行 194/194 测试通过但行覆盖 84.94%，暴露标准 smoke 未进入既有
  覆盖命令；未下调 85/85/55 阈值，而是把六个 fail-closed 生产就绪出口加入 smoke
  断言并纳入覆盖命令。复验 195/195，通过率为行 85.64%、函数 88.26%、分支 56.37%。
- 本地默认系统 Chrome 复现既有 TEST-005（35/36，同一慢服务恢复用例）；CI 等价的
  已安装 Chromium 模式 36/36 通过，未修改小程序业务代码或浏览器配置。
- 回滚：回退本切片即可恢复旧脚本与 workflow；没有数据迁移、运行时状态或制品恢复步骤。

---

## 2026-08-20 T00 ARC-002 组合根循环依赖决策与实施 PLAN

- 分支：`process/t00-arc002-provider-decoupling-20260820`
- 基线：`origin/main@fc42833e95156571fb197b16a959708db715f057`
- Owner：T00
- 状态：方案 2 已由 T00 批准；本地最小实现、全量门禁与只读 review 完成，待发布审批
- 决策材料：
  `docs/adr/2026-08-20-pilot-cutover-alert-provider-injection.md`

### 目标与依据

移除以下唯一已确认的 CommonJS 循环，并保持平台仍为模块化单体：

```text
server.js
  -> src/platform/cutover/pilot-cutover-alert-runtime.js
  -> server.js.pilotCutoverControlPlaneReadiness
```

地图、模块分级和技术债均把 alert cutover runtime 标为 C/ARC-002。只读调用方扫描确认，
delivery cycle 的仓库内生产入口只有 `scripts/platform-cutover-alert-worker.js`；其主程序
默认不提供 `controlProvider`，因此 adapter 已就绪时会触发运行时模块内的反向 require。

### 推荐方向

采用 Accepted ADR 方案 2：

- alert runtime 只消费显式 `controlProvider`，不再寻找或加载组合根；
- worker CLI 在组合边界注入现有 `pilotCutoverControlPlaneReadiness`；
- provider 缺失、类型错误或执行失败时，继续转成稳定、脱敏、默认 NO-GO 的控制投影；
- 不抽取或重写 `server.js` 中的 trust、ledger、readiness 实现。

### 范围

获批后的预期运行时变更仅限：

- `src/platform/cutover/pilot-cutover-alert-runtime.js`：显式 provider 端口与失败分类；
- `scripts/platform-cutover-alert-worker.js`：默认 CLI 组合和 provider 注入；
- `test/pilot-cutover-alert-runtime.test.js`：特征、失败和 CLI 组合回归；
- `test/platform-architecture-foundation.test.js`：禁止平台运行时反向导入组合根；
- 与事实变化直接相关的依赖地图、模块分类、技术债、ADR 状态和交付记录。

预计不需要修改 `server.js`：现有公开 readiness 导出已经满足组合注入。若实施时发现必须
改变该导出、公共运行时上下文或路由协议，应停止并回到审批点，不扩大当前授权。

### 非目标

- 不拆分微服务，不整体瘦身或重写 `server.js`。
- 不改变 HTTP method/path、响应 schema、角色、权限、数据范围或审计语义。
- 不修改数据库、SQLite/PostgreSQL、schema、migration、`data/db.json` 或告警 journal 格式。
- 不增加依赖，不修改 CI required checks、systemd service/timer 或部署拓扑。
- 不处理 ARC-001、ARC-003、OTP、前端 CSP 或审计链等邻近债务。

### 分阶段实施

1. **特征测试保护。** 锁定 provider 调用次数、adapter 未就绪时不调用 provider、provider
   抛错后的受限投影、三个告警候选、worker CLI 报告 schema/退出码及敏感字段不泄露。
2. **架构测试先红。** 增加精确测试，证明 alert runtime 当前仍包含/触发对 `server.js` 的
   反向依赖，并要求 worker 默认组合显式提供 provider。
3. **最小实现。** 删除 runtime fallback require；在 worker 的 CLI 组合边界注入现有
   readiness 函数；不复制控制面逻辑。
4. **兼容复验。** 验证 API readiness、standard smoke、worker status/run-once、部署模板、
   平台迭代清单和默认 NO-GO 行为无漂移。
5. **事实收口。** 仅在实现与全部门禁通过后把 ADR 改为 Accepted/Implemented，并更新
   AS-IS 地图、模块标签和 ARC-002 状态；Proposed 阶段不得预先宣称循环已关闭。

### 风险与控制

- 未注入 provider 会导致 worker 无法读取真实控制面：用稳定错误码、CLI 默认组合测试和
  NO-GO 断言控制。
- 直接调用者可能依赖旧的隐式 fallback：保持导出和报告 schema，仓库调用方全部迁移，
  并在 review 中复查动态加载及外部使用说明。
- provider 原始错误可能含内部信息：对外只保留归一化 code，不输出错误正文或 provider
  payload。
- worker 仍会加载大组合根：这是已知残余，不在本切片扩大为 server 抽取。

### 迁移与回滚

- 无数据、schema、journal 或部署迁移；仓库内 worker 在同一实现提交中完成调用迁移。
- 回滚为整体回退未来的单一实现切片，告警 journal 原样保留，不执行数据恢复。
- 回滚会重新引入 ARC-002，只能作为临时应急措施；必须恢复技术债状态并重新排期。

### 测试计划

- 测试先行：`node --test test/pilot-cutover-alert-runtime.test.js`；
- API/启动：`node --test test/platform-production-adapter-runtime-api.test.js test/standard-smoke.test.js`；
- 组合与架构：`npm run architecture:test`、`npm run process:verify -- --base=origin/main`、
  `npm run process:test`、`npm run platform:iterations:test`；
- 路由与语法：`npm run routes:check`、`npm run routes:test`、`npm run check`；
- 标准门禁：`npm run build`、`npm run lint`、`npm run typecheck`、`npm run test:unit`、
  `npm run test:integration`、`npm run test:smoke`、`npm run test:all`；
- 浏览器 E2E 不因本后端组合变更自动豁免；完整执行与否在实现 review 时依据变更风险记录，
  PR/main required checks 必须全部通过。

### 完成条件

- `src/platform/cutover/pilot-cutover-alert-runtime.js` 对 `server.js` 的静态和动态依赖均为零；
- worker 主程序显式装配 provider，provider 缺失/失败保持可观测、脱敏和 NO-GO；
- 公开 API、worker 命令、报告 schema、journal、退出码原则和生产安全边界无意外变化；
- 专项、架构、流程、平台迭代、标准门禁及 PR/main CI 通过；
- `/review` 无未处理 P0/P1，且地图和 ADR 只在事实落地后同步为完成。

T00 已批准方案 2、provider 缺失时的脱敏 NO-GO 语义及上述兼容边界。实现已遵循测试
先行和最小修改完成；尚未提交、推送或创建 PR。

### 本阶段验收结果

- TEST-001 已通过 PR #130 squash 合入 `main@fc42833e95156571fb197b16a959708db715f057`；
  PR 8 项检查、合并后 [main CI](https://github.com/xujiann/chronic-care-platform/actions/runs/32337594730)
  与 [Pages](https://github.com/xujiann/chronic-care-platform/actions/runs/32337594732) 均成功。
- ARC-002 工作树从该最新 main 创建，初始 HEAD 与 `origin/main` 完全一致；现有用户工作树未被
  pull、stash、reset、clean 或覆盖。
- 测试先红：新增 provider/组合/架构保护在旧实现下 4/14 失败；最小实现后专项
  14/14、alert runtime 9/9、API/启动 7/7、`architecture:test` 37/37、
  `platform:iterations:test` 90/90、`routes:test` 16/16 通过，`routes:check` 检查 64 个文件通过。
- alert runtime 已无 `server.js` 静态或动态依赖；worker 默认 runtime 以懒 provider 复用
  现有 readiness。provider 缺失、无效或抛错均返回受限 `controlErrorCode`、`NO-GO`，且
  不泄露错误正文；adapter 未就绪时不会调用 provider。
- `npm run build`、`lint`、`typecheck`、`test:unit`、`test:integration`（373 项）、
  `test:smoke`（5 项）均通过；`test:all` 11/11 批通过，Chromium E2E 36/36 通过。
- `process:test` 8/8、`deploy:check` 通过；完整依赖树与生产依赖树的官方 npm audit 均为
  0 vulnerabilities。文档收口后的 `process:verify -- --base=origin/main` 检查 14 个文件、
  4 个 T00 保护文件、0 越界；`npm run check` 与 `git diff --check` 通过。
- 最终只读 review 已复核仓库调用方、懒加载路径、报告兼容字段、失败关闭、敏感信息边界、
  未跟踪文件及完整 diff，未发现 P0/P1；没有 stage、commit、push 或创建 PR。
- API method/path、鉴权、数据范围、数据库、schema、migration、audit/journal 语义、依赖、CI、
  systemd 与部署拓扑均未修改；`API_MAP.md`、`DATA_MODEL.md` 无事实变化。未触碰
  `data/db.json`、SQLite、生成报告、PDF、归档或发布制品。

## 2026-08-22 T00/T02 OPS-02 医院运行命令边界移交

### 早间检查

- 主业务工作树存在用户修改且当前分支领先远端，未执行 pull、stash、reset 或 clean；
- 在干净的独立 T00 工作树执行 `git pull --ff-only`，其文件树与
  `origin/main@4fcdd61d9d098ad199eb86d69bc3a5e1e4637f40` 完全一致；
- PR #140 已合并，9 项 PR 检查、合并后 main CI 与 Pages 均成功，当前无开放 PR；
- 已阅读 `ROADMAP.md`、`ARCHITECTURE.md`、`AGENTS.md`、工程治理、六张 AS-IS 地图、
  模块标准/重构安全网以及临床五子域相关 Accepted ADR。

### 目标与依据

- Owner：T00 integration 执行跨域接线，目标运行时 owner 为 T02 platform-governance；
- 依据：Accepted 临床五子域 ADR、`ROADMAP.md` 7A、`TECH_DEBT.md` ARC-007；
- 目标：把仍错位在 T06 的 `operations-command` 原子移交到 T02，关闭 32 条
  `/api/operations/*` 命令/治理接口的领域归属偏差。

### 批准范围

1. 将 `operations-command` 路由源码迁至 `src/http/routes/platform-governance/`；
2. 在原 `ROUTE_ORDER` 插槽替换 owner segment，保持请求优先级不变；
3. 将现有 20 项依赖从 clinical runtime context 移到 platform-governance context；
4. 移除 T06 facade/子上下文归属，更新 route-subdomain 与临床五子域机器事实；
5. 增加唯一 owner、禁止回流、依赖完整性、鉴权和代表性读写行为测试；
6. 同步六张地图、模块分类、路线图和既有 ADR 实施状态。

### 非目标

- 不重构约 699 行 handler 内部业务，不改 method/path、角色、状态码、响应或副作用；
- 不改变数据集合、Schema、migration、存储事实源、生产 capability 或部署拓扑；
- 不同时实施 REG-01B PostgreSQL 原子仓储或 CHR-002 持久 worker；
- 不生成或伪造任何现场 Go/No-Go 证据。

### 风险、回滚与测试

- 主要风险是路由顺序漂移、20 项依赖漏迁、动态路由重复、写入/审计行为变化和 T06 回流；
- 以原插槽替换、特征测试、唯一源码扫描和 process/architecture/routes 门禁控制；
- 回滚为整切片恢复旧 owner segment、facade 和 runtime context；不涉及数据回滚；
- 完成前运行专项测试、`routes:check/routes:test`、`architecture:test`、
  `process:verify/process:test`、`platform:iterations:test`、`build`、`lint`、`typecheck`、
  unit、integration、smoke、`test:all`，并执行独立 `/review`。

本方向已由用户于 2026-08-22 批准。运行时原子移交、测试保护和治理文档已完成，当前进入
全量门禁与独立 review 收口；尚未提交、推送或创建 PR。

### 本地验收与 review 结果

- 32 条命令/治理路径在原全局插槽唯一归属 T02；20 项运行时依赖完整迁移，T06 operations
  路由归零；新旧 handler 标准化比较除 route id/domain 外完全一致。
- OPS-02 专项与相邻回归 19/19、授权矩阵 588 条声明/0 错误、`routes:check` 64 个文件、
  `routes:test` 17/17、`architecture:test` 37/37、`process:test` 8/8、
  `platform:iterations:test` 90/90 均通过；`process:verify -- --base=origin/main` 检查 24 个文件、
  8 个跨 Owner 保护路径、0 违规。
- 标准门禁 `build`（132 个静态文件，输出位于系统临时目录）、`lint`、`typecheck`、`check`、
  unit 9/9 批、integration 2/2 批、smoke 5/5 全部通过；完整 `test:all` 11/11 批 0 失败，
  Playwright E2E 36/36 通过。
- 完整依赖树和生产依赖分别通过官方 registry 审计，均为 0 vulnerabilities；本机 npmmirror
  不实现 audit endpoint，因此只对审计命令临时指定 registry，未修改 npm 配置或依赖。
- 独立只读 review 无 P0/P1、无阻断项；P2 的跨域直写与逐路径行为覆盖缺口已分别登记为
  ARC-008、TEST-007，并在 DATA_MODEL/ADR 中明确后续治理边界。
- 未触碰 `data/db.json`、SQLite/WAL/SHM、生成报告、归档或发布制品；未修改 schema、migration、
  CI、部署拓扑或生产 Go/No-Go 状态。

## 2026-08-22 T00 生产基础设施第一切片：PostgreSQL 容量与故障转移门禁

### 早间检查与审批

- 主业务工作树包含用户修改且明显落后于主线，未执行 pull、stash、reset 或 clean；
- 从 `origin/main@b99b934cd6087a7c852ac4a8a44653c25c2cfe61` 创建独立干净工作树与分支
  `process/t00-production-foundation-wave1-20260822`；当前 main CI 与 Pages 成功、无开放 PR；
- 已阅读 `ROADMAP.md`、`ARCHITECTURE.md`、`AGENTS.md`、工程治理、六张架构地图、数据库与模块
  标准，以及 PostgreSQL shadow/core schema 等相关 Accepted ADR；
- 用户已批准按推荐实施顺序继续开发。本切片沿用既有 Accepted 决策，只补齐已经声明的数据库
  迁移门禁，不改变数据库事实源或切换授权。

### 今日目标

1. 在现有 `buildTransitionAssessment()` 增加独立的容量与故障转移失败关闭检查；
2. 修复恢复、outbox 等数值字段把空字符串隐式视为零的旁路；
3. 用受控证据引用、目标/实测容量、延迟、故障切换时长、数据丢失和严重问题数形成供应商中立契约；
4. 同步 PostgreSQL 主存储文档和 production database readiness 的机器门禁；
5. 始终保留 `activationAuthorized=false`、`productionReady=false`、`productionPrimary=false`、
   `runtimeCutoverEnabled=false` 与 `requestPathWrite=false`。

### 非目标

- 不执行 `pg_dump`、`pg_restore`、真实故障转移、备份恢复或 switchback；
- 不启用 PostgreSQL 主读写，不修改主服务 `STORAGE_ENGINE`，不合并两套既有 adapter；
- 不修改 Schema、migration、API、鉴权、审计、CI、依赖或部署拓扑；
- 不直接编辑 `data/db.json`、SQLite/WAL/SHM，不生成 release/report/PDF/归档产物；
- 不制造容量、灾备、现场验收或 Go/No-Go 证据。

### 风险、回滚与验证

- 风险：新数值校验过松会让空值通过，过严会拒绝既有合法零实测值；因此目标值必须为有限正数，
  实测值允许有限非负数，并用空白、`NaN`、`Infinity`、负数和数据丢失场景锁定语义；
- 回滚：整切片回退即可恢复原评估逻辑，无数据或制品恢复步骤；
- 测试：先增加失败测试，再运行 PostgreSQL 主存储/driver/production readiness 专项，随后执行
  build、lint、typecheck、unit、integration、smoke、routes、architecture、process、platform、
  `test:all` 和独立只读 review；PR/main required checks 必须全部通过。

### 实施与验收结果

- 测试先行确认旧实现会放行缺失容量/故障转移证据；实现后 PostgreSQL storage、driver 与
  production database readiness 专项 `25/25` 通过；
- 审查发现并关闭 migration/reconciliation/outbox 的 JavaScript 数值强制转换旁路，以及布尔、
  对象、数字被误当作证据引用的类型旁路；空白、`Infinity`、分数、十六进制、指数形式和非字符串
  引用均有回归测试；
- build、lint、typecheck、check、routes、architecture、process、platform、unit、integration、smoke
  全部通过；`process:verify -- --base=origin/main` 检查 9 个文件、0 个违规；
- 修复后 `test:all` 11 个批次全部通过，Playwright 浏览器 E2E `36/36` 通过；完整依赖审计和仅生产
  依赖审计均返回 0；
- 独立只读复核确认原 2 个 P1 与 1 个 P2 全部关闭，最终无 P0/P1/P2；未触碰受保护数据、SQLite、
  release/report/PDF/归档产物，所有生产授权与运行时切换标志仍为 `false`。
