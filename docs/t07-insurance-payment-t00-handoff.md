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
| formal-grouping-operations | GET | `/api/disease-payment/formal-grouping/operations` | `buildFormalGroupingOperations` | insurance, commission, institution（同时校验机构类型） |
| formal-grouping-create | POST | `/api/disease-payment/formal-grouping/jobs` | `createFormalGroupingJob` | insurance, commission（同时校验机构类型） |
| formal-grouping-dispatch | POST | `/api/disease-payment/formal-grouping/jobs/:id/dispatch` | `dispatchFormalGroupingJob` | system / official_grouper_adapter |
| formal-grouping-receipt | POST | `/api/disease-payment/formal-grouping/jobs/:id/receipts` | `receiveTrustedFormalGroupingReceipt`（内部执行 `verifyTrustedGrouperCallback`） | system / official_grouper_adapter |
| formal-grouping-fail | POST | `/api/disease-payment/formal-grouping/jobs/:id/fail` | `failFormalGroupingJob` | system / official_grouper_adapter 或 platform |
| formal-grouping-retry | POST | `/api/disease-payment/formal-grouping/jobs/:id/retry` | `retryFormalGroupingJob` | insurance, commission（同时校验机构类型） |
| formal-grouping-reconcile | POST | `/api/disease-payment/formal-grouping/jobs/:id/reconcile` | `reconcileFormalGroupingDeadLetter` | insurance / insurance_center 或 insurance_bureau |
| refund-create | POST | `/api/online-payments/refunds` | `createRefundRequest` | institution, commission |
| refund-resubmit | POST | `/api/online-payments/refunds/:id/resubmit` | `resubmitRejectedRefund` | institution, commission |
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
6. 年度清算必须按领域状态机完成逐机构确认、机构争议定位与解决、汇总摘要、医保批准、基金财务入账和锁账；`confirm-institutions` 只能使用 `institutionConfirmationDigest` 生成的摘要。每次动作前还须通过 `verifyAnnualClearanceProjection`，不得由公共层直接写争议、确认、批准、入账或清算终态。
7. 月度结算出现差额时，必须登记摘要证据，由医院财务和医保经办使用不同身份签署相同的调整金额与处置摘要；驳回后须补充新摘要证据。`verifySettlementBatchProjection` 和 `verifyDifferenceCaseProjection` 失败后不得继续流转，公共层不得伪造双审数组或直接调用 `resolve-difference` 跳过复核。
8. 退款运营视图通过 `buildRefundOperations` 返回阶段 SLA 和脱敏异常队列。超时只用于告警和人工处置，不得由公共层据此伪造服务商失败回调、释放退款占用额度或绕过可信回调状态机。
9. 特例复议申请必须由医疗机构角色提交并携带原决定摘要及至少一项新证据摘要；复议评审仅允许医保角色调用。所有原审、复议和结算纳入动作前必须通过 `verifySpecialCaseStateProjection`；公共层不得替换原决定摘要、改写账本封存的驳回时间、复核数组或复议结论，放宽申请窗口，或以新专家编号复用原审评审账号。
10. 医保核心退回回调必须携带退回回执号、原因码、原因和补正要求摘要；补正重报必须引用当前退回周期并更换外部请求号和幂等键。公共层不得覆盖历史退回周期或直接把退回批次改为受理。
11. 拨付失败必须由可信医保核心回调触发，并携带失败回执、原因码、原因和失败证据摘要；重试必须引用当前失败周期并使用新的拨付申请号。三次失败后只能进入人工处置，不得由公共层继续自动重试或伪造拨付成功。
12. 已驳回退款补证重提必须提交当前驳回决定摘要、新的补证材料摘要、整改说明和新幂等键。领域层会保留原复核快照、重新检查当前可退余额并重置双领域复核；公共层不得覆盖原驳回历史、复用旧补证摘要或直接恢复批准状态。
13. 所有既有退款状态迁移，包括复核、补证重提、派发、可信回调同步、失败重试、取消、对账和结案，均须先通过退款事件哈希账本及状态投影交叉校验。收到 `REFUND_LEDGER_INVALID` 或 `REFUND_STATE_PROJECTION_INVALID` 后只能进入人工审计，不得重算、跳过历史事件，或直接修补当前状态、复核数组、补证历史和派发次数。
14. 月结、差额和年清事件必须保持相邻 `from/to` 语义连续，空事件账本不得承载任何状态迁移。状态投影不一致属于账务完整性事件，T00 只能记录告警并交由医保、医院财务和基金财务联合核查。
15. 特例单议事件同样必须保持相邻状态连续；当前状态、原审意见、复议材料摘要、复议意见、决定摘要和结算批次绑定必须能由事件重建。`SPECIAL_CASE_STATE_PROJECTION_INVALID` 不得映射为可重试业务错误。
16. 正式分组作业的幂等返回、派发、回执、失败、重试和死信重开前必须通过 `verifyFormalGroupingJobLedger`；完成态幂等返回还必须通过 `verifyFormalGroupingResultProjection`，死信重开还必须通过 `verifyFormalGroupingDeadLetter`。正式分组运行和支付测算账本必须与作业编号、关联号、方案版本、病例输入摘要及回执集合一一对应。完整性失败只能进入人工安全审计。公共运维路由必须使用 `buildFormalGroupingOperations` 的脱敏摘要，不得从领域状态直接返回 `caseSnapshots`、病例输入、适配器内部端点、错误详情或死信处置结论。
17. 正式回执和派发受理结果只能由 `system / official_grouper_adapter` 主体写入，且回执入口必须先执行 `verifyTrustedGrouperCallback` 的来源白名单、时间窗、防重放和传输层签名校验，再执行逐病例官方回执验签。人工 `insurance/commission` 会话不得直接提交 `accepted=true` 或正式回执正文；死信对账仅允许医保经办机构完成。
18. T00 部署前必须调用 `buildGrouperProductionConfiguration` 校验正式分组器 HTTPS 端点、凭据引用、回执签名证书指纹、回调密钥强度、来源白名单和时间窗。报告只能保存布尔检查及白名单/证书数量，不得输出端点、凭据引用、密钥或来源值。配置通过不能替代真实联调与现场证据。

