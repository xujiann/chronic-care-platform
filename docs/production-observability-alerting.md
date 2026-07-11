# 生产可观测性与 SIEM 告警闭环

## 已实现范围

- `/api/metrics` 汇总 HTTP 请求、慢请求、工作负载、集成死信、数据质量和医院运行告警。
- `GET /api/observability/alerts` 返回 SIEM/Webhook 路由状态、当前去标识化信号、投递回执和失败队列，不暴露地址、令牌或签名密钥。
- `POST /api/observability/alerts/dispatch` 采用 HMAC-SHA256、时间戳、请求 ID 和幂等键向生产接收端投递。
- `POST /api/observability/alert-deliveries/:id/retry` 支持最多三次人工重放；失败投递自动形成运维事件，接收端恢复后自动关闭该事件。
- 运营中心展示路由、活动信号、投递回执和重放操作，正常静态预览不会伪造生产投递成功。
- 告警载荷只包含计数、环境、责任方、服务标签和证据引用，禁止居民 ID、患者 ID、身份证号、手机号、诊断、病历原文、令牌和私钥。

## 生产配置

至少配置一条路由：

```text
SIEM_ENDPOINT / SIEM_SIGNING_SECRET / SIEM_TOKEN
ALERT_WEBHOOK_URL / ALERT_WEBHOOK_SECRET / ALERT_WEBHOOK_TOKEN
ALERTING_TIMEOUT_MS / ALERTING_MAX_ATTEMPTS
```

生产地址必须使用 HTTPS。签名密钥和令牌只能由密钥管理系统或受控环境变量注入。

## 运行闭环

```text
运行指标和审计信号
  -> 去标识化告警
  -> SIEM 或运维 Webhook
  -> 接收回执
  -> 失败进入运维事件
  -> 人工重放
  -> 接收成功并关闭事件
```

## 生产边界

告警适配器基础通过不等于生产监控已经正式验收。正式上线前仍须完成：

1. SIEM、工单或呼叫平台真实地址、网络白名单和最小权限凭据开通。
2. 告警分级、聚合抑制、静默窗口、责任方、值班电话和升级时限签字。
3. 接收端回执、超时、限流、重复、乱序和不可用场景联合测试。
4. P1/P2 告警呼叫、工单、升级、回退和首日观察演练。
5. 日志留存、SIEM/WORM 保全、等保密评和隐私评估材料归档。
6. `CUTOVER_MONITORING_SIGNOFF` 由运维、安全、项目和业务责任方正式签署。

## 验证命令

```powershell
npm.cmd run monitoring:readiness
npm.cmd run env:check:production
npm.cmd run release:report
npm.cmd run deploy:check
```
