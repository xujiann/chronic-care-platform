# 工程治理路线图

## 源目标身份绑定 PLAN（2026-09-22）

- 同轮收尾：PR #314 已保护 squash 合并为 `6b10def4b0f3a39cb7eefd21b063acb92c3a5467`，与独立审查冻结 `f2fa372999a1b5dea345ce451de45608a1466e58` 和 PR 合成提交共享 tree `53e31652c91765109c1f89ec6f98e5f5897f2f18`。PR CI35712865240 九项成功，真实 primary 39/39、零跳过；完整本地串行门禁通过（全量 3726pass/40 环境 skip）。main CI35713934328 九项及 Pages35713934423 均成功（Pages 仅静态演示）；主线真实 primary 同样 39/39、零跳过。GOV-019 / OPS-045 关闭限定代码交付，WIP 2/5；OPS-045 运行能力仍为已实现，观测/跨进程/克隆/TLS/容量灾备和现场缺口保留。本收尾仅事实同步，仍需自身独审、冻结与门禁，生产 NO-GO。

- 用户批准 GOV-019 / OPS-045，WIP 4/5；基线 origin/main@828893ac，前轮 PR #313 与 main 精确 CI 已通过。
- 范围、合同、风险、迁移/恢复及四角色单写见 Accepted [ADR-OPS-045](docs/adr/2026-09-22-primary-source-target-identity.md)。A 开发 SQLite，B 开发 PG，审查者只读，T00 协调集成。
- 仅持久身份/绑定、新增版本迁移及隔离合成测试；不补历史，不接 relay/checkpoint/请求/生产。独立审查、冻结后串行门禁，精确 CI 后按已有授权保护集成。当前未完成实现/验证，生产 NO-GO。

- 开发完成待完整验证：独立审查所提 schema 结构漂移 P2 已修复、复审无 P0–P2；组合窄测 167pass/39skip/0fail（39 项为未启用真实 PG），SQLite 补强后 76pass，治理/head 兼容 72pass。现在冻结候选后进入完整串行门禁；不以开发结果或 skip 代替真实 CI。旧 23 项 live 保留，新增身份专项 16 项。

- 首次冻结 `97ad2272` 在单元测试通过、集成测试运行中，由协调者发现目录 `name[]` 在当前 pg 驱动下返回字符串；主动中断。两处显式转换为 `text[]` 并加入实际 pg 类型解析回归，独立复审通过，组合窄测更新为 168pass/39skip/0fail。重新冻结后从头执行完整门禁，不沿用中断候选的结果。

- 第二候选 `9255eb6c` 本地完整门禁通过，但 PR #314 / CI35708941237 真实 primary 结果为 38pass/1fail/0skip：抽取共享测试助手时漏保留旧回滚用例仍使用的锁常量导入。恢复导入并增加模块加载期断言，使本地未启用 PG 也能发现此缺失；重新独审、冻结并执行完整门禁，不合并失败候选、不删除原测试。新增 16 项身份 live 在该轮已真实通过，但完整通过证据仍待新候选。

## 真实 PostgreSQL 主存储验证 PLAN（2026-09-22）

- 同轮收尾：PR #312 经独立审查、冻结本地串行门禁和 PR CI35689960332 九项成功，已保护 squash 合并为 `fbaab2a09ac170a3dfbee9114eafec86591a0d97`。冻结 `9cab86df9bf7b6123bb1012483259c89290f7ea8`、PR 合成提交及合并提交共享 tree `d497d2097abe5121ff563d6e7ad8c352460b7049`。真实 primary 专项 23pass/0fail/0skip/0cancel，清理钩子未报错（未单独做残留库盘点）。main CI35690591338 九项及 Pages35690591198 成功（Pages 仅静态演示）；main primary 同样 23/23 通过且零跳过。GOV-018/OPS-044 关闭限定测试交付、WIP 2/5；不晋升运行时或生产。本收尾仅总账、六图、路线图和合同事实同步，沿原单写范围独立复核、冻结并串行门禁，保护集成；不以 PR #312 的 CI 替代收尾提交证据。

- 批准与基线：用户批准隔离合成 PostgreSQL primary 验证；origin/main@3474f43c，PR #311 已合并，精确 main CI35572286391 九项与 Pages35572286399 成功，无开放 PR。GOV-018/OPS-044 独立准入，WIP 4/5。
- 范围：只增加真实驱动验证、测试夹具、环境拒绝负测、package 显式入口及既有 postgres-production-contract CI 作业内的串行步骤；复用现有 pg 依赖和未修改的正式 PG DDL，不变运行时/生产 schema/API/relay/checkpoint/生产激活。
- 四角色：A 单写 test/helpers/postgres-primary-live-fixture.js 与 test/postgres-primary-live-contract.test.js；B 单写 test/postgres-primary-live-concurrency.test.js；协调者独占其余精确任务写范围和 CI；审查者只读。先登记再写，审查后冻结、重型门禁串行。
- 隔离：POSTGRES_PRIMARY_LIVE_TEST=1 与专用 POSTGRES_PRIMARY_LIVE_TEST_ADMIN_URL 双条件；连接前限制 loopback、contract_runner、health_platform_contract，拒绝生产 NODE_ENV、URL query/hash/别名及未知开关值，禁止回退通用 DATABASE_URL/POSTGRES_URL。仅创建并清理本轮成功创建的随机独立数据库，不删除既有 schema/库或终止无关连接。
- 验收：真实 SQLite wrapper/loader 产生凭证后经正式 driver 写入 PG；七字段精确重放/冲突、三路纪元/微秒/bigint、集合/账本/延迟约束故障原子回滚；独立 pool/PID 与实际锁等待证明并发，同批唯一应用，有界显式重试仅允许真实序列化冲突。异载荷竞争只证明正式 driver 的底层 CAS，不伪造两条合法源链。
- CI 与证据：保留原 auth/shadow 作业及 required checks，只追加必须执行的 primary 入口；显式启用时缺配置/连接失败/全部跳过必须失败。本地 Docker daemon 不可连接，不修改其配置或安装环境；通用本地发现可明确 skip，真实结果必须来自新精确 CI。
- 交付与回滚：独立审查、冻结后按原必需门禁串行验证，精确 PR CI 后依原授权保护集成并收尾。测试或 runtime 缺陷不得以弱化断言解决；如需改变运行时合同或 schema，集中请求新增准入。撤销测试入口不影响业务，清理仅本轮自有随机库。生产 TLS、多进程服务、容量/灾备、源目标绑定和现场准入仍外置，生产 NO-GO。

## 重放合同加固 PLAN（2026-09-21）

