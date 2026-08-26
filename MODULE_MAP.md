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

历史字面扫描识别 368 个精确 method/path 下限；当前扫描识别 371 个字面条件路由和 601 条授权声明（含 13 条机器认证证据声明），机器生产目录取并集后形成 593 个唯一接口，其中 585 个为字面 method/path、8 个保留运行时策略阻断。扫描器不再跨越已结束的相邻 handler 配对 method/path；目录复用现有授权矩阵和 route source inventory，不新增平行路由注册表，`npm run routes:check` 继续负责模块语法与装配边界。

## 2. 主要服务模块

| 层 | 位置 | 现状 |
|---|---|---|
| 组合根 | `server.js`、`src/http/platform-runtime-composition.js` | 仍向上下文注入数百个函数，耦合中心 |
| 路由器 | `src/http/api-router.js`、`src/http/routes/index.js` | 固定顺序、ID 唯一、响应短路，结构清楚 |
| 运行时上下文 | `src/http/runtime-contexts/` | 领域依赖列表显式，但 public-health 160 项、care 102 项，接口过宽 |
| 身份安全 | `src/identity-security/`、`production-adapters.js`、`session-store.js`、`auth-security-state-store.js` | Cookie/CSRF、OIDC/JWKS、SMS、会话仓储、共享 OTP/限流/锁定状态和 v2 审计链验证已模块化；生产 bearer/hybrid 受显式兼容门禁约束并保持 NO-GO |
| 平台数据 | `src/platform/data/`、`src/platform/storage/` | 数据所有权、SQLite migration 注册表/runner、PostgreSQL 主存储契约；集合治理对 252/252 个快照集合给出 owner/system/review/quarantine 状态 |
| 领域事件 | `src/platform/events/`、各领域 worker | outbox/inbox、幂等和后台投递 |
| 慢病随访 durable dispatch | `citizen-chronic-followup-event-service.js`、`src/citizen-chronic/followup-event-publisher.js`、`followup-dispatch-*` | T04 v1 事件/投递语义 + T00 SQLite v16/outbox/worker/部署装配；真实外部 activation decision、回执与现场启用仍 NO-GO |
| 审计投递 | `src/identity-security/audit-delivery-source.js`、`src/platform/operations/audit-delivery.js`、`scripts/audit-delivery-worker.js`、`scripts/audit-delivery-preflight.js` | v15 同事务 append-only source、最小投影、cursor 批次和 checkpoint v3 已实现；v2 snapshot 不静默提升，可信 receipt、外部 anchor 和真实 WORM capability 仍使生产失败关闭 |
| 安全对象存储端口 | `secure-object-storage.js`、`scripts/object-storage-readiness.js` | T00 管版本化请求/响应信任、精确 Origin/TTL、严格回执和生产门禁；T08 附件路由在兼容容量达到 500 条时先失败关闭，不再静默淘汰既有元数据；持久命令、无损分页和对账仍未建立 |
| 区域运行 | `src/platform/regional/`、`regions/` | 多地区清单、能力包、复制和发布注册 |
| 领域实现 | `src/care-coordination/` 等与根目录服务 | 新旧实现并存，边界尚未完全迁移 |
| 前端共享 | `auth.js`、`shared.js`、`platform-api-client.js`、`platform-shell.js` | 身份上下文、API 调用、壳和设计系统；服务端 token 不进入 localStorage，Cookie 上下文优先，陈旧凭据启动即清理 |
| 静态发布与浏览器安全 | `src/http/static-asset-policy.js`、`src/http/static-content-runtime.js`、`src/http/browser-security-policy.js`、`src/http/browser-security-inventory.js`、`browser-safe-url.js`、`page-auth-bootstrap.js`、`scripts/static-publication.js` | 44 个入口、145 个显式发布资产、Pages 制品和服务端读取共用默认拒绝契约；血液主工作台、急救生命链、医生工作台、血液上线看板、陪诊工作台、产品运行驾驶舱、产品区域运行驾驶舱、质量安全工作台、区域切换工作台、血液召回面板、血液创新指挥中心及体检工作台已改为可信 DOM/text 渲染，Safe URL port 按 internal/official/object-storage/tel/blob 能力在 mutation 前检查协议、凭据和 exact-Origin。Inventory v2 现锁定 799 个 DOM HTML、6 个动态 URL 和 42 个动态样式风险；体检工作台自身 P0/P1 finding 已归零，2 个 OHIF URL occurrence 仍复核。严格 CSP 仍是 Report-Only，生产 NO-GO |
| 演示脱敏 | `src/platform/data/public-demo-snapshot.js` | 服务端合成、Pages 构建和 storage-admin 共用纯函数，凭据字段删除、个人姓名/身份/联系字段稳定掩码 |
| API 生产目录 | `routeSourceFiles` + `api-authentication-evidence` + `api-idempotency-evidence` → `api-authorization-matrix-v3` → `production-api-catalog-v3` | 13 项认证证据保持未分类为 0。13 份幂等行为合同覆盖 11 个完整 endpoint 与 2 个转诊 action-slice；T03 highlight signal intake 复用既有 public-health route/service 和 bounded `publicHealthSignals`，增加 canonical 来源机构范围、actor 组织命名空间 key hash、按 key 单进程命令锁、锁内重读、稳定错误和 signal+audit 单次提交。322 个写接口仍缺 endpoint 级行为证明；退款 runtime-role variant 与通用 action remainder 使 324 项保持复核，全部生产 NO-GO。`reviewedProofRequired` 为零；有界 ledger、进程锁与 SQLite CAS 不是多实例生产证明 |
| 内部边界覆盖治理 | `config/internal-boundary-coverage.json` → `scripts/internal-boundary-coverage.js` | 复用现有 c8/直接行为测试，以 10 个不重叠源码组锁定 identity、audit、object storage、API governance、worker observability、区域共享命令、转诊 owner command、科研合规导出、浏览器响应头与 Safe URL 真实基线；每组绑定至少一条实际执行的负向合同，报告仅写临时目录 |
| Playwright E2E 基础设施 | `playwright-browser-policy.v1`、`playwright-pwa-browser-policy.v1`、`playwright-port-policy`、三套 runner/config | 在线根 39 项（含急救生命链、医生工作台、血液上线看板、陪诊工作台、产品运行驾驶舱、产品区域运行驾驶舱、质量安全工作台、区域切换工作台、血液召回面板、血液创新指挥中心、体检风险卡恶意响应回归与 Go/No-Go 四方审批角色命名空间回归）与居民 13 项继续阻止 Service Worker；独立 PWA 3 项只在专项 context 允许 Worker，三套共 55 项唯一并集，统一 Chromium、动态端口和临时数据，并验证缓存/注册清理 |
| 生产证据信任 provider | `src/platform/governance/production-evidence-trust-provider.js` → `scripts/production-preflight.js` | T00 通用 signed-envelope/anchor 验证端口与 production decision 适配；CLI 可部署装配，双角色 Ed25519、pin、撤销、时窗和发布上下文失败关闭；不拥有生产授权 |

