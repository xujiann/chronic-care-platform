# ADR-GS03-STORAGE-001：转诊回调入站回执与授权事实的同库原子边界

- 状态：Proposed
- GOV-042（2026-10-12）：仅获批逐写者/事实源盘点设计，22项已发现入口不是穷尽或共同围栏证明；专业接受、正式实现和生产仍另行准入。
- GOV-041（2026-10-10）：仅获批反馈-only合同设计与Owner准入梳理；本父ADR仍未接受。以下反馈读写矩阵是拟议边界，不是事务/现库/S1正式注册实施授权。
- S1限域例外：ADR-GS03-S1-001仅授权未装配migration定义与隔离合成专项，不接受本父ADR，不授权现库、自动注册、事务端口、HTTP或生产。
- S2设计交叉引用：`ADR-GS03-S2-001`（`2026-10-04-gs03-shared-transaction-contract.md`）细化拟议共同事务端口、全写者提交围栏与失败四态；它仍是 Proposed，不接受本父 ADR，也不授权 HTTP、事务端口源码、现库或生产接线。下表是 GOV-029 的源码候选盘点，不代表数据/身份/审计 Owner 签字或全仓穷尽。
- 限域实验例外：用户已批准 `ADR-GS03-EXPERIMENT-001`（`2026-10-01-referral-callback-sqlite-experiment.md`）的 TEST-026 无 HTTP、一次性合成 SQLite 实验；只有此实验可依独立 Accepted 决策实施，不受下文父 ADR 未接受的正式实施前置阻断。本 ADR 及父 ADR 仍 Proposed，正式 repository、现库迁移、主权威选择与运行时接线仍须另审。
- 日期：2026-10-01
- Owner：T00 存储组合与事务端口；T05 会诊事实及消息；T04/`citizen-chronic` 授权和档案事实；T08 入站集成回执候选；平台治理审计 Owner。数据 Owner、隐私/留存 Owner 与真实调用方尚须分别审批。
- 影响范围：GS-03 反馈、排期、报告三类入站回调的 receipt、确切居民授权、会诊、报告档案、应用内消息和成功审计的提交/重放；不改变父 ADR 的 provider 信任合同。
- 依据：`ADR-GS03-CALLBACK-001`（仍为 Proposed）、GOV-027 设计任务、TEST-024/025 的冻结 v1 行为证据；PR329 与主线九门已通过。本 ADR 只作独立存储设计，不授权 runtime、DDL、迁移执行、真实数据写入或生产激活。

## Problem

v1 回调读取平台快照，在验签和案例范围后，以 `contractId + idempotencyKey` 查最多 200 条的 `integrationGatewayEvents`，随后同一次 `writeDatabase` 修改会诊、可选报告档案、两条应用内消息、成功审计及访问日志；它不校验案例绑定的确切授权是否仍有效，也没有耐久且资源/主体/意图绑定的入站 receipt（`src/http/routes/care-coordination.js:489-614`）。TEST-025 已证真实撤权使案例 `authorization-on-hold` 后，旧键重放及新键首次仍获 v1 的 200；这只是现状风险，不是本 ADR 的拟议行为。

授权事实实际是 `personalRecords` 中 `category="authorizations"` 的记录，会诊只保存 `residentAuthorizationId` 引用，不在 `referralSystem` 内嵌授权账本（`registration-referral-standalone.js:200-216,440-535`；`server.js:21659-21678`）。现有直会诊创建在缺授权 ID 时还可借居民任一有效授权通过并存空引用（`server.js:21659-21677`）；新合同不能由其他授权推断历史案例的确切绑定。现有 `withStateCommandLock` 只在本进程内排队，直会诊 create/actions 的显式 CAS 集合列表未单列授权，回调未调用该 helper（`src/platform/storage/state-command-consistency.js:59-97`；`src/http/routes/care-coordination.js:350-614`）。但 `readDatabase` 在业务读取后取含全部 SQLite collection versions 的 `storageMeta`，`prepareCollectionCas` 复制这些版本，`writeSqliteState` 核所带版本，因此已有路径可能带着 `personalRecords` CAS；不能说授权版本一概未受保护（`server.js:6588-6597,8109-8113,8644-8654`；`src/platform/storage/state-command-consistency.js:86-97`）。实际缺口是业务读取与版本采集未证明处于同一受控快照，回调缺确切授权业务检查，所有写者也未证明共享一个线性化点。

这是一项存储权威决策：同一次入站提交、授权撤销/续授权、旧键重放及失败恢复必须使用什么事实源与线性化点？它不重复父 ADR 的字段、签名、角色或供应方认证选择；父 ADR 未被接受前，本方案不能单独开工。

### 当前事实源和跨 Owner 依赖