- 同轮交付收尾：PR #310 已保护 squash 合并为 `85bfde7a50a3f2997a941ee03903c39e724284a6`，与冻结 `b3b6d8a813c73f92a42ad195fdf798d723b17c16` 共享 tree `330475f13774b45ad9bc5a4859d3360db77929db`。PR CI `35568133300`、main CI `35568982001` 各九项及静态 Pages `35568981927` 成功。GOV-017/OPS-043 关闭已验收的限定代码切片，WIP 释放为 2/5；OPS-043 保持“已实现”及未闭合能力映射，不晋升生产。本收尾只改总账、路线图和六图，无运行时变化；沿原单写范围独立复核、冻结并运行必需门禁后保护集成，不用 PR #310 的 CI 替代收尾提交验证。

- 准入：用户批准限定范围；基线 origin/main@6e5ba723，工作树 process/t00-outbox-replay-contract-20260921。PR309 冻结 e4a8d6b3 与合并 tree 一致，PR CI35559351287/main CI35560034738 各九项及 Pages35560034708 成功；GOV-016/OPS-042 关闭已交付切片，不关闭生产缺口。
- 目标与方案：按 ADR-OPS-043 加固六字段凭证、七字段精确重放与正式驱动无损时间校验；只对不存在集合兼容普通首版本 0/1，保留 expectedVersion=-1、已有 CAS 和 baseline 规则。不接 relay/checkpoint、不改 DDL/SQLite head/HTTP/worker/生产。
- 单写者：开发 A 负责主合同、主合同测试及新增 SQLite receipt→内存主合同测试；开发 B 负责正式 driver 和其测试。协调者负责 GOV-017 治理与 OPS-043 接口/schema 文档；独立审查只读。精确路径见任务总账，先收口旧任务，WIP 4/5。
- 验收：未知字段、getter、数字字符串、UUID/时间/摘要变体拒绝；七字段漂移均零写，规范 duplicate 不重复写集合或账本；真实 SQLite 生成首版本 1 证明，无手工事务 ID 冒充；首版本 0 与 baseline 兼容、后继 CAS、墓碑、SQL rollback 和亚毫秒漂移负测。
- 测试与交付：专项→独立审查→冻结→串行 build/lint/typecheck/unit/integration/smoke/test:all、中央 process/routes/architecture/iterations/文档治理→保护 PR 与精确 CI→条件 squash 合并。旧真实 PG 门禁仅证明 auth/shadow，不能声称 primary 实测。
- 冻结前验证：主合同/正式驱动/真实 SQLite 到内存目标专项 61/61；receipt/migration/样本/生产数据库 readiness/release-report 兼容组 81/81。兼容组首次 release-report 汇总失败，单独只读诊断未发现 error 检查，停写后完整重跑通过，仍以冻结后的完整门禁为准。独立审查指出 SQL 时间投影丢失 BC/AD 纪元，已增加三路纪元保留、严格 AD/四位非零年校验及负测；复审无剩余 P0–P2，允许代码冻结。治理与六图已同步，新交叉测试登记 TEST-OPS-043-RECEIPT；不把受控 SQL 替身测试算作真实 PG primary 证据。
- 回滚与风险：无数据迁移或 schema 变更，停止新增调用方并保留源/目标账本；不自动修复历史凭证，不用宽松比较绕过冲突。真实 PG primary、多实例、源目标绑定、checkpoint/relay、容量/灾备与现场准入继续外置，生产 NO-GO。

## 提交凭证第一切片 PLAN（2026-09-21）

- 准入：用户回复“按照建议执行”。先前只读样本已由 PR #308 合并为 `70521f29`，与冻结 `17df11d7` 文件树一致；独立复审、本地必需门禁和 PR CI `35555853638` 九项成功。合并后 main CI `35556532283` 九项成功，自动 Pages `35556532287` 成功。GOV-015/OPS-041 仅关闭已交付的只读切片，不关闭真实迁移或生产门禁。
- 目标：按 Accepted ADR `2026-09-21-sqlite-outbox-commit-receipt.md` 第 1 切片建立原子 receipt、受控单批次事务包装器及全部投递状态的只读装载器；从最新 `origin/main@70521f29` 独立工作树开始，现已实现、待冻结后的完整门禁及保护集成。ADR 后续 relay/checkpoint/目标绑定及主存储重放切片仍未准入。
- 决策：复用既有 outbox 的完整批次和原摘要链，不从 batch ID 推导事务标识、不补造历史凭证。实施前重验 head=17 且无 v18 预留后已追加 v18，历史 migration/checksum 不变。普通旧请求路径不自动生成 receipt。
- 四角色与单写范围：协调者独占 GOV-016 的中央总账、ROADMAP、ADR/索引、文档治理配置及六图。OPS-042 为明确编号的 T00 技术存储任务，不承载领域业务：开发 A 独占新 `src/platform/storage/sqlite-outbox-commit-receipt.js`；开发 B 独占新 receipt 测试与 `test/sqlite-migration-governance.test.js`；协调者独占 migration 注册表、`DATABASE_SCHEMA.md`、三处 object-storage head 兼容检查及对应测试、`test/storage.test.js` 全局 head 断言。独立审查者只读。完整文件闭集见总账 writeScopes，WIP 4/5；新增 receipt 测试已登记为 TEST-OPS-042-RECEIPT。
- 必要兼容：对象存储 worker/架构治理不能继续强制当前 head 等于 17；必须验证原 v17 已应用且指纹正确，并保留完整迁移校验，不能仅改成 `head >= 17`。实施复核另发现 `src/platform/operations/object-storage-command-worker.js` 的同类 readiness 检查，已加入 OPS-042 精确范围并由协调者单写；仓库 readiness 验注册表，实际 openRepository 验已应用 ledger，两者不得混同。保留 `reservedSqliteMigrationVersion=17`、原 worker 权限、原生产禁止状态。未来非法版本测试探针改用 head+1。
- 验收：真实正式迁移文件库验证空库、v17升级、重跑、指纹、部分失败；两个连接证明业务/outbox/receipt/storage event 同时提交可见；各写步骤 SQL 故障注入全部回滚。拒绝嵌套、既有批次补证及调用者事务 ID；loader 独立只读一致快照、outbox LEFT JOIN receipt、读取 pending/retry/delivered/failed；历史缺证停止，严格 UUID/安全整数/摘要/UTC毫秒时间/未知字段、完整 envelope/changes 和链后继验证，允许有链证明的序号空隙。
- 测试顺序：专项开发负测 → 独立审查 → 冻结 SHA → 串行 build、lint、typecheck、unit、integration、smoke、legacy test:all 及 process/routes/architecture/iterations/文档治理；既有远端真实 PG/E2E 门禁保留。按已授权保护流程推送、PR、精确 CI 后合并，不启用自动合并或绕过保护。
- 开发验证：receipt/migration/既有同步/只读样本专项 82/82 通过，object-storage 兼容/storage/文档专项 38/38 通过。独立审查提出的集合版本起点问题已修复并补测：首个版本只能为 1，触达已有状态但缺认证历史或历史存在而状态丢失均拒绝；不改变 PostgreSQL 目标版本合同，当前结果不构成可直接重放证明。
- 首次冻结 `59ee6ef6` 的全量 unit 因旧迁移数量常量断言失败并停止。必要兼容测试修正由协调者单写，已登记 `test/chronic-followup-dispatch-outbox.test.js`、`test/object-storage-durable.test.js`、`test/production-db-readiness.test.js`、`test/release-report.test.js`；仅把当前 head/升级数量与正式注册表精确对齐，历史 v17、领域行为及生产阻断断言保持，复审后重新冻结并重跑全部门禁。
- 非目标与回滚：不改 server.js、T09路由、旧 worker投递目标/状态、主存储replay/checkpoint、依赖或生产配置；不迁移真实数据、不启用worker/主库。停止新增调用方并保留 receipt/outbox和业务事实，不自动DROP；已升级库不得直接交旧runtime，恢复通过受控前滚修复或备份恢复。真实PG、多实例、容量、灾备、现场签署和六域NO-GO不因库级测试关闭。

