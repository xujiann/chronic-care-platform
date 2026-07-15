# 生产身份与消息适配器

## MVP 范围

本模块把统一身份和居民短信验证码从演示契约推进为可配置的生产运行时适配层，覆盖 OIDC UserInfo 校验、受控本地账号绑定、token 刷新、token 撤销与本地注销、SCIM 目录预览与安全停用、短信网关发送、供应商受理回执、验证码随机生成与摘要存储。

## 生产安全边界

- `NODE_ENV=production` 时禁用 `POST /api/auth/login` 本地口令入口，演示账号和固定口令仅保留给开发、测试与静态预览；生产登录必须走已配置的 OIDC 等外部身份链路。
- 生产启动要求 `SESSION_SECRETS` 或 `SESSION_SECRET` 至少包含 32 个字符，缺失、弱值或占位值会以 `PRODUCTION_SESSION_SECRET_INVALID` 拒绝启动。
- 浏览器在 API 认证失败或网络异常时失败关闭，不再回退到本地演示账号；只有 `file:` 等静态预览场景允许本地演示身份。
- 非市级监管角色按居民家庭、机构归属或医保/区县业务关系收敛居民数据；机构修改居民主索引时还必须匹配居民归属机构。
- 动态血液业务字段在进入 `innerHTML` 前统一编码，服务端下发 CSP、`nosniff`、同源嵌入、引用策略和生产 HSTS 响应头。
- 当前平台会话仍存放在单进程内存中，多实例生产部署前必须接入集中式会话或等价的跨节点撤销机制；本轮加固不把该外部依赖误报为已完成。

## 运行接口

- `POST /api/auth/oidc/exchange`：使用上游 access token 调用 OIDC UserInfo。仅已绑定且启用的本地账号可获得平台会话；新外部身份返回待绑定状态，不自动提权或开户。
- `POST /api/auth/oidc/refresh`：通过发现文档或显式 token endpoint 刷新上游 token，并重新执行 UserInfo 与本地启用状态校验后签发新平台会话。
- `POST /api/auth/oidc/revoke`：撤销上游 token 并删除当前本地会话；即使上游撤销失败，本地会话仍立即失效并返回部分失败结果。
- `GET /api/auth/adapters`：卫健委角色查看身份与短信适配器配置状态、HTTPS 要求和现场阻断项，不返回密钥。
- `GET /api/auth/identity-lifecycle`：卫健委角色查看刷新、撤销、目录和安全边界状态，不返回端点、token 或客户端密钥。
- `POST /api/auth/identity-directory/preview`：只读拉取 SCIM 用户目录，生成匹配、停用、待受控绑定和人工复核计划。
- `POST /api/auth/identity-directory/bind`：卫健委角色使用审计说明和精确确认短语，把已核对的活跃目录 subject 绑定到同名、同机构、启用的本地账号；禁止 subject 冲突和静默改绑。
- `POST /api/auth/identity-directory/apply`：使用操作说明和精确确认短语，仅执行已绑定本地账号的停用及会话撤销。
- `POST /api/auth/phone-code`：演示环境继续返回演示码；生产环境生成随机六位码，调用短信网关并返回脱敏手机号和供应商受理回执。
- `POST /api/auth/phone-login`：生产环境只校验已签发验证码的 HMAC-SHA256 摘要，不接受固定演示码。

## 配置契约

统一身份需要 `OIDC_ISSUER_URL`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`、`IDENTITY_DIRECTORY_URL` 和 `IDENTITY_DIRECTORY_TOKEN`；UserInfo、token 与 revocation endpoint 可通过发现文档解析，也可分别用 `OIDC_USERINFO_URL`、`OIDC_TOKEN_URL`、`OIDC_REVOCATION_URL` 显式指定。可选超时为 `IDENTITY_ADAPTER_TIMEOUT_MS`。短信需要 `SMS_GATEWAY_URL`、`SMS_TEMPLATE_ID`，可选 `SMS_GATEWAY_TOKEN`、`SMS_SENDER` 和 `SMS_GATEWAY_TIMEOUT_MS`。生产端点必须使用 HTTPS，真实密钥不得写入仓库。

## 安全控制

- 上游 access token 仅用于本次 UserInfo 请求，不写入日志、审计记录或响应。
- 刷新后必须重新校验 UserInfo 与本地账号启用状态；仅在供应商轮换 refresh token 时才把新 token 返回调用方。
- OIDC 登录和刷新只按已绑定的稳定 subject 匹配本地账号，不按同名用户名自动回退；同名未绑定身份始终拒绝登录并进入受控绑定复核。
- 目录同步不自动开户、不自动提权、不改变角色或机构，也不自动复活已停用账号；未绑定身份进入受控绑定队列。
- 受控绑定要求目录与本地用户名、机构一致，subject 未被其他账号占用；已绑定账号的 subject 改绑必须另行安全复核。
- 目录停用禁止停用当前操作员和最后一个卫健委账号，执行后撤销该账号的全部本地会话，并记录脱敏审计事件。
- 生产验证码不以明文写入内存记录，只保存手机号、用户、有效期、请求号、受理回执和 keyed digest。
- 身份映射沿用机构、角色和门户白名单；外部声明不能直接创建可登录账号。
- 短信回执仅保留供应商消息号、受理状态、时间和非敏感代码。

## 生产边界

当前代码完成通用 HTTP JSON 短信适配、标准 OIDC UserInfo、刷新、撤销、本地注销和 SCIM 目录安全停用流程。供应商专有签名、最终送达回调、短信退订与频控策略、政务身份供应商差异、真实机构目录的归属与映射验收、现场联合测试回执及责任方签字仍属于生产接入工作。在这些证据归档前，本模块只能标记为“身份生命周期代码就绪、现场接入待验收”，不能标记为正式生产就绪。

## 验证

```powershell
npm.cmd run identity:contract
npm.cmd test
npm.cmd run release:report
npm.cmd run deploy:check
```
