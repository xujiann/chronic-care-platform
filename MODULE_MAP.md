# MODULE MAP — 主线模块地图

> 实施分支 AS-IS 快照：基于 `main@a15d10d`。模块是可分配责任和验证的架构单元，不等同于每一个 JavaScript 文件。

## 1. HTTP 模块与所有权

| 进程 | 路由域 | 路由段 | 可识别精确 API 下限 | 主要职责 |
|---|---|---:|---:|---|
| T00 | regional / runtime composition | 2 | 3 | 组合根、区域运行时、全局顺序和协议；组合根本身不作为领域路由域 |
| T01 | runtime / identity-security | 8 | 31 | 健康、指标、登录、会话、OIDC/SMS、授权和安全控制 |
| T02 | platform-governance / state-data | 14 | 76 | 平台治理、证据、状态适配、迁移与发布控制 |
| T03 | public-health | 4 | 49 | 监测、直报、出生死亡和公卫运营 |
| T04 | citizen-chronic | 7 | 34 | 居民档案、家庭授权、慢病管理 |
| T05 | care-coordination | 10 | 32 | 挂号、转诊、护理、陪诊和履约 |
| T06 | clinical-specialties | 10 | 73 | 急救、用血、影像、体检和质量安全 |
| T07 | insurance-payment | 4 | 27 | 医保、支付、退款和凭证 |
| T08 | integration | 3 | 13 | 外部网关、签名回调和交换 |
| T09 | research / shared | 14 | 30 | 科研沙箱、组合查询和确实跨域的体验 |

静态扫描识别 368 个唯一的精确 method/path 组合，未发现重复；动态参数和 prefix 路由未计入该数字。`npm run routes:check` 对 64 个受检模块通过。

## 2. 主要服务模块

| 层 | 位置 | 现状 |
|---|---|---|
| 组合根 | `server.js`、`src/http/platform-runtime-composition.js` | 仍向上下文注入数百个函数，耦合中心 |
| 路由器 | `src/http/api-router.js`、`src/http/routes/index.js` | 固定顺序、ID 唯一、响应短路，结构清楚 |
| 运行时上下文 | `src/http/runtime-contexts/` | 领域依赖列表显式，但 public-health 160 项、care 102 项，接口过宽 |
| 身份安全 | `src/identity-security/`、`session-store.js` | Cookie/CSRF、策略、会话仓储和审计已模块化 |
| 平台数据 | `src/platform/data/`、`src/platform/storage/` | 数据所有权、SQLite migration 注册表/runner、PostgreSQL 主存储契约 |
| 领域事件 | `src/platform/events/`、各领域 worker | outbox/inbox、幂等和后台投递 |
| 区域运行 | `src/platform/regional/`、`regions/` | 多地区清单、能力包、复制和发布注册 |
| 领域实现 | `src/care-coordination/` 等与根目录服务 | 新旧实现并存，边界尚未完全迁移 |
| 前端共享 | `auth.js`、`shared.js`、`platform-api-client.js`、`platform-shell.js` | 身份上下文、API 调用、壳和设计系统 |
| 静态发布 | `src/http/static-asset-policy.js`、`src/http/static-content-runtime.js`、`scripts/static-publication.js`、`config/static-publication.json` | 44 个入口、递归资源图、Pages 制品和服务端读取共用一份默认拒绝契约；HTTP 细节不再堆入组合根 |
| 演示脱敏 | `src/platform/data/public-demo-snapshot.js` | 服务端合成、Pages 构建和 storage-admin 共用纯函数，凭据字段删除、个人姓名/身份/联系字段稳定掩码 |

## 3. 依赖宽度

运行时上下文显式依赖数：public-health 160、care-coordination 102、clinical-specialties 76、citizen-chronic 64、shared 50、identity-security 45。显式依赖好于隐藏全局变量，但这些宽接口会让组合根、测试夹具和跨域演进同步变化，是当前最大的模块耦合指标。

静态 CommonJS 图（排除测试）包含 526 个文件、861 条本地边。最高入度：

- `src/http/runtime-source.js`：62；
- `src/platform/governance/technical-evidence.js`：22；
- `src/platform/regional/region-manifest.js`：18；
- 公卫密钥环/适配服务：10–13。

## 4. 循环依赖收口（ARC-002 本地候选）

```text
scripts/platform-cutover-alert-worker.js
  ├─→ src/platform/cutover/pilot-cutover-alert-runtime.js
  └─→ server.js.pilotCutoverControlPlaneReadiness
          └─→ src/platform/cutover/pilot-cutover-alert-runtime.js
```