## 3. 依赖宽度

运行时上下文显式依赖数：public-health 160、care-coordination 102、clinical-specialties 76、citizen-chronic 64、shared 50、identity-security 45。显式依赖好于隐藏全局变量，但这些宽接口会让组合根、测试夹具和跨域演进同步变化，是当前最大的模块耦合指标。

静态 CommonJS 图（排除测试）包含 527 个文件、862 条本地边。最高入度：

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
- 数据 owner 清单现有 106 个合同，其中 60 个是快照内既有可写合同，19 个是首发范围内完成唯一
  owner/reader/classification 审查但显式禁止生产写入的 legacy 合同，27 个当前不在 252 集合快照；
  另有 3 个系统集合。其余 170 个不复制 owner：169 个精确源码引用登记为 `review-required`，1 个
  种子专有集合登记为 `legacy-quarantined`。19 个 owner-reviewed legacy 与 170 个未分配 legacy
  均禁止生产写入和晋升。
- 许多 readiness/report 脚本重复读取 `data/db.json` 并各自产生报告，证据生成接口尚未统一。
- 静态发布与 storage-admin 原有脱敏逻辑已收敛到同一纯函数；其他报告脚本的重复读取仍未治理。
- `server.js` 与 `scripts/audit-retention.js` 已统一消费 `src/identity-security/audit-chain.js`；审计验证不再保留两份平行语义。

## 6. 超大文件

