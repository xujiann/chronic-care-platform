# 工程治理路线图

## GS03 执行器输入边界修复 PLAN（2026-10-09）

用户要求继续开发，GOV-038/OPS-057只修复既有Accepted ADR-GS03-OUTCOME-001合同内输入异常逃逸，不扩大接口或专业权限。基线origin/main@8942e1c2；PR342同树保护集成、PR/main各9成功后，仅关闭GOV037/OPS056限定初始化交付，风险保持open，WIP先4降2再登记回4。

目标是输入null、撤销Proxy或environment/port访问异常时返回固定rejected/admission/productionReady=false，先核环境、无效环境不得访问port，无事务调用或遗留占用。方案选择受保护读取，保留合法访问器、额外字段、原并发/unknown及四态行为；不新增精确字段限制、身份规则、HTTP、现库、默认schema、依赖或生产装配。

T00单写台账、本PLAN、架构和模块地图；A在独立T08只写gs03-transaction-outcome.js，B只写既有专项gs03-transaction-outcome.test.js，Git索引串行；独立审查者只读。先准入核验，回归先证旧缺陷，再修复及相关组合测试；独审通过后冻结，串行18项必需门禁，最终SHA/日志摘要保存在仓库外受控证据。不借PR342结果证明本候选，不推送、合并或部署；回滚仅撤本片增量，不动库和已提交历史。

后续业务优先评审反馈回调纵向闭环，其正式事务、确切授权、全写者围栏、留存和未知结果恢复仍需独立准入及责任人决定。影像质控缺机构归属核验及外调/本地提交耐久对账；医保日终对账当前只比较汇总，需逐笔绑定以识别相互抵消的差错；公卫已有合成闭环及租约恢复，仍需共同持久事务/CAS和跨实例竞争验证；后台任务已有checkpoint及未知恢复组件，仍缺受控常驻调度、围栏和运行交付。以上新协议分别准入，不因模块存在或局部测试通过晋升整体验收；黄金场景及生产六域保持未闭合/NO-GO。

## 2026-10-09 GS03 非生产内存初始化 PLAN

用户批准GOV-037/OPS-056显式自有内存初始化：真实runner与未注册S1先于端口发放，复用原租约引擎，旧空库工厂兼容。ADR见docs/adr/2026-10-09-gs03-memory-bootstrap.md。PR341已同tree集成e835fd2f，PR/main各9成功、18本地门禁，全发现3962pass/45skip/0fail，仅闭合GOV036/OPS055限定交付；风险仍open。T00治理、A单写adapter、B单写新专项，独审冻结后串行18门禁并按已有保护流程推送合并。默认19/41、父Proposed、GS03未建设与生产六域NO-GO不变。

## GS03 回执检查修复与组件组合 PLAN（2026-10-09）

GOV-036/OPS-055修复store TEMP元数据观察导致适配器unknown的合同内缺陷，组合三个已集成组件与原生v15/S1结构及真实hook开展隔离回归。真实migration runner专项独立，不新增bootstrap或正式业务接线；准入和专业决定清单见docs/adr/2026-10-09-gs03-receipt-composition.md。PR340已同树集成42a90fee，PR/main各9成功及演示Pages成功；仅关闭GOV035/OPS054限定交付，风险/GS03未建设及六域NO-GO保留。用户继续开发并沿用既有保护交付流程；T00治理、T08 A源/helper与B两测试单写，独审冻结后串行18门禁。

## GS03 未接线回执读写组件 PLAN（2026-10-08）

用户批准GOV-035/OPS-054开发测试，复用S1定义，新增未装配回执组件与专项。固定namespace、同键精确匹配/冲突拒绝、不可变INSERT；调用方持有事务，matched/staged不表示授权有效或已提交。基线main@c69e25b0，PR339与冻结8871d6e3同tree67932107、PR/main各9成功，先闭合GOV034/TEST028限定测试交付，WIP2增4。T00治理、T08两开发分别单写组件/测试、独审只读；详见docs/adr/2026-10-08-gs03-receipt-store.md。默认schema/HTTP/现库不变，父Proposed及生产NO-GO保留；用户协调专业另签。本片不推送合并上线。

## GS03 事务组件组合验收 PLAN（2026-10-08）

用户批准GOV-034/TEST-028仅开发测试：组合已集成结果执行器和内存适配器，验证多类合成事实首次、重放、故障回滚和未知隔离。合成审计占位不是真实v15或专业证据，详见docs/adr/2026-10-08-gs03-transaction-composition.md。基线main@302919c5；PR338冻结b57f44d5同tree1e12e7f9，PR/main各9成功，先闭合GOV033/OPS053限定交付，WIP2增4。T00治理、T08双开发分别单写helper/专项、独审只读；冻结后串行18门禁。不改src、HTTP、现库、默认schema或父Proposed，不推送合并上线；用户协调、专业另签。

## GS03 内存事务适配 PLAN（2026-10-07）

GOV-033/OPS-053沿用户确认的非生产路线实施自建内存连接的事务适配，专业事项另签。核PR337精确同树与PR/main九成功后闭合GOV032/OPS052，释放单写范围，WIP2增4。基线main@fba3c706。详见docs/adr/2026-10-07-gs03-memory-transaction.md；不接外部连接、文件库、现库、HTTP、持久业务或生产；独审冻结后串行18门禁，本轮不推送合并。

## GS03 非生产提交结果判定 PLAN（2026-10-07）

用户统一协调、专业事项另行签署；按已确认非生产路线实施最小提交结果组件。GOV-032负责准入，OPS-052在T08独立工作树写模块和专项；核PR336精确提交、同树与PR/main CI后闭合GOV031限定交付并释放治理写范围，再登记两任务，WIP2增4。基线main@574b4dd8。详见docs/adr/2026-10-07-gs03-transaction-outcome.md：明确commit前后失败、异步端口和unknown，测试真实内存SQLite；不接HTTP、现库、默认启动、完整共同事务或生产。独审后冻结串行门禁，本轮不推送合并。

## GS03 离线准入资料校验 PLAN（2026-10-05）

用户批准 GOV-031 非生产离线校验与负向测试，限域 Accepted 见 docs/adr/2026-10-05-gs03-admission-validator.md。基线 main@4a831303，WIP2增3，T00 唯一写工具、模板、专项及治理。缺项/待定拒绝，齐备仅可人工评审，永远不授予实施或生产权限，父 Proposed 不变。专项及独审后冻结串行门禁，本轮不推送、合并、HTTP、现库或上线；回滚只撤本片增量。

## GS03 隔离实验交付事实收口 PLAN（2026-10-05）