## T02 数据质量问题集合 PostgreSQL 迁移样本 PLAN（2026-09-19，已准入只读首切片）

> 2026-09-20 准入与实现边界：用户批准按 T02/T09/T00 单写者范围实施。复核发现 `loadPendingPostgresSyncBatches` 未返回 outbox 序号或可验证事务 ID，而现有 PostgreSQL 主存储合同要求两者；不得由 batch ID 或测试值伪造提交凭证。本轮先由 OPS-041/T02 交付纯只读、合成数据的源/批次/目标精确核验与失败关闭负测，T00 登记任务并组合测试；T09 路由不变。真实 relay、SQLite schema/migration、worker 和本地执行授权等待独立 Accepted ADR 与专项任务，六域生产 NO-GO 不变。

- 基线与事实：`origin/main@b54c9a6c` 已集成 PR #307；GOV-013/GOV-014 的本地事实收口已作为独立提交组合进本候选，不作为迁移执行证据。首发组合把 `dataQualityIssues` 归于 T02 `platform-governance`、`internal`、`wave-first-release-platform`，目前仅 `repository-plan-ready`。`localExecutionAuthorized=false`、`productionCutoverAuthorized=false`、`productionWriteAllowed=false` 与六域 `NO-GO` 不变。
- 目标：以一个真实有写入口的集合证明“已提交 SQLite 事实 → 独立 worker/outbox → PostgreSQL 影子集合状态 → 精确核对 → 独立回滚演练”的可重复样本；只将仓库合同和受控本地演练能力推进，不把样本结果推广为 20 个集合或生产切换证据。正常、重复、版本冲突、失联/中断、部分批次失败、核对不符和恢复路径均须可测。
- 现状与单写者：真实 POST `/api/data-quality/issues/:id/actions` 位于 T09 所有的 `src/http/routes/shared.js:815`，调用 `readDatabase`/`writeDatabase` 并把覆盖项限制在 300 条；它读取 `buildDataQualityIssues` 派生视图，不能把 300 条覆盖项误当全部源数据。T02 拥有集合语义与迁移映射，T09 只拥有兼容路由，T00 独占迁移组合、生命周期登记和集成。第一实施切片不改路由或 `server.js`，不变更请求路径写入语义；若发现现有 SQLite 事务 outbox 不承载本集合完整版本/提交凭证，先停在合同与负测，另立 T09/T00 handoff，不补请求路径双写。
- 方案：优先复用现有 `health_platform.primary_collection_state`、PostgreSQL 主存储 CAS/批次幂等合同和 `outbox-shadow-then-cutover` 波次，不建第二事实源、新业务表或新依赖。T02 先提供仅接受合成数据的确定性集合提取、版本/摘要与失败关闭测试；T00 对接现有 worker、checkpoint、精确计数/摘要和切回评估。任何真实数据导入、worker 激活或环境切换均不属于此授权。
- 决策与风险：Accepted 的首发组合 ADR 只批准 metadata-only 计划，未批准执行；本样本若需改变数据权威源、事务 outbox、schema 或本地执行授权，必须先形成专门 Accepted ADR 和任务总账审批。敏感数据不进仓库；执行证据须用受控引用及 SHA-256，不能以测试伪造现场签名。不得用覆盖项的 300 条上限掩盖丢失、重复或摘要不一致。
- 拟议写范围：T00 独占 `config/lifecycle-governance.json`、`ROADMAP.md`、迁移组合/门禁配置及六图；T02 独占其领域迁移适配模块和专项测试；T09 仅在后续明确批准兼容入口改造时独占 `src/http/routes/shared.js`。每个切片先登记 requirement、依赖、风险、验收、writeScopes、回滚及测试，保持 WIP≤5；不同 owner 不共写同一文件。
- 测试与验收：先执行集合合同、现有迁移执行/PG 驱动及负向专项，核实空库、升级、重跑、失败、CAS、schema 指纹、核对与回滚；集成前依序运行 `process:verify`、routes/architecture/process/iterations、build、lint、typecheck、unit、integration、smoke、legacy `test:all` 和真实环境允许的 PG 门禁。独立审查通过后冻结 SHA，再 PR/CI；真实 PG、容量、多实例、灾备和现场签署缺一项就保持生产 `NO-GO`。
- 回滚：仓库切片可按独立提交回退适配与合同；演练环境只能停 worker、保存 checkpoint/批次账本、核对源与影子状态并依受控回滚手册切回，禁止删除源事实、outbox 或审计。未完成可验证恢复前，不晋级 `local-candidate`。
- 非目标：不推送/合并此 PLAN，不迁移真实数据，不启用生产 worker、PostgreSQL 主读/主写、请求路径双写或自动上线；对其余 19 个持久化引用不作已完成声明。
## GOV-013 / GOV-014 远端集成事实收口 PLAN（2026-09-19）