| 事实或副作用 | 现有位置与机器 Owner | 本 ADR 的候选边界，尚未批准 |
|---|---|---|
| 确切授权及报告档案 | `personalRecords`；`citizen-chronic`（`config/domain-data-ownership.json:565`）。T04 的授权语义职责不自动改写该数据 Owner。 | 由已批准的授权/档案端口在同一提交边界读写；缺确切 ID、居民、用途、目标或版本时失败关闭。 |
| 会诊与应用内消息 | `referralTeleconsultations`、`taskMessages`；`care-coordination`（同配置 `:515,630`）。 | T05 保持业务事实 Owner；两条 `taskMessages` 是应用内消息，当前 `status="sent"` 不等于已投递外部网络。 |
| 入站观测与拟议 receipt | `integrationGatewayEvents`；`integration`（同配置 `:950`），现行列表截断 200。 | 推荐由 integration/T08 提名并经数据 Owner 批准一个**唯一入站 receipt 权威**，仅存受控 principal 命名空间、合同/版本/key 摘要、目标/确切授权 ID、版本化意图摘要、最小结果及审计引用；不复用观测事件为权威，不复制原始 provider payload、患者正文或凭据。 |
| 成功安全/访问审计 | `securityEvents`、`dataAccessLogs` 为 `platform-governance` 系统集合（`src/platform/data/collection-governance.js:8-11`）。SQLite v15 append-only audit source 由已接受 ADR 治理。 | 成功审计与业务一起提交并保持既有 append-only source hook；拒绝审计可走独立受控写入，不得生成成功 receipt，也不得把未知提交误记为已拒绝。 |
| 外部通知 | 当前三回调仅生成两条 `in_app` `taskMessages`（`server.js:21884-21892`），无已证实的回调外部 pending outbox。 | 若另批外部投递，须先批准其 owner、待投递事实及 worker；事务最多原子写入同库 pending intent，不能覆盖提交后的网络发送或外部收件。 |

### S2 已核对的写入口候选与激活前处置（非穷尽）

表中的 Owner 是现行进程/机器数据归属，不等于跨域写入批准；末列均为**提议的激活前策略**，不是已接线或已封堵的事实。`readDatabase()` 先读取 SQLite 集合，再另取 `storageMeta.collectionVersions`，两者没有已证明的同一锁内快照（`server.js:6588-6597,8003-8019,8618-8653`）。`writeSqliteState()` 自行 `BEGIN`，仅核传入的版本键，并将规范化全状态同步到集合表，甚至删除输入中缺失的键（`server.js:8022-8037,8107-8157,8190-8207`）；已有 CAS 可能保护多集合，却不能据此证明各写者的业务读集或外部 scope 与提交共用一个线性化点。