| 文件 | 行数约 | 风险 |
|---|---:|---|
| `server.js` | 28,731 | 组合根、种子和领域函数仍集中；SQLite migration 已抽离 |
| `digital-hospital-standard-platform/app.js` | 10,563 | 单文件子站 |
| `test/api.test.js` | 约 8,200 | 回归范围仍巨大；共享运行时及 hospital、alert、financial、object-storage 四个单一 mock 生命周期已提取，业务断言仍集中 |
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
| imaging | T06/imaging | 17 | dashboard、公开响应净化及 share/QC 两个写用例已进入目标源码根 |
| physical-examination | T06/physical-examination | 7 | dashboard 查询与专项分流 action command 已进入目标源码根；其余写命令仍与 blood-innovation 混合 |
| quality-safety | T06/quality-safety | 14 | 写模型限定为质量自有数据 |

原有 33 个 `/api/operations` 字面路径已全部移交 T02：dashboard 由 `platform-governance/operations-dashboard` 承载，其余 32 个由 `platform-governance/operations-command` 承载。两次移交都只替换各自原全局 manifest 插槽的 owner segment，没有改变公开路由顺序、method/path、鉴权、响应、数据副作用或部署方式；T06 facade 和 runtime context 已无 operations 依赖。

首个标准接口为 `emergency-dashboard-query.v1`：路由完成角色校验和脱敏，查询用例通过 `buildEmergencyDashboard` 与 `readBloodCoordination` 两个注入端口组合只读结果。其余急救写用例仍由遗留模块承担。

血液首个标准接口为 `blood-dashboard-query.v1`：通过 `normalizeTransactionState` 和 `buildBloodDashboard` 两个注入端口保留遗留组装顺序，并在用例内统一 commission 全域、institution 机构范围投影。HTTP 层未新增数据写入；混合路由内的影像、血液写命令和集成接口尚未迁移。

影像标准接口现包含 `imaging-dashboard-query.v1`、`imaging-study-share-command.v1` 和
`imaging-study-quality-control-command.v1`。share 由既有 `imaging-cloud` HTTP 适配器保留鉴权、居民范围、
body 顺序、持久化和公开响应投影，目标模块构造既有 share 状态并调用注入的数据访问审计/UUID 端口。
QC 同样保留原 commission/institution、先查检查再读 body、FHIR 失败审计、单次状态写和公开投影；目标命令
只消费 `publishDiagnosticReportToFhir` 与 UUID 端口。两个写用例均已离开 `clinical-blood`，其余影像写命令
与互认流程仍在混合路由。QC 的外部调用先于本地提交、无幂等/CAS/机构范围等既有债务未被本切片关闭。

体检标准接口现包括 `physical-examination-dashboard-query.v1` 和 `physical-examination-specialized-intake-action-command.v1`。前者通过两个注入端口生成查询视图并统一角色投影；后者通过显式业务、审计、时钟、规范化和持久化端口执行专项分流动作。HTTP 适配器继续执行鉴权、请求解析、记录定位、居民范围、错误映射及响应；体检导入、异常处置、联调等命令尚未迁移。

## 9. SQLite migration 模块

`src/platform/storage/sqlite-migrations.js` 是 T00 管理的单一注册表和执行入口。`server.js` 与部署/readiness/发布报告消费同一注册表结果。v1–v14 保持历史 ledger checksum 并冻结源码指纹；v15 追加 append-only 审计 source，v16 追加慢病随访 durable outbox，当前 head 为 16。任何后续 DDL 必须从 v17 连续追加，不允许领域模块绕过注册表。

## 10. 标准工程门禁模块

- `scripts/standard-build.js` 是标准构建适配器，委托既有 `static-publication`
  allowlist；默认使用系统临时目录，显式输出仍必须位于仓库外。
- `scripts/run-standard-test-suite.js` 与 `config/standard-test-suites.json` 管理测试分类；
  integration 冻结旧 `npm test` 清单，unit 是 `test:all` 根测试集合的精确补集，smoke
  只保留隔离启动与发布健康检查。TEST-006 将 `test/api.test.js` 标为 integration isolated hotspot，
  不改变成员和执行顺序；runner 输出 batch/suite `durationMs`，不设置或放宽耗时阈值。
