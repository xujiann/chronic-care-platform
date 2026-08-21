# ADR：转诊写操作统一进入单一命令轨道

- 状态：Accepted
- 日期：2026-08-21
- Owner：T05（care-coordination / referral）

## Problem

转诊聚合同时被 `/api/referrals/:id/actions`、`/api/workflow-actions` 与 `/api/tasks/:id/actions` 修改。后两条兼容路径直接写 `referralSystem.referrals`，绕过已有 `referral-command-service` 的聚合版本、命令收件箱和事件发件箱，形成并行写轨、不同并发语义和不完整审计证据。

## Options

1. 保留三套写实现，仅补充局部校验。
2. 删除两条兼容 API，强制所有调用方立即改用版本化 API。
3. 保留三条公开 API 与各自成功响应，但全部委托 T05 现有 `referral-order.v1` owner command。

## Advantages

方案 3 保持现有机构端和居民端接口兼容，同时让转诊聚合、command inbox 和 outbox 继续在一个 UoW 内提交；权限、幂等、CAS、字段边界及事件合同只维护一份。

## Disadvantages

兼容路由需要把旧 payload 映射为 owner command，并为旧无版本记录采用既有 `version=1` 兼容规则。居民任务消息仍是兼容副作用，不属于 `referral-order.v1` 聚合事务，必须在 owner command 成功且非幂等重放后追加。

## Migration cost

机构端 `shared.js` 和居民端 `citizen.js` 需要发送 `Idempotency-Key` 与 `expectedVersion`；调用方遇到 `409 REFERRAL_VERSION_CONFLICT` 时刷新聚合后重试。无需 schema、SQLite 或 PostgreSQL migration。

## Risk

主要风险是历史调用方缺少幂等键或版本、机构主数据别名不足导致范围拒绝，以及旧客户端把任意 task action 用于转诊。通过稳定错误码、from/to 机构别名与 region 范围、居民本人/家庭授权、action allowlist 和兼容 API 专项测试控制。

## Recommendation

采用方案 3。T05 是转诊命令唯一 owner；新增转诊写入口必须调用该服务，不得直接修改 `referralSystem.referrals`，也不得新建平行 referral command、inbox 或 outbox 概念。

## Decision

- 三条公开路径和成功响应形状保持不变，统一调用 `createReferralCommandService().update()`。
- 权限判断在 inbox 重放与 CAS 之前执行：机构必须匹配 from/to/org，区县主体必须匹配 region，居民仅能处理本人或有效家庭授权成员。
- task source 使用 action-specific allowlist；所有身份、幂等、范围和业务字段超长均以稳定 `REFERRAL_*` 错误码拒绝，不静默截断。
- `expectedVersion` 和 `Idempotency-Key` 对三条 HTTP 命令轨道均为必需；旧聚合缺少版本时继续解释为版本 1。
- 聚合、command inbox 与 outbox 的原有 UoW 不变；本决策不修改 schema、迁移、转诊闭环或远程会诊流程。
