# 支付、医保与电子证照生产网关

## 已实现范围

- `GET /api/financial-gateways`：按角色返回 PAYMENT、INSURANCE、CERTIFICATE 三类网关配置状态，不暴露地址、令牌和签名密钥。
- `POST /api/financial-gateways/dispatch`：统一执行支付、医保和电子证照出站请求，支持 14 个受控操作。
- 出站报文采用 HMAC-SHA256、请求 ID、时间戳和幂等键；暂时性故障按上限重试，最终失败进入统一死信与人工对账链路。
- 金额统一使用整数分；证照正文只允许传 SHA-256 摘要和受控引用，不允许传身份证号、手机号、访问令牌、私钥或证照 Base64 原文。
- 支付交易契约 `payment-transaction-v1` 已纳入接口字段映射；医保和电子证照继续复用 `insurance-settlement-v1`、`certificate-sync-v1`。

## 运行配置

共享配置：

```text
FINANCIAL_GATEWAY_SECRET
FINANCIAL_GATEWAY_TOKEN
FINANCIAL_GATEWAY_TIMEOUT_MS
FINANCIAL_GATEWAY_MAX_ATTEMPTS
```

分域配置：

```text
PAYMENT_GATEWAY_URL / PAYMENT_GATEWAY_SECRET / PAYMENT_GATEWAY_TOKEN
INSURANCE_GATEWAY_URL / INSURANCE_GATEWAY_SECRET / INSURANCE_GATEWAY_TOKEN
CERTIFICATE_GATEWAY_URL / CERTIFICATE_GATEWAY_SECRET / CERTIFICATE_GATEWAY_TOKEN
```

生产环境必须使用 HTTPS，签名密钥必须由密钥管理系统注入，不得写入代码、数据快照或发布报告。

## 生产边界

适配器基础通过不等于支付、医保或电子证照已经正式验收。正式上线前仍须完成：

1. 支付机构商户号、医保机构编码、电子证照授权和最小权限凭据开通。
2. 支付结果、退费结果、医保结算结果和证照状态回调的来源校验、验签、防重放与乱序处理。
3. 支付和医保日终对账、差错补偿、长款短款、冲正及人工处理时限验收。
4. 金额、医保目录、机构、证照类型和状态码字典逐字段签字。
5. 等保、密评、隐私影响评估、渗透测试及现场联合测试回执归档。
6. `CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF` 由业务、医保、财务、安全和项目负责人共同签署。

## 验证命令

```powershell
npm.cmd run financial-gateway:readiness
npm.cmd run env:check:production
npm.cmd run release:report
npm.cmd run deploy:check
```
