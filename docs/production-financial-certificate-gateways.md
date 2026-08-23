# 支付、医保与电子证照生产网关

## 已实现范围

- `GET /api/financial-gateways`：按角色返回 PAYMENT、INSURANCE、CERTIFICATE 三类网关配置状态，不暴露地址、令牌和签名密钥。
- `POST /api/financial-gateways/dispatch`：统一执行支付、医保和电子证照出站请求，支持 14 个受控操作。
- `POST /api/financial-gateways/callbacks/:type`：接收 PAYMENT、INSURANCE、CERTIFICATE 分域 HMAC 回调，校验时间窗、nonce、金额、业务日期和供应商回执号。
- `GET /api/financial-gateways/operations`：委办查看全域回调与对账，医保角色只查看 INSURANCE 域；不返回居民标识、请求正文、密钥或 nonce 摘要。
- `POST /api/financial-gateways/reconciliation-runs`：登记账单计数、整数分金额和 SHA-256 摘要，按支付/退费、医保结算/撤销、证照签发/撤销等状态变更操作生成本地/供应商日终差异；查询与预检不计入账单，不上传账单明细。
- 出站报文采用 HMAC-SHA256、请求 ID、时间戳和幂等键；暂时性故障按上限重试，最终失败进入统一死信与人工对账链路。
- 入站回调采用独立密钥，支持事件幂等、nonce 防重放、乱序和终态保护、成功后合法冲正、旧回执隔离及金额不一致转人工对账。
- 金额统一使用整数分；证照正文只允许传 SHA-256 摘要和受控引用，不允许传身份证号、手机号、访问令牌、私钥或证照 Base64 原文。
- 支付交易契约 `payment-transaction-v1` 已纳入接口字段映射；医保和电子证照继续复用 `insurance-settlement-v1`、`certificate-sync-v1`。
- 在线退费领域闭环已实现：校验原支付成功回执和可退余额，申请人与复核人分离，必须分别取得业务复核和财务复核意见后才能派发；驳回后以决定摘要绑定新的补证摘要重提，并重新检查余额、重置双领域复核；失败与成功后机构冲正均保持额度占用，人工确认后在原申请上重试。
- 退费成功必须匹配支付域日终对账批次并关联财务凭证后结案；所有既有退款状态迁移先校验事件哈希链，并由事件重建当前状态、复核、补证历史和派发次数完成投影交叉验真。操作中心只输出脱敏订单引用、状态、金额、复核轮次、补证次数、复核数、尝试数、账本及投影验真结果，不返回原支付交易号。

## 运行配置

共享配置：

```text
FINANCIAL_GATEWAY_SECRET
FINANCIAL_GATEWAY_TOKEN
FINANCIAL_GATEWAY_TIMEOUT_MS
FINANCIAL_GATEWAY_MAX_ATTEMPTS
FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS
FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS_PER_SCOPE
FINANCIAL_CALLBACK_LEDGER_MAX_EVENTS_PER_REQUEST
FINANCIAL_CALLBACK_SECRET
FINANCIAL_CALLBACK_MAX_SKEW_SECONDS
```

分域配置：

```text
PAYMENT_GATEWAY_URL / PAYMENT_GATEWAY_SECRET / PAYMENT_GATEWAY_TOKEN
INSURANCE_GATEWAY_URL / INSURANCE_GATEWAY_SECRET / INSURANCE_GATEWAY_TOKEN
CERTIFICATE_GATEWAY_URL / CERTIFICATE_GATEWAY_SECRET / CERTIFICATE_GATEWAY_TOKEN
PAYMENT_CALLBACK_SECRET / INSURANCE_CALLBACK_SECRET / CERTIFICATE_CALLBACK_SECRET
```

生产环境必须使用 HTTPS，出站签名密钥与回调验签密钥必须分离并由密钥管理系统注入，不得写入代码、数据快照或发布报告。共享 `FINANCIAL_CALLBACK_SECRET` 可由分域回调密钥覆盖，生产回调时间窗限制为 60 至 900 秒。`FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS` 默认 100000、允许 1000 至 1000000；`FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS_PER_SCOPE` 默认 10000，以机构编码优先、否则按调用主体隔离，防止单一授权主体耗尽全局账本。`FINANCIAL_CALLBACK_LEDGER_MAX_EVENTS_PER_REQUEST` 默认 1000、允许 30 至 10000，callback evidence 只追加、不滑动淘汰，达到单请求上限稳定返回 507 并转人工对账。运行中心与 Prometheus 暴露全局/分 scope/callback 已用量、上限和利用率，80% 触发 warning、95% 触发 critical。达到上限后新金融 reservation 失败关闭，禁止静默淘汰旧幂等凭证；扩容或归档必须通过迁移和审批，并在上线前配置值班告警接收方。

## 回调与对账安全

- 签名输入绑定原始业务 JSON 的稳定摘要、回调时间戳和 nonce；签名比较采用定时安全比较。
- 验签器为单次持久化签发绑定目标 gateway event 的进程内证明；中央写守卫复验该证明并拒绝 callback event/nonce 跨账项重放。证明不入库、不写日志、不返回客户端，进程重启后不可复用。
- 回调只持久化白名单字段，供应商结算引用仅保存 SHA-256 摘要。
- 成功 dispatch/retry finalize 必须携带与 gateway type、operation、status 一致的供应商回执和 dispatchedAt；失败 finalize 必须同时携带稳定失败码、失败时间、死信原因和死信标记，禁止无证据写入成功或失败账项。
- 同一事件号内容变化、nonce 重用、未来时间、金额不一致、旧回执和乱序终态冲突均不会覆盖当前状态。
- 摘要级日终对账只证明本地计算与登记摘要的差异处理链可运行，`productionEvidence` 固定为 `false`。

## 生产边界

适配器基础通过不等于支付、医保或电子证照已经正式验收。正式上线前仍须完成：

1. 支付机构商户号、医保机构编码、电子证照授权和最小权限凭据开通。
2. 通用签名回调代码就绪；仍须完成支付结果、退费结果、医保结算结果和证照状态的供应商专有字段/签名映射、来源网络白名单和真实回执验收。
3. 摘要级日终对账代码就绪；仍须完成支付和医保账单传输、差错补偿、长款短款、冲正及人工处理时限验收。
4. 金额、医保目录、机构、证照类型和状态码字典逐字段签字。
5. 等保、密评、隐私影响评估、渗透测试及现场联合测试回执归档。
6. `CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF` 由业务、医保、财务、安全和项目负责人共同签署。

公共退费路由（包括驳回补证重提）及 PAYMENT 回调后的可信同步钩子由T00按 `insurance-payment-operating-model.js` 接入；在该接线完成前，退费领域模块可验收但不能标记为公共API已上线。

因此适配器基础通过不等于支付、医保或电子证照已经正式验收；当前只能标记为“签名回调代码就绪、摘要级日终对账可运行、现场联合测试回执待归档”。

## 验证命令

```powershell
npm.cmd run financial-gateway:readiness
npm.cmd run env:check:production
npm.cmd run release:report
npm.cmd run deploy:check
```
