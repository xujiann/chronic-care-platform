# 工程治理体系 v1

> 适用基线：`main@b1e4898` 及其后续短生命周期 `process/*` 分支。
> 本文件补充而不替代 `AGENTS.md`、`config/process-workstreams.json`、分支保护和 Accepted ADR。

## 1. 规则优先级

1. 法律、监管、安全和真实生产约束。
2. `main` 的 `AGENTS.md`、进程/数据所有权清单、required checks。
3. Accepted ADR、数据库 migration 和公共兼容契约。
4. 本治理体系、模块/数据库标准和重构安全网。
5. 六张 AS-IS 地图、体检报告和技术债台账。
6. Proposed ADR、路线建议和计划。

事实地图不授予实现权限；Proposed 不等于 Accepted；仓库报告不能替代现场证据。

## 2. 基线与所有权

- `main` 是唯一集成、发布和默认分支。
- 新工作树和本地 ownership 验证默认使用最新 fetched `origin/main`；固定
  `baseline/governance-20260817-enhancement-v1` 仅用于可复现证据，不得作为日常开发默认基线。
- 通过 `npm run process:plan` / `process:create` 创建 `process/tNN-topic-YYYYMMDD` 工作树。
- T00 独占组合根、全局路由顺序、CI、治理配置和部署打包；T01–T09 只改其领域保护路径。
- 每次交付运行 `process:verify`；跨域协议或路由顺序交 T00。
- 脏工作树不得自动 pull/stash/reset/clean；陈旧分支先对账，不继续堆业务功能。
- 应急目录是可复现派生制品，不是独立源码。

## 3. 应用边界

| 边界 | 规则 |
|---|---|
| 主应用 | 根 lockfile、主线 CI、T00–T09 所有权 |
| 内嵌子站 | 数智医院/居民小程序可有 UI 边界，但共享主仓发布和安全门禁 |
| 外部展示站 | 不在主线时按独立仓库、lockfile、CI 和托管生命周期治理 |
| 应急制品 | 只能从批准提交生成，记录来源 SHA 和校验和 |
| 视频项目 | 独立工具链和脱敏资产，不进入主应用运行依赖 |

## 4. 模块治理

- A KEEP：正确、边界合理、测试较好；默认不动。
- B KEEP + IMPROVE：功能正常，触及时补接口、命名和测试。
- C REFACTOR：耦合/重复/体量严重；先特征测试，再逐块迁移。
- D REPLACE：只有根本设计错误、严重安全风险、无法测试、技术路线废弃或维护成本明显更高时采用；必须有 ADR、迁移和回滚。

标准依赖方向：入口 → 路由协议 → 领域端口 → 仓储/外部端口 → 实现。禁止领域模块反向 require `server.js`，禁止把新业务路由加回组合根，禁止让 `shared` 或 `state-data` 成为数据 owner。

## 5. Boy Scout Rule

修改遗留代码时，不做无关大重构；安全时修复小的邻近问题；适当改善命名；补缺失测试；仅在与任务直接相关时减少重复；让触及代码小幅靠近目标接口。公共接口、schema、授权、依赖、部署或跨域边界变化必须另行批准。

## 6. 数据治理

- 禁止直接编辑 `data/db.json`、SQLite/WAL/SHM、报告、PDF 和归档制品。
- 全部跟踪 Markdown 必须唯一分类为 `current`、`snapshot` 或 `superseded`；日期化 snapshot
  保留原文，修订通过新的 current 文档或 superseding ADR 完成。
- `output/pdf` 跟踪制品必须登记 SHA-256、页数、大小、来源、引入提交、保留理由和生成器可用性。
  无可复现生成器的历史 PDF 只读冻结，不得手工编辑或以校验器冒充生成器。
- schema 变化只能通过顺序 migration；历史 migration 默认不可变。
- migration 内容必须可指纹验证，schema head、公开版本和部署门禁必须一致。
- 生产集合必须先进入 `domain-data-ownership`，明确 owner、reader、分类、写契约、迁移和回滚。
- 核心概念遵守 `CORE_DATA_DEFINITIONS.md`，禁止创建平行 Resident/Institution/Practitioner/Record 等模型。
- 生产目标 PostgreSQL、fallback write=false；请求路径不得双写。

