# 影像质控结果查看与耐久对账计划

- 更新日期：2026-09-08
- 核查基线：`origin/main@523738228630ae7733278744aff233cd19fc8870`
- Owner：T06/影像；T00 负责登记、跨域契约、中央装配、迁移注册、CI 与集成
- 本次授权：T00 批准 OPS-015 纯文档 PLAN 更新，唯一写文件为本文
- 当前状态：OPS-018/#266 已集成；OPS-015 仍受阻；耐久协议待独立批准；生产 `NO-GO`

## 1. 已交付能力与审批事实

[PR #266](https://github.com/xujiann/chronic-care-platform/pull/266) 已合并，合并提交
`aac695431fc6322bf010c287ef28bed5204e18de`。最小对账错误投影、本页锁和“查看状态”严格 GET 已交付；
GET 失败不采用演示数据，字段相符不触发重发或解锁。本次不重复实施该能力。

`config/lifecycle-governance.json` 中 OPS-015 为“已阻塞”、能力“已实现”、风险“高”。
其 approved 范围为 `imaging-quality-control-recovery`，引用的 ADR-CLINICAL-001 对应
[临床五子域 ADR](./adr/2026-08-18-clinical-five-governed-subdomains.md)；
该 ADR 第七切片明确未新增幂等、CAS、机构范围、schema、outbox 或生产授权。
[耐久对账 ADR](./adr/2026-09-07-imaging-quality-control-durable-reconciliation.md) 仍为 **Proposed**，
不能用旧 approval 字段授权新协议。OPS-018 已关闭，其范围也仅允许耐久设计形成 Proposed 方案。

T00 本次只批准本文更新和独立文档 PR。UI 处置指引在本文固化后单独批准；高风险实现须先完成第 7 节人工决策、
Accepted ADR、专项验证设计及 T00 写范围/WIP 登记。本次中央台账、ADR、路由、六图和生产状态只读。
下文新协议、状态、文件和验收均为待批准设计，不表示已实现或已具备现场证据。

## 2. 当前实现与真实缺口

| 证据位置 | 已有行为与尚缺能力 |
|---|---|
| `src/http/routes/clinical-specialties/imaging-cloud.js` QC POST | 允许 commission/institution，查 study 后读 body；没有 study 机构范围校验。角色允许不能替代资源授权 |
| 同一分支 | 调用 FHIR 后才 writeDatabase；本地失败返回 503 需对账。调用前没有耐久 command、聚合 CAS 或持久重放回执 |
| `src/clinical-specialties/imaging/study-quality-control-command.js` | 每次生成 review UUID/时间；历史 slice(0,300)，不能充当非淘汰幂等账本 |
| `solution-a-connectors.js` publish/upsert | 按 study UID 派生固定 DiagnosticReport ID 并 PUT，回执校验资源/患者/检查/结果/有效时间；并非每次创建新资源，但缺命令绑定、条件版本控制和 DiagnosticReport 回读，新 issued/review 可改变资源版本 |
| 同一 connector | versionId 可为空；报告未绑定评分摘要或机构命令；相同资源 ID/相同结论不足以证明本命令完成 |
| `imaging-cloud.js` 两个 Map 与 inspect 函数 | 本页恢复上下文不能跨刷新、新标签页或进程；本地快照相符不能证明外部完成 |
| `config/clinical-subdomains.json`、`config/state-collection-governance.json` | imageCloudStudies/imageCloudQualityReviews 仍属候选/待治理集合，未成为独立生产权威聚合 |
| `src/platform/storage/sqlite-migrations.js`、worker inventory、影像源码根 | 未见 QC 专用 command/outbox/ledger/worker；通用 PostgreSQL 同步 outbox 不等于 FHIR 命令投递 |

现有“通过”还使用文本正则匹配，否定词如“不合格”“未通过”可能命中正向片段；后续应由临床负责人批准封闭
结果代码及显式中文映射。本次不改变旧输入语义，也不将该问题标为已修复。

现有路由特征、命令、公开响应和 Solution A connector 测试是后续回归起点。#266 的测试通过不证明尚未实现的
跨进程恢复、命令幂等或机构授权；本次不将旧 42 项结果包装为新功能交付。

### 可观测性端口复用结论

影像子上下文有 `appendSecurityEvent`，没有 QC 专用指标、trace 或 worker 端口。
该函数实际重新读库、追加事件并写库，并非无副作用日志；不能在本地提交失败后顺手“补日志”，形成新的独立写入。
业务与命令审计须随批准的事务合同实现。

平台已有 HTTP 计数/耗时，但 `server.js` 中 buildRuntimeMetrics/renderPrometheusRuntimeMetrics 不提供 QC
unknown 年龄或耐久对账积压；slowRequests 可能带实际资源路径，不能搬进用户指引或低基数标签。
`src/platform/operations/worker-observability-contract.js` 仅接受登记 profile 的 metadata-only 投影，
QC 尚无 profile。后续应由 T00 登记后复用，不能借用其他领域 profile 或新造通用观测中心。

文案/手册是低风险切片；新增指标端口至少需跨域 PLAN 审查，涉及敏感信息、审计写入或 worker 状态则随高风险
协议审批。HTTP 502/503 次数不能当作耐久对账 backlog。

## 3. 当前未知结果处置说明

触发条件：外部结果未知、FHIR 接收但本地未提交，或请求断连且无法确认完成。

1. 停止重复提交该检查，不用刷新、新标签页或另一账号绕过本页锁；刷新不能证明对账完成。
2. 点击“查看状态”。读取失败保留“未能读取”和需对账；当前授权/筛选范围未找到检查，不等于外部资源不存在。
   带 residentId 的既有 GET 可能记录访问审计；这里“只读”指不提交 QC 业务变更。
3. 通过机构已有受控工单渠道交给影像管理员和值班运维，提供发生时间、稳定错误码及必要的受限业务引用。
   不向公开日志、群聊、截图或本文复制患者信息、报告正文、DICOM UID、访问链接、凭据或供应商原始错误。
4. 授权人员在受控外部管理界面核验检查关联、报告内容、版本与写入时间，再与本地记录比对。相同资源 ID
   可能已被其他 QC 写入新版本；历史不可得或多候选时保持未知并升级人工核查。
5. 外部确认、本地缺失时保留证据，交领域负责人决定受控修复。当前没有批准的自动补写/关闭接口，
   不直接改数据库、不删除外部资源、不用再 POST 替代补偿；外部“未找到”不能单独证明原请求未执行。
6. 交班保留工单责任人和证据引用。只有依据已批准处置流程取得明确结论后，才决定后续业务操作；
   本手册不授予重新投递、人工关闭、改库或上线权限。

明确拒绝单独处理：只有响应明确为拒绝且 retryable=true，才按既有拒绝处理流程由用户再次操作；
其他拒绝先处理原因，unknown 不通过刷新或次数阈值变成可重试。

### 待单独批准的兼容 UI 切片

拟在现有提示中增加：“① 暂停重复提交，刷新页面不能证明对账完成；② 点击查看状态，并通过机构受控工单联系
影像管理员核对外部报告与本地记录；③ 在取得明确核验结论前保留需对账状态。”
GET 失败也显示责任人/渠道指引；替换暗示“重新加载即可恢复”的提示。

- 精确拟写：`imaging-cloud.js`、`test/imaging-dashboard-route-characterization.test.js`。
- 验收：unknown、confirmed/local-not-committed、GET 失败都有处置指引；仍只发生原 POST 后 GET，
  不二次 POST、不 fallback、不清 Map、不自动解锁，不增加数据收集/上传/导出。
- 无迁移，回滚只回退文案提交。T00 在文档 PR 复核后单独批准并登记 writer；本批不实施。

## 4. 方案选择与分阶段交付

目标是一条获授权的 QC 命令能够跨进程恢复、精确重放、可信核验并追踪处置责任。
推荐沿 Proposed ADR 方案 3 分阶段推进。仅保留同步外调只能改善提示；JSON 追加数组仍保留双写窗口；
同时切 PostgreSQL 主存储和影像聚合扩大迁移面。这些替代方案不纳入本轮实现。

| 阶段 | 交付与退出条件 | 前置条件 |
|---|---|---|
| S0 本文 | 现状、写范围、负向矩阵、处置与决策清单；独立文档 PR | T00 已批准，仅本文可写 |
| S1 领域协议 | 纯函数机构范围、命令规范、幂等/CAS、结果代码、receipt/readback 判定和负向测试；不挂路由 | Accepted 耐久 ADR、临床/安全评审、第 7 节决策及正式任务登记 |
| S2 耐久仓储 | 非生产 SQLite 事务、迁移、不可变回执/ledger、租约 fencing、重启/跨连接验证；无真实外调 | S1、Data Owner、字段/留存/事务审计批准，T00 注册迁移并安排旧 writer 冻结 |
| S3 HTTP 兼容 | 命令受理/状态查询、机构过滤、原子审计、稳定投影；旧同步写不能旁路 | S2、调用方兼容合同和 T00 中央装配；worker 默认关闭 |
| S4 投递与核验 | worker、模拟传输/回读、崩溃恢复、人工复核、观测/runbook | FHIR 能力合同、安全评审、T00 profile/部署计划；本地只用 synthetic fixture |
| S5 现场准入 | 六域真实证据、独立批准、显式激活 | 仓库验收后另行现场审批，缺证据继续 NO-GO |

阶段 ID 只是本文排序，不是已登记任务号。T00 分配真实任务、依赖、WIP 和每包 writer。
非目标：数据库拆分、独立微服务、同时切 PostgreSQL 主存储、修改分享/互认等其他用例、追溯制造历史成功。

### 待审协议不变量

- 机构：只从可信会话与权威机构目录解析 actor/organization，study 归属必须来源可验证且唯一。
  机构仅写本机构；commission 辖区与写权限由安全/临床明确批准，不自动全域。禁止名称子串、客户端归属和
  “缺机构则放行”。授权先于 body/重放结果读取，重放前再次复核当前范围。
- 幂等：命名空间绑定 actor、机构、study、合同版本和 key 摘要；规范化规则版本化。
  同命令返回首次受理快照，状态查询返回当前状态；同键异载荷 409。重放无再次外调、业务写或命令审计，
  访问审计按 T01 合同独立决定。容量满拒绝新命令但允许有效旧键重放，不淘汰旧回执。
- 聚合：同一 study 只允许一个未解决命令；expectedVersion 为非负安全整数，不强制转换字符串/布尔值。
  受理事务重验机构/版本并原子保存 command/outbox/audit；外部网络不在事务中。
- 数据：候选表 `imaging_qc_commands`、`imaging_qc_outbox`、`imaging_qc_reconciliation_ledger`
  需先批准 Owner、唯一键、不可变字段、留存和归档。摘要不能重建 FHIR payload，受理时须冻结经临床/安全批准
  的最小报告快照或不可变受控版本引用，并验证 payload digest。worker 不从可变 study 重建不同报告。
  本文不批准保存报告正文，也不复制居民/机构核心模型。
- FHIR：优先评估保留“单检查单资源”并增加命令绑定/版本约束，降低读方迁移成本；若选命令级资源，
  必须先批准查询和历史兼容。条件写、版本读和冲突处理能力待供应方确认。稳定资源 ID/HTTP 成功码不构成
  命令 exactly-once；能力不足时未知结果继续人工处理。
- HTTP：现有成功 200 返回 study/review/fhirReportSync；拟议 202 返回 command/status 是可观察变化。
  第 D05 决策必须选择版本化入口或显式协商及旧客户端策略；不能静默以 queued 假装同步成功。

命令生命周期拟为 queued/publishing/reconciliation-required/completed/rejected/dead-letter；
externalOutcome 的 unobserved/unknown/confirmed/rejected 为独立观察维度，不能与本地完成混用。
outbox 租约/重试从属命令，同一事务保证一致，不另设可独立晋升成功的业务状态机。

| 故障窗口 | 必须行为 |
|---|---|
| 受理事务失败 | 零外调，command/outbox/audit 一起回滚 |
| claim 后 | 先耐久提交租约再外调，网络期间不持数据库事务 |
| 完整可信回执 | 绑定命令、study、机构、患者引用、结果、评分摘要、固定时间与资源版本；QC 事实与完成状态原子提交 |
| 超时/回执不匹配/发送后崩溃 | 需对账；过期租约按“可能已发送”恢复，禁止直接再次写 FHIR |
| 外部成功、本地完成失败 | 用固定命令/版本回读并恢复完成事务，不重新投递 |
| 回读零条/多条/陈旧/错归属/版本冲突 | 不提升 confirmed；404 不等于“从未写入” |
| 老 worker 迟到 | 校验 token 摘要、租约版本/到期及 command CAS；冲突不改写成 provider 失败 |
| 明确无副作用的暂时拒绝 | 仅按批准的供应方语义以同一命令退避；耗尽 dead-letter，不扩大旧拒绝分类 |
| 人工复核/补偿 | 服务端授权、证据绑定、独立复核及不可变 ledger；不能填写 success 直接关闭 |

## 5. 精确拟写范围与 Owner 交接

下列新文件当前不存在，启动前再次搜索并核准复用。路径不构成写授权；不得一次申请整棵目录。
现有随访/对象存储/急救机制可作设计证据，不能复制私有实现或跨域直接读表。

| 实施包 | T06 拟写文件 | 跨域/中央交接 |
|---|---|---|
| S1 | 新增 `src/clinical-specialties/imaging/qc-command-contract.js`、`src/clinical-specialties/imaging/qc-command-scope.js`；新增 `test/imaging-qc-command-contract.test.js`、`test/imaging-qc-command-scope.test.js` | T01 权威机构查询合同；T00 注册领域/数据 Owner。禁止借用其他子域的名称模糊匹配 helper |
| S2 | 新增 `src/clinical-specialties/imaging/qc-command-repository.js`、`src/clinical-specialties/imaging/qc-command-sqlite.js`、`test/imaging-qc-command-repository.test.js` | T00/Data Owner：`src/platform/storage/sqlite-migrations.js`、存储入口与审计事务；不预占下一版本号 |
| S3 | `src/http/routes/clinical-specialties/imaging-cloud.js`、`src/clinical-specialties/imaging/public-response.js`、`imaging-cloud.js`、`test/imaging-dashboard-route-characterization.test.js`、`test/t06-imaging-response-security.test.js`；新增 `test/imaging-qc-command-api.test.js` | T00：`src/http/runtime-contexts/clinical-specialties.js`、`server.js`、API/数据注册和六图 |
| S4 | 新增 `src/clinical-specialties/imaging/qc-command-worker.js`、`src/clinical-specialties/imaging/qc-command-readback.js`、`test/imaging-qc-command-worker.test.js`、`test/imaging-qc-command-readback.test.js` | T00 核定 `solution-a-connectors.js` 的 writer、共享端口和 worker profile；CLI/部署/监控文件由指定 Owner 另列精确清单 |

## 6. 负向验收与迁移回滚

以下为未来 S1–S4 的完成条件，尚未执行或证明：

| 类别 | 场景 | 验收结果 |
|---|---|---|
| 授权 | 无身份、缺失/停用/重复机构、跨机构 study、名称碰撞、伪造归属、重放前撤权 | 拒绝且无 body/受保护重放读取、业务写和外调；必要授权查询最小化 |
| 输入 | 非字符串 ID、超长 key、非法版本、评分边界、未知结果、否定词误命中 | 不接受歧义转换；合法零分保留，临床状态不用子串判断 |
| 幂等/CAS | 同键并发、同键异载荷、同 study 异键、旧版本、已有未决命令、容量满 | 一次受理、稳定冲突、零重复外调，旧回执保留 |
| 原子性 | command/outbox/audit 各写点失败、机构/聚合并发漂移 | 一起回滚，无半成功、备用写或审计重封 |
| 耐久 | 重启、claim 后崩溃、外部已写而完成未存、双 worker、过期 worker 迟到 | 可恢复查询；只有效租约可推进；未知先回读 |
| FHIR | 错命令/机构/患者/检查/评分/结果/时间/版本、伪造 ID、零条/多条/陈旧回读 | 不确认；观测失败不等于拒绝；无立即第二次 PUT |
| 人工/审计 | 自审、重复补偿、篡改/删除 ledger、失效证据、旧复核命令重放 | 独立批准、版本约束、只追加历史及稳定脱敏错误 |
| UI/HTTP | 刷新恢复状态、旧客户端、202 未完成、GET 失败、跨机构查询 | 排队不当成功；无 fallback/自动重发，权限与白名单不变宽 |
| 迁移 | 归属缺失/重复记录、坏摘要、升级中断、降级旧 writer、历史超 300 条 | 隔离无证据记录，幂等迁移，阻断旧 writer，不制造已丢失历史 |
| 观测 | provider 原文、路径、凭据、资源 ID、标签爆炸、数据源缺失 | 固定有界标签；缺失为 unavailable，不假报零 backlog |

迁移建议先限非生产 SQLite，生产 PostgreSQL 另行决策。T00 核对真实 schema head 后登记新增单主题 migration，
历史 migration 不变；先验证备份和唯一约束，再只读核对旧数据机构/来源。不得为旧成功状态补造命令或可信回执；
无证据记录为 review-required，已截断历史不可恢复为完整账本。

read model 对照与旧 writer 禁用完成后才启用命令受理；worker 默认关闭，关闭期间队列仍须可查可告警。
双读不等于请求路径双写。新写合同不能被旧客户端、旧应用或通用状态写接口绕过。

回滚先停新受理/worker，再核对 in-flight；租约过期不证明无外部副作用。
保留 command/outbox/ledger 与查询/受控导出能力，以前滚修复为主；应用降级仍拒绝旧同步写。
不 drop 表、不清历史、不删除外部报告；外部业务补偿另行批准。

## 7. 必须核定的六项决策

| 决策 | 推荐待审方向 | 必要确认方与证据 |
|---|---|---|
| D01 FHIR 能力 | 优先保留单资源策略并验证命令绑定、版本条件写/读；能力不足保持人工未知 | 供应方/T06/安全：实际版本、认证、条件写、回读及超时并发联调 |
| D02 Owner/最小数据 | T06 为领域 Owner 候选；冻结最小快照或版本引用，明确命令/审计保留归档 | Data Owner/临床/安全/T00：字段字典、敏感级别、留存、归档批准 |
| D03 机构/临床权限 | 权威目录精确绑定，缺失冲突拒绝；commission 范围与封闭结果枚举单独确认 | T01/临床：角色辖区矩阵、study 来源/回填规则、结果代码 |
| D04 unknown/人工 | 只认完整可信观察；人工职责分离，无副作用重试须供应方语义支撑 | 安全/临床/运维：回读匹配、人工权限、拒绝分类与复核要求 |
| D05 存储/HTTP | SQLite 先非生产；版本化或显式协商受理合同，旧同步写受控退役 | T00/Data Owner/调用方：事务审计、迁移回滚、旧客户端测试 |
| D06 激活/SLO | 运维批准阈值/值班人/证据后才激活；缺失继续 NO-GO | 运维/T00/现场：排空、告警送达、备份恢复、升级回滚、独立激活审批 |

T00 将批准决定与精确 Accepted ADR、任务 ID、writer、review 人和专项验证引用对应登记。
文档或 CI 通过，以及笼统“继续开发”，均不替代高风险协议的这些决策。

## 8. 观测和上线证据

未来指标来自耐久仓储：queue depth/age、unknown age、人工对账积压、dead-letter、租约/CAS 冲突；
固定 domain/outcome/errorCode 等低基数标签，患者/检查/命令/资源 ID 不进入标签。
关联摘要仅进入授权 trace。健康检查区分存储/worker/FHIR 可用性和业务未决；
告警证明送达与处置，SLO/错误预算及升级时限由运维批准，仓库不编造数值。

| 准入域 | 必需真实证据 | 缺失时 |
|---|---|---|
| 功能完整性 | 受理→投递→核验→完成、拒绝/未知/人工闭环、临床结果映射独立验收 | NO-GO |
| 数据迁移 | 真实机构归属、历史隔离、计数/摘要、schema 指纹、旧 writer 冻结 | NO-GO |
| 安全合规 | 越权/撤权、TLS/凭据、日志最小化、独立人工复核、审计留存测评 | NO-GO |
| 性能容量 | 受理/投递/回读容量、积压与年龄、并发租约、运维批准的阈值/错误预算 | NO-GO |
| 灾备恢复 | command/outbox/ledger 一致备份、恢复点、崩溃、排空、降级读与前滚演练 | NO-GO |
| 供应商联调 | 实际 FHIR 能力、认证回读、条件写、资源历史、超时未知/乱序联合验收 | NO-GO |

只提交受控证据引用/摘要、适用版本、有效期及独立批准；原始报告和秘密不进入 Git。
六域通过后仍需受保护发布流程和现场显式激活；本文不改变生产状态。

## 9. 本次文档验证和回滚

T00 指定门禁：`npm run documentation-facts:verify`、`npm run repository:governance:verify`、
`npm run process:verify -- --base=origin/main`；另核对 diff --check、唯一文件差异、源码/链接定位及地域中性文本。
本文没有嵌入图片，不生成 PDF/截图；更新既有 current 文档不增加 Markdown 库存，不修改中央计数。
不重复长测旧实现。提交独立文档 PR，UI 与高风险实现分别等待批准；回滚只回退本文，无运行时或数据影响。

