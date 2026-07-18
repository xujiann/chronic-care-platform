# 医院核心系统生产连接器

## MVP 范围

本模块复用现有 `integrationContracts`、`integrationGatewayEvents`、幂等、死信和人工对账能力，为 HIS、EMR、LIS、PACS 和号源系统增加平台主动调用的 HTTP JSON 运行时适配层。

## 运行接口

- `GET /api/integration/adapters`：卫健委和医疗机构角色查看五类连接器的配置、HTTPS、超时和重试状态；响应不包含地址、密钥或令牌。
- `POST /api/integration/dispatch`：按现有 `contractId` 校验必填字段，从服务器环境解析对应端点，签名并发送业务载荷。
- `POST /api/integration/events/:id/retry`：对医院出站死信执行真实重新调用，达到三次人工重试后转人工对账。
- `GET /api/integration/monitor`：继续使用现有监控汇总查看入站和出站事件、失败、死信及待对账数量。

## 协议控制

连接器发送 `X-Platform-Contract`、`X-Idempotency-Key`、`X-Request-Id`、`X-Timestamp`、`X-Signature-Algorithm` 和 `X-Signature`。签名原文由时间、请求号和稳定 JSON 载荷摘要组成，算法为 HMAC-SHA256。自动重试保持请求号、幂等键、时间和签名不变，避免重复生成业务单。

响应必须是 JSON，并至少返回 `receiptId`、`messageId` 或 `requestId` 之一。HTTP 429、5xx 和网络超时允许有限自动重试；4xx、明确拒绝回执及超过响应大小限制不会继续自动重试。供应商地址只能来自服务器环境配置，API 调用方不能提交任意目标 URL。

## 配置契约

五类端点分别使用 `HIS_ADAPTER_URL`、`EMR_ADAPTER_URL`、`LIS_ADAPTER_URL`、`PACS_ADAPTER_URL` 和 `APPOINTMENT_ADAPTER_URL`。签名密钥可使用共享 `HOSPITAL_ADAPTER_SECRET`，也可分别配置 `HIS_ADAPTER_SECRET` 等每域密钥。可选 `HOSPITAL_ADAPTER_TOKEN`、每域令牌、`HOSPITAL_ADAPTER_TIMEOUT_MS` 和 `HOSPITAL_ADAPTER_MAX_ATTEMPTS`。生产端点必须使用 HTTPS，真实凭据不得进入仓库、响应或审计明文。

## 事件与审计

成功调用保存脱敏供应商回执、尝试次数和 `provider-accepted` 对账状态。失败调用保存错误摘要并进入 `dead-letter`；人工重试会真实调用原域连接器并更新同一个事件。安全事件只记录域、契约、回执号、幂等键和处理结果。

## 生产边界

当前实现是通用 HTTP JSON + HMAC 适配器基础。各厂商专有协议、字段字典、电子签名或双向证书、VPN/专线、网络白名单、回调验签、LIS 项目编码、PACS 原文授权、号源锁定语义、性能容量测试以及医院和厂商签署的联合测试回执仍是正式生产阻断项。适配器基础通过不等于医院接口已正式验收。

## 验证

```powershell
npm.cmd run integration:readiness
npm.cmd test
npm.cmd run release:report
npm.cmd run deploy:check
```