- `test/helpers/api-regression-runtime.js` 只拥有上述 API 热点的临时 JSON seed、测试环境变量和同一
  `server.js` 启停生命周期；它显式返回测试正文仍需的 fixture 与数字医院测试句柄，不拥有 API、领域状态机、
  生产配置或外部证据。工程门禁锁定 43 个子测试的数量和顺序摘要，后续只能继续按一个共享生命周期小步拆分。
- `test/helpers/hospital-adapter-mock-runtime.js` 只拥有同一 integration 子测试内的 HIS mock HTTP server、
  动态回环端口、3 个既有测试环境变量和关闭清理；请求记录仍返回原测试正文完成响应、签名和次数断言。它不是
  hospital 生产 adapter、公共测试 SDK 或外部回执来源。
- `test/helpers/alert-delivery-mock-runtime.js` 只拥有单个告警投递子测试内的 SIEM mock HTTP server、请求数组、
  成功/503 失败开关、动态回环端口、3 个既有测试环境变量和关闭清理；测试正文仍显式控制失败后恢复和重试顺序。
  它不是生产 SIEM adapter、公共测试 SDK 或外部投递证据。
- `test/helpers/financial-gateway-mock-runtime.js` 只拥有单个金融网关子测试内的 mock HTTP server、请求数组、
  PAYMENT/INSURANCE/CERTIFICATE synthetic receipt 映射、动态回环端口、6 个既有测试环境变量和关闭清理；
  HMAC、callback、reconciliation、retry 和请求次数断言仍在测试正文。它不是生产金融 adapter、公共测试 SDK
  或外部支付/医保/证照回执来源。
- `test/helpers/object-storage-gateway-mock-runtime.js` 只拥有单个附件子测试内的 mock HTTP server、四类 v1
  签名响应、动态回环 URL、请求数组、8 个既有测试环境变量和关闭清理；最小 `setScanStatus` 控制口由测试正文
  按原 clean→恶意 provider 文本顺序驱动，helper 不自行恢复或重试。它不是生产存储 adapter、公共测试 SDK，
  synthetic upload/scan/download/lifecycle 回执与 URL 也不是外部对象存储或现场证据。
- `test/escort-owner-route-characterization.test.js`、`test/internet-nursing-closed-loop-characterization.test.js`
  与 `test/internet-nursing-nurse-lifecycle-characterization.test.js` 是 T05 owner/route 特征测试；共享
  `test/helpers/care-api-characterization-runtime.js` 在各测试进程内启动真实 HTTP 服务并使用临时数据副本，
  以保持派单证据能力与 owner adapter 同一信任边界。三者不拥有业务状态机或生产投递能力。
- `eslint.config.js` 与 `jsconfig.typecheck.json` 是渐进式静态质量边界，不拥有业务接口。
  Pages、complete-unit-test、governance-api 和 release-readiness 只消费这些标准入口；
  `test:all` 仍是独立的自动发现回归保护。两个前端翻译 map 的 16 个重复键已由
  `frontend-duplicate-key-contract` 锁定旧 shadow 值、最终值和调用行为后去重；lint 现无文件级规则例外，
  typecheck 覆盖 13 个唯一边界文件。
- `scripts/internal-boundary-coverage.js` 复用现有 c8 与专项测试，为 10 个关键边界建立独立覆盖组；
  它不替代原 `server.js` 85/85/55 门禁，阈值只能持平或提高，报告不进入仓库。
- `test/operations-command-handoff.test.js` 复用原 T02 handoff harness，把 32 条 operations command
  路径登记为唯一数据驱动行为矩阵；`operations-command:behavior-test` 在 governance-api 显式运行，
  同时仍由标准 unit 补集覆盖。矩阵保护遗留 handler，不是新路由注册表或拆分授权。
- 根、居民和 PWA 三套 Playwright 配置共用 Chromium、动态端口与 runner 端口装配；在线 39 + 13 项
  固定 `serviceWorkers=block`，只有 PWA 3 项使用 `playwright-pwa-browser-policy.v1` 允许 Worker。
  Playwright 列表门禁锁定 39 + 13 + 3 = 55 且无重复，固定端口、系统 Chrome 或 PWA 测试混入在线套件会失败。

## 11. 区域共享调阅命令

