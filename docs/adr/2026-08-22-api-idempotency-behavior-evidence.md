# ADR：API 幂等行为证据必须显式登记且默认拒绝

- 状态：Accepted
- 日期：2026-08-22
- Owner：T00 证据门禁；T01 首个身份/SMS pilot 行为 owner
- 影响范围：生产 API 目录、外部回调鉴权分类、CI、测试与六张地图

## Problem

`production-api-catalog-v1` 能观察写接口附近的 `idempotent`、`nonce`、request ID 等字符串，但目录曾仅在完全未观察到标记时增加复核阻断。这会让“源码出现过相关词”在目录状态上等同于“幂等行为已由测试验证”，无法区分精确重放、同键异载荷、多实例耐久性和现场生产证据。既有 SMS delivery callback 已有 HMAC、事件级去重和行为测试，却仍被归入未分类自定义鉴权。

## Options

1. 保持源码标记启发式，把观察到标记的写接口视为仓库内已完成。
2. 为全部写接口人工维护第二份完整幂等清单。
3. 保留源码观察字段，另建只登记已验证 endpoint 的小型行为证据合同；未登记写接口一律 `behavior-proof-required`，从单一 SMS callback vertical pilot 开始。

## Advantages

- 方案 1 成本最低，不增加配置。
- 方案 2 可以一次性记录所有接口的理想状态。
- 方案 3 不复制路由目录；合同同时绑定 owner、认证模型、幂等键、载荷绑定、实现锚点与可执行测试，并允许逐 owner 小步扩展。
- 外部 HMAC principal 与平台 session/RBAC 分开表达，不创造并不存在的平台角色。

## Disadvantages

- 方案 1 会持续产生虚假的完成信号。
- 方案 2 容易漂移，并诱使维护者为凑齐清单猜测 owner 或行为。
- 方案 3 会让当前 `review-required` 数量上升，因为过去观察到标记但无行为合同的接口重新失败关闭。
- 文件/测试锚点只能证明受控仓库证据存在，不能证明测试在真实分布式生产环境通过。

## Migration cost

低到中等。目录 schema 从 v1 加法升级到 v2，增加一个小型证据注册表、验证 CLI、负向测试和 governance-api CI 步骤；授权矩阵加入一条既有 SMS callback 的 custom external authentication 声明。HTTP method/path、响应、数据写入、schema、migration、运行时依赖和部署拓扑不变。

## Risk

- 行为测试可能覆盖单进程内存/JSON ledger 而非多实例原子写，因此合同必须显式保持 `distributedExactlyOnceClaimed=false`。
- HMAC nonce 防重放与业务 `eventId` 幂等不是同一保证，目录不能合并二者。
- 测试锚点可能随合理重命名漂移；漂移应触发 owner 复核并更新合同，而不是静默放行。
- 仓库验证通过仍缺真实 provider、密钥托管、网络、耐久数据库、审计留存与现场签字。

## Recommendation

采用方案 3。`production-api-catalog-v2` 同时保留 `source-marker-observed/not-observed` 与独立的 `behavior-verified/behavior-proof-required`。源码标记永远不能自动晋升行为状态；只有机器合同、owner、实现锚点和可执行测试证据一致时才允许 `behavior-verified`。

首个 pilot 为 `POST /api/auth/sms-delivery-callback`：T01 owner，认证机制为 HMAC-SHA256 签名外部 SMS provider，授权范围为 provider message delivery；业务幂等键为 `eventId`，精确重放返回既有事件，同键异载荷返回 `SMS_CALLBACK_EVENT_CONFLICT`。该结论只适用于当前 ledger 行为，不宣称分布式 exactly-once。

所有条目继续固定 `NO-GO`、`productionReady=false` 和外部现场证据阻断。后续扩展必须由相应 owner 提供行为合同和真实负向测试；不得用批量源码扫描结果、注释或猜测 owner 填充注册表。

## 2026-08-23 existing-proof 扩展状态

在不修改运行时和数据库 schema 的前提下，注册表已扩展到 6 份合同。区域共享、直接转诊、科研合规导出 action 与 SMS callback 共 4 个完整 endpoint；两条通用兼容转诊入口只登记 `collection=referrals` / `referrals:*` action-slice。目录必须让 action-slice 保留 `behavior-proof-required` 和 `review-required`，禁止用局部证明晋升整个通用入口。专项测试直接执行身份先于读取、精确重放、同键异载荷、CAS、稳定错误和 AS-IS 审计语义；全部合同仍为 `productionReady=false`、`distributedExactlyOnceClaimed=false`。

