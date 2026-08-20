# ADR：连续审计投递与耐久 checkpoint

- 状态：Accepted
- 日期：2026-08-21
- Owner：T00

## Problem

严格审计链若只停留在本地验证，无法证明连续外送、WORM 耐久、崩溃恢复或投递失败告警。

## Options

1. 请求路径同步外送；2. 新建平行告警账本；3. 独立 worker + checkpoint，复用现有 cutover alert lifecycle。

## Advantages / Disadvantages

方案 3 隔离请求延迟、提供崩溃恢复且不分叉告警模型；代价是 checkpoint/head/lock 和部署目录权限增加运维复杂度。

## Migration cost / Risk / Recommendation

迁移需要专用账号、外部路径、TLS/WORM 材料和 timer。风险是 checkpoint 或外部目标错误配置导致 fail closed；推荐先跑 preflight/WORM rehearsal，再用真实 SIEM receipt 与恢复演练完成外部门禁。

## Decision

- 连续审计投递实现位于 `src/platform/operations/audit-delivery.js` 与独立 worker，消费 v2 审计链验证结果，不在 HTTP 请求路径发送。
- SIEM transport 强制 HTTPS、证书校验、TLS 1.2+，支持受控 CA/mTLS 文件；receipt 必须同时绑定 `batchId`、digest、recordCount；429/5xx 按有界 `Retry-After`/指数退避重试。
- WORM filesystem 使用 create-only、0700 目录、0400 文件、符号链接/权限检查、内容冲突检查和文件/目录 fsync。
- checkpoint v2 包含 digest、单调 sequence、previous digest、durable head 和独占 worker lock；损坏、回退、跳号和并发全部 fail closed。
- 投递事件映射到现有 `pilot-cutover-alert-lifecycle`：失败产生 `alert-opened`/`delivery-failed`，成功产生 `delivery-acknowledged`，恢复产生 `alert-recovered`，不创建平行告警系统。checkpoint 写失败产生 metadata-only `audit-write-failure` operational signal。
- systemd 模板使用专用非 root 身份、只读应用目录和最小可写目录；preflight 只校验本地配置，始终 `productionReady=false`。

真实 SIEM/WORM 接收、保留策略、证书签发、恢复演练和现场验收仍是外部门禁。