## 7. API、鉴权与审计

- API 变化登记 method/path、owner、调用方、角色、权限、数据范围、错误、幂等和审计事件。
- `npm run api:authorization-matrix` 校验声明级授权，`npm run api:production-catalog` 校验 route inventory 与授权声明并集；动态/未分类项必须 review-required，目录不得出现生产 GO。
- 鉴权默认拒绝；角色允许不等于资源范围允许。
- 认证、越权、跨机构/跨居民、重放、并发和错误输入必须有负向测试。
- 演示账号、默认密码和本地存储路径不得在生产降级启用。
- 审计链、留存和导出统一使用 Accepted ADR 的 v2 严格验证语义；链异常必须 fail closed，不能被模糊成“仅诊断”或通过读取时重封修复。
- 静态服务必须基于发布 allowlist，而不是仓库根路径。

## 8. 测试保护

```text
LEGACY CODE → TEST PROTECTION → REFACTOR
```

当前主线有效门禁：

| 目的 | 命令 |
|---|---|
| 标准构建 | `npm run build`（默认写入仓库外临时目录） |
| 静态检查 | `npm run lint`、`npm run typecheck` |
| 标准测试分类 | `npm run test:unit`、`npm run test:integration`、`npm run test:smoke` |
| 语法 | `npm run check` |
| 全量自动发现 | `npm run test:all` |
| 路由 | `npm run routes:check`、`npm run routes:test` |
| operations 命令行为矩阵 | `npm run operations-command:behavior-test`（32/32 路径，直接运行真实 route segment） |
| API 治理 | `npm run api:authentication-evidence`、`npm run api:authorization-matrix`、`npm run api:production-catalog`、`npm run api:idempotency-evidence` |
| 集合治理 | `npm run data:collection-governance:verify`（只读；不生成 release 报告） |
| 对象存储架构决策 | `npm run object-storage:architecture-governance:verify`（只读；Proposed 状态失败关闭） |
| Worker 兼容观测 | `npm run worker:observability:verify`、`npm run worker:observability:test`（只读；不授权生产） |
| 关键内部边界覆盖 | `npm run test:coverage:boundaries` |
| 架构 | `npm run architecture:test` |
| 所有权 | `npm run process:verify`、`npm run process:test` |
| 仓库文档与制品治理 | `npm run repository:governance:verify`（只读，不生成报告或 PDF） |
| 平台迭代 | `npm run platform:iterations:test` |
| E2E | `npm run test:e2e` |
| 浏览器 sink | `npm run security:browser:verify` + `npm run static:test` + `npm run test:e2e`（模板 URL 归零、OHIF 外部 Origin 继续失败关闭） |
| 部署 | `npm run deploy:check` |

六个标准入口已在 TEST-001 T00 切片建立。`test:unit` 与
`test:integration` 对根 `test/*.test.js` 形成不重叠且完整的分区，`test:smoke`
是可快速独立运行的精选集合；`test:all` 的自动发现语义保持不变。`lint`
覆盖仓库 JavaScript，当前不再保留文件级规则例外；`typecheck`
已从主线实际 9 个唯一文件扩大为 13 个治理/安全边界文件的增量基线，不得表述为全仓类型检查。
`test/api.test.js` 已恢复全文件 `no-unreachable`；三段原不可达 care 断言已完成 owner/route 重验、
删除 skip 并恢复执行，另有 3 个独立真实 HTTP 特征测试保护陪诊、护理闭环与护士生命周期。测试必须
保持 scope、幂等、audit、notification plan 和 pending outbox 断言，不得以模拟 delivery 替代外部回执。
两个前端文件原有 16 个 shadowed map key 已在旧值/最终值/真实翻译调用特征测试保护下去重；新增重复键
或重新引入 `no-dupe-keys` 文件例外均失败关闭。
扩大基线时应先清债，不得用全局关闭规则换取通过。

