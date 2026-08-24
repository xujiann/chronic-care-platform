# API MAP — 主线接口地图

> 实施分支 AS-IS 快照：历史静态分析识别的 368 条精确路由是下限；当前扫描识别 371 个字面条件路由和 601 条授权声明，派生目录取并集后形成 593 个唯一接口（586 个字面路由、7 个运行时策略）。其中 13 条声明来自机器认证证据合同，不新增路由；相邻 handler 不再被跨块拼接成虚假 method/path。动态 ID、请求体 action 和外部回调变体仍需以运行时路由测试为准。

## 1. 请求链

```text
HTTP request
  → browser-security-headers.v1（兼容 CSP + 严格 Report-Only；生产 HSTS）
  → platform request handler
  → cookie/session hydration
  → createPlatformApiRouter(runtime)
  → ROUTE_ORDER 的 76 个路由段
  → requireApiRole / authorize / 数据范围校验
  → 领域服务、仓储或外部适配器
  → 审计/状态变更
  → JSON、下载或错误响应
```

路由段命中并完成响应后返回 `true`；所有段未处理时由统一入口返回 404。

## 2. 路由域

| 路由域 | 段数 | 精确路由下限 | 代表性接口 |
|---|---:|---:|---|
| runtime | 4 | 8 | live、health、metrics、runtime status |
| regional | 2 | 3 | 区域状态、配置与能力 |
| identity-security | 4 | 23 | 登录、SMS、OIDC、会话、身份目录、安全审计 |
| platform-governance | 13 | 105 | 生产控制、迁移、证据、数智医院、产品化、医院运行 dashboard 与 command |
| state-data | 3 | 4 | 通用状态和 collection 兼容访问 |
| public-health | 4 | 49 | 监测、直报、生命登记、交换和运营 |
| citizen-chronic | 7 | 34 | 居民、档案、授权、慢病、随访 |
| care-coordination | 10 | 32 | 挂号、转诊、护理、陪诊、协同订单 |
| clinical-specialties | 8 | 40 | 急救、用血、影像、体检、质量安全；不再承载 operations 路由 |
| insurance-payment | 4 | 27 | 医保结算、支付、退款、凭证 |
| integration | 3 | 13 | HIS/EMR/LIS/PACS 网关、签名回调 |
| research | 2 | 5 | 科研数据集、申请、审计和成果 |
| shared | 12 | 25 | 组合查询、兼容体验和跨域工作台 |

静态扫描未发现重复的精确 method/path 组合；这不证明动态路由、语义重复或 handler 内分支没有冲突。

## 3. 认证与会话 API

- 服务端支持签名会话、HttpOnly Cookie、SameSite、CSRF token、SQLite/PostgreSQL 会话仓储和撤销。
- 浏览器通过 `/api/auth/context` 升级到服务端 Cookie 上下文；服务端登录响应中的 bearer/token
  不写入 `localStorage`，启动和上下文失败都会清理陈旧脚本凭据。静态非生产演示仍可保存不含
  凭据的本地身份状态。
- 外部身份支持 OIDC exchange/refresh/revoke；居民手机登录支持 SMS provider 和签名 delivery callback。
- 生产策略对 session secret、存储、保留期、外部 provider 和 demo 模式执行 fail-closed 检查。
- 页面级授权由 `access-control-policy.js` 与静态页面守卫执行；API 仍必须独立执行主体、角色、权限和资源范围验证。

## 4. 授权层次

| 层 | 实现 | 风险 |
|---|---|---|
| 身份 | 签名 token、Cookie、session store | Cookie 优先；显式 bearer 兼容仍扩大状态空间并保持 NO-GO |
| 角色/权限 | authorization runtime、`requireApiRole`、permission set | 大量路由逐段调用，策略一致性依赖测试 |
| 数据范围 | `canAccessResident`、机构/区域过滤、delegation | 规则分散在组合根和领域函数 |
| 页面/资产 | static page guard + access control policy + static asset policy | HTML 先受发布清单约束再执行页面角色策略；非 HTML 只能命中同一显式资源图 |
| 外部回调 | HMAC、nonce、时间窗、幂等键 | 密钥和现场配置依赖外部证据 |
| 审计 | securityEvents/dataAccessLogs/专用 PostgreSQL | v2 对内容、链接、结构和重复 ID 严格失败；验证读取不重封，全量写入不能修改服务端审计数组 |

## 5. 外部 API

| 系统 | 协议/模式 | 边界 |
|---|---|---|
| HIS / EMR / LIS / PACS | HTTPS、FHIR R4、DICOMweb、签名事件 | T08 契约，真实联调仍是外部阻断项 |
| OIDC 身份源 | issuer/userinfo/token/revoke | T01，生产必须真实 provider 与绑定目录 |
| SMS 网关 | HTTPS + bearer token + 签名回执 | T01；OTP、发送/登录限流和失败锁定已进入共享认证安全状态仓储，生产多实例要求 PostgreSQL |
| PostgreSQL | TLS verify-full、outbox/reconcile | 迁移期禁止请求路径双写 |
| Orthanc / OHIF / HAPI FHIR | Solution A Compose | 专科集成演示与受控部署 |
| 对象存储 | HTTPS 请求 HMAC；`object-storage-gateway-trust-v1` 原始响应 HMAC；上传/下载 exact-Origin + TTL；完成/生命周期显式回执 | 生产不允许 legacy 回退；请求与响应密钥分离，不得在仓库、API、日志或报告暴露真实凭据、签名 URL、原始敏感对象、provider 内部 receipt ID 或上游错误正文 |

