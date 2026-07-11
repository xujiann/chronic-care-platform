# 生产身份与消息适配器

## MVP 范围

本模块把统一身份和居民短信验证码从演示契约推进为可配置的生产运行时适配层，覆盖 OIDC UserInfo 校验、受控本地账号绑定、短信网关发送、供应商受理回执、验证码随机生成与摘要存储。

## 运行接口

- `POST /api/auth/oidc/exchange`：使用上游 access token 调用 OIDC UserInfo。仅已绑定且启用的本地账号可获得平台会话；新外部身份返回待绑定状态，不自动提权或开户。
- `GET /api/auth/adapters`：卫健委角色查看身份与短信适配器配置状态、HTTPS 要求和现场阻断项，不返回密钥。
- `POST /api/auth/phone-code`：演示环境继续返回演示码；生产环境生成随机六位码，调用短信网关并返回脱敏手机号和供应商受理回执。
- `POST /api/auth/phone-login`：生产环境只校验已签发验证码的 HMAC-SHA256 摘要，不接受固定演示码。

## 配置契约

统一身份需要 `OIDC_ISSUER_URL`、`OIDC_CLIENT_ID`、`OIDC_CLIENT_SECRET`，可选 `OIDC_USERINFO_URL` 和 `IDENTITY_ADAPTER_TIMEOUT_MS`。短信需要 `SMS_GATEWAY_URL`、`SMS_TEMPLATE_ID`，可选 `SMS_GATEWAY_TOKEN`、`SMS_SENDER` 和 `SMS_GATEWAY_TIMEOUT_MS`。生产端点必须使用 HTTPS，真实密钥不得写入仓库。

## 安全控制

- 上游 access token 仅用于本次 UserInfo 请求，不写入日志、审计记录或响应。
- 生产验证码不以明文写入内存记录，只保存手机号、用户、有效期、请求号、受理回执和 keyed digest。
- 身份映射沿用机构、角色和门户白名单；外部声明不能直接创建可登录账号。
- 短信回执仅保留供应商消息号、受理状态、时间和非敏感代码。

## 生产边界

当前代码完成通用 HTTP JSON 短信适配和标准 OIDC UserInfo 流程。供应商专有签名、最终送达回调、短信退订与频控策略、政务身份注销/刷新回调、真实机构目录同步、现场联合测试回执及责任方签字仍属于生产接入工作。在这些证据归档前，本模块只能标记为“适配器基础就绪”，不能标记为正式生产就绪。

## 验证

```powershell
npm.cmd run identity:contract
npm.cmd test
npm.cmd run release:report
npm.cmd run deploy:check
```