| 已核对入口及源码锚点 | 现行 Owner、读取/版本时点与旁路风险 | 提议的激活前策略 |
|---|---|---|
| `feedback/schedule/report` 三回调（`src/http/routes/care-coordination.js:489-614`） | T05 路由/T08 入站语义；`readDatabase` 在签名后、业务判定前执行，按最多 200 条 `integrationGatewayEvents` 查键，未核案例的确切授权；报告把 `personalRecords` 截到 500。随后一次全状态写，无回调共享事务端口。 | T05/T08/档案/审计 Owner 在同一权威写事务锁内重读案例、确切授权和 receipt；首次/重放均复核，成功事实和真实 v15 审计源同提交；未接线时新 lane 关闭。 |
| 会诊直接 create/actions（`src/http/routes/care-coordination.js:353-476`；`server.js:21655-21678,21729-21755`） | T05，`readDatabase` 位于 `withStateCommandLock` 的进程内队列内，`prepareCollectionCas` 在写前复制所读版本（`src/platform/storage/state-command-consistency.js:59-94`）。显式列表没有单列 `personalRecords`，但可能继承全量版本；create 在 ID 为空时可借任一授权，actions 的标量 `updates` 可修改 `residentAuthorizationId`。 | 与回调共用案例/授权围栏，禁止无确切 ID 或未经核准的重绑；现有命令回执及 CAS 仅作 legacy 保护，不作新 lane 的事务证明。 |
| `/api/workflow-actions` 的会诊更新及 SLA 确认（`src/http/routes/care-coordination.js:315-348,2275-2373`；`server.js:975,20774-20781,21729-21755`） | T05；先读完整状态再更新、写回。`WORKFLOW_PROTECTED_FIELDS` 未列授权引用，标量 `updates` 可进入会诊 action；workflow 的 `expectedVersion` 可选且只覆指定集合。SLA 确认亦直接修改会诊；两者均不持回调共同锁。 | 对授权引用/案例状态纳入共同端口，或在新 lane 激活前拒绝冲突更新；SLA 与一般 workflow 不得以角色检查替代围栏。 |
| 闭环命令 grant/revoke/resume/reassign、创建/排期/回报（`src/http/routes/care-coordination.js:2405-2454`；`registration-referral-service.js:991-1104`；`registration-referral-standalone.js:200-213,258-293,432-538`） | T05 路由及案例，`personalRecords` 机器 Owner 为 `citizen-chronic`、授权语义 Owner 待签。`readDatabase` 后用聚合 `workflowVersion` 和命令事件判断，再 `normalizeState`/全状态写；不是共同事务内的授权版本判定。grant 的 `appendById(...,500)` 及报告归档（`registration-referral-service.js:546-575`）可逐出旧授权；revoke 同时改档案与未终结案例。 | 授权记录、案例引用、关联 referral 和消息由各 Owner 以同一权威写事务或可证明的共同提交围栏串行；授权的新增/删除/裁剪也在保护范围。未覆盖任一命令则新 lane 不激活。 |
| 独立授权撤销 `/api/authorizations/:id/revoke`（`src/http/routes/identity-security.js:978-1023`） | T01 路由，`citizen-chronic` 数据 Owner；读档案和居民 scope 后改状态，`expectedVersion` 仅在提交时可选覆盖为 `personalRecords` 版本，没有与回调共享的授权/案例判定点。 | 授权 Owner 确认该路径与共同围栏接线，或拒绝其与新 lane 冲突的写入；保留现有居民 scope 门禁。 |
| 档案 `POST/PATCH /api/personal-records`（`src/http/routes/citizen-chronic.js:1114-1229`；`server.js:976`） | T04/`citizen-chronic`；POST 可建授权，PATCH 的 `safePatch` 保留 `status` 与 `meta` 可变。两者先 `readDatabase`：未提供 `expectedVersion` 时保留读出的全量 `storageMeta.collectionVersions`，提供时才将其替换为仅含 `personalRecords` 的版本 map（`src/http/routes/citizen-chronic.js:1176-1181,1222-1227`）；SQLite 提交只核所携版本键，仍未证明业务读取与版本采集同快照。居民 PATCH 限 `resident-upload`，机构/主管部门仍受居民 scope。 | 对 `category=authorizations` 的创建、状态/用途/期限/目标修改与删除语义实行共同围栏或拒绝冲突写；不把现有角色限制误写为任意人可改。 |
| 其他档案新增/导入（`server.js:18992,19150,19323,19490`；`src/http/routes/citizen-chronic.js:316-371`；`src/http/routes/clinical-specialties/clinical-blood.js:166-188`；`src/http/routes/clinical-specialties/mutual-recognition-ingest.js:9-42`） | T04/T06 调用各自领域路径，`personalRecords` 数据 Owner 仍为 `citizen-chronic`。这些路径把旧档案前插后截到 500，可能在未主动撤权时逐出仍被案例引用的授权；读/写仍经旧全状态快照。 | 数据 Owner 决定无损容量、授权保留或明确失败策略；任何可使确切授权消失的裁剪/导入先纳入共同围栏或在新 lane 激活前停写。 |
| `PUT /api/state` 与 `PUT /api/state-collections/personalRecords`（`src/http/routes/state-data.js:137-154,179-397`；`server.js:980-993`） | T02 兼容入口，集合事实仍归各数据 Owner；`commission`/经理门禁后可提交全量或替换档案集合。全量路由的 `firstVersionConflict` 预检只查请求携带版本的已改集合，随后把请求的 `storageMeta` 交给存储层；SQLite 提交对规范化全状态中**所有**带有预期版本键的集合再核 CAS，不限于已改集合（`src/http/routes/state-data.js:137-154,282-312`；`server.js:8107-8112,8190-8207`）。请求不带版本键则相应集合无此 CAS；集合保存有 `expectedVersion` 时只携该集合键，缺省时明确置空版本 map（`src/http/routes/state-data.js:371-393`）。均不共享回调提交点。 | 在存储层拒绝任何可覆盖授权、案例或 receipt 的 legacy 全量/集合写，或经各 Owner 批准改由共同端口；先核字段、集合与版本，不依赖 UI 或管理角色约束。 |
| 非生产 `/api/reset` 与启动归一化/JSON→SQLite 种子（`src/http/routes/state-data.js:406-445`；`server.js:6588-6597,7998-7999,11878`） | T02/T00；reset 有生产禁止、经理和访问声明空集门禁，但 `seedState` 后可重置相关事实。归一化/种子、旧快照导入也可改变授权与案例投影，未形成与入站 receipt 的共同恢复世代。 | 维护/种子窗口停新 lane，经数据 Owner 核准同源世代及 receipt/授权/案例一致性后恢复；无法证明时失败关闭，不自动用旧快照覆盖。 |
| 文件级备份恢复/回滚（`scripts/storage-admin.js:229-259`；`scripts/rollback-snapshot.js:8,37-43`） | T00 存储/运维；restore 要求显式确认并检查 sidecar/备份，然后替换 JSON/SQLite 文件，但代码本身不证明全部写者已停，也不证明源身份、receipt 与业务恢复世代一致。 | 由运维、数据和审计 Owner 批准停写、快照/源身份/世代核对、恢复后同 key 对账与重新开放条件；新 lane 在核对前保持关闭。 |
| 外部账号/机构/居民 scope 变更写者与成功审计（`server.js:15353,15567-15604,8114-8121`） | T01 身份与 `platform-governance` 审计事实跨边界；本地 SQLite 锁不覆盖另一权威的撤销/归属变更，v15 append-only source 现随旧 `writeSqliteState` 工作。单次外部版本复读仍留 TOCTOU。 | 外部事实 Owner 提供覆盖其**全部变更写者**、持续至回调线性化提交的 `authorityFence`；审计 Owner 验真实 v15 hook 与业务/receipt 同事务。任一无法证明则新 lane 关闭。 |

该表按当前可见调用链列出直接写者及可通过全状态同步覆盖事实的类别，仍须由 T00 静态枚举剩余 `readDatabase`/`writeDatabase`、迁移、管理脚本及恢复调用，并由 T01/T02/T04/T05/T06/T08、机器数据/授权语义/身份 scope/审计/留存 Owner 对各自读集、写集、停写或接线策略逐项签认。尤其 `personalRecords` 的 500 条截断和会诊授权引用变更不能因“不是撤权路由”而排除。入口、Owner 和外部事实若有未签或未封堵项，新 lane 的激活条件不成立。详见 [S2 共同事务合同](2026-10-04-gs03-shared-transaction-contract.md) 的拟议端口与故障四态。

## GOV-042 逐写入口事实盘点（2026-10-12）

本轮仅批准对共同提交前置作代码盘点设计。以下将 GOV029 的入口类别细化为22项已发现的调用链、读写集、版本时点和旁路；并非全仓或真实外部写者穷尽证明，也没有接线/封堵任何入口。代码基线为 main@e64835fed38561ee8232296c7aaffd84aec1ef81（PR348，源码与原冻结42567e38一致）；源码摘要及搜索边界受控记录在 .codex-platform-evidence/gs03-writer-inventory-20261012/source-inventory.json。本表只证明静态可见实现，未执行正式交易或并发验收。

### 事实源与共享读写时点