## 6. 错误、幂等与审计

- router 未命中统一 404；存储冲突和 session store 不可用有专用错误转换。
- 健康/存储元数据的既有 `schemaVersion` 字段形状保持不变，值由 SQLite 注册表 head 派生，当前为 16。
- 静态未知/敏感路径统一 404；`GET/HEAD /data/public-demo.json` 返回合成脱敏数据，`/data/db.json`、源码、配置和仓库元数据不可发布。
- HTML、静态资源、JSON/API、下载与错误响应由集中端口下发 `nosniff`、frame、referrer、
  permissions 与 CSP。显式发布图的内联脚本/样式静态风险已归零，但兼容 CSP 仍含 `unsafe-inline`，
  严格目标只为 Report-Only；血液主工作台、急救生命链、医生工作台、血液上线看板、陪诊工作台、产品运行驾驶舱、产品区域运行驾驶舱、质量安全工作台、区域切换工作台、血液召回面板、血液创新指挥中心及体检居民解释/报告质检卡 API 字段已使用 DOM/text 节点，Inventory v2 已把
  824 个 DOM HTML、6 个动态 URL 和 45 个动态样式
  sink 作为资产级治理事实锁定。`browser-safe-url-policy.v1` 将可证明的内部导航、对象存储、`tel:120`
  和 blob 下载迁入统一协议/无凭据/exact-Origin 检查；29 个原模板 occurrence 已由 28 个真实 DOM
  绑定迁移和 1 个扫描误报校正闭合，仅 2 个 OHIF 导航保持 `review-required`。该变化不改变任何
  HTTP API、响应体或鉴权，也不证明 HTML sink 输入可信。动态样式
  与全角色浏览器回归完成前 SEC-004 仍未关闭。生产 HSTS 只由
  生产运行时生成，真实 TLS 终止层仍需现场核验。
- 多个领域具有 HMAC、nonce、时间窗、CAS、outbox 和 replay 记录。
- 错误格式仍由不同路由模块自行构造，存在 `{error}`、`{ok,code,message}` 等多种形态。
- 审计追加点分散在组合根、路由和领域服务；统一审计契约尚未完全落地。
- `GET /api/audit/verify` 继续返回 HTTP 200 的可解析业务结果，运行时与留存 CLI 共用 v2 严格验证器；合规报告和留存门禁按相同失败语义传播。
- 所有既有状态写入在同一 SQLite 事务内核对并追加 v15 审计 source；该 hook 不暴露新 HTTP API，同 ID 异内容会使原请求整体失败回滚。
- `PUT /api/state` 保持原路径和成功形状。审计数组以及四个 T02 区域共享集合均为服务端管理字段：省略时保留，提交时必须与当前值逐项深相等。区域集合的删除、修改、重排或伪造追加优先返回 `409 REGIONAL_SHARING_SERVER_MANAGED_COLLECTION_CONFLICT`；其他集合的乐观版本冲突仍返回 `409 STORAGE_CONFLICT`。集合级兼容入口对四个区域集合返回 `403 REGIONAL_SHARING_SERVER_MANAGED_COLLECTION_WRITE_DENIED`。
- `npm run api:authorization-matrix` 从模块化路由源码生成/校验 owner、身份、角色、范围、用途和九条高风险接口唯一性。
- `npm run api:authentication-evidence` 校验 13 项认证合同的 owner、mechanism、credential source、required/optional/none、replay/CSRF、scope、实现锚点和可执行负向测试。其中 SMS callback 从现有幂等合同派生；原 13 个未分类 key 中 12 个真实入口已分类，T10 cutover pack 绑定 commission 直接拒绝证据，1 个公卫词法误配已从 inventory 删除，未分类认证为 0。
- `npm run api:production-catalog` 合并上述授权矩阵与同一 route source inventory 的字面条件；当前 593 项全部 `NO-GO`。333 个写接口中 11 个完整 endpoint 有直接幂等行为合同，322 个仍缺 endpoint 级行为证明；2 个转诊 action-slice 不晋升通用 endpoint，退款 runtime-role variant 仍复核，因此总 `review-required` 为 324。
- `npm run api:idempotency-evidence` 校验 13 份证据合同。T07 financial dispatch/formal grouping 保持既有边界。T03 highlight signal intake 要求 session/RBAC 先行，city/health-admin 保持旧 payload 兼容，district 只允许自身 orgCode 或 `publicHealthHospitalCodes` 中的 canonical `sourceOrgCode/institutionCode`；其他 orgType 失败关闭。key 按 header、body idempotencyKey、body id、canonical payload 依次选择，并以 actor 组织 scope 命名空间后只保存 hash；同 key 在当前进程串行并锁内重读。首次提交 signal 与链式 `securityEvents` 一次写入并返回 201，精确重放 200/只读，同键异载荷或 ID 占用稳定 409，body/scope/CAS/未知存储错误均脱敏。200 条 ledger、单进程锁和 SQLite CAS 不等于跨实例 exactly-once，合同保持 `productionReady=false`。
- 身份/SMS HTTP 路径保持不变；组合根已为短信发送生成随机 request ID，适配器现在拒绝缺失幂等 ID，OIDC refresh 返回的 ID token 必须通过 JWKS/claims 验证后才暴露脱敏 claims。
- `POST /api/attachments/upload-intents` 在完成身份和居民范围校验后检查服务端元数据容量；已有
  500 条或更多记录时返回 `507 SECURE_ATTACHMENT_METADATA_CAPACITY_EXCEEDED`，且不调用对象
  存储网关、不写数据库、不返回附件标识、文件名、对象地址或容量明细。第 500 条可正常创建，
  既有元数据不再通过数组截断被删除；持久命令和分页仓储仍是后续生产闭环。
