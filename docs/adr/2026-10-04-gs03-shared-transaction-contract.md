# ADR-GS03-S2-001：回调共同事务端口与全写入口提交围栏

- 状态：Proposed
- 日期：2026-10-04。用户批准本 S2 **设计**，不等于接受本 ADR 或授权实现。
- 任务/责任：GOV-029；T00 负责跨域事务技术合同及集成，T05 负责会诊业务，T08 负责入站协议与回执语义；`personalRecords` 的机器数据 Owner 为 `citizen-chronic`，`referralTeleconsultations`/`taskMessages` 为 `care-coordination`，审计为 `platform-governance`。授权语义、外部身份/scope 和留存 Owner 须在接受前确认。
- 本文只设计接口、旁路处置和验收。无 HTTP、UoW 代码、migration 注册、现库操作、生产接线或 schema head 变更；GS-03 未建设、生产六域 `NO-GO`。

## Problem 与已证事实

现行 v1 回调在入口读取状态、改会诊/报告档案/消息及审计后调用 `writeDatabase`；按 `contractId + idempotencyKey` 从最多 200 项 `integrationGatewayEvents` 查旧事件。TEST-024/025 已证跨资源重定位、跨主体同键和撤权后旧键/新键仍可返回成功的 **v1 现状**，不是新合同的通过证据（`docs/adr/2026-09-30-referral-callback-contract.md`；`src/http/routes/care-coordination.js:489-614`）。父 CALLBACK/STORAGE ADR 均仍 Proposed。

`DomainUnitOfWork` 先积累 owned `put/delete/publish`，`commit()` 才调用 adapter `transact`，没有事务内读取、跨 Owner 受控写或授权 fence（`src/platform/data/domain-repository.js:80-168`）。`withStateCommandLock` 是进程内 key 队列；`prepareCollectionCas` 提供集合版本冲突保护，但不能证明业务读集与版本取自同一锁内快照。现行 `readDatabase()` 先读取状态，再单独构造 `storageMeta`，尤其不能把旧业务快照与后来取得的新版本拼成成功写入（`src/platform/storage/state-command-consistency.js`；`server.js:6588-6597`）。`writeSqliteState` 自己 `BEGIN`，同步全量 `state_collections`、v15 审计源等后 `COMMIT`；不能原样嵌进另一个事务，也不能让事务外算出的旧全量快照覆盖新授权（`server.js:8022-8161`）。`STORAGE_ENGINE=auto` 可选择 JSON；新 lane 必须显式核实 SQLite 权威身份并失败关闭，不能静默降级（`server.js:7787-7887`）。

TEST-026 在**独立合成 SQLite 库**用 `BEGIN IMMEDIATE`、双连接/子进程、同键回查及模拟审计源验证候选语义；模拟源并非真实 v15 hook（`test/helpers/gs03-sqlite-experiment.js`；`docs/adr/2026-10-01-referral-callback-sqlite-experiment.md`）。S1 Accepted 只允许未装配 `gs03_callback_receipts` 迁移定义及隔离验证；拟议 v20 未加入默认注册表，表的成功审计引用 FK 指向真实 v15 `audit_delivery_source_events`，FK 存在不证明同事务或成功语义（`docs/adr/2026-10-03-gs03-receipt-migration-definition.md`）。

## Options

1. 保持旧快照入口、进程锁和有界事件窗口：改动少，无法给出跨进程撤权/回执原子承诺，仅保留 legacy 风险。
2. **推荐评审方向：**在单一已核实的 SQLite 权威上提供锁内决策与提交端口，所有冲突写者共享同一提交围栏；基于 S1 唯一不可变 receipt 结构，不新增平行 facts。先隔离合成验证，再逐写者接线；任何未封堵旁路使新 lane 保持关闭。
3. 正式 PostgreSQL 主权威连同全部授权、会诊、回执和审计写者迁移：可评估多实例目标，但当前 PG outbox relay/出站 receipt 不等于入站权威，需独立架构、数据迁移和现场决策。
4. 独立回执服务/跨库账本：会产生跨事实源提交、补偿和未知结果窗口；在缺分布式提交证明时不推荐。

## Advantages / Disadvantages