标准 integration suite 保持成员、顺序、断言与超时不变；`test/api.test.js` 作为单文件热点批次执行，
runner 向 CI 日志输出 batch/suite `durationMs`。耗时只用于定位与趋势观测，不是放行阈值，当前不改变
CI job 拓扑、10/15/5 分钟预算或 required check。
API 热点的共享运行时夹具可以按一次一个生命周期移入 `test/helpers/`，但必须保持同一 server/进程、
测试成员与顺序、断言、超时、临时数据清理和 CI 预算。首个 seed/env/server、第二个单一 HIS mock 及第三个
单一 SIEM alert mock 切片继续以 43 个子测试的有序 SHA-256 摘要失败关闭；每个 helper 只能拥有一个已证明封闭的测试生命周期，
不能承载业务逻辑、生产凭据、外部投递或现场证据。改变并行/分片拓扑须另行审批和 ADR。

DATA-003 的只读集合治理验证映射到 governance-api，并由 architecture test 运行专项负向测试；
它补充 TEST-001，不改变 unit/integration/smoke 分区，也不把仓库通过结果解释为生产批准。

OBJ-ADR-002 的机器 decision/action register 同样映射到 governance-api 与 architecture test。在 ADR
Accepted、data owner 和 v1/v2 兼容策略获人类确认前，检查必须拒绝 v17、runtime/API implementation 和
production promotion；它不修改实际 owner，不生成 migration，也不能替代外部对象存储现场证据。

JOB-001 的共同合同只允许 additive、metadata-only 观测投影。新增 server-side worker 前必须搜索并复用
`platform-worker-observability.v1`，登记真实 state/retry/lease/checkpoint/terminal 语义，补部署入口和负向测试；
不得借共同 outcome 改写业务状态机，也不得把投影、摘要或仓库测试解释为生产授权。

原 `server.js` 的 c8 85/85/55 门禁保持不变。runtime identity、audit chain/source、object
storage trust、API governance、worker observability、区域共享命令、转诊 owner command、科研合规导出、
浏览器响应头和 Safe URL 使用 10 个职责独立覆盖组，冻结当前真实基线并绑定实际执行的安全负向矩阵；
源码不能跨组重复，后续阈值只能持平或提高。覆盖原始数据和报告只写临时目录，不得提交，也不能替代
Playwright、外部 Origin、生产现场或安全评估证据。

API-IDEM-001 在 TEST PROTECTION 层新增幂等证据专项：源码 marker 只作观察，写接口只有在 owner、route/action、身份、重放/冲突、CAS、错误、审计、实现锚点与可执行负向测试全部一致时才能标为 `behavior-verified`；action-slice 只能登记局部证据，完整 endpoint 必须继续 `review-required`。该标签不等于生产就绪或分布式 exactly-once。

API-002 的 T07 退款切片只登记 `POST /api/online-payments/refunds`：匿名和非授权角色拒绝、可信 actor 机构绑定、精确回放、同键异载荷冲突、事务 CAS 及 command/outbox 原子性均有真实行为测试。相邻退款 action regex、T08 普通 integration event/dispatch 和静态 runtime-role variant 不随该证据晋升；目录继续保留 `review-required`、外部证据阻断和全量 `NO-GO`。

T07 financial reconciliation 后续切片只登记 `POST /api/financial-gateways/reconciliation-runs`。身份和保险 gateway scope 必须先于 ledger 读取；同 gateway/date 在当前进程串行，锁内重读并复用 statement digest 的精确回放/冲突；run 与链式安全审计必须在同一次 `writeDatabase` 中提交。SQLite 复用现有 collection-version CAS，冲突返回稳定脱敏 409；写失败不得再发起第二次审计写。该接口没有实际下游事件，禁止为满足目录虚构 outbox；JSON 兼容锁不构成跨实例 exactly-once，集合 owner 和生产状态继续失败关闭。

T01 security-control 后续切片只登记 `POST /api/security/controls/:id/actions`。commission 身份与 provider-verified step-up 必须先于 command collection，精确 control ID 缺失保持 404/零写；既有 session-security-audit repository 继续拥有 intent digest、精确回放/冲突、同一 cloned-state control+receipt+audit 单写和进程内串行。SQLite collection-version 冲突只投影为稳定脱敏 409，普通写失败不得补写审计。不得把未接线的 PostgreSQL adapter、进程锁或单机测试解释为跨实例 exactly-once；没有真实下游语义时不创建 outbox，data owner 与生产状态继续失败关闭。