- Cookie 与 Authorization 同时存在时，服务端以 Cookie 会话解析身份并应用 CSRF 规则；生产
  `bearer`/`hybrid` 配置若未同时设置 `AUTH_BEARER_COMPATIBILITY=enabled`，Bearer 请求以
  `BEARER_AUTH_DISABLED` 失败关闭且登录响应不返回 token。显式打开兼容仍不改变
  `productionReady=false`。
- `GET /api/chronic/followup-events/health` 兼容增加脱敏 publisher 与 durable queue readiness；不返回 endpoint、
  secret 或外部回执。`POST /api/chronic/followup-events/dispatch` 保持 method/path 与角色，但只确认已由
  SQLite v16 耐久队列承接的本地事件，请求路径不再调用 publisher。内部必须读取真实 durable health；
  非 SQLite、队列不可用或不健康时以 `503 FOLLOWUP_EVENT_DISPATCH_DURABLE_QUEUE_UNAVAILABLE`
  失败关闭且不记录 allowed/accepted。机构响应继续隐藏全局队列计数，但不影响内部真实判定。
- 科研合规导出创建路径保持 `POST /api/research/datasets/:id/compliant-exports`，但新记录只进入 `pending/blocked`；`POST /api/research/compliant-exports/:id/actions` 由 commission 执行独立审核、退回和发布。命令要求 `expectedVersion` 与幂等键，同键异载荷或陈旧版本返回稳定 409；机构列表只返回本主体申请，历史 released 记录保持只读兼容。

## 7. API 风险与缺失测试

- `API-001`：机器目录已覆盖当前 601 条授权声明、371 个字面条件路由和两者并集的 593 个唯一接口，并强制 method/path/owner/auth/roles-or-scope/idempotency/生产状态完整；不再手工复制路由清单。
- `API-002`：区域共享、直接转诊、科研导出 action、T07 退款申请/financial dispatch/financial reconciliation/formal grouping create、T01 security-control action、T02 quality-governance item action与 T03 highlight signal intake 共 11 个 endpoint 已形成行为证据；两条通用转诊入口仅登记 referrals action-slice。8 个运行时策略、322 个尚无 endpoint 级幂等行为证据合同的写接口和 role × permission × resource 运行时矩阵仍需逐 owner 扩展。T08 普通 integration event/dispatch 和 T07 退款 action regex 也未晋升。
- T03 signal intake 的 POST 成功响应已隐藏命令摘要，并对 district 仅返回自身/服务端医院 allowlist 内的 signal 与全量同范围关联 alert；混合范围 alert 失败关闭。独立 `GET /api/public-health/highlights` 与 commission `GET /api/state` 不属于该写 endpoint 合同，其 district 全局读范围及持久化命令摘要投影仍是明确 `NO-GO` 债务，不能由本次 POST 证明替代。
- API 治理脚本继续拒绝伪造认证合同、跨 handler method/path 误配、action-slice 冒充 endpoint、缺幂等行为证明和生产误 promotion；覆盖率门禁不关闭上述 324 项 `review-required`，也不构成生产放行证据。
- `API-003`：错误响应契约不统一，调用方需要理解多个格式。
- `API-004`：`shared` 有 12 个路由段，容易成为跨域逻辑聚集点。
- `API-005`：已通过 Pages/Node 共用显式资源图和敏感路径拒绝矩阵缓解；后续新增页面资源必须同步更新清单并通过构建验证。
- `API-006`：服务端 token 的 localStorage 双路径已关闭；显式 bearer-only/hybrid 兼容仍增加
  请求来源、CSRF 与运维状态空间，因此生产继续作为阻断项。
- `API-007`：外部接口的生产可用性、证书、密钥和回执只能由现场证据证明。

## 8. 临床五子域 API 归属