## 生产证据交接

`insurance-payment-production-handoff.js` 将 23 个待接项和外部阻断项转换为摘要绑定、职责分离、可验真的证据台账。T00 接线完成后，应由 `integration-owner` 提交路由测试证据，再由不同主体的 `acceptance-reviewer`、`security-reviewer` 或 `finance-auditor` 核验。

每个交接项的职责、要求摘要、启停状态、流转状态、证据记录和核验记录均绑定到事件的 `projectionDigest`。系统同时校验哈希链、相邻 `from/to` 以及“创建→提交→核验/驳回”的语义顺序；直接改写 `required`、状态、证据摘要或核验人，或者重算哈希后跳过提交步骤，都会使 `ledgerValid=false`，后续提交和核验返回 `HANDOFF_LEDGER_INVALID`。证据包对该实现及专用测试文件一并做 SHA-256 摘要绑定；离线校验还会逐项重读固定清单中的当前文件，核对路径、字节数和摘要，不能用重新计算包摘要掩盖缺失、过期或被替换的工件。

证据签发、提交、核验及系统事件统一使用 UTC ISO-8601 时间。签发时间不得晚于提交时间，核验时间不得早于提交时间，任何事件不得早于同一交接项的前一事件；无效时间或倒序事件在状态修改前失败关闭，重新计算事件哈希也不能绕过时序检查。

每项交接要求必须使用独立证据和独立幂等键。证据摘要不得跨要求复用，驳回后不得用原摘要再次提交，提交和核验幂等键不得被其他项目或其他动作占用；汇总门禁同时检查交接项编号、证据摘要和动作幂等键的全局唯一性，防止用一份笼统材料批量关闭多个外部条件。

当前仍有 9 类外部生产条件，并展开为 20 项必须分别提交、分别核验的证据要求：

1. 国家或地方正式 DRG/DIP 分组器及正式回执：连通与双向认证、证书归属、可信回调、结果一致性、现场签字共5项。
2. 医保核心结算、清算和拨付接口：结算回调、拨付回调、账单对账、失败演练、联合现场签字共5项。
3. HIS、EMR、病案首页和医保结算清单全量数据源：字段映射、全量质量性能、隐私安全、医院现场签字共4项。
4. 商户、医保经办和证书机构生产凭据。
5. 回调字段映射、来源白名单和防重放联合测试。
6. 支付/医保对账单传输及日终对账验收。
7. 服务商字段字典和错误码映射签字。
8. 安全、隐私和密码应用评估。
9. 医院、医保经办和相关服务商现场签字验收。

任何本地测试、模拟回调或自签名证据都不能关闭这些阻断项。每项证据必须由其指定的 `security-reviewer`、`acceptance-reviewer` 或 `finance-auditor` 核验，不能用一份笼统“已联调”材料批量关闭。`productionReady` 必须保持 `false`，直至真实公共接线、可信外部访问和现场证据全部完成。

金融网关6项证据同样采用确定性职责映射：生产凭据、可信回调和安全评估由 `security-reviewer` 核验；账单传输及日终对账由 `finance-auditor` 核验；字段字典及错误码、现场联合签收由 `acceptance-reviewer` 核验。新增但尚未配置责任映射的外部要求会使 `externalEvidenceGoverned=false`，且交接账本失败关闭，不允许退化为任意审核角色。

## T00 集成后的验收

```powershell
node --test .\test\disease-payment*.test.js .\test\financial*.test.js .\test\insurance-payment*.test.js
node .\scripts\insurance-payment-acceptance.js
node .\scripts\insurance-payment-evidence-packet.js
node .\scripts\insurance-payment-acceptance.js --require-production
node .\scripts\insurance-payment-evidence-packet.js --require-production
```

前两条命令用于验证T07本地领域能力，当前应成功；后两条是发布流水线严格门禁，在公共接线和现场证据未齐备时必须以非零状态退出。不得用本地验收命令的成功退出替代生产门禁。

统一验收报告和证据包均输出 `productionGate`，包含稳定检查编号、布尔结果、明细及 `blockers` 数组。当前严格门禁应明确报告 `t00-public-wiring-complete`、`handoff-evidence-complete` 和 `live-site-acceptance-confirmed` 等未通过项，便于CI直接生成阻断清单。