- 准入来源：用户在上一轮批准完成后推送、合并；PR #307 已于 2026-09-19 按保护规则 squash 合并。本轮“继续开发”按已提出的执行顺序先完成 T00 事实收口，唯一主线 `origin/main@b54c9a6c`，独立 `process/t00-access-ack-closeout-20260919` 工作树，工作区干净、无开放 PR。
- 目标与选择：只将已发生的独立审查、冻结本地 18 项门禁、PR CI 九项和 main CI/Pages 结果如实写回机器台账及六张当前地图。选用 GOV-013 既有中央单写范围，关闭纯治理任务 GOV-013/GOV-014；OPS-040/SEC-016 仅补集成引用并保留“验证中/已实现”与运行观测缺口。其余方案（借本次合并把运行能力标为生产已验证，或重写历史阶段记录）均与现有证据不符。
- 范围：`config/lifecycle-governance.json`、`ROADMAP.md` 及六张当前 AS-IS 地图。不得改业务源码、验证器、API 合同、schema、依赖、CI、生产状态或历史快照；本轮不推送、合并或上线，后续远端动作另按授权与门禁执行。
- 证据：冻结 `a35faf4f9e8e29f5f376dc33bf338edf60768cc5`，PR #307 的 CI `35433532188` 九项成功，合并提交 `b54c9a6cdca44381968f9e763e0317f119a5309d` 与冻结 tree `f832c3236cebc487a01a4a0433acd72544193892` 一致；main CI `35434027307`、自动 Pages `35434027259` 成功。完整本地全量 3569 通过/1 项真实 PG 环境跳过，E2E 76/76。自动 Pages 仅是静态演示发布。
- 验收：生命周期引用与 WIP/地图 gap 对账、文档当前事实一致、仓库文档治理和所有权检查通过；独立 diff 审查无 P0–P2，冻结后按元数据变更风险运行中央门禁。不得把已合并运行时旧提交的重型测试归属伪装为本次元数据提交重新执行。回滚仅撤销元数据收口，不删除居民声明或审计历史。
- 保留：生产六域 NO-GO；高风险 API 目录条目、长期留存、2000 条容量、真实 PostgreSQL、多实例、现场签署及完整运行观测仍需后续范围。`GOV-013/GOV-014` 纯治理完成不关闭 `OPS-040/SEC-016` 运行能力。

## GOV-014 访问知晓声明证据登记 PLAN（2026-09-16）

- 用户批准本轮证据登记、测试及完成后的推送/PR/条件合并（USER-APPROVED-ACK-EVIDENCE-INTEGRATION-2026-09-16）；不授权上线、生产激活或保护规则例外。主线新鲜核验为 origin/main@cb8f37e0，无开放 PR；既有功能冻结候选为 078840ba，11 个本地提交尚未集成。
- 目标：仅为 POST /api/access-reviews/:accessLogId/acknowledge 增加完整 endpoint 幂等行为合同。复用 Accepted API-IDEM-001 与 ADR-OPS-040；不改变运行时、安全模型、验证器、schema、依赖、生产策略或高风险 API 清单。方案为逐 endpoint 实证登记，拒绝仅靠源码 marker 晋级。
- GOV-013 协调者继续独占 lifecycle 与已有文档范围；新增 GOV-014 为中风险 T00 治理任务，开发 A 独占 config/api-idempotency-evidence.json，开发 B 独占 test/api-idempotency-evidence.test.js 和 test/production-api-catalog.test.js；独立审查者只读。沿用现有 T00 集成树，078840ba 保留为不可变证据点；不新增领域代码任务，在制 4/5。
- 合同精确绑定本人/当前会话重验、完整 header/body 键与载荷、原事件审计核验、精确回放/冲突、SQLite CAS 和单事务、JSON 单进程原子替换、容量拒绝及历史保留。命令拒绝不新增声明/命令审计，但既有认证层可记录拒绝审计，不写“一律零审计”。不声明专门 Cookie/CSRF、重启后 HTTP 回放、PG 或跨实例证据。
- 验收：新登记负测、实际 93 项命令/HTTP/适配专项、目录/文档/生命周期校验；独立审查后冻结，串行执行全部 18 项既有门禁。计数从机器结果核实，不提前记通过；productionReady=false、externalEvidenceRequired=true、distributedExactlyOnceClaimed=false 和全部 NO-GO 不变。
- 推送与合并：仅推送本联合切片；PR 绑定最终冻结 head，全部 required checks 成功、无未解决高风险审查、主线无未处理漂移时按保护规则合并，不用管理员绕过。合并后核对树与主线 CI；现有自动 Pages 工作流按仓库配置运行，不执行生产部署。
- 回滚：撤销本次证据登记使接口恢复 proof-required，不删除声明或审计。既有功能回滚必须保留声明历史与通用写保护。后续生产、多实例、2000 条保留迁移及接口 highRisk 元数据遗漏继续作为风险，不借本轮自动关闭。
- 历史证据：078840ba 的 18 项本地门禁已通过，含全量 3566 通过/1 个真实 PG 环境跳过和 E2E 76/76；该事实不替代本轮新提交测试或远端 CI。OPS-040/SEC-016 的生产观测缺口保留，仓库合并不等于完整运行能力验收。

## 全生命周期治理控制塔（2026-09-07）