方案 2 的单库写锁、唯一键和真实审计 hook 可给首次、重放、撤权一个可故障注入的线性化边界；保留 T05/T08/档案/审计各自数据责任，`integrationGatewayEvents` 只作可截断观测投影。代价是改造共享写入路径、事务内读取和所有冲突入口；SQLite 本地证据不自动成立于跨库 scope、PG 多实例或现场。方案 3 迁移量更高但能在单一 PG 权威落实多实例合同；方案 4 的跨库一致性与恢复成本最高。

## 拟议端口合同（尚未实现）

```text
executeGs03Callback(command, trustedPrincipal, authorityFence, clock, transaction)
  -> ConfirmedFirst(minimalResult) | ConfirmedReplay(minimalResult)
  -> ProvenRollback(error) | CommitUnknown(reconcileWithSameKey)

transaction.beginWrite() -> lockedContext   // SQLite 候选为同连接 BEGIN IMMEDIATE
lockedContext.readCurrentCaseAndExactAuthorization(targetId, authorizationId)
lockedContext.readReceipt(namespaceDigest, contractId, version, keyDigest)
lockedContext.assertAuthorityFenceUntilCommit(authorityFence)
lockedContext.stageOwnedFacts({case, optionalReportRecord, twoInAppMessages,
  securitySuccess, accessSuccess, v15SourceRows, immutableReceipt, optionalApprovedOutboxIntent})
transaction.commit() -> confirmed | unknown
```

这是职责合同而非现有 `DomainRepository` API。事务端口由 T00 存储 Owner 提名；各数据 Owner 在同一连接/事务内提供受控读写适配，不能通过越权 `DomainUnitOfWork.put` 伪造所有权。端口对外只接收父 ADR 审批后的严格版本化规范化命令；认证 principal、scope 与签名校验来自可信边界，业务 body 中的 `sourceSystem`、`externalId` 不能生成身份。由可信主体目录确定稳定 principal namespace，计算 `namespace_digest`；同 namespace + 合同 ID/版本 + `key_digest` 唯一。`intent_digest_version=2` 的规范化字段顺序、类型、长度、时间格式、目标与确切授权 ID 绑定须与父 CALLBACK ADR 一同冻结，不能拿 TEST-026 的 `gs03-intent-v1` 或现有 state-command 摘要直接充当正式算法。

写事务成功取得单一权威的写锁后，**从该锁内新快照**读取目标案例、绑定的确切 `residentAuthorizationId`、居民、用途、机构、状态、版本和 receipt；锁外读取只能做预检，不能决定成功。仅以受控服务端时钟判授权有效期，在决策时及提交前复核 `expiresAt > now`；到期、撤权、挂起、授权 ID/居民/用途/机构不符即失败关闭，不搜索另一份有效授权替代。若 clock 前跳越过到期，提交前复核必须拒绝；时钟来源、漂移界限和过期政策由授权 Owner 批准，不预填容差。grant/revoke/resume/reassign 及授权记录直接编辑必须与回调使用同一锁/版本围栏；反馈/排期即使不改档案，也必须保护所读授权版本。`personalRecords` 的现行若干新增路径及回调报告归档会截到最近 500 条（如 `server.js:18992`、`src/http/routes/care-coordination.js:592`）；若确切授权被无关新增逐出，不能改查另一授权或把缺失视作有效。授权事实的留存/独立权威由其 Owner 决定。撤权先提交则首次和重放均拒绝；回调先线性化则已提交事实保留，之后撤权生效。HTTP 到达顺序不决定此排序。

首次请求在权限与确切授权成立后查唯一键；命中时仍先核当前 scope/授权，再逐项比较目标、授权 ID、`intent_digest_version` 和 `intent_digest`。完全一致仅投影经审批的最小回执，不追加业务、消息或成功审计；同主体 namespace 的异目标/异授权/异意图返回冲突且不披露旧目标。不同 principal 同 key 分属不同 namespace，仍各自核资源权限；是否属于同一外部逻辑事件由调用方协议另定，不能以此承诺跨主体去重。首次成功以数据库唯一约束提交 S1 receipt、会诊、必要报告档案、两条应用内 `taskMessages`、成功安全/访问审计及其**真实 v15 append-only source**；由审计 Owner 的现有 hook 从同事务旧/新链状态追加。S1 FK 只证明审计 source 引用存在；端口还须证明两条 source 对应**本次**成功安全/访问事件、当前目标、principal、receipt 与同一事务，拒绝引用其他主体或目标的有效旧审计行。不拿 TEST-026 fake `audit_source` 当真证据。若另批外部投递，最多同库写 pending outbox intent，网络发送在提交后由 worker 处理；应用内 `status=sent` 不是外部送达证明。任一步骤失败全部同库事实回滚，禁止成功业务后补 receipt/成功审计或向 JSON、PG 同步双写。