同日第二个 owner 切片将注册表扩展到 7 份：只把 T07 `POST /api/online-payments/refunds` 登记为第 5 个完整 endpoint。选择该入口是因为既有 HTTP 与事务测试能够直接证明匿名/角色拒绝、服务端机构绑定、幂等键摘要、精确重放、同键异载荷 `PERSISTENCE_COMMAND_CONFLICT`、版本冲突、并发余额保护及 command/outbox 原子提交。相邻退款 action regex 未登记；T08 普通 integration event/dispatch 因同键异载荷当前只返回旧事件，也未登记。退款 endpoint 在目录中仍受 `runtime-role-policy-not-resolved` 阻断，故全局 `review-required` 数保持 330；该合同不改变运行时、数据库或生产 NO-GO。

## 2026-08-23 T07 第二批零晋升审计

同一注册表新增 3 条最小 `reviewedProofRequired` 记录，但没有新增行为合同。`POST /api/financial-gateways/dispatch` 缺少同键异载荷冲突、并发/CAS 和原子审计/outbox；`POST /api/financial-gateways/reconciliation-runs` 虽有摘要重放/冲突但缺少并发 fencing 与原子命令；`POST /api/disease-payment/formal-grouping/jobs` 虽有重放/冲突和角色检查，但缺资源范围、CAS、稳定 HTTP 错误和原子审计/outbox。拒绝记录与行为合同同 key 时验证失败；它只防止部分证据被误升级，不复制路由目录或创造目标语义。三项及全目录继续 `NO-GO`。

## 2026-08-23 T07 financial reconciliation 扩展

在本 ADR 已接受的逐 endpoint 机制内，`POST /api/financial-gateways/reconciliation-runs` 的拒绝记录由第 8 份行为合同替换。实现保留既有成功响应和 provider digest ledger：身份与保险 gateway scope 先于读取，同 gateway/date 在进程内串行并在锁内重读；精确载荷回放复用原 run，同 digest 异 summary 返回稳定 409。run 与 `securityEvents` 链式审计进入同一状态快照并只调用一次 `writeDatabase`；SQLite 继续使用既有 collection-version CAS/事务，冲突被投影为脱敏 409，写失败不再触发第二次审计写。

该切片不增加 schema、migration、dependency、outbox 或新 ADR。因为没有实际下游消息语义，不为目录虚构 outbox；进程锁只保护 JSON/单进程兼容路径，SQLite CAS 也不等于分布式 exactly-once。`financialReconciliationRuns` data owner、真实多实例 PostgreSQL、外部对账来源与现场证据均未关闭，合同继续 `productionReady=false`，593 项仍全部 `NO-GO`。

## 2026-08-23 T01 security-control action 扩展

在本 ADR 已接受的逐 endpoint 机制内，注册表新增第 9 份合同，只登记 `POST /api/security/controls/:id/actions`。实现复用既有 session-security-audit owner repository：commission 与 provider-verified step-up 先于 command collection；精确 control ID 缺失保持 404/零写；相同 command/intent 精确回放，异载荷返回稳定 409；同一 cloned-state UoW 只写一次 `securityAcceptanceLedger + securityEvents receipt/result snapshot/chained audit`。SQLite collection-version 冲突被投影为脱敏 409，普通写失败不触发 fallback audit。

该扩展不接现有 PostgreSQL adapter，不增加 schema、migration、dependency、outbox 或新 ADR；没有真实下游语义时不为目录虚构 outbox。`securityAcceptanceLedger` data owner、跨实例耐久性和现场证据仍未决，所以该 endpoint 及全目录继续 `productionReady=false` / `NO-GO`，且不宣称 distributed exactly-once。

## 2026-08-23 T02 quality-governance item action 扩展

在本 ADR 已接受的逐 endpoint 机制内，注册表新增第 10 份合同，只登记 `POST /api/quality-operations-governance/items/:id/actions`。实现复用既有 quality-operations owner 状态机、来源 adapter、command receipt 和全状态 UoW：session/RBAC 在 body/state 之前拒绝，精确 record 可见性与 action/institution scope 在 receipt replay 之前重新核验；404 不写，精确重放不二次写，同键异载荷稳定 409，同 record 的同/异载荷命令在当前进程串行。来源 record、receipt 与 governance/platform/security 三类审计只通过一次 `writeDatabase` 提交；SQLite collection-version 冲突与未知写失败均映射为稳定脱敏错误，且不触发 fallback audit。

该扩展不新增 schema、migration、dependency、outbox、PG adapter、外部系统或第二套状态机。既有 denied command 审计继续原子持久化，但越权响应不返回 record/audit 细节；真实多实例串行、PostgreSQL 主存储、来源集合 owner 决策和现场证据仍未关闭。合同继续 `productionReady=false`、`externalEvidenceRequired=true`、`distributedExactlyOnceClaimed=false`，593 项全部 `NO-GO`。

## 2026-08-23 T07 financial dispatch 扩展

