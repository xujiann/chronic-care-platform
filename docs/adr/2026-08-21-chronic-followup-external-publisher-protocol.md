# ADR：慢病随访外部 publisher 协议与失败语义

- 状态：Accepted
- 日期：2026-08-21
- Owner：T04 citizen-chronic（运行时启用证据后续由 T00 组合根交付）
- 影响范围：`citizen-chronic.followup-updated.v1`、随访事件 dispatch/health、外部 publisher、内嵌回执证据

## Problem

既有随访聚合已经在业务更新时原子追加内嵌 outbox，并通过受权 HTTP dispatch 完成 inbox、
projection 和 receipt，但缺少可用于生产外发的明确信任边界。仅凭环境变量宣称“已启用”、
信任任意 publisher 自报验签布尔值、使用每次变化的幂等键、允许内网目标，都会造成 SSRF、
越权投递、伪造回执或重试重复副作用。批次中途失败和外部成功后本地最终写回失败还必须有
一致、可审计的重试语义，同时保留既有 API、v1 事件和非生产本地测试兼容。

## Options

1. 维持本地模拟或任意自定义 publisher，只用环境变量表示生产已启用。
2. 在 T04 建立安全外发端口：稳定幂等键、独立 activation verifier、公网 HTTPS 目标限制、
   签名回执和模块私有 capability；继续使用既有内嵌 outbox，由同步 dispatch 写回摘要证据。
3. 立即建设跨进程 worker、持久 lease、独立投递表和 T00 生产装配，一次替换现有 dispatch。

## Advantages

- 方案 1 改动最少，完全保留当前调用方式。
- 方案 2 在不变更 schema/API/event contract 的前提下关闭主要信任漏洞；`requestId` 和 nonce
  由 `eventId + payloadDigest` 稳定派生，精确幂等回执可在重试时再次验证；单进程同一 publisher
  的并发请求可合并。机构投递先按 resident/org scope 过滤，并对拒绝、成功和失败写安全审计。
- 方案 3 能最终承载定时投递、跨实例互斥、退避和死信，运行语义最完整。

## Disadvantages

- 方案 1 无法形成生产信任证据，应继续失败关闭。
- 方案 2 仍是人工 HTTP 同步触发；无持久 lease/worker/attempt/dead-letter，也无法独立保证
  多进程 exactly-once。DNS 检查与底层连接之间仍依赖部署网络策略避免重绑定，生产还需出站
  allowlist/代理控制。
- 方案 3 会跨 T04/T00、数据库 migration、部署和运维边界，超出本切片且迁移风险较高。

## Migration cost

推荐方案 2 的迁移成本为中：保留 method/path、成功响应和 v1 事件合同，不新增集合、DDL 或
migration；新增 T04 publisher 端口、专项测试、路由范围/audit 组合和聚合内最小回执摘要。
方案 3 为高成本，必须另行 ADR、schema migration、T00 运行时装配和发布回滚演练。

## Risk

- 批次第二项失败时，第一项可能已被供应方接受，但本地克隆整体丢弃，原 outbox 全部保持
  pending；重试会再次发送第一项的同一幂等键。供应方必须按 `idempotency-key` 返回原精确回执，
  才能避免重复业务副作用；网络请求本身可能重复。
- 外部接受后最终本地写回失败具有同样语义：状态保持 pending，重试同一幂等键并重验原回执。
- 同一进程、同一 publisher 实例的并发 dispatch 会按稳定 requestId 合并为一次外部请求；跨进程
  没有 lease，因此只能依赖供应方幂等合同，不能宣称平台级 exactly-once。
- 机构范围拒绝必须发生在外发前；授权/尝试审计必须先独立持久化，失败时禁止调用 publisher。
  结果审计追加与领域整体 checkpoint 仍不是一个事务：外发或最终写回失败时可能只有 attempt
  证据，结果审计也可能追加失败；反之最终领域写回成功后结果审计失败，接口仍会返回 503，
  但重试会看到 published outbox 而不会再次外发。这是待统一审计事务端口解决的剩余风险。
- 只保存摘要意味着能校验绑定和状态，但不替代供应方原始证据的受控留存与现场核对。

## Recommendation

接受方案 2。生产发送必须先获得独立注入 verifier 返回的、绑定 contract、endpoint、event 和
payload digest 的有效 activation；环境字符串和 flags 不能成为证明。目标只允许无凭据、无
query/fragment 的公网 HTTPS 默认端口，禁止回环、私网、链路本地、重定向和超限响应。

请求用稳定 `requestId`/nonce 和每次发送时间签名；回执必须绑定 request/event/correlation/
payload、状态 `accepted|delivered`、自身发送时间窗与 HMAC。publisher 通过模块私有 capability
向 service 证明验证结果，持久化只保留可重验最小摘要和状态，不保存原始回执 ID、签名或正文。
route 必须在 publisher 调用前持久化授权/尝试审计；失败时不外发、不写领域状态。当前 T04 不
注入 T00 activation verifier，默认失败关闭，`productionReady=false`。

本决策明确不包含 worker、持久 lease、schema、T00 runtime 装配和生产 Go/No-Go。后续方案 3
必须由 T04 拥有领域投递语义、T00 拥有生产组合和部署证据，并以独立 ADR/migration 实施。