临床五子域机器门禁当前覆盖 103 个 API 字面路径：急救 37、血液 28、影像 17、体检 7、质量安全 14；历史 operations 路由数为 0。`GET /api/operations/dashboard` 唯一归属 T02 `platform-governance-12`，其余 32 个 operations 字面路径唯一归属 T02 `platform-governance-13`。该计数包含参数模板和同一路径的不同源码表达，不替代精确 method/path 下限；全部 operations API 的 method/path、角色、状态码、响应、写入/审计语义和等效路由顺序保持不变。

`GET /api/emergency/dashboard` 已通过兼容委托接入 `emergency-dashboard-query.v1`。允许角色仍为 commission、institution、citizen；未授权请求在读数据前停止；成功状态仍为 200，响应继续经过既有 `redactSensitiveResponse`，且血液协调投影只暴露 `consumer=emergency`。该只读接口没有新增幂等、写入或审计语义。

`GET /api/blood-system` 已通过兼容委托接入 `blood-dashboard-query.v1`。允许角色仍为 commission、institution；未授权请求在读数据前停止。commission 保留全域交易投影，institution 继续按 `orgCode`、目的机构和可见输血申请过滤；状态码仍为 200，既有接口不经过额外脱敏。本切片没有增加持久化、幂等或审计语义。

`GET /api/imaging-cloud` 已通过兼容委托接入 `imaging-dashboard-query.v1`。允许角色仍为 commission、institution、county、citizen；显式 `residentId` 继续通过 `canAccessResident`，拒绝时记录安全事件并返回净化后的 403。成功响应仍为 200，先执行既有角色脱敏，再递归删除凭据、签名 URL、物理路径和内部连接字段；带居民过滤的成功调阅仍持久化既有数据访问审计。

`POST /api/imaging-cloud/studies/:id/share` 已从混合 `clinical-blood` 路由迁入 `imaging-cloud` 路由并接入 `imaging-study-share-command.v1`。角色仍为 citizen、institution、commission；鉴权后读取状态，404/居民范围 403 均在读取 body 前返回，成功继续限制 1–90 天、写入既有 share 与数据访问审计、单次持久化并返回 201。公开响应继续移除内部 token；本切片不增加幂等语义或生产批准。

`POST /api/imaging-cloud/studies/:id/qc` 已从混合 `clinical-blood` 路由迁入 `imaging-cloud` 路由并接入
`imaging-study-quality-control-command.v1`。角色仍为 commission、institution；鉴权后读取状态，检查不存在
仍在读取 body 和调用 FHIR 前返回 404。成功继续使用原默认值、更新检查及最多 300 条质控记录、调用
DiagnosticReport provider 后单次持久化并返回 200；provider 失败仍追加一次安全事件、返回 502 且不写本地
业务状态。公开投影继续剔除敏感 provider 字段。本切片不新增幂等、CAS、机构范围、错误标准化或生产批准，
该接口仍为 `behavior-proof-required` 和 `NO-GO`。

`GET /api/physical-exams` 已通过兼容委托接入 `physical-examination-dashboard-query.v1`。允许角色仍为 citizen、institution、commission；显式 `residentId` 继续按 `allowedResidentIdsForUser` 拒绝越权并记录安全事件。citizen 仍不接收联调、网关和专项分流明细，readiness 只暴露代码状态、质量和阻断数量；管理角色保留完整投影。成功响应继续在既有访问审计持久化之后执行最终脱敏。

TEST-007 已把 T02 `operations-command` 的 32 条路径全部纳入运行时行为矩阵：每条路径验证声明角色和
deny-before-read，19 条 GET 验证只读响应，13 条 POST 验证 payload/错误、响应、状态副作用及审计—写入
顺序；三条 integration POST 另验证签名与 institution 机构范围。该矩阵没有新增 idempotency、CAS 或
标准错误合同，也不改变生产 API 目录的 `NO-GO`。

## 9. 区域共享调阅 API

`GET /api/regional-data-sharing` 与 `GET /api/regional-data-sharing/handoff-report` 保持原 method/path、
commission/institution 角色、机构可见范围、状态码和响应 shape。`shared-05` 现在通过显式
`regional-sharing-read-model.v1` capability 构建结果：前者仍执行专用 access-review 投影后再按角色脱敏；
后者仍在构建成功后追加一条“生成区域共享交接清单”安全审计，再执行角色脱敏。拒绝发生在读取和 builder
之前，`latestRecords` 降序/最多五项、交接证据汇总和 Markdown 内容保持兼容。

`POST /api/regional-data-sharing/access-reviews` 保持原 method/path、commission/institution 角色声明和 `shared-05` 顺序。institution 继续按精确 `orgCode` 访问来源或目标共享包；commission 在非生产兼容模式保留原有全域服务端范围并增加 `COMMISSION_LEGACY_SCOPE` blocker。成功新建仍返回 201，幂等重放返回 200，授权拒绝返回 403，版本/幂等冲突返回 409，审计或生产仓储不可用返回 503。