- 用户已授权原范围修复、验证、推送与保护合并，并指示继续推进。本收口是该交付的必要事实更新，只改台账、路线图和数据地图三文件，不增加业务能力或运行时范围。
- PR334冻结2a5671f9与保护合并fe925ffb共享tree9a3ad272；PR CI37259811096及main CI37264160208各9项成功，主线提交已fetch核对。新Linux真实文件链接负测通过；PR真实PG认证影子1项、主回放CAS44项均零跳过，浏览器E2E60+13+3通过。独审和18项本地串行门禁通过；全发现3816通过/45环境跳过/0失败。旧失败与修复记录保留，精确证据见受控pr334-delivery.json。
- T00从最新origin/main@fe925ffb建立process/t00-gs03-storage-experiment-closeout-20261005，唯一写三份治理文件，独审只读。GOV030/TEST027只关闭已集成的限定准入和隔离实验交付，WIP4降2，仅释放MAP-DATA对应两个gap；OPS040/SEC016保持原状，原任务编号、分支与证据链保留。
- 正式协议、Owner、外部scope、全写入口fence、历史留存/容量、恢复世代及provider/现场缺口仍由开放RISK-GOV030、RISK-TEST027与父Proposed设计承接。默认schema19/41、GS03未建设与生产六域NO-GO不变。
- 本收口自身须专项、独审、冻结18项串行门禁后推送，精确新head CI全通过后保护合并，再核主线CI；PR334绿灯不能证明本候选。最终提交与验证写仓库外受控证据，避免递归新建收口任务；回滚仅撤销本次三文件事实增量，不动已集成代码、数据库和历史证据。

## GS03 Linux CI 修复与保护集成 PLAN（2026-10-05）

- 用户确认原切片内修复、独审、重新冻结及完整18项串行门禁后推送新提交，在该提交CI全通过时按既有保护规则合并PR334。批准标识为USER-GS03-STORAGE-CI-REPAIR-MERGE-2026-10-05；不授权部署、生产或新增业务范围，原实验ADR与父Proposed边界不变。
- 旧冻结da556bb3本地18门禁通过、全发现3816通过/45环境跳过/0失败，但PR334 CI37253921134在Linux真实文件符号链接负测失败：期望UNSAFE_LINK，helper却分类FOREIGN_FILE。该run其余8作业成功仍不能抵消独立required单元全集失败；旧日志和摘要保留，不重试原错误换绿灯。
- A在原T08单写helper，只把文件链接拒绝与普通foreign条件分离，须在stat/realpath/数据库打开前拒绝；B只读核原测试真实分支及目标摘要/目录不变断言。T00单写审批、事实与证据；独审只读。默认schema19/41、实验20/42、运行时/HTTP/现库/CI拓扑均不变。
- 原GOV030/TEST027继续验证中／已实现，WIP4/5，不提前关闭或释放gap。新专项、组合独审、冻结全18门禁及新head远端CI必须分别完成；Linux本机未执行须如实列出，只由新CI确认。合并限定实验交付后核精确merge/tree及主线CI，不把仓库证据解释为GS03完整或生产GO。
- A最小修复T08提交741ebae6，helper先lstat链接拒绝UNSAFE_LINK，之后才普通stat/realpath；测试/child不变，narrow-6-linux-ci-fix本机18通过/0失败/0跳过，Windowsjunction分支实际执行。Linux分支、新组合独审与冻结门禁以及新head CI待验；旧失败不能由本机通过覆盖。

## GS03 隔离存储事务验证 PLAN（2026-10-04）

- 2026-10-04原准入历史：用户仅批准限定开发测试，独立Accepted ADR只授权新测试harness；父Proposed、正式Owner/协议/外部scope/留存/恢复不变。当时不推送、合并或上线；2026-10-05的当前交付权限和顺序以本页上方追加PLAN为准，仍不部署上线。
- PR333已保护同树集成eeb7730e，PR/main各九项CI成功、真实PG各44项零跳过；上一片限定闭合，不作为本片证据。最新fetched origin/main为本T00/T08工作树共同基线，WIP2登记为4（GOV030/TEST027与OPS040/SEC016），原两任务不变。
- T00单写治理及独立ADR/六图，A只写新harness，B只写新专项和child。先准入独审及专项再放行T08，复用真实runner、未注册S1、严格audit-chain与真实v15 appendAuditDeliverySourceChanges，不改生产模块或默认schema19/41表。
- 验收与回滚以新ADR为准：三合同精确事实/source关联、双进程撤权与同键、expiry、逐副作用回滚及四态恢复、审计错绑与路径拒绝。只测试合成同库身份，不宣称正式外部scope fence或全写者修复；实验库禁止交旧runtime。
- 三份新测试文件已由T08提交cf24895c并准备到T00；实际专项已登记，第三轮16通过/0失败/0跳过，前两轮12通过/4失败与14通过/2失败日志保留。Windows junction分支实际执行，Linux分支未在本机执行。GOV030/TEST027为验证中／已实现，非已集成；代码独审后组合冻结并串行执行18项门禁，不预支独审/全门禁/PR/CI。GS03未建设、六域生产NO-GO。
- 修复使用新库WAL模式、真实锁忙unknown，以及自有临时副本的身份/schema/ledger预检；副本绝不参与授权、回执或提交判断。预检后敌对并发替换源文件的TOCTOU不在受控合成实验边界内，须独审确认限域说明，不将本方案用作生产现库接入。
- ed3c9def独审发现两P2，原记录保留：reconcile提交前缺expiry复核、冲突负测缺逐字段及合法授权重绑。A/B各在原单写范围修复，T08提交5678f6d1，narrow-4-review-fix为18通过/0失败/0跳过；新组合需独立复审后冻结，不复用旧候选放行结论。
- 1febf3b5复审通过后冻结；串行前10门禁通过，第11 lint发现预检finally不安全throw，后7项未执行，旧冻结失败证据保留。原A修清理错误保留结构，T08 a1c46a44，narrow-5-lint-fix为18通过/0失败/0跳过，单文件eslint通过；新组合需独审后重新冻结并完整重跑18门禁，旧10项不替代新提交验证。

## GS03 S2 限定设计交付闭合 PLAN（2026-10-04）

- 用户“批准并闭合”追加授权 `USER-GS03-S2-CLOSEOUT-2026-10-04`：推送冻结S2、精确CI成功后保护合并及限定治理闭合。原设计授权 `USER-GS03-S1-MERGE-S2-DESIGN-2026-10-04` 保留为历史来源，不扩大为HTTP/UoW、现库、默认迁移注册或生产授权。
- PR332冻结 `2791aa19` 经保护规则合并为 `713ab5d0`，同tree `c49f56e2`；PR CI `37176589829`、主线CI `37177140686` 各九项成功，PR真实PG44pass/0fail/0skip。Pages `37177140739` 成功只说明静态发布。原S2独审无P0-P2、18项冻结串行门禁通过，本地test:all3798pass/45环境skip/0fail；旧P2及准入失败记录保留。
- T00单写台账、路线图和数据地图三文件，独立审查者只读；复用GOV029限定交付，不新增领域任务。工作树由process:create从最新origin/main `713ab5d0` 建立；主线验证成功后，本候选将限定设计任务标为“已关闭／已集成”、WIP3降2，MAP-DATA只释放此设计gap。OPS040/SEC016不变，原任务工作树/分支和需求来源保留。
- 正式Owner、共同事务权威、外部scope协议、历史留存及恢复继续由开放RISK-GOV029及两份Proposed ADR承接。设计完成不表示这些事项已解决；正式schema仍v19/41表，GS03未建设、六域生产NO-GO。
- 本三文件收口是独立候选：专项、独审通过后冻结，重新串行执行18项门禁，再推送、精确CI及保护合并。此PLAN不预支自身测试或集成结果；最终提交/CI由仓库外受控证据绑定，不递归创建收口任务。回滚只撤回本片治理事实，不动已集成设计、业务库或历史证据。