同一幂等证据注册表允许保存最小 `reviewedProofRequired` 拒绝记录，只含 owner、endpoint、缺失证明类别和现有锚点。拒绝记录不得与行为合同使用同一 key；只有全部缺口由可执行证据关闭后，才可在一次评审变更中移除拒绝记录并添加合同。该记录不是第二份路由目录，也不能解释为已验证行为。

API-AUTH-001 在 TEST PROTECTION 层新增 custom auth 证据专项：required/optional/none、credential source、replay/CSRF、scope、实现锚点和可执行负向测试必须同时一致。源码 marker 或相邻字符串不构成证明；目录解析不得跨越已结束的 handler 拼接 method/path，直接拒绝证据和解析器回归均纳入门禁。未登记入口继续 `review-required`，认证证据通过也不构成生产放行。

TEST-007 在既有 operations handoff harness 上建立 32 条路径的唯一数据驱动矩阵，并由 governance-api
显式运行。矩阵是拆分 699 行 handler 和治理 ARC-008 前的行为安全网，不改变 handler、数据 Owner、
事务或生产状态。

TEST-005 规定标准 E2E 只能使用 Playwright Chromium，不得按本地操作系统自动切换浏览器。在线根 32 项
（含急救生命链、医生工作台、血液上线看板、陪诊工作台和产品运行驾驶舱恶意响应回归）与
居民 13 项继续阻止 Service Worker；PWA 3 项只能在独立允许策略、context、动态回环端口和临时数据中运行。
三套必须形成 48 项不重叠并集，PWA 每项结束注销 registration 并删除 Cache Storage；runner 不得复用或
停止其他任务的服务。该门禁不证明真实 HTTPS、OS 安装策略、外部 Origin 或现场浏览器验收。

## 9. 变更风险门禁

| 变化 | 最低附加门禁 |
|---|---|
| 路由/协议 | routes + 领域测试 + API 兼容/负向测试 |
| 组合根/跨域 | process + architecture + routes + test:all |
| 鉴权/审计 | 安全矩阵、拒绝路径、会话/重放/留存测试 |
| 数据库 | migration、空库/升级/重跑/失败、schema 指纹、核对/回滚 |
| 前端 | 页面角色、XSS sink、静态缓存、E2E/smoke |
| 依赖 | 官方 audit、许可/维护/兼容、build/test、回滚 |
| 部署 | deploy check、配置 fail-closed、制品来源和回滚 |

## 10. ADR、Review 与交付

- 架构、安全模型、数据权威源、核心概念、公共破坏性接口、部署拓扑和技术路线替换必须先有 ADR。
- ADR 包含 problem、options、advantages、disadvantages、migration cost、risk、recommendation。
- `/review` 检查回归、安全、数据、并发、错误、所有权、测试真实性和文档同步。
- PR 单一职责，说明基线、进程、问题、决策、范围、非目标、测试、风险、迁移/回滚和 ADR。
- 未运行项明确写未运行；不删测试、不降门禁换绿灯。
- 当前规则只来自 current 文档和 Accepted ADR；snapshot/superseded 仅作历史证据，不能覆盖当前流程。
- merge 后更新地图、风险、ADR、路线图和发布证据。

## 11. 每日循环

```text
git/CI/昨日 PR 检查
  → 阅读 ROADMAP / ARCHITECTURE / AGENTS / 治理 / ADR
  → PLAN
  → 方向审批
  → implementation
  → tests
  → /review
  → PR
  → merge
  → 下一工作日重新开始
```

PLAN 前不得编码；批准只覆盖明示范围。任何阶段失败都回到最近的安全阶段，不能跨过测试或 review。

生产切换行动配置只能描述定义，禁止在 Git 中保存权威完成状态。effective status 必须从受控外部证据
经可信 provider 派生，绑定当前 release/artifact、有效期、转换历史、命令回执摘要和独立角色；原始证据、
签名、凭据及现场输出不得进入仓库或发布包。

生产晋级只能从 `main` 手工触发受保护 `production` environment，并在标记为
`self-hosted, production-promotion` 的受控 runner 上执行 immutable package verify 与 strict preflight。
仓库工作流只上传 digest-only、create-once 的 eligibility receipt；它不执行生产部署，也不替代 environment
reviewer、变更审批、现场签收或回滚指令。