| 模块 | Owner / Process | 类型 | 当前边界 |
|---|---|---|---|
| `src/platform/governance/regional-sharing-access-command.js` | 机器 owner T00 integration；目标 platform-governance / T02 | `regional-sharing-access-command.v1` 写用例 | 服务端授权、幂等、应用层 CAS、package queue、回执与审计组装；不导入 `server.js` |
| `src/platform/governance/regional-sharing-read-model.js` | 机器 owner T00 integration；目标 platform-governance / T02 | `regional-sharing-read-model.v1` 两查询只读端口 | 构建共享视图和交接清单；只依赖组合根注入的 legacy normalize/seed/scope/handoff/UUID/clock 端口，不导入 `server.js` 或 HTTP 路由 |
| `src/platform/governance/resident-authorization-decision-adapter.js` | 机器 owner T00 integration；目标 T02 consumer adapter | `resident-authorization-decision.v1` anti-corruption adapter | 唯一读取 T04 `personalRecords` meta 的边界；命令只消费结构化决策端口 |
| `src/http/routes/shared.js` 的 `shared-05` | 兼容 HTTP 适配器 | 原 method/path/顺序 | 认证外层、读取/写入端口、兼容响应头；不再拥有旧 review 决策函数 |
| `src/http/routes/state-data.js` | platform-state / T02；跨 owner 收口 T00 | legacy state 兼容边界 | 四个区域集合只能省略或深相等，拒绝全量/集合级客户端旁路；GET 的 `authUsers` 专用投影移除 `password/passwordHash` 且不修改底层快照 |
| `citizen-records-v1/v2` | citizen-chronic / T04 | 授权事实端口 | 提供授权状态与 lifecycle；T02 只读消费，不复制授权模型 |
| `config/regional-sharing-access-data-contract.json` | T00/T02 治理证据 | 数据晋升合同 | 锁定 owner、跨域合同、无 DDL 迁移理由、回滚和生产 NO-GO |

两个区域共享 GET builder 已由组合根归位到版本化 read-model port，shared runtime context 由两个散函数依赖
收敛为一个 capability；`shared-05` 仍是混合兼容路由，legacy normalize/seed/handoff evidence 仍由组合根注入，
因此不能宣称区域共享模块已完整独立或已经具备跨进程生产事务。

`config/process-workstreams.json` 对三个 regional-sharing governance 源文件登记当前可验证的 T00 integration owner；这是跨 owner 接线期的源码责任，不改变 `domain-data-ownership.json` 中四个区域集合的目标 T02 数据 owner。后续正式移交必须在独立 ADR/流程变更中同时更新源码 owner 和运行时边界。
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

## 16. 慢病随访 durable dispatch 模块

- T04：`followup-event-service`、`followup-event-publisher`、`followup-dispatch-outbox` 合同与
  `followup-dispatch-worker` 状态机语义。
- T00：SQLite v16 注册、`server.js` 事务 hook、worker CLI、生产 preflight、部署包与 systemd/env 合同。
- 信任适配：`followup-dispatch-activation-provider` 校验仓库外 registry 与固定 Ed25519 公钥摘要；审批私钥和
  实际决定不进入仓库。
- 边界：HTTP 路由只提交/查询本地队列；worker 才能调用 publisher。内嵌 outbox 保留 API 兼容，专用
  SQLite outbox 是外部投递权威状态。跨主机 PostgreSQL 实现尚不存在。

## 17. 对象存储 ADR 前置治理模块

| 模块 | Owner / Process | 类型 | 当前边界 |
|---|---|---|---|
| `config/object-storage-architecture-decision.json` | T00 治理；建议 T08 data owner 待确认 | machine decision/action register | 记录 Proposed 状态、两项人类决策、v17 预留和十项 blocked 行动；不是数据 owner 合同或实施授权 |
| `scripts/object-storage-architecture-governance.js` | T00 | 只读 fail-closed CLI | 核对 ADR 状态/章节、行动覆盖、owner 未推断、SQLite head v16/v17 预留和 promotion=false；不写数据库或报告 |
| `test/object-storage-architecture-governance.test.js` | T00 | TEST-001/architecture 保护 | 覆盖误启用 v17/runtime/API/promotion、行动提前、owner 推断、ADR 漂移、版本冲突和未决人类审批 |
| `secure-object-storage.js`、`src/http/routes/integration.js` | 既有 T00/T08 | 未修改运行时 | 保持 v1 信任与同步兼容行为；没有在本切片实现 v17、异步 API、worker 或 reconcile |