- 2026-09-14集成结果：用户追加PR/条件合并授权后，[PR #305](https://github.com/xujiann/chronic-care-platform/pull/305)以head `d27eb1cb`、CI `34824818585`九项成功合并为`bb464563`，整树与冻结候选零差异。SEC015/TEST021及OPS037/038/039限定切片和GOV012组合登记完成仓库交付，本批在制由3/5收口为0/5；不启动新开发。四运行能力仍已实现且保留观测缺口，测试能力TEST021及治理GOV012已集成；历史失败和六域NO-GO保留。当前三文件事实收尾须独立review和自身PR/CI，不能预支自身结果，见[集成收尾PLAN](docs/lifecycle-governance.md#gov-012-pr305-集成收尾-plan-与事实)。下方仅本地/在制/阻塞表述为历史阶段记录，由本条及机器总账给出当前状态。

- 2026-09-14批准失败修复：SEC015精确日志身份比较优先，TEST021居民单用例虚拟时钟其次，均中风险精确PLAN。原三OPS因组合验收失败暂停为已阻塞/已实现；在制3/5、另有组合阻塞3项，原源码不动。GOV012仅中央writer迁移；不改安全模型或业务runtime超时，不推送/PR/合并/上线，见[修复PLAN](docs/lifecycle-governance.md#sec-015与test-021-失败修复-plan)。

- 2026-09-14 证据复查：3da30ea9仅追加中央证据，但iterations出现97通过/1失败（监控日志路径替换未拒绝）。原6e92bf5d通过不覆盖此失败；优先独立安全诊断，其次居民超时恢复测试确定性，均须新精确准入。组合与收口门禁未全通过，WIP4/5和生产NO-GO保持。

- 2026-09-14 续授：GOV-012 在独立本地候选组合 OPS-037/038/039 并收口台账，原冻结树不动，WIP4/5。候选6e92bf5d标准与legacy通过，但完整E2E退出1（根60通过、居民12通过1失败，PWA另行3通过），组合验收未通过；四任务保持验证中/已实现。失败证据及后续居民测试独立准入边界见 [组合 PLAN](docs/lifecycle-governance.md#gov-012-本地组合验证与台账收口-plan)。不推送、PR、main 合并或上线。

- 2026-09-14：用户临时授权当前协调者履行本轮T00准入登记与调度，GOV012三文件内登记OPS039/T01数字医院认证就绪启动接线，中风险、三文件分配两个互斥writer，WIP4/5；不改共享认证/权限契约，独立审查后冻结并串行验证。本地登记与OPS037/038尚未集成，禁止以本轮开发授权推送、合并或上线。

- 2026-09-13：GOV011由#303合并为 `62e56918`。GOV012登记OPS037文书与OPS038共享工作台读取代次修复，当前WIP3/5；各限定两文件、两个独立writer，旧阶段WIP为历史快照。observer A/B及高风险接口不在本批准入内。

- 最新交付：TEST-012 已由 #304 / CI 34573014899 合并为 `2582698b`，九根资源 LF 检出与原始预算/产物一致性回归完成；当前 WIP 1/5（GOV-011 中央证据收口），下方 2/5 为本批准入快照。身份运行观测与生产 NO-GO 不变。

- 2026-09-11：中央 GOV-010 已由 #301 / CI 34567441437 合并为 `a9603e45`。当前 GOV-011 登记 TEST-012 / T09 九预算资源 LF 检出治理，WIP 2/5；仅属性与两个测试文件，原始预算计量、阈值及运行时代码不变。下方 GOV-010 WIP 为上一阶段记录；身份观测、居民接口与系统黄金场景缺口不随本批晋级。

- 2026-09-11：GOV-009 已由 #296 / CI 34505513741 合并为 `f1ce053d`。GOV-010 登记人工确认的授权策略及 SEC-014 / T02 通用身份写边界前置，SEC-014 三文件已由 #302 合并为 a6181a8c，限定实施任务关闭、能力仅已实现且观测缺口保留，当前 WIP 1/5（GOV-010）；领域已停止写入，SEC-012 授权版本、中央接线及 SEC-013 居民旅程仍候选。GS 与生产状态不晋级。

- T00 已从领域实施语义收敛为任务组合、依赖、WIP、风险、证据和准入控制塔；机器事实源与操作规范见 `config/lifecycle-governance.json` 和 `docs/lifecycle-governance.md`。
- 首批建立六图状态层、完整追踪链、四级门禁、十条黄金场景及六域生产准入矩阵。GOV-002/GOV-005/GOV-006 与上一批 OPS-020～OPS-024、TEST-010/TEST-011 均已依据各自已合并 PR 和成功 CI 关闭。GOV-006 对应 PR #280、head `13327891`、CI 34324353339、main 合并提交 `7fe6882b`。
- GOV-007/GOV-008 与 OPS-025～OPS-032 均已完成仓库集成；中央 #293 最终 head `3d856f8f` / CI 34486531706 九项成功 / merge `3918a79d`。GOV-009 四领域 OPS-033～OPS-036 已经 #299/#300/#297/#298 串行集成至 main `9e651ef6`，各最终 CI 九项成功及独立评审完成；该批中央 #296 已随后合并为 f1ce053d，GOV-009 已关闭；当前在制任务见上方 GOV-010 登记。三条居民后端 POST 仍归 OPS-017，需独立 ADR/人工审查；GS-01～GS-10 尚未完成系统证据映射、保持未建设，上位运行与现场缺口不随局部修复关闭。
- 六个生产准入域全部保持 `NO-GO`；仓库检查不能制造迁移、测评、容量、灾备、供应商联调或现场签署证据。

## AI/CDSS 主线整合（2026-09-06）

原整合以 `main@7de328e0` 为基线选择迁入 #248 缺失保护；本次按用户重新批准，将 `main@f48684d9` 加法合入并保留 #249/#250 中心与 #252 审计中心。当前整合范围、验收及后续队列见 [执行计划](docs/ai-cdss-reconciliation-plan.md)；影像、体检和外部现场事项未因本增量标记完成。

> 更新：2026-09-06。队列不是实施授权；只有 Accepted ADR/明确 owner 审批的范围可进入实现。

## T01 平台审计治理首增量（2026-09-06）

- 已复用 `securityEvents`、`dataAccessLogs`、严格 `audit-chain-v2` 与 `append-only-audit-source-v2`，新增 commission-only `GET /api/security/audit-governance/center` 和左侧导航工作台；没有创建第二审计事实源、migration、Worker 或写命令。
- 中心只返回固定结果/事件/角色分类、数量、日期桶、配置布尔值和哈希摘要，禁止输出 actor、患者/居民、机构、访问目标、用途或事件正文；来源结构、链完整性或读取审计失败时接口失败关闭。
- `L-GOV-AUDIT` 已形成仓库页面/API/测试追踪。真实 SIEM/WORM、可信回执、外部单调锚、留存与销毁策略、告警恢复、灾备演练及多方现场签字仍外置；链修复、原始导出、Worker 激活和生产放行均禁用，生产继续 `NO-GO`。

## T01 平台人工智能治理首增量（2026-09-06）

- 已建立 commission-only `GET /api/runtime/ai-governance/center` 和分级左侧导航工作台，统一展示临床决策、科研模型、公共卫生研判和基层辅助四类场景的风险、责任、来源接线、控制与生产阻断。
- T01 只读取中央合同已允许平台治理访问的临床与科研治理元数据；慢病治理、公共卫生和基层辅助未完成 Owner 接线的来源只登记待办且禁止读取记录，没有创建第二模型或跨域业务事实源。
- `L-GOV-AI` 已形成仓库页面/API/测试追踪。独立验证、效果基线、漂移/偏差/公平性、不良事件、电子签名、暂停回滚和现场签字仍外置；自动决策和生产激活均禁用，生产继续 `NO-GO`。

## T06 临床决策支持安全治理首增量（2026-09-05）

- 已复用既有临床辅助规则、提醒、回执和插件合同，新增 `GET /api/quality-safety/ai-cdss/center` 及左侧导航治理工作台；没有创建第二患者、模型、建议或回执事实源。
- 主管部门只获得跨机构治理元数据，机构账号按可信机构/医生范围获得最小临床建议；规则/模型卡统一声明适用边界、人工复核、证据、治理缺口和禁止自动执行事项。
- `J-CLIN-CDSS` 已形成仓库页面/API/测试追踪。真实临床验证、规则审批、工作站联调、电子签名、效果漂移、不良事件和现场验收仍外置；后续 T01 中心只聚合最小治理元数据，生产继续 `NO-GO`。

## T08 区域医疗文书闭环增量（2026-09-04）

- 已复用既有 `integrationGatewayEvents` 与 `secureAttachments`，新增按账号角色和可信机构代码裁剪的 `GET /api/integration/clinical-documents/center` 以及左侧导航工作台；没有创建第二文书、居民或附件事实源。
- 主管部门查看跨机构采集、校验、报送、异常和日志，但不获得临床摘要或 PDF 标识；医疗机构只查看本机构最小临床摘要、医生工作站提醒和完整性已验证附件，并通过既有补传与短时下载入口执行操作。
- `D-INT-DOC` 已形成仓库页面/API/测试追踪。真实机构接口、目录映射、生产签名、上级平台正式回执、对象存储和医生工作站嵌入仍需外部证据，生产保持 `NO-GO`；T06 临床决策支持安全治理首增量已于后续切片完成。

## T07 医疗付费一件事闭环增量（2026-09-04）

- 已复用既有金融网关、在线退款和日终对账账本，新增按账号角色与机构范围裁剪的 `GET /api/medical-payments/center` 以及左侧导航工作台；没有创建第二订单或支付事实源。
- 医疗机构可发起支付、申请退费和执行独立业务/财务复核，主管部门可查看跨机构运行并登记对账，医保账号只查看医保通道并执行本职责范围对账；所有写操作继续由既有接口、幂等、回调和审计合同约束。
- `E-CIT-ORDER`、`E-CIT-PAY`、`E-CIT-REFUND` 已形成仓库页面/API/测试追踪。真实支付与医保 provider、凭据网络、账单、回调、商户/机构/医保验收和生产多实例证据仍外置，生产保持 `NO-GO`。

## T03 卫生监督首个闭环增量（2026-09-01）

- 已按 R009 源文档复核范围实现“主体最小目录引用—检查任务—接单/开始—不可变检查记录—问题—机构整改—监管复核—关闭”闭环，并提供独立管理页面。
- 四类领域集合由 `public-health` 拥有；所有写命令强制显式幂等键、聚合版本、资源范围重验、单次持久化和链式安全审计。主体只引用身份组织目录代码，不复制机构名称、地址、联系人、证照、居民或患者数据。
- 本增量不包含案件、GIS、视频、社会办医、ESB、附件上传或地方规则定版；通用清单保持 `draft-reference`，运行时和页面固定 `productionReady=false`，生产继续 `NO-GO`。

## 地区需求产品化接入增量（2026-09-01）

- T00 已把松江二期 19 项原始建设需求归一化为独立的 `regional-requirement-catalog-v1` 只读机器合同，并通过既有 commission-only 产品化中心 GET 与管理页面提供白名单摘要；运行期统一待办、地区部署验收和能力包交付状态没有被混用。
- 19 项当前均为 `normalized`，不是 Owner 批准或能力实现。R009 已按原始 PDF 第 73–79 页完成视觉复核并标记 `source-verified`，其余采购文件页码待复核；平台继续 `productionReady=false`、生产 `NO-GO`。
- 后续按 Owner 独立切片推进：T03 智慧卫监协管、T07 医疗付费一件事、T08 区域医疗文书、T06 临床决策支持安全治理以及 T01 平台人工智能与审计治理首批仓库闭环已完成；其余待办仍需独立 PLAN、领域测试、接口/数据 Owner 评审和 T00 集成。

## 已建立基线

- T00–T09 主线与所有权制度。
- “T00 集成治理 + T01–T09 九个一级开发域 + T06 五个临床子域”的机器可校验开发组织。
- 六张 `main@b1e4898` AS-IS 地图和全仓体检。
- A/B/C/D 模块分级、标准接口和重构安全网。
- Schema 台账、数据库标准、核心数据定义。
- ADR 模板、台账和每日 PLAN 审批循环。

## 决策与实施队列

| 优先级 | 事项 | 状态 | 进入实现条件 |
|---:|---|---|---|
| 0 | T00 治理基线迁移 | 已合入 `main@58e05e5` | 按每日循环持续维护 |
| 0A | 9+5 开发组织 | 已接受并形成组合合同、当前说明和治理门禁；不改变运行时 / P1 | 各域按 Owner 独立计划、工作树和测试；跨域接线归 T00，独立部署仍走服务提取 ADR |
| 0B | T07 医保支付独立开发产品线 | 已接受并进入组合合同：独立 Roadmap、Backlog、工作树和领域测试；发布仍经 T00/main，运行时/部署保持共享 / P1 | 按 T07 Owner 推进产品迭代；任何独立仓库、数据库、服务或部署须另行通过服务提取评分和 ADR |
| 1 | 静态内容 allowlist 与快照隔离 | 已合入 `main@6c18221`；PR/main CI 与 Pages 验证通过 | 持续执行清单审查、负向测试与缓存版本治理 |
| 2 | 审计链失败语义 | Accepted ADR；#131 候选已实施，待最新 PR/main CI / P0 | 持续运行严格验证、全量写入拒绝和外部历史链 preflight；真实历史链迁移继续 NO-GO |
| 3 | Schema migration 与指纹 | v1–v14 冻结，v15 append-only audit source、v16 慢病随访 durable outbox 已追加并覆盖空库/v11 升级/重跑/回滚门禁 / P1 | 后续 v17+ 按冻结规则追加，生产迁移仍需备份、核对和现场证据 |
| 4 | 标准 build/lint/typecheck/unit/integration/smoke 入口 | 已合入 `main@fc42833`（PR #130）；TEST-006 已关闭 API test 的 `no-unreachable` 文件级例外，把类型边界由实际 9 个唯一文件扩大到 13 个，隔离/观测本机约 294–371 秒 API 热点，在 shadow-map/调用行为保护下消除两个前端文件的 16 个重复键和全部 lint 文件例外，完成 3 个 care skip 的 T05 owner/route 重验与恢复执行，并依次完成临时 seed/env/server、单个 HIS hospital mock、单个 SIEM alert mock、单个 financial gateway mock 与单个 object-storage gateway mock 五个共享生命周期夹具切片；TEST-002 将内部边界从 4 组扩展为 10 组，新增 worker、区域共享、转诊、科研导出及两个浏览器安全端口，并提高 API governance 基线 / P1 | 保持 test:all 与原 server.js 85/85/55 语义；API 的 43 个子测试数量/顺序摘要、单进程共享状态、断言和超时继续失败关闭；其余共享状态后续仍一次只拆一个生命周期；覆盖阈值只升不降、源码不跨组重复、负向测试必须由所属组直接执行，报告只留临时目录；浏览器端口覆盖不替代 E2E/现场验证，外部 care/HIS/SIEM/financial/storage 投递与现场验收仍 NO-GO，若改变测试拓扑再另立 ADR |
| 5 | 移除组合根循环依赖 | 已合入 `main@21d8f3c`（PR #132）；PR/main CI 与 Pages 验证通过 / P1 | ARC-002 已关闭；后续组合根瘦身归 ARC-001，不扩大本切片 |
| 6 | 生产身份/SMS、PostgreSQL shadow、连续审计投递 | 身份/SMS 与 PG shadow 已存在；PG 已增加 metadata-only 七门评估 CLI、migration/read/adapter/storage-admin 命令闭包及 sync/reconcile systemd/env 合同；连续审计已完成 v15 同事务 append-only source、最小投影、cursor/source binding 和 checkpoint v3 / P1 | 可信签名 receipt、外部单调锚、真实 provider/PG/SIEM/WORM/KMS、容量/故障切换/恢复演练和现场证据继续 NO-GO；CLI 不接 strict preflight，不启动 worker，不做 PG 主切换 |
| 6A | OTP/锁定共享状态 | 已纳入生产身份 ADR；#131 候选已完成 P1 代码增量，待最新 PR/main CI | 保持 SQLite 单主机、PostgreSQL 多实例及原子消费/限流/锁定契约；真实 PG 由 CI 和现场重跑 |
| 7 | 运行时上下文瘦身 | 候选 / P1 | 按领域子端口，逐块迁移，不重写 server |
| 7A | 临床五个可治理子域 | 治理切片完成，急救/血液/影像/体检首个查询用例已迁移；影像 share/QC 与体检专项分流 action 三个写用例已接入目标命令端口并有单元、顺序/失败保护；operations dashboard 与 command 已由 T00 移交 T02，command 32/32 路径已完成 TEST-007 行为保护 / P1 | Accepted ADR；保持协议兼容，继续按五子域逐用例迁移并禁止已迁用例及 operations 回流 T06；专项分流幂等/CAS/事务、QC 幂等/CAS/机构范围及外调—本地写入核对需独立行为变更审批，当前保持 NO-GO；operations 后续拆分或 ARC-008 治理必须保持矩阵通过并另行审批 |
| 7B | 健康驾驶舱版本化指标 | 首个 `population-service-visits.v1` 合同已建立 / P1 | 由 T03 确认来源版本与签名证据、由 T00 注入服务端 region scope；其余指标按 owner 逐项接入 |
| 7C | 生产 API 机器目录 | v3 当前 637 项与 13 项认证合同。现有 42 份幂等行为合同：40 个完整 endpoint、2 个转诊 action-slice；体检专项分流三动作已由真实 HTTP、命令与路由证据登记为一个完整 endpoint，`reviewedProofRequired` 为 0。364 个写接口中 324 个仍缺 endpoint 级证明，通用 action remainder 使总复核为 326，全部 NO-GO / P1 | 继续按高风险与数据写入优先逐 owner 补证；现有合同只证明当前单实例/SQLite 兼容路径，不关闭真实 data owner、PG 多实例、长期留存/归档与现场证据，禁止把进程锁、SQLite CAS 或测试解释为 exactly-once/生产 GO |
| 7D | 区域共享只读边界 | 两个 GET builder 已从组合根归位 `regional-sharing-read-model.v1`，shared runtime 以单一 capability 注入；行为/架构/API 特征测试锁定鉴权、范围、投影、排序、审计顺序与响应兼容 / P1 | 继续小步迁移 legacy normalize/seed/handoff evidence，最终源码 owner 移交需独立流程/ADR；`shared-05`、PostgreSQL atomic repository、数据回填、真实机构地区映射和现场验收仍未关闭 |
| 8 | JSON/SQLite state collection 治理 | DATA-003 状态完整；首发 19 个 legacy 集合已按实际调用点关闭 owner review，当前 61 existing writable、19 owner-reviewed legacy、3 system、168 review-required、1 quarantined / P1 | 继续按 DATA-008 分 owner 确认、归档或 migration 晋升；19 个已审查集合固定生产不可写，process owner 证据不得自动变成 data owner |
| 9 | 前端可信渲染与 CSP | Accepted ADR；生产 Go/No-Go 与生产安全工作台累计关闭 9 个 P0 HTML sink，管理端选择器再关闭 3 个 P0 HTML sink，平台说明页再关闭 4 个清空型 P0 HTML sink，并以恶意输入/行为回归锁定文本、审批、处置、事件委托与空态边界。Inventory v2 锁定 831 项（789 P0/42 P1）：783 个 DOM HTML、6 个动态 URL、42 个动态样式风险且禁止增加/替换 / P1 | 按高风险资产继续治理 783 个 HTML 与 42 个动态样式 sink；真实 OHIF exact-Origin 到位后迁移剩余 2 个导航；完成全角色恶意输入、真实托管头与独立安全评估后才移除兼容 `unsafe-inline` 并强制严格 CSP |
| 10 | CI/worker/部署依赖治理 | CI 风险域拆分和 Action 完整 SHA 固定已建立；required `test` 聚合现失败关闭地区矩阵、真实 PostgreSQL 合同、治理/API、浏览器 E2E 和发布就绪五个上游；12 个 worker profile 的 v1 脱敏兼容观测、9 个部署入口漂移门禁与部署包闭包已完成；在线根 60 + 居民 13 项继续隔离 Worker；OPS-019 已由 PR #275 与 CI run 34228860692 完成 v63 安装/更新/离线/缓存边界及 v62 与更早缓存清理，PWA 3 项在内的标准 E2E 共 76 项；新增入口用例验证 Pages 构建产物的 8 个入口、仓库子路径、静态登录、404 边界及 7 个管理页面的左侧导航；Go/No-Go 四方角色与治理页面恶意响应均有回归 / P2 | 不降低 required checks；持续按官方 tag 升级并核验 commit SHA；新增 worker 必须登记并复用 v1；真实 HTTPS、设备/浏览器策略、外部 Origin、现场缓存升级、采集器/告警和上线验收继续外置 |
| 11 | 居民小程序制品凭证扫描消除哈希误报 | 已完成 / P2 | JSON 仅扫描语义字符串值并精确跳过两个字段中的合法 SHA-256；非 JSON 保留文本扫描；真实演示凭证与伪造摘要负向测试已建立 |
| 12 | 对象存储结构化元数据与耐久命令轨道 | Accepted OBJ-ADR-002；T08 data owner、T00 technical owner、v1/v2 兼容策略、SQLite v17、回填冻结、异步 API、fenced worker、keyset 分页和持久 reconcile 的仓库实现均已完成，production promotion=false / P1 | 真实 provider status/abort capability、KMS/WORM/扫描、容量、备份、监控和现场验收继续 NO-GO；不得把仓库实现完成解释为 worker 已现场激活或生产晋级 |
| 13 | 严格生产预检证据信任装配 | Accepted ADR；T00 pinned-anchor/Ed25519 双角色 provider、CLI 自动装配、deployment package/env/CI 和负向矩阵已形成 / P0 | 真实 anchor/envelope、独立 signer、权限/轮换、外部 evidence 与现场执行继续由生产环境提供；provider 成功不替代完整 preflight 或最终人类授权 |
| 14 | 生产切换行动证据与受保护晋级 | Accepted ADR；definitions-only v2、14/14 共享 Ed25519 验证、strict preflight 门禁、main/manual/production/self-hosted workflow 与 digest-only receipt 已形成 / P0 | GitHub production environment reviewers、专用 runner、真实 14 份 envelope、受控路径、外部审批和实际部署/现场签收继续 NO-GO；receipt 只证明预检资格 |
| 15 | 当前工作流、Markdown 与跟踪 PDF 闭集治理 | GOV-001、DOC-001、REPO-001 仓库内缺口已关闭：开发默认 `origin/main`，固定 tag 仅作证据；289 份 Markdown 唯一分类；3 个 PDF 绑定来源与 digest / P2 | snapshot/superseded 保持只读；新增文档同步清单。两个历史 PDF 与一个现行校验 PDF 均无跟踪生成器，替换前必须先补可复现生成源，不得手工编辑 |
| 16 | 首批生产范围机器冻结 | Accepted ADR；`priority-eight-applications-v1` 冻结 8 应用、9 页面、32 API、38 数据引用、7 worker、14 外部依赖、16 应用证据与 14 切换动作；API/Owner 复核归零。新增迁移闭集把 21 个受阻引用分为 20 个唯一持久化计划与 1 个派生读模型，`collectionRepositoryPlanMissing=0` / P0 | 仓库计划完整不代表迁移完成；21 个引用仍无生产写资格，全部 API/数据晋级、真实外部证据、worker 激活、PG 主切换和现场验收继续 NO-GO |
| 17 | 招标需求治理 v2 | Accepted ADR；2 份中性样本文档、5 条候选、27 个能力 ID、受控 PDF 指纹导入、人工复核覆盖层、差距分析与产品化工作台已形成 / P0 | 原始文件、全文、浏览器上传、OCR/模型、自动改代码和生产授权均不在首批范围；复核写入口保持行为证据待补与生产 NO-GO |

## 每日任务模板

- 目标与依据；
- 范围和非目标；
- process owner / 保护路径；
- 相关地图、ADR、调用方和数据；
- 方案、代价、风险、迁移和回滚；
- 测试计划与完成条件。

输出 PLAN 后停止编码，等待方向审批。

## 2026-08-22 慢病随访 durable dispatch

- 已形成候选：SQLite v16 事务 enqueue、租约 fencing、有界退避、死信、digest-only replay、worker CLI、
  preflight/readiness、部署包与 systemd 合同。
- 下一现场阶段：绑定真实 endpoint/secret provider/activation trust files 与外部签名 decision，核验供应方幂等与签名回执，启用服务
  和告警并完成故障/恢复/死信 replay/回滚演练。
- PostgreSQL 多节点主存储需另立 ADR/migration；在外部证据完成前保持 production NO-GO。

## 2026-08-23 对象存储 ADR 前置治理

- 基于 `origin/main@0796886` 建立 Proposed ADR；不改变 schema head v16、API、runtime 或数据。
- 机器台账明确建议 T08 data owner、T00 technical owner，并把 owner/兼容策略标为两项未决人类决策。
- governance-api 执行 fail-closed 检查：ADR/台账漂移、v17 被占用、owner 被推断、行动提前或任何
  migration/runtime/API/promotion 标志误启用均失败。
- 下一步不是直接编码；先完成人类决策和 ADR Acceptance，再按每个可回滚阶段独立审批。

## 2026-08-23 生产切换行动证据 v2

- 已把 14 项配置降为 definitions-only，禁止提交 `status` 作为完成事实。
- 已建立外部 verifier 驱动的 release/artifact/time/transition/role/digest 评估与负向测试。
- 下一步把可部署 trust provider 与 v2 action evaluation 接入 strict preflight、发布 provenance 和受保护的
  手动 promotion workflow；真实 envelope、信任锚、审批和现场执行继续外置。

## 2026-08-24 PostgreSQL 受控切换评估与部署闭包

- Accepted ADR 已建立独立 `postgres:transition-readiness`；输入只接受绝对路径、普通非 symlink、最多
  1 MiB 且由必填小写 SHA-256 固定的闭集 metadata-only JSON，并复用现有七门评估。
- 部署包登记 migration package/verify、primary-read rehearsal、adapter verify、storage-admin、shadow
  sync/reconciliation service/timer/env；缺文件、变量或伪造 ready 状态均失败关闭。
- 当前完成的是进入受控演练前的仓库侧闭包；真实 PostgreSQL、容量、故障切换、原生恢复、回退、审批和
  现场签字仍未完成，所有生产标志保持 false。

## 2026-08-25 预生产现场只读控制闭包

- environment/joint-test/monitoring/rehearsal/candidate 五入口已建立命令参数闭集、descriptor 有界读取、
  anchor 漂移校验、普通 CLI 固定 NO-GO、五账号/五 key/五公钥 Ed25519 报告信封、48 小时时效、
  可达的 0/2/1 退出语义、
  完整 CLI 负向矩阵与 deployment process contract。
- 候选最多 `GO-CANDIDATE`，execution/primary/production 三类授权固定 false；不会启动 worker、切换存储、
  执行 rollback 或写数据库。
- 通用输入没有新增可信摘要；真实 96 双签回执、120、对象存储、监控/灾备、四方签字和现场执行继续
  `NO-GO`，由外部系统与现场推进。
