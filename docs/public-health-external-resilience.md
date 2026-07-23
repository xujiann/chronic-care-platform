# 公共卫生外部适配器熔断、限流与背压

## 目标

八领域外部接口共享“故障不扩散、恢复可探测、容量有上限”的生产边界。`public-health-external-resilience-service.js` 提供按领域独立的签名控制状态；`public-health-external-adapter-runtime.js` 在出站入队、worker 领取和投递结果落库时调用该控制器。

未传 `resiliencePolicy` 时保留原有兼容行为，但不能据此获得生产就绪。生产环境必须为每个领域提供策略并由 T00 将通道控制与出站任务放在同一持久化事务中。

## 策略

每个领域策略包含：

```json
{
  "failureThreshold": 3,
  "openSeconds": 120,
  "halfOpenMaxProbes": 1,
  "rateLimitPerMinute": 30,
  "maxPending": 100
}
```

- `failureThreshold`：连续基础设施失败达到阈值后打开熔断器，范围 1–20。
- `openSeconds`：打开状态持续时间，范围 30–3600 秒。
- `halfOpenMaxProbes`：熔断到期后允许的并发探针数，范围 1–10，建议保持 1。
- `rateLimitPerMinute`：每领域固定分钟窗口可领取任务数，范围 1–1000。
- `maxPending`：每领域 `pending + retry-scheduled` 最大积压数，范围 1–10000。

网络错误、HTTP 429、5xx，以及 2xx 但缺失可信签名回执会计为基础设施失败。可信接受或拒绝回执都说明外部链路可用，会关闭熔断器；业务拒绝本身仍按原有补偿流程进入死信，不与基础设施熔断混淆。

## 状态与签名

`publicHealthExternalLaneControls` 持久化每领域状态：

- `version`：独立乐观版本；
- `circuitState`：`closed`、`open` 或 `half-open`；
- `consecutiveFailures`、`openUntil`、`halfOpenProbesInFlight`；
- `rateWindowStartedAt`、`claimsInWindow`；
- `auditHead`、`signatureKeyId` 和 HMAC 签名。

`publicHealthExternalLaneControlAudit` 追加领取额度、失败和成功结果。每条审计包含前序哈希、内容哈希、`auditKeyId` 和签名；控制状态同时绑定最新 `auditHead`。密钥轮换时历史审计可用 `grace` 密钥验证，新写入使用当前 `active` 密钥。修改控制状态、删除或修改审计、无签名追加以及版本跳过都会失败关闭。

控制状态和审计仅含领域、版本、计数、时间和原因代码，不包含居民标识、端点或密钥正文。

## 运行流程

1. 入队前调用 `assertPublicHealthExternalBackpressure()`；达到 `maxPending` 时不生成新任务，也不写审计。
2. worker 领取时同时提交出站任务 `expectedVersion` 与通道 `expectedLaneControlVersion`。
3. `reservePublicHealthExternalLaneCapacityToState()` 验证控制签名与审计链，检查熔断、半开探针和分钟限额，再同时推进通道版本。
4. 领取成功后才生成 worker 租约和出站审计。T00 必须原子持久化控制状态、控制审计、任务状态和任务审计。
5. claimed attempt 完成后，`recordPublicHealthExternalLaneOutcomeToState()` 根据已验证投递结果打开、保持或关闭熔断器，并再次推进通道版本。
6. 打开状态在 `openUntil` 前拒绝所有新领取；到期后的首次领取转为半开探针。探针失败会重新打开，可信回执成功会关闭并清零连续失败。

幂等重放不重复占用额度或推进通道版本。通道状态或审计被篡改时，领取、尝试重放和运行巡检都拒绝继续处理。

## 运维巡检

`buildPublicHealthExternalOperationsBoard()` 增加以下风险：

- P0 `lane-control-signature-secret-unavailable`：缺少验证密钥环；
- P0 `lane-control-audit-orphan`：控制状态缺失但仍存在通道审计；
- P0 `lane-control-integrity-invalid`：控制签名或审计链无效；
- P1 `lane-circuit-open`：领域熔断已打开；
- P1 `lane-circuit-half-open`：领域正在执行受控恢复探针。

P0 阻止该领域继续投递。P1 保持生产门禁可观察，由告警和现场值班流程处置。即使所有风险清零，`productionReady` 仍保持 `false`，直至生产策略、指标告警、负载证据和现场签字全部完成。

## T00 集成事项

- 为八领域配置独立策略；公共配置不得允许客户端覆盖阈值。
- 调用领取接口时读取当前通道版本并提交 `expectedLaneControlVersion`。
- 调用 claimed attempt 时提交领取结果返回的通道版本。
- 共享写入器必须在同一事务中 CAS 校验任务版本和通道版本，并同时写两组状态与审计。
- 到期扫描可以列出候选任务，但真正的限流和熔断授权必须以领取控制器返回结果为准。
- 对 P0/P1 风险接入监控和告警；不得通过清空控制集合、重置计数或伪造成功结果解除熔断。
- 压测需覆盖积压上限、分钟边界、并发领取、打开期间拒绝、单探针恢复、探针失败重开和密钥轮换。

T00 继续负责 `server.js`、`package.json`、`portal.css`、`README.md`、公共发布总表、生产配置和共享事务写入器；T08 不修改这些公共文件。