建议目标边界是 `T08 owner command/API → T00 structured repository + durable worker → gateway`，但只有 ADR
Accepted、data owner 与兼容策略获人类批准后才能进入逐切片实现。Proposed 台账不能替代
`config/domain-data-ownership.json`，也不能把 T08 route owner 自动解释为 data owner。

## 18. Production evidence trust provider

`production-evidence-trust-provider` 是 T00 的 B 类外部适配模块。通用端口导出稳定 envelope subject、
逐 signer signature payload、bounded JSON reader、anchor validator 和 `verifySignedEnvelope`；production
适配层只把当前 deployment manifest、registry entry 与五份 evidence records 投影为摘要绑定，并返回既有
`registryAttestationVerified/productionEvidenceVerified` 两个布尔结果。私钥、证据正文和 provider 原始错误
不进入模块输出；后续 action evidence 应复用此通用验签端口，不得复制第二套 Ed25519 实现。

## 19. 生产切换行动证据模块

`production-cutover-action-register.js` 现在分为 definitions-only 静态报告和 evidence-derived 动态评估。
前者永远不能产生 production readiness；后者直接复用第 18 节共享验签端口，只输出 action ID、摘要、
时间窗和稳定错误码。`production-promotion-receipt.js` 只在 strict GO 后生成 create-once 摘要凭证；两者
均不依赖 `server.js`、数据库或领域路由，也不拥有现场证据正文。

## 20. 生产 Go/No-Go 受信 receipt 模块

| 模块 | Owner | 类型 | 当前边界 |
|---|---|---|---|
| `production-preflight-decision-receipt.js` | T00 发布治理 | 纯同步 trust port | 校验精确八字段 receipt 合同、稳定标识符、release/digest/fingerprint、最长 24 小时窗和结构化 verifier anti-replay verdict；只返回脱敏投影 |
| `production-go-no-go.js` | T00 发布治理 | 领域 gate | 将不可伪造的当前进程验证投影作为第六项 prerequisite；普通对象或旧 synthetic GO 默认拒绝 |
| `server.js#buildRuntimeProductionGoNoGoCenter` | T00 composition root | runtime composition | 先算当前证据指纹，再注入显式 receipt/verifier；默认组合不提供本地替代 verifier |
| `test/production-preflight-decision-receipt.test.js` | TEST-001 | 负向合同 | 锁定三项漂移、过期/未来、重放、缺失/异常/异步 verifier、错误脱敏和默认 runtime NO-GO |

唯一签发权威、信任根、耐久 nonce ledger 和现场 provider 不属于当前实现；Proposed ADR 不授权生产 GO。

## 21. Worker observability compatibility

| 模块 | Owner | 职责 | 明确非职责 |
|---|---|---|---|
| `config/worker-observability-contract.json` | T00 | 12 个既有 worker 的状态/retry/lease/checkpoint 语义清单与字段映射 | 不定义新的业务状态机，不授权生产 |
| `src/platform/operations/worker-observability-contract.js` | T00 | 生成版本化、闭集、摘要化的共同观测字段 | 不持久化报告，不接触业务载荷或凭据 |
| `scripts/worker-observability-governance.js` | T00 | 发现部署入口，验证登记、适配和 Proposed 边界 | 不启动 worker，不读取现场系统 |

现有领域 worker 仍属于各自 owner；T00 只拥有兼容投影。新增 worker 必须复用该合同，不能复制第二套共同协议。

## 22. 仓库治理模块

| 模块 | Owner | 职责 | 非职责 |
|---|---|---|---|
| `config/repository-governance.json` | T00 | 当前 workflow、Markdown 分类规则/闭集摘要、3 个 PDF 来源与 digest 的机器合同 | 不定义业务 owner，不包含 PDF 正文 |
| `scripts/repository-governance.js` | T00 | 只读枚举 Git 路径，拒绝漏分/重叠/快照改写/旧 baseline/PDF 漂移 | 不生成或修改文档、PDF、报告和归档 |
| `test/repository-governance.test.js` | T00 / TEST-001 | 锁定 267 份 Markdown、三类边界、当前 main 流程和 3 个 PDF 负向漂移 | 不证明 PDF 内容正确或生产可用 |

依赖方向为 `Git 跟踪路径 + ADR 状态 + 当前进程清单 + PDF bytes/source paths → repository governance
verifier → governance-api/architecture:test`。snapshot 与 superseded 只提供历史证据，不得反向覆盖 current
规则；PDF verifier 不能取得 generator 身份。