## GS03 S2 写入口与事务合同设计 PLAN（2026-10-04）

- 用户确认两项授权：S1冻结b74a2136推送、CI成功后保护合并；S2仅inventory/Owner/旁路策略、事务接口及故障验收设计。新设计本身不授予源码、现库或生产权限，父ADR保持Proposed。
- PR331已保护合并为5134be76，与freeze b74a2136同tree8ac26212；PR37171948143/main37172517261各9success，真实PG各44pass/0skip，Pages37172517393静态success。GOV028/DATA009仅关闭S1限定交付，正式head19/41表不变，风险由父Proposed与GOV029承接。GOV029转实施中并依赖两项闭合任务，WIP3/5；OPS040/SEC016不变。
- 工作树由process:create以明确S1待集成依赖基线b74a2136建立，合并后已核main同tree；最终提交须承接最新main基线，不把候选当main。初始在制重叠校验失败后改候选等待；B提前落盘的未跟踪Proposed草稿已停笔保留，直到保护合并/mainCI核实及单写权移交后才正式承接，记录见受控intake-check.json。
- A唯一写旧存储ADR的写入口清单；B唯一写新S2事务合同ADR；协调者唯一写治理/索引/六图必要事实，独立审查者只读。设计涵盖授权、会诊、三回调、档案、消息、成功审计、通用状态/导入/恢复/裁剪及身份scope变更写者，不把模型盘点作为真实Owner签字或穷尽证明。
- 复用现有端口概念，比较共同事务与现有全状态写入，明确外部身份fence、首次/重放/冲突、失败四态和逐副作用回滚。未知提交只经受控同key核验，不fallback或补写成功审计；留存/历史/回滚方案供人工选择。
- 回滚仅撤回本片自有设计及登记，旧证据和数据库不动。文档/生命周期专项及独审后冻结18项串行门禁，未执行项如实列出；GS03未建设，六域NO-GO。新S2推送/合并另需授权。

## GS03 S1 未装配迁移 PLAN（2026-10-03）

- PR330精确head c100a9f6、merge1abd8a40同树，PR/main CI各9成功；GOV027和TEST026仅关闭限定交付，风险由父Proposed及新任务承接。
- GOV028单写中央准入；DATA009独立共享迁移任务，A只写定义、B只写新专项。新Accepted ADR只授权S1，WIP4/5，OPS040/SEC016不变。
- 范围、字段、事务责任、验收与回滚见 [S1 ADR](docs/adr/2026-10-03-gs03-receipt-migration-definition.md)。正式head19不变，无现库/自动注册/HTTP；独审后冻结串行门禁，本轮本候选不推送合并，GS03未建设，六域NO-GO。

## TEST-026 独审恢复与测试补强（2026-10-02）

- 对旧候选 `458fc4d1` 的独审已恢复：无P0/P1，提出两类P2——成功/并发副作用缺精确字段与关联断言，三合同冲突及路径隔离负测不完整。原审查记录见 `review-458fc4d1.json`，旧候选不直接冻结。
- 开发B重新独占T08既有测试文件，补三合同逐字段意图冲突、合法异目标/跨主体、完整业务/receipt/消息/双审计/source关联及并发零重复写断言，并用自有合成tempRoot边界负测验证拒绝前后库字节与目录不变。helper/child与正式运行时均未改；`narrow-review-fix.log` 为20通过/0失败/0跳过。复审与完整门禁以新候选精确证据为准，不复用旧候选通过结论。
- TEST-026仍为验证中／已实现，WIP4/5；独审通过后才冻结并串行运行18项门禁。本轮不推送、合并或上线；正式协议/存储ADR仍Proposed、实验Accepted边界和六域NO-GO不变。

## TEST-026 旧候选与当时审查阻塞（2026-10-02）

- T08 候选 `194d29a2315144027ef4e9c715bfa04e1ae2cd1f` 已准备到 T00 为 `fd068f6817b30f250a2e5dbeec3e0600a623fc04`，仅三份测试目录文件，尚非主线集成或审查冻结。准入独审通过；最终代码独审因 reviewer agent 额度耗尽未完成，不得由协调者自审替代。
- 首轮专项 `narrow-1.log` 15通过/2失败；开发者停笔后由 T00 接管测试文件，修正错误码预期分类与漏传预期值，未放宽断言、未改授权语义。`narrow-2.log` 17通过/0失败/0跳过，含真实 SQLite、多进程同键、撤权双排序、逐事实回滚、提交前后进程退出及同键恢复；失败日志保留。已绑定专用 testId，状态仅“验证中／已实现”，WIP4/5。
- 本次准备仅为后续独审保留一致候选。额度恢复后先完成代码独审并修复，再冻结运行18项串行门禁；当前未执行冻结重型门禁、远端CI、推送、合并或上线。正式ADR仍Proposed，实验Accepted不解除现网旁路/迁移/provider/现场风险。

## TEST-026 隔离 SQLite 回调实验 PLAN（2026-10-01）

- 用户已批准无 HTTP、一次性合成库实验。独立 Accepted `ADR-GS03-EXPERIMENT-001` 只提供实验例外，正式协议和存储 ADR 仍 Proposed。GOV-027 沿既有单写范围承接本次准入治理，TEST-026 为独立 T08 高风险任务；WIP 从 3/5 到 4/5，不关闭未推送的 GOV-027 设计交付。
- T00 原设计候选 `073a25a4` 的18项本地门禁通过、主线 `b37e3ce9` 的 CI 成功，仅为前置事实，不作本次候选证据。T08 由 process:plan/create 从最新 fetched origin/main 创建 `process/t08-gs03-sqlite-experiment-20261001`；A 单写 experiment helper，B 单写实验测试与 child helper，T00 单写 ADR/总账/六图，审查者只读。
- 目标是唯一回执、确切授权与同库副作用的真实 SQLite 原子性、撤权竞争及四态恢复；新库临时 DDL 不属于平台 migration，不改 schema head。范围、非目标、数据最小化、测试矩阵与回滚完整见新 ADR 的 PLAN。实验生命周期不 TTL、不删单条 receipt、不复用 key；只清理自有合成目录。
- 先核准入与文件所有权，再专项测试和独审；通过后冻结，串行执行18项适用门禁。准入阶段测试尚未落地，不提前声称已实现或通过。正式旁路接线、provider、迁移、留存和现场另审；GS-03 未建设、生产六域 NO-GO。本轮不推送、合并或上线。

