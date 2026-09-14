# ADR：居民本人访问知晓声明首切片

- 状态：Accepted
- 日期：2026-09-14
- 决策：ADR-OPS-040
- Owner：T04 声明、T01 原访问事件核验、T00 组合与通用写保护
- 批准：USER-APPROVED-ACCESS-ACKNOWLEDGEMENT-2026-09-14；用户批准访问确认首切片，仅非生产开发和测试。

## Problem

居民页面已有确认按钮和 accessAcknowledgements 读投影，但没有受控写入口。通用状态写入和归一化截断不能充当声明命令合同。确认只表达本人知晓该次访问，不追认合法性、不改变原审计结果、授权、临床判断或其他居民权益。

## Options

1. 继续仅前端演示，不提供可靠回执。
2. 复用现有 JSON/SQLite state collection，增加本人命令、只读事件端口、同事务审计、旁路保护及容量拒绝。
3. 新建数据库权威、迁移或生产写链路。

## Recommendation

采用方案 2；方案 3 未获批准。POST `/api/access-reviews/:accessLogId/acknowledge` 属于 T04，仅可信当前 citizen 本人执行。T01 版本化只读端口在同一最新事务快照中精确验证唯一事件 ID 与可信 residentId，不调用会追加审计的 GET，不允许家庭代理、机构或管理角色代确认。缺失、重复、孤儿、畸形或归属不明事件失败关闭，不依赖客户端显示列表。既有 dataAccessLogs 的原事件事实由 T01 核验；登记不授权迁移、删除、重写或重封原访问审计链。

### 命令和回执

协议版本 `resident-access-acknowledgement.v1`。唯一允许的请求字段为 id（1–220）、residentId（1–120）、accessLogId（1–160）、decision=`recognized`、status=`submitted`、acknowledgedAt、idempotencyKey、requestedAt；时间须为有效 ISO 时间，仅作为请求摘要字段。键为 1–240 字符，header/body 必须完整一致；拒绝未知字段、非对象、空白变体及类型异常。规范摘要复用 stableStringify（对象键排序、数组保序）和 SHA-256，不截断，服务端可信主体及固定动作参与绑定。回执含 schemaVersion、id、residentId、accessLogId、resourceId、decision、status=`accepted`、acknowledgedAt、acceptedAt、receiptId、auditRef、syncStatus=`accepted`；私有命令绑定不得输出。历史声明缺少完整回执、重复或畸形时拒绝自动补造/迁移。

环境准入仅服务端 NODE_ENV 为空/development/test，production（去首尾空白、不区分大小写）一律拒绝，其他未识别环境拒绝；STORAGE_ENGINE 仅 auto/json/sqlite，auto 按实际可用适配器解析，显式 sqlite 不可用不得降级，POSTGRES_SYNC_MODE 必须 disabled。生产/未知环境检查先于重放。读取端口须读取原始持久快照，不借普通 readDatabase 的 normalization 自动补链或写回；T01 使用既有 verifyAuditTrail 核验原 dataAccessLogs，命令前亦核验 securityEvents。复用原访问审计 full-state 相等保护及 collection 禁写边界并负测；如原边界不足，仅在 SEC-016 state-data 精确范围内补拒绝，禁止重封篡改链后视为有效。演示 reset 也不得删除已持久化的声明：存在声明时拒绝 reset，空集合保持原兼容。

SQLite 专属适配直接复用既有状态事务及 append-only hook，提交后不得因次级 JSON 演示快照写失败报告业务回滚；不增加外部写或新事实源。JSON 专属提交须单进程同步原子文件替换，写失败保留旧文件；若无法验证安全提交则拒绝，不扩大为通用存储改造。所有适配仅服务本命令。

