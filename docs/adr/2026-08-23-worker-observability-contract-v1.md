# Worker 统一脱敏观测合同 v1

- Status: Accepted
- Date: 2026-08-23
- Owner: T00 platform operations
- Scope: 仓库内现有 server-side worker 的兼容观测层；不包含浏览器 Service Worker、外部数字医院 worker 注册和 Proposed 对象存储 v2 worker

## Problem

仓库内 worker 已形成多套真实业务语义：有的使用 SQLite lease fencing，有的使用 cursor/checkpoint，有的只执行一次 shadow/reconcile，有的依赖外部 receipt。直接统一状态机会破坏现有重试、幂等、租约和终态含义；但完全没有共同投影又使日志、告警和漂移治理难以一致，且可能把业务载荷、凭据、租约 token 或 provider 错误文本暴露给观测面。

## Options

1. 重写为单一队列和共同状态机。
2. 保持各 worker 业务合同，只增加版本化、最小、脱敏的兼容观测投影和机器语义清单。
3. 仅写文档，不建立可执行合同。

## Advantages

选择 2 可在不改变公开 API、schema、业务终态和重试策略的前提下，统一 `outcome`、计数、稳定错误码、摘要身份、语义引用和生产授权边界。机器清单可证明部署入口已登记，负向测试能拒绝未知 worker、字段扩宽、原始标识泄露和生产误授权。

## Disadvantages

观测合同不消除底层实现差异，也不是统一调度器、队列产品或生产监控系统。适配表需要在新增 worker 或业务状态变化时同步维护；摘要投影不能替代外部 receipt、指标采集器和现场告警验收。

## Migration cost

低到中等。现有返回值只附加 `workerObservability`，CLI/worker 调用方无需迁移；部署包增加一份 JSON 清单和一个无外部依赖的运行时模块。每个新增 server-side worker 必须登记 profile、接入适配器并通过治理测试。

## Risk

- 错误映射可能把业务失败误归类为通用 outcome，因此业务原始状态仍是权威事实。
- 直接对完整业务报告做摘要可能形成敏感关联，因此 v1 只摘要已脱敏的观测输入。
- 共同投影可能被误读为生产就绪，因此合同固定 `productionAuthorization.inferred=false`、`productionReady=false`、`externalEvidenceRequired=true`。
- 对象存储 v2 仍为 Proposed；将其加入运行 profile 会违反现有 NO-GO 决策并由 CI 拒绝。

## Recommendation

采用选项 2。共同层只负责兼容观测，不统一业务状态机，不改变 lease/retry/checkpoint/receipt 语义，不引入公开 API、数据库 migration 或新依赖。

## Decision

接受 `platform-worker-observability.v1` 和 `platform-worker-semantics-inventory-v1`：

- inventory 记录 owner、入口、实现、真实状态机、delivery guarantee、retry、lease、checkpoint、终态和字段映射；
- 投影字段闭集为版本、profile/owner、通用 outcome、观测时间、worker/run 摘要、六类计数、稳定错误码、语义引用、安全声明和固定生产非授权；
- 投影不包含业务载荷、原始 worker/run 标识、凭据、provider message 或 lease token；
- `blocked` 只表示执行前/授权边界阻断；`failed/error/mismatch` 按已执行工作的结果投影为 `failed` 或 `partial`，不改写原业务状态；
- source report 是当前 worker 在进程内创建的普通结果对象，不是 HTTP、provider 或其他外部输入；外部内容必须先由领域 worker 完成验证和最小化，才能进入适配器；
- 现有业务报告保持权威，适配为 additive/idempotent；替换 profile 或扩宽合同失败关闭；
- CI 校验所有部署的 server-side worker 入口均已登记并实际接入；
- 浏览器 Service Worker、外部注册和 Proposed 对象存储 worker 明确排除，不能据此推导已经上线。

## Rollback

可回滚各 worker 的附加调用、部署包清单项和 CI 步骤，同时删除 v1 清单/模块；不会回滚数据库、数据或公开 API。回滚前应确认没有仓库内消费者把附加字段当成必需输入。

## Production boundary

本决策只关闭 JOB-001 的仓库内共同观测合同缺口。真实监控/日志采集、告警路由、外部 receipt、凭据、服务启用、容量与现场验收继续由外部系统和现场 owner 完成，并保持生产 NO-GO。
