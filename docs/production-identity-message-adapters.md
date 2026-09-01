# 生产身份与消息适配器

## MVP 范围

本模块把统一身份和居民短信验证码从演示契约推进为可配置的生产运行时适配层，覆盖 OIDC UserInfo 校验、受控本地账号绑定、token 刷新、token 撤销与本地注销、SCIM 目录预览与安全停用、短信网关发送、供应商受理回执、验证码随机生成与摘要存储，以及 HMAC 最终送达回调、时间窗与重放防护、幂等乱序状态机和持久化送达台账。

## 生产安全边界

- `NODE_ENV=production` 时禁用 `POST /api/auth/login` 本地口令入口，演示账号和固定口令仅保留给开发、测试与静态预览；生产登录必须走已配置的 OIDC 等外部身份链路。
- 生产启动要求 `SESSION_SECRETS` 或 `SESSION_SECRET` 至少包含 32 个字符，缺失、弱值或占位值会以 `PRODUCTION_SESSION_SECRET_INVALID` 拒绝启动。
- 生产会话按拓扑使用 `SESSION_STORE=sqlite`（单主机）或 `SESSION_STORE=postgres`（多主机）；显式配置 `memory` 会以 `PRODUCTION_SESSION_STORE_INVALID` 拒绝启动。会话只持久化随机会话标识、脱敏用户快照、有效期和撤销审计，不保存签名令牌。
- 生产环境缺失或非法的会话保留期、清理周期会以 `PRODUCTION_SESSION_RETENTION_INVALID` 拒绝启动；撤销审计保留期不得短于普通过期会话保留期。
- 浏览器在 API 认证失败或网络异常时失败关闭，不再回退到本地演示账号；只有 `file:` 等静态预览场景允许本地演示身份。
- 非市级监管角色按居民家庭、机构归属或医保/区县业务关系收敛居民数据；机构修改居民主索引时还必须匹配居民归属机构。
- 动态血液业务字段在进入 `innerHTML` 前统一编码；服务端通过集中端口下发兼容 CSP、严格 Report-Only 目标、`nosniff`、同源嵌入、引用策略和生产 HSTS。兼容 CSP 仍允许 inline，不能表述为严格 CSP 已关闭。
- SQLite 会话可跨进程读取，并在共享同一 `DATA_DIR` 的实例间同步注销、账号停用和撤销审计；进程重启不会使有效会话丢失。多主机集中式会话使用 PostgreSQL 中央会话表：请求先装载中央状态再进入现有角色守卫，签发、注销和目录停用在响应前完成中央写入；数据库不可用时返回 `SESSION_STORE_UNAVAILABLE` 并失败关闭。
- `SESSION_TOPOLOGY=multi-host` 强制要求 `SESSION_STORE=postgres`、有效 `DATABASE_URL` 和显式的生产 `POSTGRES_SSL_MODE=verify-full`；中央表由 PostgreSQL 迁移包创建，应用启动只校验表结构，不以运行账号执行 DDL。依赖就绪检查使用轻量 PostgreSQL 探针，中央会话不可用时 `/api/health` 返回 503 且不暴露数据库错误；无依赖的 `/api/live` 仍用于进程存活判定。
- OTP、验证码发送/登录限流和失败锁定统一进入共享认证安全状态仓储；单主机 SQLite 复用 `state_collections` 的注册迁移基线和 `BEGIN IMMEDIATE`，不在运行时建表，多实例生产强制使用 PostgreSQL `${POSTGRES_SCHEMA}.auth_security_state` 与长期共享连接池。持久化键使用服务端 HMAC，不保存手机号、用户名或验证码明文；目录停用会同时撤销会话和该主体的 OTP、限流与锁定状态。
- 过期会话与撤销会话分别按 `SESSION_EXPIRED_RETENTION_DAYS`、`SESSION_REVOKED_RETENTION_DAYS` 保留，服务启动及 `SESSION_CLEANUP_INTERVAL_MS` 周期执行幂等清理；最近结果、删除分类和失败状态通过身份生命周期接口暴露。

## 运行接口

- `POST /api/auth/oidc/exchange`：使用上游 access token 调用 OIDC UserInfo。仅已绑定且启用的本地账号可获得平台会话；新外部身份返回待绑定状态，不自动提权或开户。
- `POST /api/auth/oidc/refresh`：通过发现文档或显式 token endpoint 刷新上游 token，并重新执行 UserInfo 与本地启用状态校验后签发新平台会话。
- `POST /api/auth/oidc/revoke`：撤销上游 token 并持久化当前本地会话的撤销时间、原因和操作人；即使上游撤销失败，本地会话仍立即失效并返回部分失败结果。
- `GET /api/auth/adapters`：卫健委角色查看身份与短信适配器配置状态、HTTPS 要求和现场阻断项，不返回密钥。
- `GET /api/auth/identity-lifecycle`：卫健委角色查看刷新、撤销、目录和会话存储状态，不返回端点、token、客户端密钥或会话标识。
- `POST /api/auth/sessions/cleanup`：卫健委角色使用精确确认短语立即执行会话保留清理，并形成安全审计事件；不接受调用方覆盖服务端保留策略。
- `POST /api/auth/identity-directory/preview`：只读拉取 SCIM 用户目录，生成匹配、停用、待受控绑定和人工复核计划。
- `POST /api/auth/identity-directory/bind`：卫健委角色使用审计说明和精确确认短语，把已核对的活跃目录 subject 绑定到同名、同机构、启用的本地账号；禁止 subject 冲突和静默改绑。
- `POST /api/auth/identity-directory/apply`：使用操作说明和精确确认短语，仅执行已绑定本地账号的停用及会话撤销。
- `POST /api/auth/phone-code`：演示环境继续返回演示码；生产环境生成随机六位码，调用短信网关并返回脱敏手机号和供应商受理回执。
- `POST /api/auth/phone-login`：生产环境只校验已签发验证码的 HMAC-SHA256 摘要，不接受固定演示码。
- `POST /api/auth/sms-delivery-callback`：供应商使用 `X-SMS-Timestamp`、`X-SMS-Nonce`、`X-SMS-Signature` 提交最终送达事件。服务端先完成回调验签、时间窗和 nonce 重放校验，再执行幂等、乱序和终态保护并持久化结果。
- `GET /api/auth/sms-deliveries`：卫健委角色查看脱敏送达台账、待送达、已送达、失败、回调事件和被忽略的乱序或冲突事件；不返回回调签名、nonce 摘要、验证码或密钥。