生产请求合同为：`Idempotency-Key` 请求头，以及 `packageId`、`authorizationId`、`authorizationVersion`、`expectedVersion`、稳定 `purposeCode` 和与共享包完全相同的 `scopes`。服务端忽略客户端 `decision`、`consentStatus` 和 `note`；请求和持久化证据的过长/畸形字段均失败关闭，不做截断比较。共享包只接受明确 `ready + passed`。命令在 inbox 重放前重新核验 lifecycle、grantee、用途、范围与版本，撤销、失效或版本冲突不得复用历史 allowed 回执。单进程兼容适配器按 `packageId` 串行化 read/execute/write，避免当前全状态写入丢失；生产还必须同时满足 capability、`productionCutoverAuthorized=true`、PostgreSQL 和 atomic repository，当前注入值为 false，因此 generic JSON/SQLite 即使开启 capability 也返回 503。POST 成功/重放响应和 GET `accessReviews` 均经过专用 allowlist，不返回居民标识、授权引用/meta、用途/范围、幂等/请求摘要、关联 ID、主体标识、blocker 或共享包居民绑定载荷。非生产历史缺字段会返回 `legacyCompatibility=true`、稳定 `compatibilityBlockers`、`productionReady=false`，并设置 `Deprecation`、`Warning` 和 `X-Regional-Sharing-Compatibility`。

通用 `PUT /api/state` 不再是区域共享 owner 写端口。`regionalDataSharingScope`、`regionalSharingPackages`、`regionalSharingSnapshots`、`regionalSharingAccessReviews` 只能省略或回传服务端当前精确值；省略会保留，任何客户端删改、重排、伪造追加以及 package `version`/`lastAccessReviewId` 改写均失败关闭。区域命令仍是 packages/access receipts 的唯一业务写入口。

`POST /api/reset` 保留为非生产演示工具；在 `NODE_ENV=production` 时固定返回 `403 DEMO_RESET_DISABLED_IN_PRODUCTION`，不得用于清空区域共享权威回执。
## 10. T05 转诊命令 API

`POST /api/referrals/:id/actions`、`POST /api/workflow-actions`（`collection=referrals`）与 `POST /api/tasks/:id/actions`（`referrals:*`）继续保留原路径和各自成功响应形状，现统一进入 `referral-order.v1` owner command。三条路径均要求 `Idempotency-Key` 和正整数 `expectedVersion`；冲突、越权、超长字段和 action allowlist 失败返回稳定 `REFERRAL_*` code。权限在幂等回放和版本 CAS 之前执行。

## 11. 健康驾驶舱指标合同 API 投影

`GET /api/health-dashboard/summary` 与
`GET /api/health-dashboard/industry-governance-indicators` 的 method/path、commission-only
角色和既有响应字段保持不变。指标条目加法返回 canonical ID、显式 legacy alias、
`health-dashboard-indicator-contract.v1` 定义及 `population-service-visits.v1` 测量；summary
加法返回合同版本和阻断测量数。范围只接受服务端运行时注入，未解析范围或未经签名/版本认可的
来源返回 `blocked` 元数据，不会因报告结构 `ok=true` 被提升为生产证据。

## 12. State collection 治理与 API 边界

DATA-003 不新增、删除或改变任何 HTTP method/path、鉴权、角色、scope、错误、幂等或审计语义。
`data:collection-governance:verify` 是仓库 CLI/CI 门禁，只读取受跟踪源码、owner/process 配置、核心
定义和开发快照名称；不暴露治理目录为 API，也不允许 `shared`、`state-data` 或引用某集合的路由
process 自动成为数据 owner。252 个集合的 `productionPromotionAllowed` 均为 `false`，仓库成功检查
不改变生产 API 目录的全量 `NO-GO`。

## 13. 慢病随访事件接口变化

- `PATCH /api/followups/:id`：method/path/角色/幂等保持兼容；SQLite 模式下业务状态与 v16 enqueue 同事务。
- `GET /api/chronic/followup-events/health`：commission 可见全局 durable queue 计数；institution 仅见自身
  聚合 pending 与 `not-disclosed` 队列边界，避免跨机构泄露。
- `POST /api/chronic/followup-events/dispatch`：保留路径但仅返回 `dispatchMode=durable-worker`、queued 和
  `requestPathExternalDispatch=false`；不调用 provider、不写 delivery 结果。durable queue 不可用或不健康时
  返回 503，institution 虽不获取全局计数，仍使用同一真实健康判定。
- 人工 dead-letter replay 仅经受控 CLI digest 参数执行，尚未新增公网 HTTP 管理接口。

## 14. 对象存储异步 API 候选（Proposed，未实施）

现有安全附件 method/path、同步响应、鉴权、范围、错误和审计行为均未改变。Proposed ADR 建议未来另发
版本化 v2：创建命令返回 `202 + commandId + statusUrl`，状态查询和人工 replay 使用稳定错误、幂等键与
资源范围；生产请求路径不得直接调用 provider。具体 path、v1 是否继续同步、弃用窗口和调用方迁移顺序
尚未获人类批准，不能登记为现有 API 或进入 production catalog 的 GO。

