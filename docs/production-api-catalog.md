# 生产 API 机器目录

## 定位

`scripts/production-api-catalog.js` 是现有 `api-authorization-matrix-v3` 的派生治理视图，不是第二套路由注册表。它继续通过 `src/http/runtime-source.js` 读取模块化路由源码，并复用授权矩阵中的 method、path、owner、身份、角色、数据范围、用途和高风险覆盖。

运行 `npm run api:production-catalog` 只在标准输出中返回校验摘要，不写入仓库、数据库或发布报告。需要审阅完整机器目录时运行 `node scripts/production-api-catalog.js`；输出是可重建的代码元数据，不得加入凭据、真实 endpoint、患者数据或外部回执。

## v3 字段

每个唯一 method/path 条目至少包含：

- `owner`、`domain`、`purpose` 和源码位置；
- `authentication.required/mode/mechanisms/principalTypes/evidenceContractIds`；
- `authorization.roles`、`dataScopes` 和逐声明 variant；
- `idempotency.required/status/mechanisms`；
- `production.status/productionReady/repositoryReview/externalEvidenceRequired/blockers`。

同一 method/path 在不同分支多次声明时，目录聚合为一个条目，同时保留全部授权 variant，避免把 action/body 分支误写成单一角色语义。无法静态解析的动态 path 或 role 不做猜测，统一标为 `runtime-policy` 和 `review-required`。

## 当前基线

2026-08-23 的当前源码产生 601 条授权声明和 371 个字面条件路由；两者并集形成 593 个唯一目录条目：586 个字面路由、7 个运行时策略路由；585 个 required、7 个 no-auth public、1 个 optional-session，custom auth 未分类为 0。13 项认证证据包括既有 SMS callback，以及原 13 个未分类 key 中由控制流与可执行负向测试共同证明的 12 个真实入口。认证合同只记录 credential source 的类别名称，不记录真实 credential。

两个仓库内部歧义已按证据闭合：`GET /api/t10-specialty/cutover-pack` 绑定真实 shared handler、commission 角色以及匿名 401/机构角色 403 的直接行为测试；目录解析器禁止跨越已结束的 handler 配对 method/path，`POST /api/public-health/domain-events/health` 虚假 key 已删除，同时保留真实 `GET .../health` 与 `POST .../dispatch`。修正没有创建新 API 或改变运行时策略。

`production-api-catalog-v3` 另行统计幂等行为证据：333 个写接口中，101 个观察到幂等相关标记、232 个未观察到；只有 `POST /api/auth/sms-delivery-callback` 通过 `api-idempotency-evidence-v1` 合同、现有实现锚点和可执行测试，因此 1 项为 `behavior-verified`，其余 332 项为 `behavior-proof-required`。该 pilot 只证明当前事件 ledger 的精确重放/冲突行为，不证明多实例 exactly-once。

`source-marker-observed` 只说明相邻路由源码存在标记，不证明事务、重放、并发和跨实例语义已经正确；`not-observed` 也不是确认缺陷，而是必须由 owner 复核的门禁结果。任何写接口只有在专项合同和负向测试证明后，才能更新其领域契约。

## 生产边界

全部 593 个条目固定为 `NO-GO`、`productionReady=false`、`externalEvidenceRequired=true`。机器目录证明仓库元数据可盘点，不证明真实身份源、证书、密钥、网络、数据库、外部系统、审计留存、灾备或现场验收已经完成。

路由变更必须先更新原 route/授权实现及其测试，再由目录自动派生；禁止手工维护平行的 593 行 JSON。CI 的 `governance-api` 同时执行认证证据、授权矩阵、幂等证据和生产目录，缺失条目、重复键、跨 handler method/path 误配、credential/replay-CSRF/scope/测试锚点漂移、owner/auth/idempotency 分类缺失或任何 `GO`/`productionReady=true` 回流都会失败关闭。

## 后续复核顺序

1. 先消除 7 个 `runtime-policy` 路由的静态不确定性，但不得改变公共 method/path。
2. 保持 T10 精确路径 401/403 和相邻 handler method/path 解析回归测试，防止已闭合歧义回流。
3. 由 T01–T09 owner 分批为 332 个未验证写接口提供行为合同与负向测试；232 个“未观察到标记”只是优先排查子集，只读接口不要求幂等键。
4. 将已验证的幂等、CAS、错误与审计合同接入领域专项测试，不以字符串标记替代行为测试。
5. 持续扩展 role × permission × resident/institution/region 的运行时允许和拒绝矩阵。