## 配置契约

统一身份需要 `OIDC_ISSUER_URL`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`IDENTITY_DIRECTORY_URL` 和 `IDENTITY_DIRECTORY_TOKEN`；UserInfo、token 与 revocation endpoint 可通过发现文档解析，也可分别用 `OIDC_USERINFO_URL`、`OIDC_TOKEN_URL`、`OIDC_REVOCATION_URL` 显式指定。`OIDC_CLOCK_SKEW_SECONDS` 控制最多 300 秒的 ID token 时间偏差。短信需要 `SMS_GATEWAY_URL`、`SMS_TEMPLATE_ID`、`SMS_GATEWAY_AUTH_MODE=bearer`、`SMS_GATEWAY_TOKEN` 和不少于 32 位的 `SMS_DELIVERY_CALLBACK_SECRET`；当前生产 transport 只实现 bearer，`none` 仅限非生产，mTLS 在证书 transport 实现与验收前保持 fail closed。可配置健康 endpoint、最多五次有界重试和超时。生产端点必须使用 HTTPS，真实密钥不得写入仓库。

共享认证状态使用 `AUTH_SECURITY_STATE_STORE=sqlite|postgres`；生产 `INSTANCE_COUNT>1` 或多主机拓扑只能选择 `postgres`，并要求 `DATABASE_URL`、`POSTGRES_SCHEMA` 与 `POSTGRES_SSL_MODE=verify-full`。`AUTH_SECURITY_STATE_KEY_SECRET` 建议使用独立的 32 位以上托管密钥，未配置时沿用当前会话签名主密钥。

## 安全控制

- 上游 access token 仅用于本次 UserInfo 请求，不写入日志、审计记录或响应。
- ID token 仅接受 RS256/PS256/ES256，必须经 discovery JWKS 唯一 `kid` 验签并校验 issuer、audience/authorized party、subject、时效和 nonce。
- 刷新后必须重新校验 UserInfo 与本地账号启用状态；仅在供应商轮换 refresh token 时才把新 token 返回调用方。
- OIDC 登录和刷新只按已绑定的稳定 subject 匹配本地账号，不按同名用户名自动回退；同名未绑定身份始终拒绝登录并进入受控绑定复核。
- 目录同步不自动开户、不自动提权、不改变角色或机构，也不自动复活已停用账号；未绑定身份进入受控绑定队列。
- 受控绑定要求目录与本地用户名、机构一致，subject 未被其他账号占用；已绑定账号的 subject 改绑必须另行安全复核。
- 目录停用禁止停用当前操作员和最后一个卫健委账号，执行后撤销该账号的全部本地会话，并记录脱敏审计事件。
- 生产验证码只在共享仓储保存 keyed digest、TTL 和剩余尝试次数，原子验证成功后立即消费；固定演示码也必须先签发再验证。发送按“限流→原子签发→供应商发送”执行，供应商拒绝会只撤销本次 OTP，不清登录锁和限流；共享状态写失败时不会调用供应商。
- 短信发送的幂等键只能使用组合根生成并传入的稳定随机请求 ID；缺失时拒绝发送，禁止用手机号、验证码和模板的可枚举摘要替代。
- 身份映射沿用机构、角色和门户白名单；外部声明不能直接创建可登录账号。
- 短信受理回执持久化供应商消息号、客户端请求号、脱敏手机号、用途、受理时间和非敏感代码，不保存验证码。
- 短信同步受理回执缺省 `status` 时为兼容既有供应商按 `accepted` 处理；显式状态仅允许 `accepted`、`queued`、`sent`、`delivered` 建立有效受理证据，失败或未知状态必须拒绝并撤销本次签发的验证码。
- 最终送达回调使用 HMAC-SHA256 回调验签，默认允许 300 秒时钟偏差；过期时间戳、签名不匹配、非法 nonce 和 nonce 重放全部失败关闭。
- 重复事件号返回幂等结果；乱序回调、状态回退和终态冲突保留事件证据但不覆盖已确认状态，避免迟到失败回调改写已送达结果。
- 回调台账最多保留 500 条消息、每条 20 个事件；卫健委查询结果不暴露 nonce 摘要、签名、密钥、验证码或完整手机号。

## 生产边界

当前代码完成通用 HTTP JSON 短信适配、通用 HMAC 最终送达回调、标准 OIDC UserInfo、刷新、撤销、本地注销和 SCIM 目录安全停用流程。供应商专有字段与签名差异、真实回调密钥托管、网络白名单、短信退订与频控策略、政务身份供应商差异、真实机构目录的归属与映射验收、现场联合测试回执及责任方签字仍属于生产接入工作。在这些证据归档前，本模块只能标记为“身份与短信回调代码就绪、现场接入待验收”，不能标记为正式生产就绪。

## 验证

```powershell
npm.cmd run identity:contract
npm.cmd test
npm.cmd run release:report
npm.cmd run deploy:check
```