外部认证账号、机构关系、居民 scope 若不在该 SQLite 权威：`authorityFence` 必须由相应事实 Owner 定义可验证的版本/租约/锁协议，覆盖**所有**身份、scope 撤销和归属变更写者，并保持有效直到回调线性化提交；SQLite 内复读外部版本一次仍有 TOCTOU。缺共同提交协议、权威身份或 fence 失效时拒绝新 lane。此端口不创建认证服务，不把本地角色表或请求签名当作可信 provider 身份。

## 入口/Owner 与旁路策略

下表是必须逐一核实的入口类别，不宣称 inventory 已穷尽；完整文件/调用链由 GOV-029 盘点交付。每行由所属 Owner 选择“同端口串行化”或“新 lane 激活前拒绝冲突写”；只读允许保留，不能以现有角色门禁代替共同提交围栏。

| 冲突入口 | 当前证据/Owner | 拟议 fence |
|---|---|---|
| 三回调、会诊 create/actions、排期/报告与状态变更 | `src/http/routes/care-coordination.js:340-614`；T05/care-coordination | 同一案例锁内读写；旧全状态保存不可覆盖案例/receipt |
| grant/revoke/resume/reassign 与直接授权撤销 | `registration-referral-standalone.js:481-510`、`src/http/routes/identity-security.js:978-1040`；授权语义 Owner 待确认，`personalRecords` 数据 Owner 为 citizen-chronic | 确切授权及案例绑定同事务或经批准的可证明共同 fence |
| 档案 POST/PATCH、报告归档、通用导入/集合保存 | `src/http/routes/citizen-chronic.js:1114-1229`、`src/http/routes/state-data.js:179-455`；档案/状态 Owner | 拒绝改写授权绑定的旁路，或共同端口；现有角色限制继续生效 |
| `PUT /api/state`、`PUT /api/state-collections/*`、非生产 reset、管理脚本/恢复/备份回放 | `src/http/routes/state-data.js:179-455`、`server.js:980-993`；T00 与数据 Owner | 对受保护集合加不可绕过的存储层 fence；维护模式停新 lane 并核已提交账本，不以旧快照覆盖 |
| 审计 source、观测事件、外部身份/scope | `server.js:8118`、`src/identity-security/audit-delivery-source.js:256`；审计/身份 Owner | 成功审计同库事务；观测不作权威；外部事实需上述提交 fence |

## 失败四态与恢复

| 观察态 | 公共行为与持久含义 |
|---|---|
| 已确认提交 | 在当前权限下返回当前目标的最小结果；以 receipt 唯一键和真实审计引用证明本地提交。 |
| 权威确认回滚 | 才能断言本次业务、receipt、消息及成功审计零写；拒绝审计如需独立写，由审计 Owner 另定失败政策。 |
| 已提交但响应丢失 | 用**原 principal/合同/版本/同 key/同意图**在当前授权下查询或重放；不可换 key 重新执行业务。 |
| `COMMIT` 结果未知、连接/进程崩溃或回滚也失败 | 不推断零写或成功，不补“成功”/“已拒绝”审计；重启同 key 查唯一权威，仍无法确认则停新请求并由授权对账渠道处理。撤权后公共接口不回显旧 receipt。 |

拒绝/越权可产生独立受控安全审计，但不能创建成功 receipt，也不能把未知提交记为已拒绝。恢复查询的 Owner、授权、限时和脱敏投影须在接口接受前确认。

## Migration cost、Risk 与回滚

