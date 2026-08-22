# MODULE MAP — 主线模块地图

> 实施分支 AS-IS 快照：基于 `main@a15d10d`。模块是可分配责任和验证的架构单元，不等同于每一个 JavaScript 文件。

## 1. HTTP 模块与所有权

| 进程 | 路由域 | 路由段 | 可识别精确 API 下限 | 主要职责 |
|---|---|---:|---:|---|
| T00 | regional / runtime composition | 2 | 3 | 组合根、区域运行时、全局顺序和协议；组合根本身不作为领域路由域 |
| T01 | runtime / identity-security | 8 | 31 | 健康、指标、登录、会话、OIDC/SMS、授权和安全控制 |
| T02 | platform-governance / state-data | 16 | 109 | 平台治理、证据、状态适配、迁移与发布控制；含已移交的医院运行 dashboard 与 command |
| T03 | public-health | 4 | 49 | 监测、直报、出生死亡和公卫运营 |
| T04 | citizen-chronic | 7 | 34 | 居民档案、家庭授权、慢病管理 |
| T05 | care-coordination | 10 | 32 | 挂号、转诊、护理、陪诊和履约 |
| T06 | clinical-specialties | 8 | 40 | 急救、用血、影像、体检和质量安全；operations 路由已全部移交 T02 |
| T07 | insurance-payment | 4 | 27 | 医保、支付、退款和凭证 |
| T08 | integration | 3 | 13 | 外部网关、签名回调和交换 |
| T09 | research / shared | 14 | 30 | 科研沙箱、组合查询和确实跨域的体验 |

历史字面扫描识别 368 个精确 method/path 下限；当前扫描识别 372 个字面条件路由和 588 条授权声明，机器生产目录取并集后形成 594 个唯一接口，其中 587 个为字面 method/path、7 个保留运行时策略阻断。目录复用现有授权矩阵和 route source inventory，不新增平行路由注册表；`npm run routes:check` 继续负责模块语法与装配边界。

## 2. 主要服务模块

| 层 | 位置 | 现状 |
|---|---|---|
| 组合根 | `server.js`、`src/http/platform-runtime-composition.js` | 仍向上下文注入数百个函数，耦合中心 |
| 路由器 | `src/http/api-router.js`、`src/http/routes/index.js` | 固定顺序、ID 唯一、响应短路，结构清楚 |
| 运行时上下文 | `src/http/runtime-contexts/` | 领域依赖列表显式，但 public-health 160 项、care 102 项，接口过宽 |
| 身份安全 | `src/identity-security/`、`production-adapters.js`、`session-store.js`、`auth-security-state-store.js` | Cookie/CSRF、OIDC/JWKS、SMS、会话仓储、共享 OTP/限流/锁定状态和 v2 审计链验证已模块化；生产 bearer/hybrid 受显式兼容门禁约束并保持 NO-GO |
| 平台数据 | `src/platform/data/`、`src/platform/storage/` | 数据所有权、SQLite migration 注册表/runner、PostgreSQL 主存储契约；集合治理对 252/252 个快照集合给出 owner/system/review/quarantine 状态 |
| 领域事件 | `src/platform/events/`、各领域 worker | outbox/inbox、幂等和后台投递 |
| 慢病随访 publisher | `citizen-chronic-followup-event-service.js`、`src/citizen-chronic/followup-event-publisher.js` | T04 自有 v1 事件、安全 HTTPS 投递端口、独立 activation verifier 和本地兼容适配；尚无生产 worker/持久 lease |
| 审计投递 | `src/identity-security/audit-delivery-source.js`、`src/platform/operations/audit-delivery.js`、`scripts/audit-delivery-worker.js`、`scripts/audit-delivery-preflight.js` | v15 同事务 append-only source、最小投影、cursor 批次和 checkpoint v3 已实现；v2 snapshot 不静默提升，可信 receipt、外部 anchor 和真实 WORM capability 仍使生产失败关闭 |
| 安全对象存储端口 | `secure-object-storage.js`、`scripts/object-storage-readiness.js` | T00 管版本化请求/响应信任、精确 Origin/TTL、严格回执和生产门禁；T08 附件路由在兼容容量达到 500 条时先失败关闭，不再静默淘汰既有元数据；持久命令、无损分页和对账仍未建立 |
| 区域运行 | `src/platform/regional/`、`regions/` | 多地区清单、能力包、复制和发布注册 |
| 领域实现 | `src/care-coordination/` 等与根目录服务 | 新旧实现并存，边界尚未完全迁移 |
| 前端共享 | `auth.js`、`shared.js`、`platform-api-client.js`、`platform-shell.js` | 身份上下文、API 调用、壳和设计系统；服务端 token 不进入 localStorage，Cookie 上下文优先，陈旧凭据启动即清理 |
| 静态发布与浏览器安全 | `src/http/static-asset-policy.js`、`src/http/static-content-runtime.js`、`src/http/browser-security-policy.js`、`src/http/browser-security-inventory.js`、`page-auth-bootstrap.js`、`scripts/static-publication.js` | 44 个入口、递归资源图、Pages 制品和服务端读取共用默认拒绝契约；页面守卫使用外部标准接口，显式发布图 P0/P1 静态风险为 0；严格 CSP 仍是 Report-Only，生产 NO-GO |
| 演示脱敏 | `src/platform/data/public-demo-snapshot.js` | 服务端合成、Pages 构建和 storage-admin 共用纯函数，凭据字段删除、个人姓名/身份/联系字段稳定掩码 |
| API 生产目录 | `routeSourceFiles` + `scripts/api-authorization-matrix.js` → `scripts/production-api-catalog.js` | 字面路由与声明级授权事实合并为 endpoint 级 owner/auth/scope/idempotency/生产状态；249 项保留治理复核，全部生产 NO-GO |