机器治理 CLI 不是 HTTP API。ADR 未 Accepted 或 data owner/v1-v2 兼容策略未确认时，v17、runtime/API
implementation 和 production promotion 全部失败关闭。真实 provider endpoint、凭据、回执、capability
与现场验收继续是外部 NO-GO 边界。

## 15. 严格生产预检 provider（无 HTTP 变化）

本切片没有新增或改变任何 HTTP method/path、身份、角色、scope、错误、幂等或审计事件。
`npm run production:preflight:strict` 在既有 CLI 内自动装配外部 signed-envelope provider；显式测试注入
继续兼容但不会进入部署配置。CLI 顶层异常、provider 不可用和验签失败只返回稳定脱敏 code，不回显
绝对路径、信任材料或外部错误正文。provider 验证通过仍只是 preflight 的一个必要条件，不能直接记录
Runtime Go/No-Go 或生产授权。

## 16. 生产切换行动证据接口边界

本切片不新增或改变 HTTP API。`production:actions:check` 只验证 definitions-only 台账；v2 evaluator 复用
T00 pinned-anchor Ed25519 端口消费仓库外 `<action-id>.json` envelope，并只返回 digest-only 决定投影。
任何本地 `status`、无签名 fixture 或未绑定当前 release/artifact 的记录都不能解除 strict preflight；
manual production workflow 也不调用业务 API 或执行部署。

## 17. 全局 Go/No-Go 受信 receipt 响应语义

现有 `/api/production-go-no-go/*` method/path、鉴权和写操作形状未新增或改名。center 响应新增/强化
`goNoGo:trustedPreflightDecision` prerequisite 与脱敏 `trustedPreflightDecision` 投影；缺失、漂移、过期、
未来时间、重放或 verifier 异常只暴露稳定代码，不返回 provider 错误正文。写入普通 evidenceRef、DR
布尔或 synthetic `verified:true` 对象不能晋升生产状态。唯一授权系统和 receipt 获取 API 尚未确定，
不得把 Proposed ADR 或测试 fixture 登记为生产签发接口。

## 18. TEST-006 静态与测试性能边界

本切片不新增或改变任何 HTTP method/path、身份、角色、scope、错误、幂等或审计语义。
`test/api.test.js` 的三段历史不可达断言曾先登记为显式 skipped debt，后续 T05 revalidation 已全部恢复执行；
integration runner 只隔离该文件并输出耗时，不把通过数或耗时提升为 API 生产证据。
后续 duplicate-key closure 只清理 `internet-nursing.js` 与 `quality-safety.js` 的静态翻译 map；
既有 API 调用、请求参数、响应消费和 DOM 渲染入口保持不变，最终中文展示由逐键调用特征测试锁定。

后续 T05 revalidation 已恢复上述 3 段显式 skip，并以独立真实 HTTP 测试固定 owner 契约：陪诊创建/
阶段推进/handoff、护理创建/评估/派单/接单与护士接单/开始/完成。`POST /api/escort-services/orders`
引用 `registrationOrderId` 时先返回稳定 `ESCORT_REGISTRATION_NOT_FOUND`(400) 或
`ESCORT_REGISTRATION_SCOPE_DENIED`(403)；`POST /api/escort-services/orders/:id/hospital-handoff`
将 `reject` 与 `return` 均投影为 `hospital-returned`，并原子更新 `hospitalInterfaceStatus`。鉴权角色、
method/path、幂等、审计、notification plan 与 outbox 语义不变；planned/pending 不能解释为外部送达。

首个 API 夹具切片只把临时数据副本、环境变量和同一 HTTP server 生命周期移动到测试 helper；测试正文的
43 个有序子测试及其请求、身份、scope、幂等、错误和审计断言原样保留。helper 暴露的 fixture 与数字医院
配置函数仅供同一测试进程继续执行既有断言，不是新 API、公共 SDK 或生产信任接口。
第二个夹具切片只把 HIS hospital adapter mock 的创建、动态回环监听、3 个测试环境变量及关闭清理移入
测试 helper；既有 `/api/integration/*` method/path、请求与 provider 响应、HMAC 签名、回执次数、鉴权、
scope、幂等、错误和审计断言均不变。synthetic `his-provider-*` 只用于回归，不能解释为外部 HIS 投递证据。
第三个夹具切片只把 SIEM alert delivery mock 的创建、动态回环监听、请求记录、成功/503 开关、3 个测试
环境变量及关闭清理移入测试 helper；既有 `/api/observability/alerts/dispatch` 与 retry method/path、HMAC、
鉴权、scope、幂等、敏感字段拒绝、失败事件及 incident 关闭断言均不变。synthetic `siem-event-*` 只用于
回归，不能解释为外部 SIEM 投递、生产告警送达或现场证据。
第四个夹具切片只把 financial gateway mock 的创建、动态回环监听、请求记录、三类 synthetic receipt、6 个
测试环境变量及关闭清理移入测试 helper；既有 financial dispatch/callback/reconciliation/retry method/path、
请求与回调 HMAC、鉴权、scope、幂等、敏感字段拒绝、审计和请求次数断言均不变。synthetic provider receipt
只用于回归，不能解释为真实支付、医保、证照投递或现场证据。
第五个夹具切片只把 object-storage gateway mock 的创建、四类 v1 签名响应、动态回环 URL、请求记录、8 个
测试环境变量及关闭清理移入测试 helper；既有附件 upload/complete/download/lifecycle method/path、响应签名、
鉴权、居民/机构 scope、元数据脱敏、immutable/legal-hold、恶意 scan 文本拒绝和 quarantine 断言均不变。
`setScanStatus` 仍由原测试正文在相同时点调用；synthetic 回执与 URL 不能解释为真实存储或现场证据。