## 金融 callback/finalize 守卫

`financial-gateways.js` 独占回调验签与进程内 attestation 密钥；只导出验证能力，不导出签发密钥。`src/http/routes/insurance-payment.js` 将 `applyFinancialCallback` 返回的目标账项证明作为单次写意图传给 `server.js`；`server.js` 复验证明、全账本 event/nonce 唯一性及 finalize 回执/失败证据形状。attestation 不进入领域集合或 API projection，模块依赖保持 `route → gateway verifier → storage guard`。

## PostgreSQL 受控切换评估模块

| 模块 | Owner | 职责 | 非职责 |
|---|---|---|---|
| `scripts/postgres-primary-transition-readiness.js` | T00 | 读取 SHA-256 固定的闭集 metadata-only 文件，复用配置与七门评估，输出脱敏资格投影 | 不连数据库、不验外部证据、不激活主库 |
| `scripts/production-deployment-package.js` | T00 | 将 migration/read/adapter/storage-admin 与 sync/reconcile 模板登记为不可变部署闭包 | 不启动 worker，不保存 `DATABASE_URL` 值 |
| `deploy/postgres-*.template`、`deploy/platform-production-adapters.env.template` | T00 | systemd 与变量占位符合同 | 不提供现场值或生产授权 |

## 预生产现场控制模块

| 模块 | Owner | 职责 | 非职责 |
|---|---|---|---|
| `scripts/platform-preproduction-control.js` | T00 | 五个命令的闭集参数适配、只读文件装配、Ed25519 报告信封验证、0/2/1 退出语义与稳定脱敏错误 | 不调用外部系统、不启动 worker、不执行切换/回滚 |
| 既有 environment/joint-test/monitoring/rehearsal/candidate evaluators | T00/T08 既有边界 | 复用原证据 schema、签名、绑定、监控和演练语义 | 不建立第二套证据状态机，不产生生产授权 |
| `production-deployment-package` preproduction controls | T00 | 登记五个入口、运行依赖、变量模板与固定非授权投影 | 不保存现场文件、凭据、签名或报告正文 |

入口依赖采用 `CLI → 既有 evaluator → technical-evidence`，不依赖 `server.js`、HTTP、数据库 client 或
strict preflight。candidate 用部署 anchor 摘要检查漂移，只聚合五份由不同账号、key ID、公钥材料签发且
不超过 48 小时的摘要绑定报告信封；普通 CLI 固定 NO-GO，未来受信宿主绑定仍保持 `GO-CANDIDATE` 上限。

## 9+5 开发组织模块

`config/development-organization.json` 将 T01–T09 组合为九个一级开发域，并将五个临床子域作为 T06 的唯一嵌套组；T00 是独立的集成治理单元。`development-organization-governance` 只读取现有 process、clinical 和 service-extraction 权威并校验闭集、一致性与统一部署政策，不拥有路由、数据集合或业务状态。该模块分类为 B（KEEP + IMPROVE）：边界小且有负向测试，后续只随 Owner 决策同步演进。

## 2026-08-26 T00 生产范围治理模块

| 模块 | 类型 | 输入 | 输出 | 边界 |
|---|---|---|---|---|
| `config/production-release-scope.json` | 冻结选择器 | 既有应用、平台入口、worker 与外部依赖 ID | 数量/摘要/总指纹 | 不复制业务实现，不授权生产 |
| `src/platform/governance/production-release-scope.js` | 只读治理服务 | 应用、API、数据、worker、联调、切换行动权威 | `production-release-scope-report.v1` | 不写数据库、报告或发布制品 |
| `scripts/production-release-scope.js` | CLI 适配器 | 同上 | `FROZEN-NO-GO` 校验结果 | 失败仅表示合同漂移，不生成外部证据 |

该模块由部署包 builder/verifier、standard smoke 与 strict preflight 消费；它不被 HTTP router 或业务服务调用。
首发 19 个 legacy 集合的 owner 审查通过冻结 decision digest 与实际读写源码证据闭合，发布范围的
`collectionReviewRequired` 因此为 0；这不改变它们的 `productionWriteAllowed=false`，也不改变所有
集合的 `productionPromotionAllowed=false`。
