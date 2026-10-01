# ADR-GS03-STORAGE-001：转诊回调入站回执与授权事实的同库原子边界

- 状态：Proposed
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

## Options

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

1. **同一事实源与读集。** 所有 grant/revoke/resume/reassign、直接会诊 create/actions、三类 callback，以及任何可更改授权记录或会诊授权引用的通用状态/档案导入、集合保存、reset、管理脚本和恢复路径，须先完成精确入口 inventory。已知但尚未穷尽的旁路还包括直接授权撤销 `POST /api/authorizations/:id/revoke`（`src/http/routes/identity-security.js:978-1023`）和档案 `POST /api/personal-records` 与 `PATCH /api/personal-records/:id`（`src/http/routes/citizen-chronic.js:1114-1229`）；后者的居民 PATCH 限 `resident-upload`，机构/主管部门仍受居民 scope，不能说任意角色可随意改授权。`PUT /api/state` 与 `PUT /api/state-collections/personalRecords` 要求 `commission` 且经理门禁；非生产 `/api/reset` 也要求两者且 `accessAcknowledgements` 为空才可执行（`src/http/routes/state-data.js:179-455`；`server.js:980-993`）。这些现有限制并不等于共同事务保护。实施时所有冲突写者要么改由共同端口串行化，要么在新 lane 激活前拒绝冲突写入；不能声称当前 inventory 已完成或旁路已封堵。
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