机器数据归属仍以 config/domain-data-ownership.json 为准：personalRecords为citizen-chronic，referralTeleconsultations/referralSystem.referrals/taskMessages为care-coordination，integrationGatewayEvents为integration，accounts/authOrganizations/authUsers/residents为identity-security（该配置:453-467,510-518,560-570,630-633,950-953）。安全/访问审计不是该配置的普通集合条目，而由 src/platform/data/collection-governance.js:8-12 的 SYSTEM_COLLECTIONS 指定platform-governance；这不是专业签署或receipt权威选择。路由进程Owner亦不能替代数据/语义/留存Owner接受。

共享时点S0：readDatabase先读并normalize业务状态，再另采SQLite collectionVersions（server.js:6588-6597,8652）；未证明二者在同一受控锁内快照。prepareCollectionCas复制已读metadata，并非重新锁内读取（src/platform/storage/state-command-consistency.js:86-98）。共享时点S1：writeSqliteState自己BEGIN，仅核传入的版本键，随后全量同步/删除缺键、真实v15审计源及身份镜像，最后COMMIT/ROLLBACK（server.js:8022-8160,8190-8207）。携全量版本不等于业务读集同快照；空版本map不能提供该CAS。withStateCommandLock只是本进程key队列（同helper:59-70），不同锁或单次事务不构成共同线性化点。auto仍可能走JSON（server.js:7876-7885），新lane不能将其解释为SQLite权威。

### 服务与授权入口

末列均是接线前拟议策略，尚未实现或由真实Owner签认。当前角色、资源scope、幂等回执与版本限制必须保留，不能概括为无保护。

| 编号与实际入口链 | 读集及版本时点 | 写集/裁剪与现有保护 | 拟议处置与待签责任 |
| --- | --- | --- | --- |
| W01 feedback-callback：care-coordination.js:489-614 | 签名/role后S0；案例、居民scope、contractId+key观测查重，不核确切授权业务条件 | 案例反馈/时间/performance、最多两条按notificationKey去重的in_app消息、观测/双审计；网关最多200；无共同key锁，但SQLite可携全量版本 | T05/T08/授权/审计同端口锁内重读；正式receipt/签名/字段待签，无接线则关闭新lane |
| W02 schedule-callback：同文件:489-614 | 同W01，当前scope后查旧观测 | 案例状态/窗口/接收机构/医生及最多两条去重消息、观测/双审计；同S1局部保护 | 排期可改反馈读集，不能因反馈-only排除；T05/授权Owner签共同围栏或冲突拒绝 |
| W03 report-callback：同文件:489-614，特别:592 | 同W01；报告使用案例/居民/档案快照 | 案例报告、personalRecords前插截500、最多两条去重消息、观测/双审计；无确切授权共同判定 | 档案Owner签容量/授权保留，报告写者纳入共同端口或拒绝冲突写 |
| W04 会诊create：care-coordination.js:353-414→server.js:21655-21677 | 进程key锁内S0，读personalRecords；空授权ID仍可借任一有效记录，不证明purpose/dataScopes/到期严格检查 | case最多300、单条行内命令回执及安全/访问审计，不写消息；prepareCollectionCas可能携全量版本 | T05/授权Owner签确切ID、历史空引用、保留/容量及共同锁内决策；不替用户选历史授权 |
| W05 case actions：care-coordination.js:415-476→server.js:21729-21755 | key锁内S0、案例/居民scope/版本 | cleanWorkflowUpdates可改residentAuthorizationId（保护集:975,20774-20781未列此字段）；行内回执最多20，局部回执/CAS不是共同围栏 | T05签重绑及状态转移，授权Owner签新旧授权关联；同端口或新lane前拒绝冲突 |
| W06 workflow-actions会诊分支：care-coordination.js:2275-2374 | S0案例/居民scope；expectedVersion可选，只覆目标集合版本 | applyAction后payload.status可再覆状态、成功安全审计；无共同锁 | T05签所有updates/status与授权引用冲突面，不以可选版本代替共同提交 |
| W07 SLA run/ack：care-coordination.js:278-348 | S0案例、消息与scope | run消息截300/安全事件截120；ack改slaDisposition、消息receipts及双审计；直接S1无共同锁 | T05/消息/审计Owner签每个冲突字段及接线/拒绝策略 |
| W08 闭环命令：care-coordination.js:2405-2454→registration-referral-service.js:1073-1112→standalone.js:432-538 | 单次S0、clone、聚合workflowVersion及命令指纹；既有聚合需expectedVersion，非锁内授权版本决策 | grant档案截500；revoke授权+未终态案例hold/消息；resume确切授权；reassign目标/授权并同步referral/order；建案/排期/报告另见service:265-345,475-576；事件截300 | T05/档案/授权Owner逐命令签读写集；聚合事件不是成功v15审计，也不替正式receipt |
| W09 独立授权revoke：identity-security.js:978-1023 | S0授权/居民scope；expectedVersion仅可选personalRecords | 授权状态、双审计；直接S1，无共同锁且不同步case hold | T01路由/档案数据/授权语义Owner签共用围栏及案例语义，不削弱现有居民scope |

表内未带目录前缀的care-coordination.js、identity-security.js均在src/http/routes；standalone.js指registration-referral-standalone.js。源文件归属不自动授予T00领域实现权。

### 档案、通用状态、身份与维护入口