## GOV-027 GS-03回调receipt与撤权原子提交设计 PLAN（2026-10-01）

- 准入与事实：PR #329 的 Proposed 合同细化冻结 `29bd1a72` 与受保护合并 `b37e3ce9` 共享 tree `b836be04`；18项冻结本地门禁通过，PR CI `36873994691`、main CI `36875552422` 各九项成功，静态 Pages `36875552482` 成功。精确证据见 `.codex-platform-evidence/gs03-callback-repair-design-20261001/pr329-delivery.json`。GOV-026 只关闭已集成的限定设计文档交付，原 ADR 仍 Proposed、风险仍 open、五项外部待决由原 ADR/RISK 与新 GOV-027 继续承接，不解释为实施批准。WIP 先由 3/5 释放到 2/5，再登记独立中风险设计任务 GOV-027 回 3/5；本分支基线 `origin/main@b37e3ce9` 起始干净。
- 目标、选项与所有权：仅评审入站回调 receipt 与撤权/续授权的同一事实提交边界。独立 Proposed `ADR-GS03-STORAGE-001` 比较现有 JSON 快照、SQLite 事务及已批准持久命令机制是否可承载资源/主体/意图/授权绑定的耐久 receipt；允许提出具体推荐（例如隔离 SQLite 候选），但存储权威、集合和迁移均未正式选定或获实施批准。GOV-027 依赖已有限关闭的 GOV-026 父协议设计交付，不把父 ADR 当 Accepted。T05 持有会诊业务事实，T04 持有居民授权事实，T08 持有外部来源，T00 协调存储/跨域合同；隐私与存储责任人须确认保留/删除和失败恢复。T00 唯一治理写者负责总账、ROADMAP、文档清单、DATA_MODEL/API_MAP及另三图必要当前库存数字；独立 ADR 作者只写新 ADR 正文与 `docs/adr/README.md`，不互改文件。
- 风险、迁移与回滚：必须区分首次、精确重放、撤权与回调竞争、明确回滚、提交成功但响应丢失和提交结果未知；旧无 digest 回执不倒算或自动接受，200 项网关事件不当作耐久权威。新 ADR 只提出迁移/兼容/对账备选、前置条件和回滚策略，不执行 schema、runtime、权限、API、provider、worker 或生产变更。失败时撤销本轮设计和治理增量，已提交会诊、回执与审计事实保持原样；既有回调合同 ADR 继续 Proposed，GS-03 未建设、六域生产 NO-GO。
- 验收与交接：任务、需求、风险、Owner、精确写范围及 MAP-DATA/MAP-API gap 已登记；作者新建的 ADR 仍为 Proposed，机器 decision 与当前文档闭集已同步，仅代表设计材料存在。独审→冻结→18 项适用本地串行门禁后才可称本候选验证通过；当前不写测试通过、PR/CI或用户已选存储权威。后续任何高风险实现、迁移或生产接线须另立 Accepted ADR/审批与任务。本轮不推送、合并或部署。

## PR327/PR328 GS-03 v1限定测试交付事实收口（2026-10-01）

