# 公共卫生外部端点探测活动与连续性

## 目标

单条端点探测回执只能证明某一领域在一个时间点的连接结果。若直接把不同时间、不同策略下的八条回执拼接，可能出现“每条都曾成功，但八领域从未在同一活动窗口内同时健康”的误判。

`public-health-external-endpoint-probe-campaign-service.js` 将八领域同批探测结果封装为服务端签名活动，并要求多个新鲜、不重叠、间隔受控的活动才能得到 `continuousConnectivityReady=true`。

连续连通性仍不等于正式上线，所有活动、登记表和最终就绪报告继续保持 `productionReady=false`。

## 活动签名载荷

活动使用 `public-health-external-endpoint-probe-campaign/v2`，签名完整绑定：

- `campaignId`、`status=completed`；
- 前一活动完整签名证明的 `previousCampaignDigest`；首个活动为空；
- 八个领域各自的 `laneId`、`adapterId`、活动契约和 receiptId；
- 规范化回执及其签名的 `receiptDigest`；
- 配置端点的 `endpointDigest`；
- 当前领域探测策略的 `policyDigest`；
- 每条回执的签发和失效时间；
- 活动开始、完成和失效时间；
- `attestationOrigin=server-generated`；
- `verificationSource=platform-observability`；
- `signatureVerified=true`；
- 活动 nonce 和独立 campaign signing key ID。

`policyDigest` 由以下规范化服务端策略生成：

- `maxLatencyMs`；
- `timeoutMs`；
- `ttlSeconds`；
- `method`；
- `requireMutualTls`；
- 排序后的 `certificatePins`。

活动和公共登记只暴露策略摘要，不暴露证书 pin 原值。

## 单次活动验收

一个活动必须满足：

1. 精确包含八个已登记领域，每个领域一次；
2. lane、adapter、contract、endpoint 和策略均与当前服务端配置一致；
3. 每条回执签名、时效、HTTP/TLS、证书 pin、mTLS 和 nonce 均再次通过；
4. receiptId 和 nonce 在活动内唯一；
5. 回执签发时间位于活动开始与完成时间之间，且在活动完成时仍有效；
6. 整个活动最多持续 300 秒；
7. 活动签名有效且未过期；
8. campaignId、活动 nonce、receiptId 或回执 nonce 未被先前活动使用。

缺少领域、重复领域、跨领域 nonce、签名后篡改、客户端可信来源声明、策略变化或旧回执复用都会失败关闭。

## 连续性登记

默认连续性门禁要求：

- 三次已验证活动；
- 相邻活动通过签名内的 `previousCampaignDigest` 形成不可跳过的前序链；
- 活动之间不重叠；
- 相邻活动的空档不超过 900 秒；
- 每次都使用全新的八领域回执；
- 每次都符合当前策略快照；
- 活动证明在当前验证时刻仍未过期。

登记表先按服务端完成时间从新到旧计算“当前连续窗口”，而不是先丢弃失败记录再拼接成功记录。当前窗口达到所需次数之前：

- 最新活动验签失败、过期、策略漂移或缺少绑定回执时，连续计数为 0；
- 成功活动之间出现失败、重放或篡改活动时，只保留失败之前更新的连续段，禁止跨过失败记录拼接较旧成功记录；
- 完成时间不可解析的记录优先按不可信记录处理，不能通过排序落到成功窗口之后；
- 重叠活动或超过允许空档会在该处终止连续链；
- 前序摘要缺失、不匹配、删除中间活动或提交分叉活动会分别以稳定链路原因码失败关闭；
- 已经位于所需新鲜成功窗口之外的历史拒绝记录继续在 `rejected` 中可见，但不抹掉已经由当前窗口证明的连续性。

登记输出 `continuityBreak` 和 `summary.continuityBreaks`，只包含 campaignId 和稳定原因码，不回显签名、密钥、端点或原始验签原因。默认阈值可由服务端在 1 至 12 次活动、60 至 3600 秒间隔范围内配置。

## 脱敏边界

连续性登记只输出：

- campaignId；
- 活动开始、完成和失效时间；
- 已核验回执数量；
- 连续活动计数与阈值；
- 稳定的失败原因和生产 blocker。

登记不输出：

- 端点 URL；
- DNS 或实际远端 IP；
- TLS 证书正文或证书指纹；
- certificate pins；
- key ID、key material；
- 回执签名或原始证据正文。

## 上线边界

`continuousConnectivityReady=true` 只说明八领域在连续多个受控窗口内通过服务端主动探测。它不能替代：

- 可信现场证据；
- 正式业务回执；
- P0/P1 阻断关闭；
- production handoff 签收；
- 灾备和回退演练；
- 多方 launch approval。

因此连续性通过后仍返回：

- `formalGoLiveState=blocked-until-trusted-site-evidence-and-launch-approval`；
- `productionReady=false`。

## T00 公共集成与生产边界

T00 公共集成已经完成：

1. 受控 worker 在八领域同批主动探测后创建 campaign；
2. purpose 固定为 `public-health-endpoint-probe-campaign` 的独立 campaign keyring 不复用业务请求、业务回执或单条探测密钥；
3. SQLite 在同一事务中校验 campaignId、campaign nonce、receiptId、receipt nonce、当前活动数和受信链头，防止并发分叉；
4. 端点、活动契约、完整探测策略、时间和 keyring 只从服务端当前配置解析；
5. commission API 和页面只返回链路计数、活动标识与稳定原因码，不返回 digest、签名或原始证据；
6. `campaign-chain-link-missing` 与 `campaign-chain-link-mismatch` 已纳入 operations board、release 和 deploy 门禁；
7. `continuousConnectivityReady`、`endpointConnectivityReady` 与 `productionReady` 保持三层分离。

剩余事项属于现场和生产边界：必须提供真实独立托管密钥、生产 HTTPS 端点、证书 pin 或 mTLS 策略、受限 worker 身份、正式探测节奏、P0/P1 关闭、生产移交、现场证据和上线审批。上述证据未齐前 `productionReady=false`。

T08 候选本身不修改公共 `server.js`、`package.json`、`portal.css`、README 或发布总表；这些接线由 T00 完成。