| 编号与实际入口链 | 读集及版本时点 | 写集/裁剪与现有保护 | 拟议处置与待签责任 |
| --- | --- | --- | --- |
| W10 personalRecords POST：citizen-chronic.js:1114-1184 | S0档案/residents/scope；expectedVersion有则仅档案，无则保留S0全量metadata | normalizePersonalRecord/push档案及访问审计；角色/居民scope限制仍在，可建authorizations | T04路由/citizen-chronic数据/授权语义Owner签授权新增与同围栏，非任意人可写 |
| W11 personalRecords PATCH：citizen-chronic.js:1190-1229→server.js:976 | S0按ID找记录并核scope；版本同W10 | safePatch不排除status/meta；居民仅resident-upload，机构/主管部门亦受scope；无反馈共同锁 | 签authorizations状态、用途、目标、到期、root/meta变更及冲突拒绝，不扩大已有角色权限 |
| W12 T04非授权新增：citizen-chronic.js:316-371→server.js:18992,19150,19323,19490 | 慢病反馈、checkin、家医闭环、转诊连续性读各领域旧快照；慢病反馈另有进程锁/prepareCollectionCas | 新档案前插截500及各领域消息/审计，可逐出案例引用授权；局部锁不覆盖全部裁剪 | 档案/各领域Owner签无损容量或明确拒绝策略，无关新增亦须保护确切授权 |
| W13 临床导入：clinical-specialties/clinical-blood.js:166-188、mutual-recognition-ingest.js:9-42 | S0报告/居民/档案及各自业务范围 | 前者影像ingest mergeByKey后截500，后者互认报告前插截500；文件历史名称不决定数据Owner | T06/档案Owner签导入、裁剪及授权保留；同端口或激活前拒绝冲突 |
| W14 PUT state：state-data.js:179-313,:137-154 | commission+manager，withLock('clinical-assist:state')内S0；预检只查改动且携版本集合 | normalize全状态并采用payload.storageMeta；S1再核全部携版本键，不仅已改集合；可覆盖授权/案例 | T02兼容路由/T00及数据Owner逐集合核存储层不可绕过围栏；管理权限不是共同锁 |
| W15 PUT state-collections：state-data.js:315-395 | 同角色/本进程锁；S0后替集合；expectedVersion有则仅该集合，无则明确空map | personalRecords可被替换；部分server-managed身份集合拒绝，不能说任意集合可写 | 逐COLLECTION_WRITE_KEYS与scope依赖集合签冲突处置；受保护事实未核不得激活 |
| W16 非生产reset：state-data.js:406-445 | 禁production、commission manager、accessAcknowledgements空集门禁 | seedState→writeDatabase重置相关事实；无已证receipt/授权/案例共同恢复世代 | T02/T00与数据Owner签停写、重置用途、恢复核验，新lane维护时关闭 |
| W17 normalize/空库seed：server.js:6580-6597,7980-8000,11878,12243-12308 | readDatabase会normalize投影；SQLite读后normalize不自动写盘，JSON changed可写回；空SQLite可从JSON seed | 补演示档案/授权投影；实际持久变更需对应ensure/seed或后续writeDatabase路径核实 | 不把每次读或启动称写盘；源/数据Owner逐实际写入口核seed/normalize持久化及停新lane策略 |
| W18 文件恢复/回滚：scripts/storage-admin.js:225-259、rollback-snapshot.js:8-43 | restore需confirm、sidecar不存在、checksum/integrity/质量检查及安全备份；rollback保存pre-rollback | 替换JSON/SQLite文件，未证明所有进程停写或receipt/key/审计源同恢复世代 | T00运维/存储/身份/数据/审计Owner签停写、源身份/世代、同key对账及重开；confirm不等于fence |
| W19 账号生命周期/目录应用：identity-security/account-lifecycle.js:71-104→account-lifecycle-service.js:153-176；identity-security.js:714-766→server.js:14679,14725 | 生命周期路由S0进入自身withLock后写；目录bind/apply从外部目录及本地authUsers决策 | 建/改role、orgCode、permissions、disable/restore及主体绑定，目录apply亦撤session；局部锁不同于反馈锁 | T01/外部目录权威签全部变更写者及持续至提交的authorityFence，不能用一次复读替代 |
| W20 PATCH residents：citizen-chronic.js:491-520 | commission/institution+canManageResidentProfile；S0；expectedVersion有仅residents，无空map | 更新residents归属等scope来源；T04路由但数据Owner为identity-security | 身份/scope与居民资料Owner签scope字段变更、同围栏或冲突拒绝；不能假定缺省全量CAS |
| W21 泛型/派生scope来源：server.js:17743-17778,15532-15560,15353及W14-W18 | 当前用户/authUsers、residents、accounts.members、county业务集合、组织别名及doctor/nurse关联、referralSystem均可能影响scope | 泛型集合、业务命令、seed/恢复可能改变来源；尚未逐个证明所有实际写者闭集 | 身份/scope Owner逐来源列动态/间接/外部写者和受控凭据；未检出不能写“不存在”，缺签/缺fence新lane关闭 |
| W22 真实v15 source：server.js:8114-8124→src/identity-security/audit-delivery-source.js:256-286 | 在S1同连接读取旧/新securityEvents、dataAccessLogs链 | 按事件/摘要append-only及冲突拒绝，身份镜像随后同步；确有旧事务hook，尚无正式receipt语义绑定 | platform-governance系统归属及真实审计责任方签本次principal/目标/成功事件/receipt绑定；FK存在和fake源均不证明该语义 |

citizen-chronic.js、state-data.js及identity-security子目录路径均相对src/http/routes；account-lifecycle-service.js在src/identity-security。W19-W21涉及真实外部权威，其变更入口、审批凭据与停写协议未提供，不能由本地源码替代。

### 搜索边界、未决项与交付标准

