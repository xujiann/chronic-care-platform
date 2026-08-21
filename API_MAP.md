# API MAP — 主线接口地图

> 实施分支 AS-IS 快照：基于 `main@a15d10d`。静态分析识别的 368 条精确路由是下限；动态 ID、prefix 和外部回调变体需以运行时路由测试为准。

## 1. 请求链

```text
HTTP request
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
| platform-governance | 12 | 73 | 生产控制、迁移、证据、数智医院、产品化、医院运行 dashboard |
| state-data | 3 | 4 | 通用状态和 collection 兼容访问 |
| public-health | 4 | 49 | 监测、直报、生命登记、交换和运营 |
| citizen-chronic | 7 | 34 | 居民、档案、授权、慢病、随访 |
| care-coordination | 10 | 32 | 挂号、转诊、护理、陪诊、协同订单 |
| clinical-specialties | 9 | 72 | 急救、用血、影像、体检、质量安全；operations command 为待移交兼容入口 |
| insurance-payment | 4 | 27 | 医保结算、支付、退款、凭证 |
| integration | 3 | 13 | HIS/EMR/LIS/PACS 网关、签名回调 |
| research | 2 | 5 | 科研数据集、申请、审计和成果 |
| shared | 12 | 25 | 组合查询、兼容体验和跨域工作台 |

静态扫描未发现重复的精确 method/path 组合；这不证明动态路由、语义重复或 handler 内分支没有冲突。

## 3. 认证与会话 API

- 服务端支持签名会话、HttpOnly Cookie、SameSite、CSRF token、SQLite/PostgreSQL 会话仓储和撤销。
- 浏览器通过 `/api/auth/context` 升级到服务端 Cookie 上下文；旧 bearer/local demo 状态仍保留在 `localStorage` 兼容路径。
- 外部身份支持 OIDC exchange/refresh/revoke；居民手机登录支持 SMS provider 和签名 delivery callback。
- 生产策略对 session secret、存储、保留期、外部 provider 和 demo 模式执行 fail-closed 检查。
- 页面级授权由 `access-control-policy.js` 与静态页面守卫执行；API 仍必须独立执行主体、角色、权限和资源范围验证。

## 4. 授权层次

| 层 | 实现 | 风险 |
|---|---|---|
| 身份 | 签名 token、Cookie、session store | 兼容 bearer/demo 路径扩大状态空间 |
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
| 对象存储 | 引用/摘要、签名访问 | 不得在仓库存真实凭据或原始敏感对象 |

## 6. 错误、幂等与审计

- router 未命中统一 404；存储冲突和 session store 不可用有专用错误转换。
- 健康/存储元数据的既有 `schemaVersion` 字段形状保持不变，值由 SQLite 注册表 head 派生并从错误的 11 修正为 14；未新增或删除 API 路径、角色、权限或审计动作。
- 静态未知/敏感路径统一 404；`GET/HEAD /data/public-demo.json` 返回合成脱敏数据，`/data/db.json`、源码、配置和仓库元数据不可发布。
- 多个领域具有 HMAC、nonce、时间窗、CAS、outbox 和 replay 记录。
- 错误格式仍由不同路由模块自行构造，存在 `{error}`、`{ok,code,message}` 等多种形态。
- 审计追加点分散在组合根、路由和领域服务；统一审计契约尚未完全落地。
- `GET /api/audit/verify` 继续返回 HTTP 200 的可解析业务结果，运行时与留存 CLI 共用 v2 严格验证器；合规报告和留存门禁按相同失败语义传播。
- `PUT /api/state` 保持原路径和成功形状，但审计数组成为服务端管理字段：省略时保留，提交时必须与当前值完全一致；乐观版本冲突仍优先返回 `409 STORAGE_CONFLICT`。
- `npm run api:authorization-matrix` 从模块化路由源码生成/校验 owner、身份、角色、范围、用途和九条高风险接口唯一性。
- 身份/SMS HTTP 路径保持不变；组合根已为短信发送生成随机 request ID，适配器现在拒绝缺失幂等 ID，OIDC refresh 返回的 ID token 必须通过 JWKS/claims 验证后才暴露脱敏 claims。

## 7. API 风险与缺失测试

- `API-001`：368+ 接口缺少一份机器生成、带 owner/角色/范围的完整目录。
- `API-002`：已建立 582 条受保护声明的静态 owner/role/scope/purpose 矩阵；运行时 role × permission × resource 允许/拒绝组合仍需继续扩展。
- `API-003`：错误响应契约不统一，调用方需要理解多个格式。
- `API-004`：`shared` 有 12 个路由段，容易成为跨域逻辑聚集点。
- `API-005`：已通过 Pages/Node 共用显式资源图和敏感路径拒绝矩阵缓解；后续新增页面资源必须同步更新清单并通过构建验证。
- `API-006`：浏览器 Cookie 与 legacy localStorage/bearer 双路径增加兼容和降级风险。
- `API-007`：外部接口的生产可用性、证书、密钥和回执只能由现场证据证明。

## 8. 临床五子域 API 归属

原临床路由源码中的 136 个去重 API 字面路径现有 135 个继续由 T06 机器门禁覆盖：急救 37、血液 28、影像 17、体检 7、质量安全 14、历史 operations command 32；`GET /api/operations/dashboard` 已成为 T02 `platform-governance-12` 的唯一源码归属。该计数包含参数模板和同一路径的不同源码表达，不替代精确 method/path 下限。dashboard 的 method/path、commission 角色、响应和等效路由顺序保持不变。

`GET /api/emergency/dashboard` 已通过兼容委托接入 `emergency-dashboard-query.v1`。允许角色仍为 commission、institution、citizen；未授权请求在读数据前停止；成功状态仍为 200，响应继续经过既有 `redactSensitiveResponse`，且血液协调投影只暴露 `consumer=emergency`。该只读接口没有新增幂等、写入或审计语义。

`GET /api/blood-system` 已通过兼容委托接入 `blood-dashboard-query.v1`。允许角色仍为 commission、institution；未授权请求在读数据前停止。commission 保留全域交易投影，institution 继续按 `orgCode`、目的机构和可见输血申请过滤；状态码仍为 200，既有接口不经过额外脱敏。本切片没有增加持久化、幂等或审计语义。

`GET /api/imaging-cloud` 已通过兼容委托接入 `imaging-dashboard-query.v1`。允许角色仍为 commission、institution、county、citizen；显式 `residentId` 继续通过 `canAccessResident`，拒绝时记录安全事件并返回净化后的 403。成功响应仍为 200，先执行既有角色脱敏，再递归删除凭据、签名 URL、物理路径和内部连接字段；带居民过滤的成功调阅仍持久化既有数据访问审计。

`GET /api/physical-exams` 已通过兼容委托接入 `physical-examination-dashboard-query.v1`。允许角色仍为 citizen、institution、commission；显式 `residentId` 继续按 `allowedResidentIdsForUser` 拒绝越权并记录安全事件。citizen 仍不接收联调、网关和专项分流明细，readiness 只暴露代码状态、质量和阻断数量；管理角色保留完整投影。成功响应继续在既有访问审计持久化之后执行最终脱敏。
