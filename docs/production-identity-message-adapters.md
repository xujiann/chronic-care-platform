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
- 动态血液业务字段在进入 `innerHTML` 前统一编码，服务端下发 CSP、`nosniff`、同源嵌入、引用策略和生产 HSTS 响应头。
- SQLite 会话可跨进程读取，并在共享同一 `DATA_DIR` 的实例间同步注销、账号停用和撤销审计；进程重启不会使有效会话丢失。多主机集中式会话使用 PostgreSQL 中央会话表：请求先装载中央状态再进入现有角色守卫，签发、注销和目录停用在响应前完成中央写入；数据库不可用时返回 `SESSION_STORE_UNAVAILABLE` 并失败关闭。
- `SESSION_TOPOLOGY=multi-host` 强制要求 `SESSION_STORE=postgres`、有效 `DATABASE_URL` 和显式的生产 `POSTGRES_SSL_MODE=verify-full`；中央表由 PostgreSQL 迁移包创建，应用启动只校验表结构，不以运行账号执行 DDL。依赖就绪检查使用轻量 PostgreSQL 探针，中央会话不可用时 `/api/health` 返回 503 且不暴露数据库错误；无依赖的 `/api/live` 仍用于进程存活判定。
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

统一身份需要 `OIDC_ISSUER_URL`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`IDENTITY_DIRECTORY_URL` 和 `IDENTITY_DIRECTORY_TOKEN`；UserInfo、token 与 revocation endpoint 可通过发现文档解析，也可分别用 `OIDC_USERINFO_URL`、`OIDC_TOKEN_URL`、`OIDC_REVOCATION_URL` 显式指定。可选超时为 `IDENTITY_ADAPTER_TIMEOUT_MS`。短信需要 `SMS_GATEWAY_URL`、`SMS_TEMPLATE_ID` 和不少于 32 位的 `SMS_DELIVERY_CALLBACK_SECRET`，可选 `SMS_GATEWAY_TOKEN`、`SMS_SENDER`、`SMS_GATEWAY_TIMEOUT_MS` 和 `SMS_DELIVERY_CALLBACK_MAX_SKEW_SECONDS`。生产端点必须使用 HTTPS，真实密钥不得写入仓库。

## 安全控制

- 上游 access token 仅用于本次 UserInfo 请求，不写入日志、审计记录或响应。
- 刷新后必须重新校验 UserInfo 与本地账号启用状态；仅在供应商轮换 refresh token 时才把新 token 返回调用方。
- OIDC 登录和刷新只按已绑定的稳定 subject 匹配本地账号，不按同名用户名自动回退；同名未绑定身份始终拒绝登录并进入受控绑定复核。
- 目录同步不自动开户、不自动提权、不改变角色或机构，也不自动复活已停用账号；未绑定身份进入受控绑定队列。
- 受控绑定要求目录与本地用户名、机构一致，subject 未被其他账号占用；已绑定账号的 subject 改绑必须另行安全复核。
- 目录停用禁止停用当前操作员和最后一个卫健委账号，执行后撤销该账号的全部本地会话，并记录脱敏审计事件。
- 生产验证码不以明文写入内存记录，只保存手机号、用户、有效期、请求号、受理回执和 keyed digest。
- 身份映射沿用机构、角色和门户白名单；外部声明不能直接创建可登录账号。
- 短信受理回执持久化供应商消息号、客户端请求号、脱敏手机号、用途、受理时间和非敏感代码，不保存验证码。
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