## 18A. TEST-002 内部覆盖扩展（无 API 变化）

区域共享命令、转诊 owner command 和科研合规导出状态机现进入各自独立 c8 组，直接复用既有身份先行、重放/CAS、职责分离和失败关闭测试；覆盖组不新增或改变 HTTP method/path、响应、鉴权、审计或生产状态。浏览器响应头与 Safe URL 组同样只测内部策略端口，不能替代 Playwright 页面行为、真实托管头或外部 Origin 验证。

## 19. Worker 观测合同（无 HTTP 变化）

本切片不新增或改变 HTTP method/path、请求/响应 schema、鉴权、scope、幂等或审计语义。既有 worker/CLI
报告仅 additive 地增加 `workerObservability`；原业务字段和失败/重试结果继续权威。投影字段闭集、未知
profile、profile 替换、额外字段和生产授权扩张均失败关闭。该库接口不是公开 API，不能据此宣称 worker
已启用、外部 delivery 已完成或平台可以生产上线。

## 20. Playwright E2E 隔离（无 HTTP 变化）

TEST-005 只改变测试进程、浏览器与临时端口装配，不新增或改变任何 HTTP method/path、鉴权、角色、
scope、错误、幂等或审计语义。根 39 项与居民 13 项继续调用现有接口；动态回环端口和临时数据只用于
自动化验证，不能登记为公开 API、生产 endpoint 或现场证据。

PWA 专项增加 3 项独立浏览器行为测试，但不新增测试控制 HTTP API：仍由现有 `/api/health` 探活并使用
正式 `service-worker.js`。Worker 明确旁路 `/api/*`，缓存拒绝非同源和非成功响应；测试中的 offline 模式、
Cache Storage 与 registration 清理不构成真实 HTTPS、生产 endpoint、现场浏览器策略或外部 Origin 证据。

## 21. 仓库文档与制品治理（无 HTTP 变化）

本切片不新增或改变任何 HTTP method/path、身份、角色、scope、错误、幂等或审计语义。
`repository:governance:verify` 是只读 CLI/CI 门禁，仅校验当前 workflow、Markdown 路径分类与 PDF
provenance/digest；不公开治理清单为 API，不读取 PDF 正文作为业务数据，也不产生生产 readiness。

## 22. 急救生命链可信渲染（无 HTTP 变化）

本切片只改变 `emergency-lifechain-ui.js` 对既有 overview、quality、command-center 响应与错误消息的浏览器
表达，不新增或改变 method/path、响应 schema、鉴权、scope、幂等、CAS 或审计。恶意字段通过 DOM
`textContent`/dataset 呈现且不能创建元素或事件属性；该测试不证明接口数据可信、外部系统或生产上线。

## 23. 医生工作台可信渲染（无 HTTP 变化）

本切片只改变 `doctor.js` 对既有 `/api/doctors/me`、`/api/public/multi-practice-ledger` 与
`/api/phase2/clinical-assist` 响应的浏览器表达；申请提交和临床辅助回执的 method/path、payload、
身份、机构范围、错误、幂等和审计均保持原状。API 字段与 alert ID 通过 `textContent`/dataset 写入，
恶意标签和事件属性不能进入活动 DOM；仓库测试不证明上游数据可信或生产就绪。

## 24. 血液上线看板可信渲染（无 HTTP 变化）

本切片只改变 `blood-go-live.js` 对既有 `GET /api/blood-system/go-live` 响应和固定
`BloodStandardRegistry` 的浏览器表达；接口/设备、要求、演练、迁移、审批、临床门禁和回滚的
method/path、payload、身份、错误、幂等和审计均保持原状。API 字段通过 `textContent` 与显式 DOM 节点写入，
恶意标签和事件属性不能进入活动 DOM；仓库测试不证明真实血液系统、设备接口、证据签署或生产就绪。

## 25. 陪诊工作台可信渲染（无 HTTP 变化）

本切片只改变 `escort.js` 对既有 `GET /api/escort-services/dashboard` 响应的浏览器表达；陪诊订单、服务主体、
陪诊师、风险队列、政策映射和医院交接按钮的 method/path、payload、身份、机构范围、错误、幂等和审计均保持原状。
API 字段通过 `textContent`/文本节点写入，订单 ID 只经 dataset 绑定动作；恶意标签和事件属性不能进入活动 DOM。
仓库测试不证明上游数据可信、真实 HIS/导诊台、托管响应头、渗透或生产上线。

