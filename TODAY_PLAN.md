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
