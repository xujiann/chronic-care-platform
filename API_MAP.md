# API MAP — 主线接口地图

> 快照：`main@b1e4898`。静态分析识别的 368 条精确路由是下限；动态 ID、prefix 和外部回调变体需以运行时路由测试为准。

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
| platform-governance | 11 | 72 | 生产控制、迁移、证据、数智医院、产品化 |
| state-data | 3 | 4 | 通用状态和 collection 兼容访问 |
| public-health | 4 | 49 | 监测、直报、生命登记、交换和运营 |
| citizen-chronic | 7 | 34 | 居民、档案、授权、慢病、随访 |
| care-coordination | 10 | 32 | 挂号、转诊、护理、陪诊、协同订单 |
| clinical-specialties | 10 | 73 | 急救、用血、影像、体检、质量安全 |
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
| 页面 | static page guard + access control policy | 只保护 HTML，不保护非 HTML 资产发布范围 |
| 外部回调 | HMAC、nonce、时间窗、幂等键 | 密钥和现场配置依赖外部证据 |
| 审计 | securityEvents/dataAccessLogs/专用 PostgreSQL | 链断裂语义当前可诊断但不失败 |

## 5. 外部 API

| 系统 | 协议/模式 | 边界 |
|---|---|---|
| HIS / EMR / LIS / PACS | HTTPS、FHIR R4、DICOMweb、签名事件 | T08 契约，真实联调仍是外部阻断项 |
| OIDC 身份源 | issuer/userinfo/token/revoke | T01，生产必须真实 provider 与绑定目录 |
| SMS 网关 | HTTPS + token + 签名回执 | T01，OTP/失败状态仍有进程内部分 |
| PostgreSQL | TLS verify-full、outbox/reconcile | 迁移期禁止请求路径双写 |
| Orthanc / OHIF / HAPI FHIR | Solution A Compose | 专科集成演示与受控部署 |
| 对象存储 | 引用/摘要、签名访问 | 不得在仓库存真实凭据或原始敏感对象 |

## 6. 错误、幂等与审计

- router 未命中统一 404；存储冲突和 session store 不可用有专用错误转换。
- 多个领域具有 HMAC、nonce、时间窗、CAS、outbox 和 replay 记录。
- 错误格式仍由不同路由模块自行构造，存在 `{error}`、`{ok,code,message}` 等多种形态。
- 审计追加点分散在组合根、路由和领域服务；统一审计契约尚未完全落地。

## 7. API 风险与缺失测试

- `API-001`：368+ 接口缺少一份机器生成、带 owner/角色/范围的完整目录。
- `API-002`：授权和数据范围规则分散，缺少全量 role × permission × resource 矩阵测试。
- `API-003`：错误响应契约不统一，调用方需要理解多个格式。
- `API-004`：`shared` 有 12 个路由段，容易成为跨域逻辑聚集点。
- `API-005`：静态非 HTML 资产不进入页面授权，仓库文件可能绕过 API 安全边界。
- `API-006`：浏览器 Cookie 与 legacy localStorage/bearer 双路径增加兼容和降级风险。
- `API-007`：外部接口的生产可用性、证书、密钥和回执只能由现场证据证明。