## 3. 依赖宽度

运行时上下文显式依赖数：public-health 160、care-coordination 102、clinical-specialties 76、citizen-chronic 64、shared 50、identity-security 45。显式依赖好于隐藏全局变量，但这些宽接口会让组合根、测试夹具和跨域演进同步变化，是当前最大的模块耦合指标。

静态 CommonJS 图（排除测试）包含 526 个文件、861 条本地边。最高入度：

- `src/http/runtime-source.js`：62；
- `src/platform/governance/technical-evidence.js`：22；
- `src/platform/regional/region-manifest.js`：18；
- 公卫密钥环/适配服务：10–13。

## 4. 循环依赖收口（ARC-002 已关闭）

```text
scripts/platform-cutover-alert-worker.js
  ├─→ src/platform/cutover/pilot-cutover-alert-runtime.js
  └─→ server.js.pilotCutoverControlPlaneReadiness
          └─→ src/platform/cutover/pilot-cutover-alert-runtime.js
```

平台运行时不再导入组合根；worker CLI 是仓库内该用例的组合边界，并以懒 provider 复用
现有控制面实现。库级调用者必须显式提供 provider；缺失、无效或抛错时返回受限错误码、
`NO-GO` 和非授权投影。架构测试禁止反向依赖恢复，worker 组合测试锁定默认装配；PR #132
及合并后 main CI/Pages 已通过，ARC-002 已关闭。worker 继续加载较大的
`server.js` 属 ARC-001 残余，不在本切片抽取控制面。

## 5. 重复与边界重叠

- 根目录与 `src/` 存在同名模块：`blood-innovation`、`digital-hospital-governance`、`imaging-cloud`、`public-health`、`quality-safety`、`shared`。部分是前端/后端同名，部分是迁移期并存；命名本身不足以判定死代码。
- `server.js` 内仍有大量种子、规范化、存储和领域函数，而相同领域也已在 `src/` 建立模块。
- 数据 owner 清单现有 87 个合同，其中 60 个存在于 252 集合快照；另有 3 个系统集合。其余 189 个
  不复制 owner：188 个精确源码引用登记为 `review-required`，1 个种子专有集合登记为
  `legacy-quarantined`，全部禁止生产晋升。
- 许多 readiness/report 脚本重复读取 `data/db.json` 并各自产生报告，证据生成接口尚未统一。
- 静态发布与 storage-admin 原有脱敏逻辑已收敛到同一纯函数；其他报告脚本的重复读取仍未治理。
- `server.js` 与 `scripts/audit-retention.js` 已统一消费 `src/identity-security/audit-chain.js`；审计验证不再保留两份平行语义。

## 6. 超大文件

| 文件 | 行数约 | 风险 |
|---|---:|---|
| `server.js` | 28,189 | 组合根、种子和领域函数仍集中；SQLite migration 已抽离 |
| `digital-hospital-standard-platform/app.js` | 10,563 | 单文件子站 |
| `test/api.test.js` | 8,140 | 回归范围巨大、定位慢 |
| `citizen.js` | 6,066 | 居民端视图、状态和流程耦合 |
| `portal.css` | 5,243 | 全局样式影响面大 |
| `test/static.test.js` | 5,058 | 静态结构测试集中 |
| `public-health.js` | 4,467 | 公卫前端大控制器 |
| `platform.js` / `operations.js` | 3,804 / 3,716 | 管理和运营端耦合 |
| `src/http/routes/care-coordination.js` | 2,174 | 单领域路由仍过大 |

