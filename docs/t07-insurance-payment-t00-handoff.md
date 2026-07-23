# T07 医保支付与按病种付费：T00 公共接入交接

## 边界

本文件是 T07 领域实现向 T00 公共服务集成的唯一接线清单。T07 候选分支不修改以下 T00 所属文件：

- `server.js`
- `portal.css`
- `package.json`
- `README.md`
- `scripts/release-report.js`

T00 负责公共路由、统一认证鉴权、请求体与错误响应映射、状态持久化、可信回调入口、发布脚本和门户样式。T07 负责本文列出的领域函数、状态机、摘要契约、事件账本及专项测试。不得使用本地模拟分组结果代替正式医保分组或基金结算依据。

## 公共路由与内部回调

下表由 `insurance-payment-operating-model.js` 的 `T00_ROUTE_CONTRACTS` 生成语义约束；若二者不一致，以代码契约和专项测试为准。

| ID | 方法 | 路径或挂钩点 | T07 领域函数 | 允许角色 |
|---|---|---|---|---|
| refund-create | POST | `/api/online-payments/refunds` | `createRefundRequest` | institution, commission |
| refund-review | POST | `/api/online-payments/refunds/:id/reviews` | `reviewRefundRequest` | institution, commission |
| refund-dispatch | POST | `/api/online-payments/refunds/:id/dispatch` | `prepareRefundDispatch` → `dispatchFinancialRequest` → `recordRefundDispatch` | commission |
| refund-retry | POST | `/api/online-payments/refunds/:id/retry` | `retryRefund` | commission |
| refund-cancel | POST | `/api/online-payments/refunds/:id/cancel` | `cancelRefund` | institution, commission |
| refund-reconcile | POST | `/api/online-payments/refunds/:id/reconcile` | `reconcileRefund` | commission |
| refund-close | POST | `/api/online-payments/refunds/:id/close` | `closeRefund` | commission |
| refund-callback-hook | INTERNAL | PAYMENT 回调完成可信校验并入账后 | `applyFinancialCallback` → `syncRefundFromFinancialCallback` | system |
| special-case-reselect | POST | `/api/disease-payment/special-cases/:id/expert-reselection` | `reselectSpecialCaseExpert` | insurance |
| special-case-disclosure | GET | `/api/disease-payment/special-cases/disclosure` | `buildSpecialCaseDisclosure` | insurance, commission, institution |
| special-case-appeal-create | POST | `/api/disease-payment/special-cases/:id/appeals` | `createSpecialCaseAppeal` | institution |
| special-case-appeal-review | POST | `/api/disease-payment/special-cases/:id/appeals/review` | `reviewSpecialCaseAppeal` | insurance |
| settlement-core-callback | INTERNAL | INSURANCE 回调完成可信校验并入账后 | `applyInsuranceCoreSettlementCallback` | system |
| annual-clearance-create | POST | `/api/disease-payment/annual-clearances` | `createAnnualClearance` | insurance |
| annual-clearance-action | POST | `/api/disease-payment/annual-clearances/:id/actions` | `applyAnnualClearanceAction` | insurance, institution, commission |

接线时必须保留以下控制：

1. 先执行公共层认证和角色校验，再调用 T07 领域函数；不得通过路由参数覆盖登录主体。
2. PAYMENT/INSURANCE 回调必须先通过金融网关签名、时间窗、事件幂等、金额和摘要校验，再触发领域同步函数。
3. 领域函数完成后原子持久化状态与事件账本；持久化失败不得返回业务成功。
4. 退款派发使用同一请求身份完成准备、网关调用和回执登记，不得绕过余额占用和双领域复核。
5. 特例公示只能返回聚合脱敏结果，不得暴露病例、患者、证据原文或专家身份。
6. 年度清算必须按领域状态机完成逐机构确认、机构争议定位与解决、汇总摘要、医保批准、基金财务入账和锁账；`confirm-institutions` 只能使用 `institutionConfirmationDigest` 生成的摘要，不得由公共层直接写确认或清算终态。
7. 月度结算出现差额时，必须登记摘要证据，由医院财务和医保经办使用不同身份签署相同的调整金额与处置摘要；驳回后须补充新摘要证据，公共层不得直接调用 `resolve-difference` 跳过复核。
8. 退款运营视图通过 `buildRefundOperations` 返回阶段 SLA 和脱敏异常队列。超时只用于告警和人工处置，不得由公共层据此伪造服务商失败回调、释放退款占用额度或绕过可信回调状态机。
9. 特例复议申请必须由医疗机构角色提交并携带原决定摘要及至少一项新证据摘要；复议评审仅允许医保角色调用。公共层不得替换原决定摘要、改写账本封存的驳回时间、放宽申请窗口，或以新专家编号复用原审评审账号。

## 生产证据交接

`insurance-payment-production-handoff.js` 将 13 个待接项和外部阻断项转换为摘要绑定、职责分离、可验真的证据台账。T00 接线完成后，应由 `integration-owner` 提交路由测试证据，再由不同主体的 `acceptance-reviewer`、`security-reviewer` 或 `finance-auditor` 核验。

当前仍有 9 项外部生产条件：

1. 国家或地方正式 DRG/DIP 分组器及正式回执。
2. 医保核心结算、清算和拨付接口。
3. HIS、EMR、病案首页和医保结算清单全量数据源。
4. 商户、医保经办和证书机构生产凭据。
5. 回调字段映射、来源白名单和防重放联合测试。
6. 支付/医保对账单传输及日终对账验收。
7. 服务商字段字典和错误码映射签字。
8. 安全、隐私和密码应用评估。
9. 医院、医保经办和相关服务商现场签字验收。

任何本地测试、模拟回调或自签名证据都不能关闭这些阻断项。`productionReady` 必须保持 `false`，直至真实公共接线、可信外部访问和现场证据全部完成。

## T00 集成后的验收

```powershell
node --test .\test\disease-payment*.test.js .\test\financial*.test.js .\test\insurance-payment*.test.js
node .\scripts\insurance-payment-acceptance.js
node .\scripts\insurance-payment-evidence-packet.js
```

预期 T07 六条业务链全部通过；在外部证据未齐备时，证据包仍必须输出 `productionReady=false`。