本次定向搜索src/http/routes、src/identity-security、server.js、上述两个管理脚本，核personalRecords赋值/前插/裁剪、authUsers/residents写式、通用read/writeDatabase、命令锁/CAS及审计hook。没有逐一审完全仓动态引用、所有scripts、所有业务数组的scope派生写者、provider目录及部署进程，也没有真实Owner逐入口签认；22项是已发现事实，不是“全部写者已穷尽”的结论。新增入口或外部写者变化须补清单并重新审查，不通过grep数量、角色限制、模拟测试或离线校验器宣布围栏成立。

专业待签仍集中在ROADMAP九组清单：四主体用途与最小重放、专业字段/消息隐私、确切授权、正式签名/摘要及跨principal同逻辑事件责任、唯一receipt/审计绑定、留存/隐私删除/容量/到期及legacy、源身份/恢复世代、全部scope写者与持续fence、unknown受控对账。真实Owner、批准值、期限和受控签署凭据均未提供；本盘点交付可以完成，不代表任何专业项接受或风险销项。

正式接线前，逐入口须提交可执行同源锁内读取/冲突保护或不可绕过拒绝、真实多连接/多进程交错、到期/裁剪/恢复、v15语义绑定和故障四态证据，且全部外部authorityFence持续到线性化。缺任一关键写者证明则不激活新lane，不静默v1/JSON回退。验收方案见S2增补；本轮只运行治理及既有仓库门禁，不执行这些未来正式专项。

## Options

### GOV-041 反馈-only读写与Owner待签矩阵

当前首次反馈通过 `applyReferralTeleconsultationAction` 改案例status/receivingFeedback/lastUpdated/updatedBy/auditTrail，再赋feedbackAt、可merge任意performance；追加网关事件、两条in_app消息、成功安全/访问审计，最后writeDatabase。反馈不创建personalRecord，报告才归档（`src/http/routes/care-coordination.js:532-614`）。反馈normalizer有嵌套/别名及时间、居民、externalId、sourceSystem回退；状态已知别名映射，未知字符串trim后保留，空值回退requested（`server.js:21704-21720,21778-21795`）；这些是现状，正式字段与转移待CALLBACK批准。

| 事实/副作用 | 反馈首次候选、精确重放与失败约束 | Owner及接受前输入 |
|---|---|---|
| 当前案例与确切授权读集 | 锁内读同ID的案例授权、resident/目标/状态/用途/数据范围/到期及版本；反馈不改personalRecords也保护所读授权。重放先同样核当前权限，不能借另一授权。 | T05与授权语义/citizen-chronic数据Owner：字段及合法转移、root/meta冲突、purpose/dataScopes、空授权历史策略、续权和裁剪。 |
| 案例写集 | 仅正式白名单反馈字段及获批状态转移；服务端时间/审计trail在同一受控提交生成，不能放进重试意图摘要；同key冲突不写。 | T05：feedbackStatus/performance逐字段及终态/hold规则；未经批准不沿用宽merge或状态倒退。 |
| 两类应用内消息 | 首次按经批准收件角色/资源绑定/隐私投影写；重放不追加。v1 notificationKey含case/kind/key/role，跨principal同key可能碰撞（`server.js:21848-21900`）。 | T05/消息与隐私Owner：命名空间、两收件规则、正文是否进入消息、留存；status=sent不是外部送达。外部通知/报告归档均不在反馈-only片。 |
| receipt及观测 | 首次唯一约束receipt与同事务业务关联；只存受控摘要、最小结果与审计引用，禁止provider原文/患者反馈正文复制。观测事件仍非权威，不受200截断影响receipt。 | T08提名且数据Owner签唯一入站权威、最小公共投影、命名空间/key/正式digest、retention/到期tombstone/key复用及容量。S1结构不是上述批准。 |
| 成功审计与真实v15源 | 首次成功安全/访问事件及原生v15 append-only source同事务，引用必须属于本次principal/目标/receipt，不只验证FK存在；精确重放不补成功审计。 | platform-governance审计Owner：真实hook、受控来源和隐私投影；拒绝审计另定，不创建成功receipt，unknown不伪记已拒绝。 |

推荐继续评审同库单提交候选，不新建JSON集合、平行反馈账本、第二个授权源或跨库请求双写；若无法覆盖事实源与外部scope，停在设计或另审迁移。完整共同写者清单仍以本ADR前述非穷尽inventory及S2为基础；缩为反馈-only不能排除排期/报告、授权/档案/通用状态/导入裁剪/恢复等冲突写者。

接受前存储/身份/数据Owner还须签认恢复源身份/世代与principal namespace、key、audit source绑定。S1没有epoch列，不能暗改摘要或补历史receipt。超过200观测、旧无digest/冲突及空授权历史只能另批失败关闭/人工对账；legacy allowlist/期限、receipt保留与隐私删除/备份恢复目标不填生产值。合同算法冻结后按最新head另立Accepted实施片；本设计不注册候选v20或变更默认19/41。

未来反馈专项须逐步故障注入案例、两消息、观测、成功安全/访问审计、真实v15源、receipt和COMMIT前后；明确回滚才断言本次零写，丢响应/unknown用原主体/合同/版本/同key/同意图在当前授权下恢复。无法确认则受控对账，撤权后公共receipt隐藏且既有事实保留。受控对账Owner/权限/留痕/期限待签，不能以换key或删回执修复未知结果。以上不是本轮已运行的事务或HTTP验收。