方案 2 成本中高：全入口 inventory 与数据 Owner 协议，正式接入 S1 未装配候选前重新核最新 schema head/迁移 checksum，单连接可组合事务端口、受控 audit hook、停写/恢复和跨进程专项。S1 定义不自动成为正式 v20；head 漂移须另审。不得新建 JSON receipt 集合或复制 `personalRecords`/会诊权威。若单库不涵盖关键事实，方案 3 须另立 Accepted 迁移决策，不能请求路径跨库双写。

legacy `integrationGatewayEvents` 最多 200 且旧事件无正式 `intentDigest`，缺失/重复/同键多目标不得自动回填为已证明 receipt。legacy 调用方 allowlist、已迁移主体不能降级、旧 lane 关闭期限和对账归属由父 CALLBACK ADR 与调用方 Owner 决定。新 receipt 留存期、隐私删除、到期 tombstone/key 可否复用、容量与备份恢复目标尚未获批；未定前不能宣称长期去重。新 lane 失败不得回退 v1 或 JSON。S1 仅有 `namespace_digest`，没有 source epoch/generation 列；恢复旧备份后，旧 namespace/key 可能落到不同源世代。正式权威身份与恢复世代如何绑定 principal namespace、key 和 audit source，及旧 key 的兼容/对账，须由存储、身份、数据 Owner 另行 Accepted 决定，不静默改 S1 摘要或补历史 receipt。现有 `scripts/storage-admin.js:229-259` 的确认和文件替换不证明所有写者已停、世代未倒退；恢复时须围栏停写、核源身份/世代及已提交账本，再决定恢复或失败关闭。已提交后回滚仅停新入口并保留 receipt/业务/审计，前滚修复或经验证的备份恢复与对账；不能 DROP、删除回执、重置 key，升级库不得未经验证交旧 runtime。

## Recommendation 与逐阶段 PLAN

推荐方案 2 **供下一轮审批**，前提是父 CALLBACK/STORAGE ADR 的 A 合同、授权/身份/数据 Owner、唯一权威、外部 fence 和留存政策获得正式决定。本 Proposed 文档只使后续设计可审查；S1 和 TEST-026 的 Accepted 限域不授权正式接线。B provider 信任/凭据轮换与生产现场另审。

1. **Inventory/准入：**T00 锁定逐入口、事实源、Owner、锁/CAS/事务、外部 scope 来源及旁路处置；T05/T08/档案/审计 Owner 签事务责任。无法封堵任何冲突写者时停在此阶段。冻结父协议的 principal 和 canonical intent，另立实施 PLAN/Accepted 决策。
2. **隔离存储片：**另获技术片准入后，只用未注册的 S1 候选和真实 migration runner 在自有合成库显式验证唯一 receipt、锁内读写、真实 v15 hook 与故障四态；不接 HTTP/默认启动。正式 registry 装配、最新 head、升级/回退另需独立 Accepted 决策及 PLAN；本阶段不暗中注册拟议 v20。
3. **共同写者片：**正式装配获准后逐 Owner 接通或拒绝所有授权/案例/档案/通用状态/恢复冲突入口，并证明外部 scope fence；再接新 lane 与严格版本/签名，legacy 只按已批准名单/期限隔离。每片独立文件所有权、审查、冻结和门禁。
4. **验收/切换评审：**三合同 `feedback/schedule/report` 分别测首次、精确重放、同主体异意图/异目标/异授权、跨主体同 key、越权与撤权后重放；用真实两进程/双连接交错撤权、续权、授权只读版本变化及提交前到期。负测第 500 条确切授权被无关新增逐出、旧业务 snapshot 拼新版本、授权集合变化而反馈/排期业务集合不变；逐步故障注入案例、报告、两消息、成功安全/访问审计、**真实 v15 source**、receipt 与 `COMMIT` 前后，且拒绝审计不能生成成功 receipt、存在但属于其他 principal/目标的成功审计引用必须拒绝。重启同 key 在当前身份/scope 下核未知与丢响应，不披露撤权后的旧 receipt；覆盖超过 200 事件、历史无摘要/冲突、留存到期、restore 后旧 namespace/key/source 世代、回滚和 state/collection/reset/导入旁路。用隔离合成库及真实执行器，不能以 fake audit 或 TEST-024/025/026 代替正式验收。通过仓库门禁后仍需真实 provider、PG/现场、灾备及签署证据；生产继续 `NO-GO`。
