# ADR：生产身份与短信适配器信任边界

- 状态：Accepted
- 日期：2026-08-21
- Owner：T01（协议与身份语义）+ T00（组合根、环境与部署）

## Problem

主线已有 OIDC UserInfo/SMS 回调，但缺少 ID token 加密验签、claims 全约束、生产 SMS 凭据与安全重试合同。

## Options

1. 保持宽松 provider-specific 调用；2. 新建平行身份服务；3. 在现有协议 owner 内补 provider-neutral transport 与严格 trust boundary。

## Advantages / Disadvantages

方案 3 保持路由和 owner 稳定、可注入测试且默认拒绝；代价是适配器文件继续承载多个 provider-neutral 协议，并需现场映射供应商字段。

## Migration cost / Risk / Recommendation

迁移只增加环境变量和 fail-closed 校验；主要风险是旧部署未传随机 request ID 或凭据而被拒绝。推荐先在 rehearsal 验证 health/JWKS/SMS receipt，再按外部门禁切换。

## Decision

`production-adapters.js` 保持主线身份/SMS 协议 owner；T01 负责 OIDC/JWKS、claims、短信回执和脱敏契约，T00 只负责组合根传参、生产环境和发布门禁。

- ID token 只允许 RS256、PS256、ES256，经 discovery `jwks_uri` 唯一 `kid` 验签，并严格校验 `iss`、`aud`、多 audience 时的 `azp`、`sub`、`exp`、`nbf`、`iat` 与请求 `nonce`。
- 通用 HTTP transport 使用有界超时、最多五次重试和稳定安全错误；日志字段拒绝 token、secret、手机号、验证码、payload 和幂等键。
- 生产 SMS 必须显式选择受支持认证模式并满足凭据条件；发送重试必须复用组合根生成的随机 `clientRequestId`。
- 禁止从手机号、验证码、模板等低熵材料派生幂等键；缺少随机请求 ID 时 fail closed。
- 健康探针仅返回配置和连通性状态，不返回 endpoint、凭据或原始断言。

外部 provider 联调、真实证书/密钥、网络 allowlist 和现场签字仍是阻断项，`productionReady` 保持 false。