1. **维持 JSON/SQLite 快照写与 200 项事件窗口。** 不新增权威或改变写入口。成本低，但无法承诺长期去重、确切授权竞态或跨实例原子性；只适于继续刻画 legacy 风险。
2. **推荐评审：隔离 SQLite 同库事务端口 + 独立入站 receipt 权威。** 先限合成隔离环境，所有会影响确切授权/案例绑定的写者都进入同一受控端口；在同一 SQLite 事务中读取并验证授权、案例与 receipt，再以唯一约束原子提交入站 receipt 的最小结果/审计引用、业务、档案、应用内消息、成功审计及经批准的待投递意图。JSON 新 lane 失败关闭。若需新表/索引，必须另有 Accepted 迁移 ADR 和实施 PLAN；不预占 migration 版本。
3. **将 PostgreSQL 直接选为入站主权威。** 在同一正式 PG 事务、唯一约束和行锁/CAS 下迁移授权、会诊、receipt 及各副作用的所有写入口。可作为后续多实例方案，但当前 primary/relay 是隔离样本链，`STORAGE_ENGINE` 仅支持 `auto/json/sqlite`（`server.js:515,7869-7887`）；出站 PG delivery receipt 与主存储批次 receipt 均不是入站 callback receipt。此方案需更大范围的数据、部署与现场迁移审批。
4. **另建独立回执服务或跨库账本。** 可能隔离吞吐，但授权/业务/receipt 跨库后需要分布式提交或可证明补偿，显著增加未知提交和双写窗口；在真实调用方/存储权威未定前不推荐。

## Advantages

- 方案 2 沿用当前 SQLite 事实源，在一个可故障注入的提交点验证入站 receipt 和授权竞态，不把出站 receipt 或 200 项观测事件误称为权威。
- 唯一 receipt Owner、最小存储投影与失败关闭旧记录，可避免平行入站账本和患者正文复制；T04/T05/T08/审计 Owner 仍保留各自事实责任。
- 方案 3 将来可评估真正多实例 PG 语义，但无需为本轮设计提前激活或假装已有 callback PG 表。

## Disadvantages

- 方案 2 不是“给现有回调加一个 `BEGIN`”即可：当前 SQLite `writeSqliteState` 自身开启事务并执行全状态同步（`server.js:8022-8158`），新端口须设计可组合的单事务读写、唯一约束及所有相关写入口接线；现有进程锁与可能继承的全量 collection versions，仍不能单独证明业务读集、确切授权语义与共同线性化点。
- 授权、档案、会诊、消息和审计横跨多个机器数据 Owner。若任何入口仍能用旧快照覆盖这些事实，局部事务不提供全局保证。当前 JSON 路径最终写快照（`server.js:7787-7856`），`auto` 可在 SQLite 不可用时退到 JSON；新 lane 必须显式校验引擎与源身份，不能静默降级。
- 方案 3 要迁移全部写者、数据与备份/恢复，并验证真实 PG 多实例；现有 SQLite→PG relay 及出站投递证明不能代替该验收。方案 4 的跨库一致性和运维成本最高。

## Migration cost

方案 1 低但风险不消除。方案 2 中到高：首先盘点全部授权和会诊写入口及各 Owner；经审批后才可能设计入站 receipt schema/唯一索引、共享事务端口、成功审计 source hook、故障恢复与版本化兼容测试。当前 SQLite schema head 为 19；若实施需要 migration，必须届时重新核最新 head，选择其后继版本并保留历史 checksum，不能现在预占 v20，也不能借 `2026-09-21-sqlite-outbox-commit-receipt.md` 的出站首切片 Accepted 范围授权入站接线。方案 3 高到极高，须另行批准 PG 数据迁移、所有写路径切换、多实例、容量、回退和现场运维；本 ADR 不执行任何迁移。

### 推荐候选端口的必要不变量

1. **同一事实源与读集。** 上述 S2 源码候选盘点不是全仓穷尽或 Owner 签收；所有 grant/revoke/resume/reassign、直接会诊 create/actions、三类 callback，以及任何可更改授权记录、会诊授权引用或通过裁剪逐出授权的通用状态/档案导入、集合保存、reset、管理脚本和恢复路径，仍须完成精确入口 inventory 与逐 Owner 确认。直接授权撤销、档案 POST/PATCH、`PUT /api/state`、`PUT /api/state-collections/personalRecords` 和非生产 `/api/reset` 均有既存角色/经理/居民范围门禁（`src/http/routes/identity-security.js:978-1023`；`src/http/routes/citizen-chronic.js:1114-1229`；`src/http/routes/state-data.js:179-455`）；这些限制不等于共同事务保护。实施时所有冲突写者要么进入同一权威提交围栏，要么在新 lane 激活前拒绝冲突写入；不能声称旁路已封堵。
2. **从锁内新快照决策。** 候选 SQLite 端口在同一连接上获得受控写事务/序列化点后，才读取案例、确切 `personalRecords` 授权、receipt 和相关版本，规范化并决定首次或重放。禁止在事务外用旧业务快照计算更新，再取新版本拼成写入。每个写者须证明授权与案例业务读取依赖受保护：即使反馈/排期不修改 `personalRecords`，也必须在提交前验证确切授权记录或所属集合版本未被撤权/续权改变；不能仅假定继承的全量 metadata 与业务读取同快照，也不能只显式列脏集合。授权用途、居民、目标机构、状态、到期均以服务端受控时钟在决策/提交边界复核；无已批准的时间容差数值。
3. **首次提交与唯一回执。** 在同一事务内以批准的稳定 principal 命名空间 + 合同/版本 + key 唯一定位 receipt，比较目标、确切授权 ID 和父 ADR 规定的版本化 `intentDigest`。首次成功以数据库唯一约束原子写入入站 receipt 自身（受控 namespace、目标/授权 ID、摘要、最小结果和审计引用）、会诊、必要的报告档案、两条应用内消息、成功安全/访问审计及 append-only audit source；如外部投递另获批准，只提交同库 pending intent。任何一步失败必须回滚这些同库事实，不能先写业务再异步补 receipt。`integrationGatewayEvents` 只作可截断观测投影。receipt 最小结果不得包含旧事件的完整 payload、患者正文或跨目标 `receivedBy`。
4. **重放与撤权线性化。** 旧键重放虽不改业务，也在同一一致快照/序列化点重新核当前主体 scope、案例绑定的确切授权、有效期及 receipt 摘要后才投影最小结果；若撤权先提交，首次和重放均失败关闭且不泄露旧 receipt；若回调/合法重放先线性化，已提交事实保留，后续撤权再生效。排序取事务判定/提交点，不以 HTTP 到达或网络响应完成时刻定义。若当前 scope/机构身份来自事务外目录或另一数据库，SQLite 锁不能覆盖它，单次复读版本也仍有 TOCTOU：必须沿用父 ADR 的可信认证前提，由该外部事实权威批准并与所有撤销/变更写者共同实行可验证的提交协议，使身份/scope 证据或 fence 持续有效直到回调线性化完成；无法证明这一点则新 lane 失败关闭。本 ADR 不创建新认证服务。
5. **失败四态。** 成功已提交只回最小授权结果；明确由权威证实回滚才可断言本次业务/receipt 零写；提交成功但响应丢失须在当前授权下用**同 key**查/重放；结果未知不得推断零写或换新 key，先以同 key 在权威中核实，无法核实则停下受控对账。撤权后公共接口不披露旧 receipt，但保留经授权、留痕的对账渠道；其 Owner、响应时限和权限仍待批准。拒绝安全审计独立于成功事务，未知提交不能补写“已拒绝”造成伪证。

