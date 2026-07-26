# 公共卫生外部端点可信探测

## 目标

八领域协同已经具备签名请求、签名回执、持久化 outbox、worker 租约、重试死信、韧性控制和契约版本治理。生产接线前仍需证明配置的外部 HTTPS 端点确实由服务端监测链路探测成功，并且探测结果没有被客户端自报、缓存旧结果或跨领域重放替代。

本增量新增 `public-health-external-endpoint-verification-service.js`，提供：

- 生产端点规范化与公网目标限制；
- 服务端签名的端点探测回执；
- 领域、适配器、契约、端点摘要、HTTP、TLS、时效和 nonce 绑定；
- 八领域端点探测登记表；
- 连通性就绪与正式生产上线状态的强制拆分。

## 可信探测回执

回执使用 `public-health-external-endpoint-probe/v1`。签名载荷完整绑定以下字段：

- `receiptId`、`laneId`、`adapterId`、`contract`；
- 规范化 `endpoint` 及其 `endpointDigest`；
- `status`、`httpStatus`、`latencyMs`；
- 实际 `resolvedAddress` 与 TLS SNI 主机名；
- `tls.authorized`、`tls.protocol`、证书 SHA-256 指纹和 mTLS 结果；
- `verification.attestationOrigin`、`verification.verificationSource`、`verification.signatureVerified`；
- `issuedAt`、`expiresAt`、`nonce`、`signingKeyId`。

可信来源固定为：

- `attestationOrigin=server-generated`；
- `verificationSource=platform-observability`；
- `signatureVerified=true`。

即使客户端自报 `healthy`、`verified` 或 TLS 成功，只要来源字段不可信、签名不匹配、签名后字段被修改、回执过期或 nonce 已使用，验证都会 fail-closed。

## 端点安全策略

探测目标必须：

- 使用 HTTPS；
- 不携带 URL 用户名、密码或片段；
- 与服务端当前领域配置精确一致；
- 不使用 localhost、`.local`、`.invalid`、`.test`、`.example`；
- 不使用回环、私网、链路本地、组播或保留 IP；
- 服务端实际解析地址必须是公网 IP，SNI 主机名必须与配置目标一致，防止 DNS rebinding；
- 返回 2xx；
- 在配置的时延阈值内；
- TLS 授权成功，协议为 TLSv1.2 或 TLSv1.3，并提供证书 SHA-256 指纹。

端点 URL 和解析 IP 不进入公共登记摘要。登记表只暴露 SHA-256 目标摘要、解析地址摘要、回执 ID、签名密钥 ID、验证时间、时延和安全阻断码，避免泄露内部地址和凭据。

## 时效与防重放

- 单个探测回执最长有效 15 分钟；
- 默认只允许 30 秒时钟偏差；
- `receiptId` 和 `nonce` 在同一登记批次内必须唯一；
- 跨领域复用 nonce 会使后续领域保持 `trusted-endpoint-probe-required`；
- 未知、撤销、未生效或过期签名密钥均拒绝。

## 上线边界

`endpointConnectivityReady=true` 只表示八领域当前配置端点均取得新鲜、服务端签名且可信的连接探测回执。

它不改变：

- `productionReady=false`；
- 现场材料可信证据；
- P0/P1 阻塞关闭；
- 生产移交签收；
- 多方 launch gate 审批；
- 正式业务回执和居民服务结果。

因此登记表即使达到 8/8，仍返回 `trusted-site-evidence-still-required`。只有 T00 完成持久化接线、现场证据核验、生产交接、阻塞关闭和上线审批后，公共生产门禁才可能继续评估。

## T00 集成边界

T00 后续需要在公共层完成：

1. 服务端监测代理或证据仓写入端点探测回执，客户端不得直接写入可信登记表；
2. 以持久化唯一索引约束 `receiptId` 和 `nonce`；
3. 从当前服务端配置和活动契约解析期望端点、契约与 keyring；
4. 只向卫健委角色暴露脱敏登记摘要；
5. 把端点探测阻断纳入 operations board 和 release report；
6. 保持 `endpointConnectivityReady` 与 `productionReady` 分离。

T08 不修改公共 `server.js`、`package.json`、`portal.css`、README 或发布总表。

## 主动探测补充

`public-health-external-endpoint-probe-runner.js` 进一步提供服务端主动探测执行边界。执行器只接受领域编号，端点、活动契约、DNS、TLS 策略、证书 pin、mTLS 要求和 keyring 均由服务端解析；混合私网 DNS、实际 peer 不在固定解析集合、重定向、TLS 或证书策略不匹配时不会签发回执。完整流程见 `docs/public-health-external-active-probing.md`。