## 7. 死代码判定原则

本次未把“同名”或“无静态入边”直接判为死代码。高可信候选必须同时满足：无路由/页面/脚本/动态加载引用、测试不覆盖、运行时观察无调用、owner 确认可删除。当前最明确的问题是循环和重叠，而不是已经授权删除的文件。

## 8. 临床专科五子域

| 子域 | Owner | API 字面路径 | 边界状态 |
|---|---|---:|---|
| emergency | T06/emergency | 37 | 急救/信号前缀已唯一归属；dashboard 查询已进入目标源码根 |
| blood | T06/blood | 28 | dashboard 查询已进入目标源码根；其余仍与 imaging、physical-examination 混合 |
| imaging | T06/imaging | 17 | dashboard 查询与公开响应净化已进入目标源码根 |
| physical-examination | T06/physical-examination | 7 | dashboard 查询已进入目标源码根；写命令仍与 blood-innovation 混合 |
| quality-safety | T06/quality-safety | 14 | 写模型限定为质量自有数据 |

原有 33 个 `/api/operations` 字面路径已全部移交 T02：dashboard 由 `platform-governance/operations-dashboard` 承载，其余 32 个由 `platform-governance/operations-command` 承载。两次移交都只替换各自原全局 manifest 插槽的 owner segment，没有改变公开路由顺序、method/path、鉴权、响应、数据副作用或部署方式；T06 facade 和 runtime context 已无 operations 依赖。

首个标准接口为 `emergency-dashboard-query.v1`：路由完成角色校验和脱敏，查询用例通过 `buildEmergencyDashboard` 与 `readBloodCoordination` 两个注入端口组合只读结果。其余急救写用例仍由遗留模块承担。

血液首个标准接口为 `blood-dashboard-query.v1`：通过 `normalizeTransactionState` 和 `buildBloodDashboard` 两个注入端口保留遗留组装顺序，并在用例内统一 commission 全域、institution 机构范围投影。HTTP 层未新增数据写入；混合路由内的影像、血液写命令和集成接口尚未迁移。

影像首个标准接口为 `imaging-dashboard-query.v1`：通过 `buildImagingDashboard`、`redactSensitiveResponse` 两个注入端口生成结果，并由影像自有 `public-response` 递归剔除凭据、物理存储位置和内部 URL。HTTP 适配器继续执行居民范围检查和既有访问审计持久化；影像写命令与互认流程仍在混合路由。

体检首个标准接口为 `physical-examination-dashboard-query.v1`：通过 `buildPhysicalExamOverview`、`buildPhysicalExamReadiness` 两个注入端口生成查询视图，并在用例内统一 citizen 最小 readiness 与管理角色完整投影。HTTP 适配器继续执行范围拒绝、安全事件、居民访问审计、持久化和最终脱敏；体检导入与闭环命令尚未迁移。

## 9. SQLite migration 模块

`src/platform/storage/sqlite-migrations.js` 是 T00 管理的单一注册表和执行入口。`server.js` 只消费 `SQLITE_SCHEMA_HEAD` 与 `applySqliteMigrations`；部署检查、生产数据库 readiness 和发布报告消费同一注册表校验结果。v1–v14 保持历史 ledger checksum 并冻结源码指纹；v15 使用内容指纹追加 append-only 审计 source，head 为 15。任何后续 DDL 必须从 v16 连续追加，不允许领域模块绕过注册表。

## 10. 标准工程门禁模块

- `scripts/standard-build.js` 是标准构建适配器，委托既有 `static-publication`
  allowlist；默认使用系统临时目录，显式输出仍必须位于仓库外。
- `scripts/run-standard-test-suite.js` 与 `config/standard-test-suites.json` 管理测试分类；
  integration 冻结旧 `npm test` 清单，unit 是 `test:all` 根测试集合的精确补集，smoke
  只保留隔离启动与发布健康检查。
- `eslint.config.js` 与 `jsconfig.typecheck.json` 是渐进式静态质量边界，不拥有业务接口。
  Pages、complete-unit-test、governance-api 和 release-readiness 只消费这些标准入口；
  `test:all` 仍是独立的自动发现回归保护。

## 11. 区域共享调阅命令

