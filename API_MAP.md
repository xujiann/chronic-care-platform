# API MAP — 主线接口地图

> 实施分支 AS-IS 快照：历史静态分析识别的 368 条精确路由是下限；当前扫描识别 372 个字面条件路由和 589 条授权声明，派生目录取并集后形成 594 个唯一接口（587 个字面路由、7 个运行时策略）。新增声明仅分类既有 SMS 外部回调认证，不新增路由。动态 ID、请求体 action 和外部回调变体仍需以运行时路由测试为准。

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
  严格目标只为 Report-Only；血液主工作台 API 字段已使用 DOM/text 节点，Inventory v2 现把
  871 个 DOM HTML、69 个动态 URL 和 45 个动态样式
  sink 作为资产级治理事实锁定，但不改变任何 API、响应体或鉴权，也不证明 sink 输入可信。动态样式
  与全角色浏览器回归完成前 SEC-004 仍未关闭。生产 HSTS 只由
  生产运行时生成，真实 TLS 终止层仍需现场核验。
- 多个领域具有 HMAC、nonce、时间窗、CAS、outbox 和 replay 记录。
- 错误格式仍由不同路由模块自行构造，存在 `{error}`、`{ok,code,message}` 等多种形态。
- 审计追加点分散在组合根、路由和领域服务；统一审计契约尚未完全落地。
- `GET /api/audit/verify` 继续返回 HTTP 200 的可解析业务结果，运行时与留存 CLI 共用 v2 严格验证器；合规报告和留存门禁按相同失败语义传播。
- 所有既有状态写入在同一 SQLite 事务内核对并追加 v15 审计 source；该 hook 不暴露新 HTTP API，同 ID 异内容会使原请求整体失败回滚。
- `PUT /api/state` 保持原路径和成功形状。审计数组以及四个 T02 区域共享集合均为服务端管理字段：省略时保留，提交时必须与当前值逐项深相等。区域集合的删除、修改、重排或伪造追加优先返回 `409 REGIONAL_SHARING_SERVER_MANAGED_COLLECTION_CONFLICT`；其他集合的乐观版本冲突仍返回 `409 STORAGE_CONFLICT`。集合级兼容入口对四个区域集合返回 `403 REGIONAL_SHARING_SERVER_MANAGED_COLLECTION_WRITE_DENIED`。
- `npm run api:authorization-matrix` 从模块化路由源码生成/校验 owner、身份、角色、范围、用途和九条高风险接口唯一性。
- `npm run api:production-catalog` 合并上述授权矩阵与同一 route source inventory 的字面条件；`production-api-catalog-v2` 将源码标记观察和行为证据分开。当前 594 项全部 `NO-GO`；334 个写接口中 1 个有行为合同，333 个仍缺行为证明，13 个自定义鉴权仍未分类，合计 339 项 `review-required`。
- `npm run api:idempotency-evidence` 校验证据合同、实现/测试锚点并执行 SMS ledger 幂等行为测试；pilot 的认证是 HMAC 签名外部 provider message scope，不伪装成平台角色。
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

- `API-001`：机器目录已覆盖当前 589 条授权声明、372 个字面条件路由和两者并集的 594 个唯一接口，并强制 method/path/owner/auth/roles-or-scope/idempotency/生产状态完整；不再手工复制路由清单。
- `API-002`：静态矩阵与目录已建立，但 7 个运行时策略路由、13 个自定义鉴权未分类入口、333 个尚无行为证据合同的写接口和 role × permission × resource 运行时允许/拒绝组合仍需逐 owner 扩展；233 个“未观察到标记”只是观察子集，源码标记不能替代行为证明。
- API 治理脚本已形成独立覆盖组，并以负向测试拒绝缺鉴权分类、method/path 漂移、缺幂等行为证明和生产误 promotion；覆盖率门禁不关闭上述 339 项 `review-required`，也不构成生产放行证据。
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

`GET /api/physical-exams` 已通过兼容委托接入 `physical-examination-dashboard-query.v1`。允许角色仍为 citizen、institution、commission；显式 `residentId` 继续按 `allowedResidentIdsForUser` 拒绝越权并记录安全事件。citizen 仍不接收联调、网关和专项分流明细，readiness 只暴露代码状态、质量和阻断数量；管理角色保留完整投影。成功响应继续在既有访问审计持久化之后执行最终脱敏。

## 9. 区域共享调阅 API

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