- TEST-024 的 [PR #327](https://github.com/xujiann/chronic-care-platform/pull/327) 冻结 `4d50c225` 与保护合并 `07d67bbe` 共享 tree `d8d68a5b`；冻结18项串行门禁通过、`test:all` 3763pass/45环境skip/0fail，PR CI `36744134039`、main CI `36745604162` 各九项成功，静态 Pages `36745604150` 成功。精确交付记录见 `.codex-platform-evidence/gs03-callback-v1-20260930/pr327-delivery.json`，不复用为 TEST-025 证据。
- TEST-025 的 [PR #328](https://github.com/xujiann/chronic-care-platform/pull/328) 冻结 `afac898d` 与保护合并 `028801cd` 共享 tree `a937f62f`；冻结18项串行门禁通过、`test:all` 3764pass/45环境skip/0fail，PR CI `36826912177`、main CI `36827895768` 各九项成功，静态 Pages `36827895752` 成功。精确交付记录见 `.codex-platform-evidence/gs03-callback-boundaries-20261001/pr328-delivery.json`，不复用为 TEST-024 证据。
- 两项仅关闭 v1 隔离合成真实 HTTP 现状测试交付，状态“已关闭／已集成”，WIP 从 5/5 降为 3/5（GOV-026、OPS-040、SEC-016）。风险保留 open：跨 URL 签名、跨主体同键、撤权后回调和旧回执/200项窗口均未修复；GOV-026 继续细化 Proposed ADR，GS-03 仍未建设，生产六域 NO-GO。本三文件元数据收口及同期 ADR 细化是新候选，仍须自身独审→冻结→18 项适用串行门禁，不把 PR #327/#328 绿灯自证为本候选通过，也不推送、合并或部署。

## GOV-026 GS-03 回调修复合同细化 PLAN（2026-10-01）

- 用户新增授权仅为既有 Proposed `ADR-GS03-CALLBACK-001` 的设计细化，不是 Accepted 或高风险实现批准。基线 `origin/main@028801cd`，本 T00 分支 `process/t00-gs03-callback-repair-design-20261001` 起始干净。GOV-026 沿原编号转“实施中／已实现”（只指已有设计文档）；T00 单写 `config/lifecycle-governance.json`、`ROADMAP.md`、`API_MAP.md`，独立 ADR 作者单写既有 ADR 与 `docs/adr/README.md`，不创建新 Markdown。TEST-024/025 在主线 CI 精确核验和另行事实收口前仍为“验证中／已实现”，WIP 仍 5/5，不预支释放。
- 目标与方案：以 TEST-024 的三合同角色/签名/副作用现状和 TEST-025 的跨 URL 签名、跨主体同键、撤权首次/重放现状为反例与迁移输入，细化五项待决及拟议 v2 资源签名、可信 principal 命名空间、精确授权、回执/副作用原子性和历史兼容。维持 ADR 原三选项顺序：方案1仅刻画 v1 不晋升；方案2分阶段 A+B 为待评审推荐方向；方案3完整中继/独立账本为高代价备选。不得将现状断言、推荐方向或本轮批准写成已接受协议、已验证修复或现场信任。
- 风险与非目标：五项调用方、存储/原子提交、旧无 digest 回执迁移、供应方信任与生产现场决策继续待外部 Owner/用户裁定；旧回执不倒算、不自动接受，200 项事件窗口不证明耐久。仅编辑既有设计/索引及三份治理文件；不改 source、test、API、签名、权限、schema、CI、worker、部署或生产。GS-03 仍未建设，生产六域 NO-GO。
- 验收与退出：ADR 明确 v1 事实和 v2 提案、五项未决、Owner、迁移/回滚、安全负测与失败/越权/恢复矩阵；本轮新候选须独审→冻结→18 项本地串行门禁，完成前不写为通过，之后才交用户决策，不推送、合并或部署。回滚仅撤销本轮设计细化和治理增量，保留 TEST-024/025 的已集成测试及历史回执/审计；PR #327/#328 的成功不能替代本轮文档与元数据候选自身验证。

## TEST-025 GS-03 v1回调边界现状测试 PLAN（2026-10-01）

- 准入与基线：用户仅批准下一测试/治理切片。PR #327 已保护合并至 `origin/main@07d67bbe`，PR CI `36744134039`、main CI `36745604162` 各九项成功，静态 Pages `36745604150` 成功；最新 main Lifecycle `36779524950` 成功。本 T00 分支 `process/t00-gs03-callback-boundaries-20261001` 起始干净；机器在制从 4/5 登记为 5/5，TEST-024 和 GOV-026 均不伪关闭。T00 唯一写者负责总账、路线图及 API 地图最小准入，T05 在独立工作树 `.codex-platform-worktrees/process-v2/t05-gs03-callback-boundaries-20261001`、同名分支单写新测试 `test/gs03-referral-callback-boundaries-api.test.js`。
- 目标与选择：补齐 v1 现状的三个未定边界：同一已签 body 换会诊 URL 的跨资源提交、不同当前可访问主体复用同一 `contractId + idempotencyKey` 的回执、授权撤销后的首次提交与旧键重放。复用隔离合成真实 HTTP 和既有角色/签名夹具，新建独立专项文件以隔离 TEST-024 的已交付基线；不扩写旧文件。按当前实现分别断言状态码、现行响应中的回执/事件字段及资源绑定、会诊/报告档案/消息/网关事件与拒绝审计的实际变化，不能预设拟议 v2 应有的 403/409 或零审计写。
- 非目标、风险与回滚：不修改运行时、API、授权、签名、幂等、数据库、schema、CI、worker、ADR 或生产接线；不接真实供应方、凭据或患者数据。body-only HMAC、跨主体全局键、旧无 digest 回执与 200 项窗口仍是风险，Proposed `ADR-GS03-CALLBACK-001` 不授权修复。测试如发现脆弱现状，保留失败/差异证据并交后续高风险决策，不在本切片改语义；回滚只撤销单一新测试与本轮治理登记，旧业务/审计事实不动。GS-03 未建设、生产六域 NO-GO。
- 验收与交接：先登记 TASK/需求/风险/写范围/地图 gap 并通过生命周期及所有权窄门禁再放行 T05；新测试路径实际存在后再注册机器 testId 和受控窄测证据。T05 独立审查与专项零失败零跳过、T00 组合冻结及适用串行门禁均以各自精确 SHA 证明；PR #327 的绿灯不得替代本切片验证。本轮不推送、合并或部署。
- 阶段结果：T05 提交 `9d5b013e` 经 T00 cherry-pick 为 `dfdfe9da4bc4b504f36a0b3baf7814800d3ba4be`，新测试 blob `4a4d6562e3c60f32aedf732a165b03fb877975d3`；独审无 P0–P2。受控 `narrow-test-2.log` 记录一个顶层测试 1pass/0fail/0skip、6.76 秒，覆盖三合同 27 次 callback 请求及一次真实授权撤销；只证明隔离合成 v1 现状。TEST-025 暂为“验证中／已实现”，T00 组合冻结及串行门禁未完成，旧 TEST-024/GOV-026、GS-03 和六域生产状态不晋升。

## TEST-024 GS-03 v1回调现状测试 PLAN（2026-09-30）

- 用户批准下一测试切片，基线 `origin/main@92179d2f`，T00 当前候选 `3b2c77a7`；T05 独立工作树 `.codex-platform-worktrees/process-v2/t05-gs03-callback-v1-20260930` 与分支 `process/t05-gs03-callback-v1-20260930` 已确认。独立中风险 `TEST-024` 登记后 WIP 4/5；T00 控制塔单写总账、路线图与必要地图，T05 单写新增 `test/gs03-referral-callback-v1-api.test.js`，双方不覆盖彼此文件。GOV-026 仍是设计任务，本轮用户测试授权独立登记，不借 Proposed ADR 作实现准入。
- 目标与范围：隔离合成真实 HTTP，刻画 feedback、schedule、report 三类既有 v1 回调的当前允许/拒绝角色、body HMAC 正误签、`contractId + idempotencyKey` 同键精确及异意图重放、首次/重放/失败的会诊、居民档案、通知、网关事件及审计等实际持久副作用；测试要如实固定现状，不把 body-only 签名、异意图 200 或 200 项事件窗口描述为安全目标。复用既有夹具，新增文件自动进入 unit 发现，无需改 CI/测试发现配置。
- 非目标与风险：不改运行时、API、权限、数据库、schema、合同版本、Proposed ADR、worker或部署；不造真实供应方、现场回执/凭据/患者数据。v1 测试仅为后续合同决策基线，五项未决及历史无 digest 回执不倒算、不自动接受；GS-03 仍未建设，生产六域 NO-GO。角色样本遵循现行来源/接诊机构、区县和主管部门分支，不把拟议 v2 收窄规则冒充现状。
- 依赖、验收与退出：T05 测试文件存在后 T00 才补机器 tests 注册与 TEST-024 testId，核对真实 HTTP 专项零失败零跳过及持久副作用；独立审查、精确冻结与适用串行门禁由主控执行。测试引发预期差异时保留失败证据，不改生产合同来“修绿”。回滚仅撤销新增测试及本轮登记，不改旧回执、业务事实或运行时。本轮不推送、合并或部署。
- 阶段结果：T05 独立提交 `1ae060cff8dd06d3c3f3d1e671c8dccf560e9eea` 经 T00 cherry-pick 为 `d50a8dc79aa7730ad337b3ac0a5696d28841e7be`，新增测试 blob `8d2af741c00d9f3670b099d00c7beba6488699f1`。T05 独审无 P0–P2，`narrow-test-review-fix.log` 为 1 个顶层真实 HTTP 测试通过、0 失败、0 跳过，耗时 13.3 秒；记录位于 `.codex-platform-evidence/gs03-callback-v1-20260930/`。TEST-024 仅进入“验证中／已实现”，T00 组合冻结及串行门禁仍待完成；不将 v1 现状测试误称为 GS-03 完成、v2 安全证明或生产证据。

## GOV-026 GS-03 回调合同设计 PLAN（2026-09-30）

- 用户批准“进行下一步”仅指设计与准入评审；基线 `origin/main@92179d2f`，分支 `process/t00-gs03-callback-design-20260930` 起始干净。T00 登记中风险 GOV-026，WIP 由 2/5 至 3/5；本轮形成 Proposed `ADR-GS03-CALLBACK-001`，不能据此实施高风险运行时或生产接线。
- 目标和范围：核对现有三条 v1 回调、T05业务Owner、T08外部来源/签名合同、跨域数据Owner与历史回执，提出最小v2及替代方案、五项未决、验收矩阵、迁移和回滚条件。T00单写总账、路线图、文档分类清单及必要六图；独立ADR作者单写 `docs/adr/2026-09-30-referral-callback-contract.md` 与 `docs/adr/README.md`，只读审查者不写。双方不覆盖彼此文件。
- 非目标与风险：不改source、test、权限、数据库、API、CI、worker或部署，不存凭据/患者数据/原始报文；v1旧无digest回执不倒算、不自动接受。T08验真、T05业务命令与T00跨域治理的实施分工仅为建议；任何新版可信身份、耐久receipt、版本迁移和历史兼容实施须后续单独Accepted ADR与高风险任务准入。GS-03仍“未建设”，生产六域NO-GO。
- 方案与退出：ADR选项1保持v1并刻画现状、不晋升；选项2为待审批的分阶段A（资源、授权、回执语义）和B（供应方验真）设计，A需要耐久迁移时不得推迟到B；选项3为完整独立中继/账本，须列兼容与运维代价。选项2仅是优先评审方向，不预选外部主体、存储或版本切换。回滚仅撤销本轮文档/登记，不动旧回执和业务事实。完成条件为独审、文档分类与生命周期/仓库/所有权窄门禁通过并交用户决定五项未决；本轮不推送、合并或部署。

## PR325 限定交付事实收口 PLAN（2026-09-30）

- 目标与准入：在原 GOV-024 的 T00 总账与六图单写范围内，核实 [PR #325](https://github.com/xujiann/chronic-care-platform/pull/325) 的受保护合并和精确证据后，关闭 GOV-024、GOV-025、TEST-023、OPS-051 四项限定交付并释放 WIP。基线 `origin/main@2c96ee48`，本工作树起始干净，分支 `process/t00-pr325-closure-20260930`；不新增任务或业务运行时。
- 事实：独审冻结 `4cba709e` 与合并 `2c96ee48` 共享 tree `d42e904b`；冻结候选本地19项串行门禁全过，原 `test:all` 3762pass/45环境skip/0fail，E2E平台60、居民13、PWA3通过。PR CI `36539718357` 和 main CI `36540868726` 各九项成功，真实 PostgreSQL 专项各44pass/0skip；静态 Pages `36540868719` 成功。证据见 `.codex-platform-evidence/physical-auth-hydration-20260929/VALIDATION.md`，不把静态发布或仓库验证当作生产授权。
- 范围与所有权：仅更新 `config/lifecycle-governance.json`、本路线图及六张 AS-IS 地图的最新状态段；T00 唯一写者，T05/T06 原实现与测试文件保持主线 blob 不变。GOV-025/TEST-023 的先前阻塞只对旧候选有效，新同树组合已验证并集成；OPS-051 任务关闭但能力仅“已实现”，因本次只修页面竞态，未补共享 auth 的既有 file 预览异常、现场运行验收或生产准入，因此继续列模块 gap。本次元数据收口自身仍待独审、冻结及适用窄门禁，绝不复用 PR #325 绿灯声明新 SHA 已通过旧全量测试。
- 保留边界与回滚：`92c3939e` 第17项 E2E 59pass/1fail 的截图、trace 与日志继续作为原始失败记录，不倒填通过；GS-03 仅 T05 本地 HTTP 子场景，T08 外部回调与现场联调未完成，整体仍“未建设”；生产六域继续 NO-GO。撤销本次八文件元数据增量即可回滚，不改业务事实、历史证据、权限、schema、依赖或部署。收口完成条件为独审及 `governance:lifecycle`、`repository:governance:verify`、`process:verify` 等适用门禁通过；不推送、合并或部署。

## OPS-051 physical examination auth hydration repair 2026-09-29

- 冻结候选 `92c3939e` 的本地串行门禁 1–16 通过，第 17 项 `test:e2e` 失败：平台套件 59 通过、1 失败，体检页面在已确认 commission 身份后未生成联合核验控件；居民和 PWA 套件未执行。原截图、context、trace 与失败摘要保留于 `.codex-platform-evidence/gs03-acceptance-20260929/`。该候选未重试、推送或合并，不能称为完整通过；独立严格 preflight 仍按预期 NO-GO。
- GOV-025、TEST-023 因旧组合验收失败改为“已阻塞”，能力各保持“已实现”，窄测通过和原失败证据均保留；GOV-024 继续负责总账与协调，不伪关闭。独立 T06 中风险 OPS-051 已获用户批准并登记，WIP 4/5，基线仍为 `92c3939e`。
- T06 单写 `physical-examination.js` 与 `test/e2e/physical-examination-trusted-rendering.spec.js`，复用 `.codex-platform-worktrees/process-v2/t06-physical-signoff-controls-20260910` 工作树的新分支 `process/t06-physical-exam-auth-hydration-20260929`。仅修复页面等待既有身份授权初始化的时序，未就绪时失败关闭；新增延迟身份正负 E2E 并保留既有可信渲染和角色合同。不改共享 auth、权限模型、API、schema、worker 或部署。
- T06 已完成限定实现；延迟身份定向 E2E `1/1`（9.9s）与既有体检可信渲染文件全量 `1/1`（32.3s）本地通过，RED、修正和 GREEN 日志均保留在 `.codex-platform-evidence/physical-auth-hydration-20260929/`，旧页步骤计数不减。OPS-051 现为“验证中／已实现”；这只是窄测，不代表独审、冻结组合、完整门禁或远端 CI 成功。后续仍需从新候选精确 SHA 重新运行适用门禁；GS-03 只是 T05 局部子场景，十条黄金场景与生产六域均不晋升。回滚为撤销 OPS-051 两文件增量，保留旧失败与业务事实。
- GOV-024 负责在 T06 修复后对“原 GOV-025/TEST-023 限定实现 + OPS-051”做新候选的组合独审与完整门禁；只验证届时精确候选 SHA，不将新候选通过倒填为旧 `92c3939e` 通过。GOV-025/TEST-023 自身写入与验收继续暂停，直到组合事实重新核对且 WIP/写范围获主控确认；沿用 GOV-012 的失败保留原则，不因暂时腾位而虚构完成。

## GS03 acceptance slice 2026-09-29

- 基线 main@4ab4e439：PR324保护合并、与冻结1a9efcb4共享tree 11cd4602；18项本地串行门禁、PR/main九项CI、真实PG各44项零跳过及静态Pages通过。SEC-017/OPS-050/SEC-018仅关闭限定交付，现场和相邻遗留风险仍保留。
- 用户继续开发；独立准入复核认可以下三项中风险既有合同测试/治理修复，由T00批准，不需新ADR。先登记、再实施；两开发者与只读独审协作，WIP保持5/5。
- GOV-024由协调者独占任务账本、ROADMAP和六图，回写PR324证据并登记本轮。GOV-025由开发B独占scripts/lifecycle-governance.js和test/lifecycle-governance.test.js：拒绝黄金场景悬空测试/证据引用、证据测试不相关和六域NO-GO下准生产晋升；复用既有字段与门禁，不引入新状态/工具/schema。
- TEST-023由开发A在独立T05工作树独占test/gs03-referral-collaboration-api.test.js；复用真实HTTP夹具，以合成会诊覆盖跨机构报告命令拒绝、授权撤销后暂停/拒绝、重新授权恢复、报告归档和幂等重放。既有授权与状态机不改。GS-03是T05/T08跨机构业务协同，本切片只是T05本地命令子场景，不覆盖T08外部回调或现场联调，整体保持未建设，不提前晋升。
- 无业务运行时、角色、共享权限、数据库、worker、依赖、CI拓扑或生产激活变更。若测试发现需改这些边界，先停在失败证据并单独准入。不编辑真实数据，仅自有隔离夹具。
- 窄测、所有权校验、独立审查后冻结；串行执行适用必需门禁与完整CI。回滚为撤销本轮测试/治理增量，保留历史证据和业务数据。生产六域NO-GO不变。
- 实施结果：GOV-025新增三组回归先红后绿，治理21项通过；TEST-023真实HTTP专项1项通过、零跳过，源机构/接诊机构/居民/外机构四种真实账号与最终关联状态受测。T05提交fb17222b经T00 cherry-pick为8813fb43；仅局部证据挂接GS-03，状态仍未建设。待本轮组合独审、冻结和CI，不复用PR324绿灯代替本轮验证。

## Release gap hardening 2026-09-29

- 用户要求按上线标准检查并多线程完成缺口开发。首发闭集为8应用/32 API/38数据引用/7 worker；范围内API及owner复核无仓库缺口，21数据引用仍禁生产写。黄金场景跨域证据、真实迁移/容量/灾备、供应商及签署仍需后续完成，生产六域NO-GO。
- 基线 main@a27f0832（PR323已保护合并，冻结树一致；PR与main CI各九项及真实PG各44项零跳过，静态Pages成功）。TEST-022关闭限定测试交付；本轮三项登记后WIP5/5。
- SEC-017：协调者T00独占发布证据校验脚本/专项测试和本轮治理文件，拒绝空/非字符串/重复签署及无效数值，不改外部签名信任或审批角色。
- OPS-050：开发B独占storage-admin脚本/测试。合成WAL库已复现源1行而备份0行且验签成功；保留同步API，使用SQLite一致快照，备份校验真实SQLite，恢复遇旧旁文件拒绝并保留原数据。测试仅本轮自有临时目录，禁止实际生产恢复；JSON兼容不建立跨文件同一时点承诺。
- SEC-018：开发A在独立T05工作树单写care-coordination路由和referral-release-data-scope专项。复用当前canAccess范围及公共投影，先复现联调样本跨机构读取和ack私有回执泄漏，再补正常/拒绝/空态回归；相邻读取一并检查。不得新增角色或重定义数据Owner；跨域组合交T00。
- 独立审查者只读复核三项及组合。方案均为修正现有合同，不新增服务、依赖、DDL或迁移；如发现需要变更权限模型/恢复协议则集中评审。rollback为回退独立代码提交，保留所有源事实与既有备份，不自动删除旁文件。先窄测与所有权检查，独审通过后冻结，重型门禁串行，再保护PR/CI集成；现场证据不由仓库结果替代。
- 实施回归先红后绿：证据专项9项、会诊真实handler隔离专项2项；会诊矩阵使用模拟授权/helper，完整装配由既有API与全量门禁另行验证，不冒充真实居民/医生授权现场验收。OPS-050扩展仅release-registry真实SQLite夹具；坏库恢复在替换前保全原始隔离物，validBackup:false，隔离失败原数据不变。正常路径安全副本保持旧语义，不等于通过发布验证的有效备份。独审提出的损坏库/损坏JSON恢复回归纳入本轮兼容修复。

## TEST-022 checkpoint commit recovery regression（2026-09-29）

- 目标：补齐 ADR-OPS-049 已批准故障合同的真实 PostgreSQL 组合证据：checkpoint COMMIT 已完成后抛错时报告提交未知，重建连接后精确读取进度并推进下一批。现有合成测试覆盖此窗口，实库专项尚缺；本轮只补回归测试，不修改运行时合同。
- 基线 origin/main@ef8abae5，工作区干净，无开放 PR，最新主线 CI 成功。用户继续开发授权及原 ADR 范围内由 T00 批准中风险 TEST-022，独立准入复核认可；WIP 3/5。
- 单写范围：开发 A 独占 test/postgres-primary-checkpoint-live.test.js；开发 B 只读核对隔离夹具、故障注入及恢复断言；协调者独占 ROADMAP.md 与 config/lifecycle-governance.json；独立审查者只读。复用当前空闲 T00 工作树，新分支 process/t00-relay-commit-regression-20260929。
- 方案：复用现有真实 PG fixture 与专用 runner，限定 checkpoint 连接在执行 COMMIT 后抛错，并在 finally 恢复测试注入。断言未知报告、实存第一批游标、全新连接推进第二批、最终 idle、目标第一批未改写及源事实不变。避免新增运行时注入端口或新依赖。
- 风险与回滚：测试全局 prototype 注入必须限定连接和有效窗口、无并行重型任务；仅合成隔离库，沿用 fixture 自有随机库清理。撤销测试与登记增量即可回滚，无 schema、HTTP、worker、生产监控、多实例或部署变更。
- 验证：用例已实现，合成窄测11通过；本地live文件加载5跳过，无实库证据。治理及入口/文档窄测通过，下一步独审、冻结后串行必需门禁；真实 PG 专项须显式零跳过才形成实库证据。生产六域 NO-GO，OPS-049 能力层级不晋升。

## 隔离 relay 观测 PLAN（2026-09-27，已批准）

- 2026-09-28 集成收口：限定切片由 [PR #321](https://github.com/xujiann/chronic-care-platform/pull/321) 保护 squash 合并为 `7d5b2c517dc7ad66e4861667b9e0c7167a7a27a4`，与独立审查冻结 `1ff0ddef0c26ec67dfd47e2eea96ada0137f42e1` 共享 tree `9d2712fedd3a28b84a5121ac275c485f2cfe9b79`。独审无P0–P2，本地18项冻结串行门禁通过：全量3748pass/44环境skip/0fail，server及10组边界覆盖通过；PR CI36364784446/main CI36370896197各9项成功，真实PG专项各43pass/0skip；Pages36370896211成功且仅静态发布。GOV-023关闭并已集成，OPS-049关闭限定代码交付但能力仅已实现，WIP 2/5；监控投递、告警、SLO、多实例、TLS、容量灾备和现场证据仍缺，生产六域NO-GO。本收口自身仍需独审、冻结与门禁，不复用PR #321证据代替自身验证。

- 2026-09-27 实施阶段记录：加法 `runObservedOnce()` 与既有共同合同 profile 已实现，固定故障阶段和目标/checkpoint提交未知语义；旧调用不附加观测。当时组合窄测22pass/0fail/4skip，4项为未启用本机真实PG，不作现场或CI证据；后续集成结果见上，运行能力未晋升。

- PR #320 已保护 squash 合并为 `0875adaef53563146b1f5c0ac1bb6440b3cdd70f`，与冻结 `bee439d5` 共享 tree `8a8c165eadf183cef4d6fc4e12f623c7363eb200`；PR CI35847628139、main CI36301868053及静态Pages36301868020成功。PG专用入口强制零跳过，但本轮未独立取得详细计数。GOV-022关闭限定交付，OPS-048保留运行和现场能力缺口。
- 用户批准GOV-023/OPS-049；新process工作树基于上述主线，T00单写，WIP4/5。复用共同观测合同，新增显式观测方法，保留runOnce兼容；阶段与目标提交未知窗口、稳定错误码和脱敏边界见Accepted ADR-OPS-049。
- 精确范围：relay模块、profile清单、既有合成/live/共同观测测试、ADR/索引、总账、六图、Markdown清单和存储合同。无HTTP、worker、生产接线、DDL、真实数据或新依赖。先窄测、独审、冻结，再串行重型门禁；未完成的新切片不复用PR #320证据，生产NO-GO。

## 隔离单批次 relay PLAN（2026-09-23，实施中）

- 用户批准限定切片；基线 `origin/main@27a0f5d1`，无开放 PR，main CI/Pages 成功。T00 单写 `GOV-022 / OPS-048`，WIP 4/5；决策见 [ADR-OPS-048](docs/adr/2026-09-23-primary-single-batch-relay.md)。
- 仅新增显式 rehearsal 端口：读取已初始化的独立 checkpoint、加载下一份品牌化 SQLite 提交凭证、调用受绑定 PostgreSQL 主存储合同，并在目标精确成功/重复后推进进度。目标提交后进度未写须可重放。合成测试及隔离真实 PG 专项覆盖；本机真实 PG 跳过不作证据。
- 非目标：业务请求、常驻/自动 worker、生产接线、真实数据、DDL、公共 API、多实例及现场放行。运行日志、指标、告警、TLS、容量和灾备仍未闭合，六域生产 NO-GO。
- 顺序：窄测与治理 → 独立审查 → 冻结提交 → 重型测试串行 → 必要 PR CI 真实 PG 零跳过。失败返回修复重审；不以旧 PR #318 证据替代本轮验证。回滚停止显式调用并保留源、目标和 checkpoint 事实，不自动删除已提交数据。

## 真实 PostgreSQL checkpoint 验证 PLAN（2026-09-23）

- 集成收口：限定测试切片由 [PR #318](https://github.com/xujiann/chronic-care-platform/pull/318) 保护 squash 合并为 `d63d308a1cfdb6db3707a2f939d7b264fbe5af36`；冻结 `cf16168c7e4323b89ceeeaf53027435bc0bac28c` 与合并共享 tree `f7ca39ce0144dea8e72c9f48c3343e5dc1ae5ddd`。独立审查无剩余 P0–P2，冻结本地 build/lint/typecheck、unit 485 文件、integration 66 文件、smoke 6、test:all 14 批及中央门禁串行通过；PR CI35829246941 与 main CI35830448870 各九项成功，真实 PG 专项各 41pass/0fail/0skip/0cancel；Pages35830448915 成功且仅为静态演示。GOV-021／OPS-047 关闭限定测试交付，WIP 回到 2/5；OPS-046 运行能力仍为已实现，生产六域继续 NO-GO。本事实收口自身仍需独审、冻结与门禁，不复用 PR #318 结果替代自身验证。

- 基线 `origin/main@7be0041e`；PR #317 已将上一合成 checkpoint 切片的事实收口合并，主线 CI/Pages 仍以实际结果为准。本轮用户批准独立 ADR 准入，T00 单写，GOV-021 / OPS-047，WIP 从 2/5 登记至 4/5。
- 目标：在现有隔离真实 PostgreSQL 测试库、正式驱动与已绑定 SQLite 源上验证 checkpoint 的目标凭证核对、提交后崩溃窗口、重启/精确重放和错误身份失败关闭。采用复用既有 fixture/专用 runner 的方案；详见 Accepted [ADR-OPS-047](docs/adr/2026-09-23-primary-checkpoint-live-verification.md)。
- 写范围仅为新专项测试、现有 runner/guard、ADR/索引、总账、路线图、六图、数据库合同和 Markdown 清单；不改运行时代码、生产 DDL、API、worker、relay 或生产配置。真实 PG 结果只来自 CI 显式零跳过执行，本地环境 skip 不作证据。
- 先窄测与治理校验，再独立审查、冻结提交，串行执行完整门禁；如有失败退回修复重审。回滚撤销测试与治理增量，隔离 fixture 只清理本轮成功创建且身份核实的随机库；不触碰生产事实。完成条件为 PR 真实 PG 专项零失败零跳过及受保护合并后的精确事实对账，生产继续 NO-GO。

## 独立持久 checkpoint PLAN（2026-09-23）

- 限定代码切片已由 [PR #316](https://github.com/xujiann/chronic-care-platform/pull/316) 保护 squash 合并为 `cf88124fc3cbad21322ca9fd5de007165fd5ecb2`；冻结 `de23cf513179a2cb1c97302fee8a1e1c1b8cd266`、PR 合成提交与 main 共享 tree `f80571eb845c98622300c09e1266e88fc111a61a`。独立审查无 P0–P2，本地 build/lint/typecheck、单元 484、integration 66 文件、smoke 6、原始 test:all 14 批及中央门禁均通过；PR CI35815776009 九项成功，main CI35816498287 九项及 Pages35816498305 成功。GOV-020/OPS-046 关闭限定代码交付，WIP 2/5；OPS-046 能力仍为已实现，真实 PG checkpoint 新路径、观测、多实例和现场证据未闭合。此收尾不改变运行时或生产，仍需自身审查与门禁，生产 NO-GO。

- 用户已批准限定切片；`GOV-020 / OPS-046` 已登记，基线 `origin/main@717550d9`，WIP 4/5。
- T00 单写合成环境独立 checkpoint、测试及治理；决策见 Accepted [ADR-OPS-046](docs/adr/2026-09-23-primary-durable-checkpoint.md)。
- 非目标：自动 relay/worker、业务请求、生产接线、历史补证、多实例和现场放行。先窄测，再独立审查、冻结与完整串行门禁；生产 NO-GO。

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
| 15 | 当前工作流、Markdown 与跟踪 PDF 闭集治理 | GOV-001、DOC-001、REPO-001 仓库内缺口已关闭：开发默认 `origin/main`，固定 tag 仅作证据；306 份 Markdown 唯一分类；3 个 PDF 绑定来源与 digest / P2 | snapshot/superseded 保持只读；新增文档同步清单。两个历史 PDF 与一个现行校验 PDF 均无跟踪生成器，替换前必须先补可复现生成源，不得手工编辑 |
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
