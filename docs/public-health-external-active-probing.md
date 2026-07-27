# 公共卫生外部端点主动探测执行器

## 目标

`public-health-external-endpoint-verification-service.js` 负责核验服务端签名的端点探测回执。本增量新增 `public-health-external-endpoint-probe-runner.js`，把“谁实际发起探测、DNS 和 TLS 结果从哪里取得”也收敛到服务端边界。

执行器只接受 `laneId`。端点、活动契约、探测策略、TLS 客户端凭据和签名 keyring 均由服务端配置或内部 resolver 提供。请求不能提交或覆盖 endpoint、contract、status、resolvedAddress、TLS 结果、trust metadata、时间、策略或 keyring。

## 主动探测流程

1. 根据八领域适配器 profile 读取服务端生产 HTTPS 端点。
2. 规范化端点并拒绝 HTTP、凭据、片段、IP 字面量、localhost、私网和保留目标；生产端点必须使用可核对 TLS SNI 的 DNS 主机名。
3. 由服务端 DNS resolver 取得全部 A/AAAA 结果。
4. 任一结果是回环、私网、链路本地、文档、组播或其他保留地址时，整次探测失败关闭；不允许从混合结果中只挑一个公网地址继续。
5. 选择一个已核验公网地址，并把 HTTPS 客户端 lookup 固定到该地址；TLS SNI 和 Host 仍使用配置主机名。
6. 连接后再次核对 socket 的实际 `remoteAddress` 必须属于前述固定 DNS 集合，防止 DNS rebinding 或 transport 绕过。
7. 只接受 2xx、策略时延以内、TLSv1.2/TLSv1.3、授权成功且具备 SHA-256 证书指纹的结果。
8. 如服务端策略配置证书 pin 或要求双向 TLS，结果必须同时满足。
9. 由服务端生成 receiptId、nonce、签发时间和失效时间，固定可信来源后签名。
10. 签发后立即使用当前端点、活动契约、keyring 和策略自验；自验失败不返回回执。

默认使用 `HEAD`，策略可在服务端改为 `GET`。探测方法不能为 POST，避免健康检查产生业务写入。单次回执默认有效 10 分钟，允许范围为 60 至 900 秒。

## DNS 与 IP 边界

执行器最多接受 16 个去重解析地址。IPv4 回环、私网、链路本地、共享地址、基准测试、文档、组播和保留空间均拒绝。IPv6 仅接受可路由全局单播范围，并拒绝 IPv4-mapped 私网、ULA、链路本地、文档、基准、组播和其他非全局地址。

这项检查在连接前和连接后各执行一次：

- 连接前防止直接 SSRF 和混合公网/私网解析；
- 连接后防止解析结果与真实 peer 不一致。

## TLS 策略

每个领域可由服务端配置：

- `maxLatencyMs`；
- `timeoutMs`；
- `ttlSeconds`；
- `method=HEAD|GET`；
- `certificatePins`；
- `requireMutualTls`。

证书 pin 和 mTLS 结果进入签名载荷。登记表再次按当前服务端策略核验回执；策略改变后，旧回执不会继续满足新的 pin 或 mTLS 要求。

## 失败输出与脱敏

批量执行结果只返回领域、稳定错误码和统一失败说明。受限诊断可保留在服务端日志，但公共结果不包含：

- 端点 URL；
- DNS 或远端 IP；
- 证书正文；
- key ID、key material 或 TLS 客户端凭据；
- resolver/transport 原始异常。

成功回执属于受限证据写入对象，必须由 T00 存入可信证据仓；公共摘要继续使用 endpoint registry 的脱敏投影。

## 上线边界

主动探测全数成功只可使 `endpointConnectivityReady=true`。执行器和批量结果始终保持 `productionReady=false`，不得替代：

- 可信现场证据；
- P0/P1 阻断关闭；
- production handoff 签收；
- 正式业务回执；
- 多方 launch approval。

## T00 集成边界

T00 后续需在公共层：

1. 仅允许 commission 触发内部探测任务，HTTP 请求只传领域选择，不传安全配置；
2. 从服务端配置读取端点、活动契约、探测策略、TLS 凭据和 endpoint-probe keyring；
3. 把探测放入受控 worker，限制并发、频率、超时和审计；
4. 将成功回执写入已具备 receiptId/nonce 唯一约束的可信存储；
5. 仅返回脱敏 registry 和稳定错误码；
6. 在 registry 调用中传入当前证书 pin 与 mTLS 策略；
7. 保持 `endpointConnectivityReady` 与 `productionReady` 分离。

T08 不修改公共 `server.js`、`package.json`、`portal.css`、README 或发布总表。

## 连续活动补充

单条回执和单次八领域探测仍可能只反映一个瞬时窗口。`public-health-external-endpoint-probe-campaign-service.js` 进一步把八领域回执、当前策略摘要和活动窗口绑定到独立签名，并要求多个不重叠活动才能得到 `continuousConnectivityReady=true`。完整边界见 `docs/public-health-external-endpoint-probe-campaigns.md`。