- 兼容真实前端 buildIdempotentAction envelope；严格校验允许字段、完整 Idempotency-Key 与 body 键，不截断。绑定可信 actor、本人 resident、精确路径事件、固定动作及规范化完整载荷摘要。客户端时间和 ID 仅作为有界请求字段，不作为服务端事实。
- 服务端生成声明 ID、receiptId、auditRef 和 accepted/acknowledged 时间，持久化稳定回执。前端确认投影采用服务器 ID 和时间；异议等其他投影保持兼容。decision `recognized` 仅是旧协议知晓编码，界面不得表述为合法或正常访问认定。
- 每次重放重新验证当前角色、本人关系、事件归属及环境。相同绑定及载荷返回同一回执且不新增声明/审计，同键异载荷返回 409；同一事件不同键拒绝重复声明（409），保留首次声明，不覆盖。
- 新声明与回执同存于既有 accessAcknowledgements；必要新增操作审计复用 securityEvents 及既有 SQLite append-only source 同一事务提交。不补写第二次成功/失败审计，不修改 dataAccessLogs、personalRecords 或授权。旧 securityEvents 展示窗口规则不改变，durable source 不更新/删除。
- 检查完整原始声明数组，不先截断。2000 条时拒绝新命令，合法重放仍返回既有回执；历史超额完整保留，新写失败关闭。畸形存储拒绝，不通过命令清洗或迁移。
- 同进程集合锁串行 read/check/commit；SQLite 使用现有版本 CAS 及事务，冲突明确拒绝，持久失败不污染内存或数据库。JSON 只支持单进程非生产演练，不宣称多进程安全；未知存储、生产环境（服务端 NODE_ENV=production 或既有生产配置）拒绝新写及重放。
- 通用 collection PUT 无条件拒绝声明写；full-state 显式改变声明（含删除/null/类型异常/重排）拒绝，省略或深相等保留服务端事实；不改变其他集合兼容语义。

## Advantages

复用既有事实集合、锁、CAS、审计事务与页面，不引入第二权威；明确知晓语义和服务端回执，覆盖失败、重放及通用入口。

## Disadvantages

2000 条上限会阻断新增，需要后续经批准的保留/迁移方案；已淘汰的原访问事件不能确认。JSON 无跨进程一致性承诺，本地 SQLite 不代表生产验证。

## Migration cost

无新增表、列、DDL、依赖、生产切换或回填。仅登记既有集合 Owner 与非生产合同，历史记录完整保留。回滚先关闭专属写能力，保留声明和旁路保护，禁止回退至会截断记录的旧写路径；既有事实不得随代码回滚删除。

## Risk

高风险：身份、审计、容量和存储并发。必须独立审查后冻结候选，串行运行专项、边界覆盖率、build/lint/typecheck/unit/integration/smoke、原 test:all、架构/路由/流程/治理及适用浏览器回归。记录失败证据，不放宽预算或断言。仅达到本地验证，不授权推送、合并、上线或扩大异议、投诉、影像和照护结案范围；productionReady/productionPrimary 保持 false，NO-GO。

## PLAN 与单写者

- GOV-013：中风险纯文档任务，协调者独占 ADR、lifecycle、六张地图、ADR 索引与文档分类；只登记用户已批准方向、证据和单写者，不实现数据权威或领域业务。
- OPS-040：T04 独立任务/worktree。developer_a 独占命令模块、T04 路由及 citizen.js/citizen-records-v2.js；developer_b 独占两个 citizen-access-acknowledgement 专项测试文件。不得并行重型测试。
- SEC-016：独立高风险跨域边界集成任务，T00 worktree；协调者独占 server.js、citizen-chronic runtime context、state-data 旁路保护、domain-data-ownership 与 state-collection-governance 机器合同。developer_b 独占 T01 resident-access-event-query 端口及其单元测试。T01 端口只能核验，不写 T04 声明。OPS-040 与 SEC-016 必须联合验收，不允许仅上线一半保护。
- independent_reviewer 只读审查，不与开发者共享写责任。三个任务在机器台账先登记后实现，WIP 3/5。领域提交由 T00 在本地隔离候选组合，不进行远端操作。

运行时 factory 经既有 src/http/platform-runtime-composition.js 导出并注入 server.js，不增加 server require 预算。dataAccessLogs/securityEvents 原系统 Owner 仍是 platform-governance（T02），T01 仅拥有核验端口，不迁移原审计数据权威；本轮只为 accessAcknowledgements 新增 T04 非生产声明合同。

## Completion

Owner 机器登记复用既有 legacy-owner-review-write-policy.v1 / first-release-legacy-owner-review.v1 数据结构，建立独立 resident-access-acknowledgement 批次与摘要，不改旧批次或首发 portfolio。该历史 schema 名称不表示本声明进入首发迁移或生产：productionWriteAllowed/productionPromotionAllowed 均 false，migrationRequired=true；命令版本单独登记为 resident-access-acknowledgement.v1。该集合已在运行时归一化中存在，但不在跟踪种子的 252 个集合中，因此不向 state-collection-governance 无 Owner 待审清单重复添加，也不编辑种子数据。

本人成功、代理拒绝、原事件/授权不变、完整幂等、容量/并发、旁路、真实前端 envelope、生产拒绝、SQLite 事务故障零污染均须证据。未通过的门禁保留为未完成，不预填成功或生产证据。
