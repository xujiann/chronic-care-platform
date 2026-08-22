# 生产 API 机器目录

## 定位

`scripts/production-api-catalog.js` 是现有 `api-authorization-matrix-v2` 的派生治理视图，不是第二套路由注册表。它继续通过 `src/http/runtime-source.js` 读取模块化路由源码，并复用授权矩阵中的 method、path、owner、身份、角色、数据范围、用途和高风险覆盖。

运行 `npm run api:production-catalog` 只在标准输出中返回校验摘要，不写入仓库、数据库或发布报告。需要审阅完整机器目录时运行 `node scripts/production-api-catalog.js`；输出是可重建的代码元数据，不得加入凭据、真实 endpoint、患者数据或外部回执。

## v1 字段

每个唯一 method/path 条目至少包含：

- `owner`、`domain`、`purpose` 和源码位置；
- `authentication.required` 与身份机制；
- `authorization.roles`、`dataScopes` 和逐声明 variant；
- `idempotency.required/status/mechanisms`；
- `production.status/productionReady/repositoryReview/externalEvidenceRequired/blockers`。

同一 method/path 在不同分支多次声明时，目录聚合为一个条目，同时保留全部授权 variant，避免把 action/body 分支误写成单一角色语义。无法静态解析的动态 path 或 role 不做猜测，统一标为 `runtime-policy` 和 `review-required`。

## 当前基线

2026-08-22 的当前源码产生 589 条授权声明和 372 个字面条件路由；两者并集形成 594 个唯一目录条目：587 个字面路由、7 个运行时策略路由；576 个保护接口、5 个显式公共接口，另有 13 个使用自定义 session/运行时策略且尚未进入授权矩阵的接口。新增的一条声明只分类既有 SMS callback 的 HMAC 外部认证。334 个写接口中，101 个观察到幂等相关标记、233 个未观察到；观察值不再作为行为证明。

`production-api-catalog-v2` 另行统计行为证据：只有 `POST /api/auth/sms-delivery-callback` 通过 `api-idempotency-evidence-v1` 合同、现有实现锚点和可执行测试，因此 1 项为 `behavior-verified`，其余 333 项为 `behavior-proof-required`。该 pilot 只证明当前事件 ledger 的精确重放/冲突行为，不证明多实例 exactly-once。

`source-marker-observed` 只说明相邻路由源码存在标记，不证明事务、重放、并发和跨实例语义已经正确；`not-observed` 也不是确认缺陷，而是必须由 owner 复核的门禁结果。任何写接口只有在专项合同和负向测试证明后，才能更新其领域契约。

## 生产边界

全部 594 个条目固定为 `NO-GO`、`productionReady=false`、`externalEvidenceRequired=true`。机器目录证明仓库元数据可盘点，不证明真实身份源、证书、密钥、网络、数据库、外部系统、审计留存、灾备或现场验收已经完成。

路由变更必须先更新原 route/授权实现及其测试，再由目录自动派生；禁止手工维护平行的 594 行 JSON。CI 的 `governance-api` 同时执行授权矩阵、幂等证据合同和生产目录，缺失条目、重复键、证据锚点漂移、owner/auth/scope/idempotency 分类缺失或任何 `GO`/`productionReady=true` 回流都会失败关闭。

## 后续复核顺序

1. 先消除 7 个 `runtime-policy` 路由的静态不确定性，但不得改变公共 method/path。
2. 由 T01–T09 owner 分批为 333 个未验证写接口提供行为合同与负向测试，并复核 13 个未进入授权矩阵的自定义鉴权接口；233 个“未观察到标记”只是优先排查子集，只读接口不要求幂等键。
3. 将已验证的幂等、CAS、错误与审计合同接入领域专项测试，不以字符串标记替代行为测试。
4. 持续扩展 role × permission × resident/institution/region 的运行时允许和拒绝矩阵。
