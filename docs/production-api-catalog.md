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

2026-08-24 的当前源码产生 601 条授权声明和 371 个字面条件路由；两者并集形成 593 个唯一目录条目：585 个字面路由、8 个运行时策略路由；585 个 required、7 个 no-auth public、1 个 optional-session，custom auth 未分类为 0。13 项认证证据包括既有 SMS callback，以及原 13 个未分类 key 中由控制流与可执行负向测试共同证明的 12 个真实入口。认证合同只记录 credential source 的类别名称，不记录真实 credential。

两个仓库内部歧义已按证据闭合：`GET /api/t10-specialty/cutover-pack` 绑定真实 shared handler、commission 角色以及匿名 401/机构角色 403 的直接行为测试；目录解析器禁止跨越已结束的 handler 配对 method/path，`POST /api/public-health/domain-events/health` 虚假 key 已删除，同时保留真实 `GET .../health` 与 `POST .../dispatch`。修正没有创建新 API 或改变运行时策略。

`production-api-catalog-v3` 另行统计幂等行为证据：333 个写接口中，103 个观察到幂等相关标记、230 个未观察到。`api-idempotency-evidence-v1` 现登记 13 份直接行为合同，其中 11 个完整 endpoint 为 `behavior-verified`，另有 `workflow-actions[collection=referrals]` 与 `tasks[referrals:*]` 2 个 action-slice；322 个写接口仍为 `behavior-proof-required`，总计 324 项 `review-required`。最新 T03 highlight signal 合同直接证明身份/RBAC 先于 body/state、city/health-admin 旧 payload 兼容、district canonical 来源机构 allowlist、actor 组织命名空间 key hash、同 key 命令串行和锁内重读、精确重放/冲突、bounded signal ledger、signal+audit 单次提交、稳定错误与真实 SQLite API 持久化；独立 highlight GET 是 safe method，不新增幂等合同，直接路由测试已保护内部摘要脱敏、district allowlist 和混合 alert 失败关闭。T00 高风险授权注册表现在以 `city and health-admin platform; district own organization or explicit public-health hospital allowlist` 描述该读取范围，授权矩阵与派生生产目录测试同时锁定该值；`GET /api/public-health/system` 与 `GET /api/state` 的剩余读取旁路未因此关闭。两个 action-slice 仍只进入 `verifiedActionContracts`，通用 endpoint 继续阻断。所有合同都明确不证明多实例 exactly-once。

区域共享目录 owner 由 Accepted ADR 和现有数据 owner 合同明确为 T02，不再沿 `shared.js` 文件名推断成 T09。科研导出创建接口只证明重复导出 ID 冲突，没有同键精确重放，未登记为幂等行为合同。

`source-marker-observed` 只说明相邻路由源码存在标记，不证明事务、重放、并发和跨实例语义已经正确；`not-observed` 也不是确认缺陷，而是必须由 owner 复核的门禁结果。任何写接口只有在专项合同和负向测试证明后，才能更新其领域契约。

## 生产边界

全部 593 个条目固定为 `NO-GO`、`productionReady=false`、`externalEvidenceRequired=true`。机器目录证明仓库元数据可盘点，不证明真实身份源、证书、密钥、网络、数据库、外部系统、审计留存、灾备或现场验收已经完成。

路由变更必须先更新原 route/授权实现及其测试，再由目录自动派生；禁止手工维护平行的 593 行 JSON。CI 的 `governance-api` 同时执行认证证据、授权矩阵、幂等证据和生产目录，缺失条目、重复键、跨 handler method/path 误配、credential/replay-CSRF/scope/测试锚点漂移、owner/auth/idempotency 分类缺失或任何 `GO`/`productionReady=true` 回流都会失败关闭。

## 后续复核顺序

1. 先消除 8 个 `runtime-policy` 路由的静态不确定性，但不得改变公共 method/path。
2. 保持 T10 精确路径 401/403 和相邻 handler method/path 解析回归测试，防止已闭合歧义回流。
3. 由 T01–T09 owner 分批为 322 个未验证写接口提供 endpoint 行为合同与负向测试；230 个“未观察到标记”只是优先排查子集，只读接口不要求幂等键。
4. 将已验证的幂等、CAS、错误与审计合同接入领域专项测试，不以字符串标记替代行为测试。
5. 持续扩展 role × permission × resident/institution/region 的运行时允许和拒绝矩阵。