平台运行时不再导入组合根；worker CLI 是仓库内该用例的组合边界，并以懒 provider 复用
现有控制面实现。库级调用者必须显式提供 provider；缺失、无效或抛错时返回受限错误码、
`NO-GO` 和非授权投影。架构测试禁止反向依赖恢复，worker 组合测试锁定默认装配；本地候选
已无该循环且只读 review 无 P0/P1，仍须经 PR 和 main CI 才能关闭 ARC-002。worker 继续加载较大的
`server.js` 属 ARC-001 残余，不在本切片抽取控制面。

## 5. 重复与边界重叠

- 根目录与 `src/` 存在同名模块：`blood-innovation`、`digital-hospital-governance`、`imaging-cloud`、`public-health`、`quality-safety`、`shared`。部分是前端/后端同名，部分是迁移期并存；命名本身不足以判定死代码。
- `server.js` 内仍有大量种子、规范化、存储和领域函数，而相同领域也已在 `src/` 建立模块。
- 252 个 JSON 集合中仅 83 个进入数据所有权清单；其余被策略标为 legacy-non-authoritative。
- 许多 readiness/report 脚本重复读取 `data/db.json` 并各自产生报告，证据生成接口尚未统一。
- 静态发布与 storage-admin 原有脱敏逻辑已收敛到同一纯函数；其他报告脚本的重复读取仍未治理。
- `server.js` 与 `scripts/audit-retention.js` 各维护一份同语义 `verifyAuditTrail`；宽松失败判定和后续修复必须通过一个版本化安全端口统一，不能分别修改。

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

另有 33 个 `/api/operations` 字面路径属于历史错位，目标为 `platform-governance/operations`。五子域治理注册表不改变现有路由顺序或部署方式。

首个标准接口为 `emergency-dashboard-query.v1`：路由完成角色校验和脱敏，查询用例通过 `buildEmergencyDashboard` 与 `readBloodCoordination` 两个注入端口组合只读结果。其余急救写用例仍由遗留模块承担。

血液首个标准接口为 `blood-dashboard-query.v1`：通过 `normalizeTransactionState` 和 `buildBloodDashboard` 两个注入端口保留遗留组装顺序，并在用例内统一 commission 全域、institution 机构范围投影。HTTP 层未新增数据写入；混合路由内的影像、血液写命令和集成接口尚未迁移。

影像首个标准接口为 `imaging-dashboard-query.v1`：通过 `buildImagingDashboard`、`redactSensitiveResponse` 两个注入端口生成结果，并由影像自有 `public-response` 递归剔除凭据、物理存储位置和内部 URL。HTTP 适配器继续执行居民范围检查和既有访问审计持久化；影像写命令与互认流程仍在混合路由。

体检首个标准接口为 `physical-examination-dashboard-query.v1`：通过 `buildPhysicalExamOverview`、`buildPhysicalExamReadiness` 两个注入端口生成查询视图，并在用例内统一 citizen 最小 readiness 与管理角色完整投影。HTTP 适配器继续执行范围拒绝、安全事件、居民访问审计、持久化和最终脱敏；体检导入与闭环命令尚未迁移。

## 9. SQLite migration 模块

`src/platform/storage/sqlite-migrations.js` 是 T00 管理的单一注册表和执行入口。`server.js` 只消费 `SQLITE_SCHEMA_HEAD` 与 `applySqliteMigrations`；部署检查、生产数据库 readiness 和发布报告消费同一注册表校验结果。v1–v14 定义保持原执行顺序和历史 ledger checksum，独立冻结指纹阻止源码漂移；v15 及以后必须使用内容指纹作为 ledger checksum。该模块不拥有业务数据，不允许领域模块绕过注册表执行 DDL。

## 10. 标准工程门禁模块

- `scripts/standard-build.js` 是标准构建适配器，委托既有 `static-publication`
  allowlist；默认使用系统临时目录，显式输出仍必须位于仓库外。
- `scripts/run-standard-test-suite.js` 与 `config/standard-test-suites.json` 管理测试分类；
  integration 冻结旧 `npm test` 清单，unit 是 `test:all` 根测试集合的精确补集，smoke
  只保留隔离启动与发布健康检查。
- `eslint.config.js` 与 `jsconfig.typecheck.json` 是渐进式静态质量边界，不拥有业务接口。
  Pages、complete-unit-test、governance-api 和 release-readiness 只消费这些标准入口；
  `test:all` 仍是独立的自动发现回归保护。