在本 ADR 已接受的逐 endpoint 机制内，注册表新增第 11 份合同，只登记 `POST /api/financial-gateways/dispatch`。实现保持既有 session/RBAC、外部 adapter/request 和成功响应兼容；insurance 角色继续限定 INSURANCE gateway，institution 请求由服务端绑定登录 `orgCode`。现有 gateway 模块增加按幂等键命令锁、短时全局状态写锁与 canonical request digest：同 key 命令完整串行，异 key 的外部调用可并行；状态锁禁止包裹外部异步操作。锁内重读后精确重放既有事件且不再次调用 adapter/写库，同键异载荷返回稳定 `FINANCIAL_DISPATCH_IDEMPOTENCY_CONFLICT`。首次状态写在外调前以显式 `reserve` 意图持久化 `dispatching` reservation；外调后重新读取并以 `finalize` 意图在第二次原子状态写中替换最终事件、追加 `securityEvents` 审计。SQLite 在同一写事务内再次读取、合并和校验金融 ledger；显式金融写要求非负安全整数 collection version，普通全状态写不能覆盖另一实例已提交的金融状态。可信 callback 只追加 evidence 并更新 provider projection，不改写 dispatch lifecycle；retry finalizer 合并最新 callback 并标记需对账，manual dead-letter 只允许 failed 事件，不能降级 succeeded/reversed。中央持久化守卫固定 `id ↔ idempotencyKey ↔ requestDigest`；非法 JSON 与合法 JSON/错误 collection shape 均失败关闭。账本容量通过 operations/Prometheus 暴露已用量、余量和利用率，80% warning、95% critical，达到上限拒绝新 reservation 且不自动淘汰。最终写失败保留 reservation，重放固定返回 202 且不二次外调；失败事件只保存稳定脱敏原因并以原 502 语义重放。真实 stale-write 在 storage 与 HTTP 组合测试中被拒绝并映射为脱敏 `FINANCIAL_DISPATCH_VERSION_CONFLICT`。

callback 持久化守卫要求由 HMAC 验签器生成且绑定目标 gateway event 的进程内 attestation，并全账本拒绝 callback event/nonce 跨账项重放；attestation 不落库或出现在响应中。成功 finalize 必须携带与 gateway type、operation、status 一致的 provider receipt 和 dispatchedAt，失败 finalize 必须携带稳定失败码、失败时间、死信原因和死信标记。

该扩展不新增 schema、migration、dependency、outbox、PG adapter 或第二套 gateway。进程写尾只覆盖当前 Node 实例，外调成功而本地提交失败仍是必须由真实 provider 对账和生产存储设计处理的边界；因此不宣称跨实例 exactly-once。真实支付/医保/证照 provider、凭据和网络、PostgreSQL 多实例耐久性、对账回执及现场证据仍未关闭；合同继续 `productionReady=false`、`externalEvidenceRequired=true`、`distributedExactlyOnceClaimed=false`，593 项全部 `NO-GO`。

## 2026-08-24 T07 formal grouping create 扩展

在本 ADR 已接受的逐 endpoint 机制内，注册表新增第 12 份合同，只登记 `POST /api/disease-payment/formal-grouping/jobs`。现有 session/RBAC 和保险支付职责校验保持不变，并在业务读库前显式拒绝非市级的 commission scope；只有 city/health-admin/platform 与 insurance bureau/center 可以创建正式分组作业。body 幂等键存在时按其摘要建立当前进程命令尾，缺省键则保守串行；锁内读取最新 `diseasePayment`，精确重放返回既有 job/envelope、HTTP 200 且不再次写库，同键异模式/方案/病例快照返回稳定 409。

新建作业继续使用既有 `createFormalGroupingJob` 与 queued job/envelope 形状，成功 HTTP 201 不变。queued job 与链式 `securityEvents` 审计在同一快照中只调用一次 `writeDatabase`；SQLite 复用 `storageMeta.collectionVersions` 与既有事务 CAS，冲突映射为稳定脱敏 409。body/validation、资源范围、病例不存在、幂等/标识冲突、完整性和未知存储失败均建立稳定错误 code，内部存储错误正文不返回。正式分组没有新的外部消息提交语义，因此不虚构 outbox；queued job 本身仍是既有耐久工作事实。

该扩展不新增 schema、migration、dependency、outbox、worker、PG adapter 或第二套状态机。进程命令尾只覆盖当前 Node 实例，SQLite CAS 也不构成跨实例 exactly-once。真实正式分组器 endpoint、凭据/证书、签名回执、PostgreSQL 多实例、worker 运维与现场验收仍未关闭；合同继续 `productionReady=false`、`externalEvidenceRequired=true`、`distributedExactlyOnceClaimed=false`，593 项全部 `NO-GO`。