## Risk

- **历史与保留。** 旧 `integrationGatewayEvents` 截断 200、无 `intentDigest`、可能缺事件/缺 receipt 或同 key 多目标冲突，均不能自动生成“已证明”新 receipt。推荐只读盘点后将可疑历史隔离、失败关闭或由授权 Owner 人工对账；已批准的 legacy caller allowlist/截止期仍由父 ADR 控制。新 receipt 的保留期、过期后 key 摘要 tombstone、隐私删除与可否重新使用 key，须由数据/留存/调用方 Owner 批准；本 ADR 不编造生产天数。未确认期限前不得宣称长期去重。
- **回滚。** 一旦新 receipt 或业务提交，旧 runtime 若忽略新 receipt 可能重放；回滚只能停止新入口、保留账本/业务/审计并前滚修复或经验证的备份恢复与对账，不自动 DROP、删 receipt、重置 key 或恢复宽松 v1。schema 已升级的数据库不可未经验证交给旧版本 runtime。
- **审计与外部副作用。** 已接受的 SQLite v15 append-only audit source hook 必须随成功业务保持原子；展示链 120 条及外部 SIEM/WORM 不是入站 receipt。拒绝审计的独立事务、其失败政策与隐私投影须由审计 Owner 决定。外部网络通知无法包含在本地提交原子性中；当前应用内消息 `sent` 不可当作 provider delivery receipt。
- **外部身份与生产。** 真实 provider 信任、账号/机构绑定、跨库 scope 版本 fence、单实例以外的源身份、容量/备份/恢复及保留审批仍缺。SQLite 合成通过最多证明候选本地语义，不能宣称 PG、多实例或现场生产可用；GS-03 和生产六域保持 `NO-GO`。

## Recommendation

推荐方案 2 作为**待审批的最小隔离技术方向**，不视为已选定架构：先由 T00 与各数据 Owner 定唯一入站 receipt 权威及共同事务端口合同，完成全写入口/跨库依赖 inventory；再评估 SQLite 同库 schema 与事务可行性。若授权、案例或副作用不能进入同一权威，或外部 scope/机构事实没有经其权威批准且覆盖所有变更写者、维持到线性化完成的提交协议，新 lane 必须保持关闭，改走方案 3 或其他独立迁移评审，不用普通版本复读或平行账本双写掩盖缺口。父 ADR 的 A 新 lane 合同与该持久前置须分别 Accepted、另行 PLAN/准入后才能实施；B provider 信任和现场激活另审。

后续实施建议最小分片：①只读 inventory、Owner/留存/历史冲突盘点与事务端口合同；②如获独立 Accepted 迁移 ADR，先在隔离 SQLite 合成库验证 receipt 唯一约束、同库原子与失败四态，不接 HTTP；③所有授权/会诊写者与新 lane 同一端口接线、禁止旁路，补真实 HTTP 与多进程/重启故障证据；④若选择 PG，再做单独主权威迁移和真实 PG/现场评审。每片重新锁定文件单写者、最新 schema head、回滚和门禁；本轮不执行。

未来最低验收矩阵：三合同的首次/精确重放/异意图/异目标/跨主体；授权 active→revoked、grant→resume、到期跨提交边界与两进程交错；只读授权版本改变而反馈/排期业务可写集合未变；report 档案、两条应用内消息、成功审计和 SQLite append-only source 各步骤故障回滚；提交后响应丢失、未知结果重启同 key 核验；拒绝审计失败与未知提交不伪记；超过旧 200 事件、缺/重复/无摘要历史 receipt、保留到期/tombstone 和降级/回滚窗口；通用 state/collection/reset/导入旁路负测。须隔离合成数据、受控故障注入与真实多进程/跨连接验证，不能以 mock、当前 TEST-024/025 或现有出站 PG 证据代替。所有生产值和现场证据仍待批准。