| 模块 | Owner / Process | 类型 | 当前边界 |
|---|---|---|---|
| `src/platform/governance/regional-sharing-access-command.js` | 机器 owner T00 integration；目标 platform-governance / T02 | `regional-sharing-access-command.v1` 写用例 | 服务端授权、幂等、应用层 CAS、package queue、回执与审计组装；不导入 `server.js` |
| `src/platform/governance/resident-authorization-decision-adapter.js` | 机器 owner T00 integration；目标 T02 consumer adapter | `resident-authorization-decision.v1` anti-corruption adapter | 唯一读取 T04 `personalRecords` meta 的边界；命令只消费结构化决策端口 |
| `src/http/routes/shared.js` 的 `shared-05` | 兼容 HTTP 适配器 | 原 method/path/顺序 | 认证外层、读取/写入端口、兼容响应头；不再拥有旧 review 决策函数 |
| `src/http/routes/state-data.js` | platform-state / T02；跨 owner 收口 T00 | legacy state 兼容边界 | 四个区域集合只能省略或深相等，拒绝全量/集合级客户端旁路 |
| `citizen-records-v1/v2` | citizen-chronic / T04 | 授权事实端口 | 提供授权状态与 lifecycle；T02 只读消费，不复制授权模型 |
| `config/regional-sharing-access-data-contract.json` | T00/T02 治理证据 | 数据晋升合同 | 锁定 owner、跨域合同、无 DDL 迁移理由、回滚和生产 NO-GO |

两个区域共享 GET builder 仍在组合根，`shared-05` 仍是混合路由；本切片只迁移 access command 并最小化 GET review 投影，不宣称区域共享模块已完整独立或已经具备跨进程生产事务。

`config/process-workstreams.json` 对两个新 governance 源文件登记当前可验证的 T00 integration owner；这是跨 owner 接线期的源码责任，不改变 `domain-data-ownership.json` 中四个区域集合的目标 T02 数据 owner。后续正式移交必须在独立 ADR/流程变更中同时更新源码 owner 和运行时边界。
## 12. 慢病随访 publisher 边界

依赖方向为 `citizen-chronic HTTP route → followup event service → T04 publisher port → HTTPS
provider`。publisher 只接受 `followupId/status/updatedAt/version` 四个事件 payload 字段，绑定
event、correlation 和 payload digest；`requestId`/nonce 由 event 与 payload digest 稳定派生，
允许重试重验供应方返回的完全相同幂等回执。生产先通过独立注入的 activation verifier，再做
公网解析、HTTPS/443、无重定向和 HMAC 回执校验；service 只接受模块私有 capability，不能信任
自定义 publisher 的布尔声明。机构 route 在外发前按 resident/org scope 建立 aggregate allowlist
并先持久化授权/尝试安全审计；审计不可用时不调用 publisher。该边界没有反向依赖
`server.js`，也未引入 worker、schema 或 T00 运行时装配。

## 13. T05 转诊命令 owner

`src/care-coordination/referral-command-service.js` 是 `referral-order.v1` 的唯一写 owner。`care-coordination` 路由中的直接转诊动作、通用 workflow 兼容分支和统一 task 兼容分支只负责 HTTP 适配与原响应映射，不得直接修改 `referralSystem.referrals`。居民任务消息仍是 owner command 成功后的兼容副作用，不属于转诊聚合事务。

## 14. 健康驾驶舱指标合同

T02 新增的 `health-dashboard-indicator-contract` 是纯合同/测量模块，依赖既有
`technical-evidence` 稳定摘要工具，不读取存储、路由或组合根。遗留
`health-dashboard-summary` 仍是大型兼容聚合器，但首个门急诊指标已通过小端口获得可测试的
定义、测量和 fail-closed 质量语义。历史 `industry-*` ID 继续兼容，并同时公开 canonical
ID 与弃用 alias；后续指标必须按 owner 逐个接入，不得继续按数组位置复用定义和值。

## 15. State collection 治理模块

`src/platform/data/collection-governance.js` 继续是唯一集合治理纯逻辑；
`scripts/data-collection-governance.js` 从 Git 跟踪的 599 个 JS/HTML 运行时源派生精确引用，并复用
`process-worktree` 的路径 owner 解析。`config/state-collection-governance.json` 只记录无数据 owner
集合的 `review-required`/`legacy-quarantined` 状态，不复制 `domain-data-ownership`。源码 process
owner、文件引用和 closed-world 核心概念匹配只是证据，不能自动晋升为数据 owner。该 B 类模块
不读写业务数据库，不改变 runtime state，也不生成仓库内报告；原 release 报告命令继续保留。
