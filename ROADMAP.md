# 工程治理路线图

> 更新：2026-08-26。队列不是实施授权；只有 Accepted ADR/明确 owner 审批的范围可进入实现。

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
| 7C | 生产 API 机器目录 | v3 保持 593 项与 13 项认证合同。现有 21 份幂等行为合同：19 个完整 endpoint、2 个转诊 action-slice；新增八份 T09 合同关闭药械/科研首发入口的职责范围、原响应回放、CAS 与原子审计证据，`reviewedProofRequired` 为零。314 个写接口仍缺 endpoint 级证明，总复核 316，全部 NO-GO / P1 | 继续审计 8 个运行时策略及其余写接口；真实 data owner、PG 多实例、长期留存/归档与现场证据继续外置，禁止把进程锁、SQLite CAS 或测试解释为 exactly-once/生产 GO |
| 7D | 区域共享只读边界 | 两个 GET builder 已从组合根归位 `regional-sharing-read-model.v1`，shared runtime 以单一 capability 注入；行为/架构/API 特征测试锁定鉴权、范围、投影、排序、审计顺序与响应兼容 / P1 | 继续小步迁移 legacy normalize/seed/handoff evidence，最终源码 owner 移交需独立流程/ADR；`shared-05`、PostgreSQL atomic repository、数据回填、真实机构地区映射和现场验收仍未关闭 |
| 8 | JSON/SQLite state collection 治理 | DATA-003 状态完整；首发 19 个 legacy 集合已按实际调用点关闭 owner review，当前 60 existing writable、19 owner-reviewed legacy、3 system、169 review-required、1 quarantined / P1 | 继续按 DATA-008 分 owner 确认、归档或 migration 晋升；19 个已审查集合固定生产不可写，process owner 证据不得自动变成 data owner |
| 9 | 前端可信渲染与 CSP | Accepted ADR；37 个脚本和 21 个静态样式风险已外移；血液主工作台、急救生命链、医生工作台、血液上线看板、陪诊工作台、产品运行驾驶舱、产品区域运行驾驶舱、质量安全工作台、区域切换工作台、血液召回面板、血液创新指挥中心与体检工作台完成可信 DOM/text 切片，体检资产已无 Inventory P0/P1；29 个原模板 URL occurrence 已闭合。Inventory v2 锁定 799 个 DOM HTML、6 个动态 URL、42 个动态样式风险且禁止增加/替换 / P1 | 按高风险资产继续治理 799 个 HTML 与 42 个动态样式 sink；真实 OHIF exact-Origin 到位后迁移剩余 2 个导航；完成全角色恶意输入、真实托管头与独立安全评估后才移除兼容 `unsafe-inline` 并强制严格 CSP |
| 10 | CI/worker/部署依赖治理 | CI 风险域拆分和 Action 完整 SHA 固定已建立；12 个 worker profile 的 v1 脱敏兼容观测、9 个部署入口漂移门禁与部署包闭包已完成；在线根 39 + 居民 13 项继续隔离 Worker，PWA 3 项已验证 v61 安装/更新/离线/缓存边界/清理，标准 E2E 共 55 项；Go/No-Go 四方业务责任属性已与登录角色过滤命名空间隔离 / P2 | 不降低 required checks；持续按官方 tag 升级并核验 commit SHA；新增 worker 必须登记并复用 v1；真实 HTTPS、设备/浏览器策略、外部 Origin、现场缓存升级、采集器/告警和上线验收继续外置 |
| 11 | 居民小程序制品凭证扫描消除哈希误报 | 已完成 / P2 | JSON 仅扫描语义字符串值并精确跳过两个字段中的合法 SHA-256；非 JSON 保留文本扫描；真实演示凭证与伪造摘要负向测试已建立 |
| 12 | 对象存储结构化元数据与耐久命令轨道 | Proposed OBJ-ADR-002；仅完成机器 decision/action register、v17 冲突预留和 CI fail-closed 治理 / P1 | 人类确认 T08 data owner 与 v1/v2 兼容策略，ADR 转 Accepted 后才可按 v17→全量回填/冻结→异步 API→fenced worker→无损分页→持久 reconcile→readiness 的独立切片实施；真实 provider/KMS/WORM/扫描/容量/备份/现场证据继续 NO-GO |
| 13 | 严格生产预检证据信任装配 | Accepted ADR；T00 pinned-anchor/Ed25519 双角色 provider、CLI 自动装配、deployment package/env/CI 和负向矩阵已形成 / P0 | 真实 anchor/envelope、独立 signer、权限/轮换、外部 evidence 与现场执行继续由生产环境提供；provider 成功不替代完整 preflight 或最终人类授权 |
| 14 | 生产切换行动证据与受保护晋级 | Accepted ADR；definitions-only v2、14/14 共享 Ed25519 验证、strict preflight 门禁、main/manual/production/self-hosted workflow 与 digest-only receipt 已形成 / P0 | GitHub production environment reviewers、专用 runner、真实 14 份 envelope、受控路径、外部审批和实际部署/现场签收继续 NO-GO；receipt 只证明预检资格 |
| 15 | 当前工作流、Markdown 与跟踪 PDF 闭集治理 | GOV-001、DOC-001、REPO-001 仓库内缺口已关闭：开发默认 `origin/main`，固定 tag 仅作证据；269 份 Markdown 唯一分类；3 个 PDF 绑定来源与 digest / P2 | snapshot/superseded 保持只读；新增文档同步清单。两个历史 PDF 与一个现行校验 PDF 均无跟踪生成器，替换前必须先补可复现生成源，不得手工编辑 |
| 16 | 首批生产范围机器冻结 | Accepted ADR；`priority-eight-applications-v1` 冻结 8 应用、9 页面、32 API、38 数据引用、7 worker、14 外部依赖、16 应用证据与 14 切换动作，并绑定部署包、smoke、strict preflight；19 个 legacy 引用 owner review 已关闭，`collectionReviewRequired=0`；T09 八个写入口机器复核已关闭 / P0 | 合同完整只代表范围无漂移；9 个 API 仍需仓库复核，21 个数据引用仍无生产写资格，全部数据晋级、真实外部证据、worker 激活、PG 主切换和现场验收继续 NO-GO |

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