## 26. 产品运行驾驶舱可信渲染（无 HTTP 变化）

本切片只改变 `product-operations-ui.js` 对既有 `GET /api/platform/productization/operations/cockpit`
响应中 allowlisted operational metadata 的浏览器表达；method/path、commission 鉴权、响应 schema、
审计和固定 `productionReady=false` 均保持原状。`mount` 使用显式 DOM/text/dataset 构造，兼容的
`render` 字符串接口继续执行原编码语义；恶意标签和事件属性不能进入活动 DOM。仓库测试不证明
上游数据可信、真实托管响应头、渗透或生产上线。

## 27. 产品区域运行驾驶舱可信渲染（无 HTTP 变化）

本切片只改变 `product-regional-operations-ui.js` 对既有
`GET /api/platform/productization/enhancements/cockpit` 响应中 allowlisted work item、地区运行与配置差异
元数据的浏览器表达；method/path、commission 鉴权、响应 schema、审计和固定
`productionReady=false` 均保持原状。`mount` 使用显式 DOM/text/dataset 构造，兼容的 `render`
字符串接口继续执行原编码语义；恶意标签和事件属性不能进入活动 DOM。仓库测试不证明上游数据可信、
真实托管响应头、外部地区系统、渗透或生产上线。

## 28. 质量安全工作台可信渲染（无 HTTP 变化）

本切片只改变 `quality-safety.js` 对既有 `GET /api/quality-safety/dashboard`、
`GET /api/quality-safety/interface-joint-test-pack` 及既有质量安全写动作响应的浏览器表达；method/path、
commission 鉴权、请求/响应 schema、错误、幂等和审计均保持原状。共享页面挂载入口改为显式
DOM/text/class/dataset/`replaceChildren`，表头、空态和委托按钮动作保持原行为；恶意 API 字段不能
创建活动标签或事件属性。仓库测试不证明上游数据可信、真实托管响应头、外部系统、渗透或生产上线。

## 29. 区域切换工作台可信渲染（无 HTTP 变化）

本切片只改变 `regional-cutover-workbench-ui.js` 对既有 `GET /api/regional/cutover-workbench` 响应的
浏览器表达；method/path、commission 鉴权、响应 schema、审计与固定生产 `NO-GO` 均保持原状。
摘要、地区、发布、运维、存储、证据、阻断项和边界字段通过显式 DOM、`textContent` 与 dataset 写入，
恶意 ready/required scope 字段不再创建活动标签或事件属性。仓库测试不证明地区已切换、外部证据有效、
真实托管响应头、渗透或现场验收完成。

## 30. 血液召回可信渲染（无 HTTP 变化）

本切片只改变 `blood-recall.js` 对既有血液召回查询与确认接口响应的浏览器表达；method/path、鉴权、
请求/响应 schema、错误、幂等与审计语义均保持原状。召回 ID、原因和待确认机构数通过显式 DOM、
`textContent` 与 dataset 写入，确认动作仍提交原 POST、显示原 toast 并在清空后呈现空态。仓库测试不证明
真实血液系统、外部回执、托管响应头、渗透或现场验收完成。

## 31. 血液创新指挥中心可信渲染（无 HTTP 变化）

本切片只改变 `blood-innovation.js` 对既有创新中心、事件枢纽与数字孪生响应的浏览器表达；method/path、
鉴权、请求/响应 schema、错误、幂等与审计语义均保持原状。摘要、能力、库存、风险、预测、符合性、
死信与孪生字段通过显式 DOM、`textContent` 与 dataset 写入，死信重试和创新能力执行仍调用原接口。
仓库测试不证明真实血液系统、设备、跨模块消费方、外部回执、托管响应头、渗透或现场验收完成。

## 32. 体检风险卡可信渲染（无 HTTP 变化）

本切片只改变 `physical-examination.js` 对既有居民解释与报告质检响应中两个高风险卡片区域的浏览器表达；
method/path、鉴权、请求/响应 schema、错误、写动作、幂等与审计语义均保持原状。翻译结论、质检说明和
问题文本通过显式 DOM、`textContent` 与闭集状态 class 写入，未知状态不能成为 class。其余 25 个 HTML
sink 仍在 Inventory 中失败关闭；仓库测试不证明真实体检设备、外部回执、托管头、渗透或现场验收完成。

## 33. 金融 callback/finalize 写入约束（HTTP 兼容）

`POST /api/financial-gateways/callbacks/:type` 的 method、path 和公共响应不变；内部写意图新增不落库的目标账项 attestation，中央守卫拒绝伪造 `signatureVerified`、跨账项 event/nonce 重放及无新增 evidence 的 provider projection。dispatch/retry 成功 finalize 必须包含匹配 type/operation/status 的 provider receipt 与 dispatchedAt，失败 finalize 必须包含完整稳定失败证据。
