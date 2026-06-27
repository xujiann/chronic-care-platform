# 大连卫生健康信息平台 MVP

这是一个面向卫生健康信息化场景的可运行 MVP，用于验证大连市卫生健康委、医疗机构、医保局/医保中心/区市县医保局、居民端、县域医共体平台和统一运营工作台之间的数据贯通、业务闭环、权限隔离、审计保全和静态展示发布。

当前仓库已经完成 P0/P1/P2 的本地演示级与 API 基础闭环；剩余生产化事项主要依赖真实身份源、医疗机构接口、医保核心系统、公安民政共享、安全测评和现场部署资源。

## 当前能力总览

| 范围 | 已完成能力 |
|---|---|
| P0 测试与 CI | Node API、隔离测试数据、角色权限、居民数据裁剪、静态页面守卫、敏感信息扫描、API 契约、覆盖率门禁、Chromium 端到端角色旅程 |
| P0 数据与恢复 | SQLite/JSON 双路径、schema v1-v7 幂等迁移、集合版本、乐观锁、409 冲突契约、业务级 PATCH、备份、恢复演练、脱敏快照、恢复指标验收 |
| P0 认证与隐私 | PBKDF2 密码哈希兼容、签名会话、密钥轮换、token 篡改拒绝、字段脱敏、授权撤销、访问历史复核、审计哈希链 |
| P0 接口网关 | HIS/EMR/LIS/PACS/医保/电子证照/卫生统计接口契约、HMAC 签名、幂等键、事件落库、失败重试、死信补偿、对账监控、模拟接入 |
| P1 区域闭环 | 检查检验互认、诊断报告回传、危急值预警、统一任务中心、站内消息、送达回执、超时升级、数据质量问题与评分卡、安全合规证据 |
| P1 慢病医防融合 | 对照 2025 年基层慢性病健康管理服务要求，已补齐基层慢病健康管理中心、村站、牵头医院、公卫机构职责，能力建设条件、防筛诊治管康路径、多病共管、中医药服务、居民自我管理、用药保障和质控指标 |
| P2 治理科研体验 | 信用评价、绩效报表、科研数据集、专病库模型、人工复核、移动体验设置、无障碍清单、大字模式、家属代办、线下帮办、弱网模式 |

## 快速启动

```powershell
cd "C:\Users\drxuj\OneDrive\3.信息化\0.高质量发展 信息化\chronic-care-platform"
npm.cmd install
npm.cmd run dev
```

打开：

```text
http://localhost:5173/login.html
```

静态预览可以直接打开 HTML 或通过 GitHub Pages 发布根目录页面。静态模式只能读取 `data/db.json` 快照，不能执行 Node API 写入、会话、审计和工作流动作。

## 演示账号

统一密码：

```text
123456
```

| 账号 | 入口 | 角色 |
|---|---|---|
| `city` | `workbench.html` | 市级健康城市管理 |
| `district` | `workbench.html` | 区市县管理端 |
| `health` / `whjw` | `index.html` | 大连市卫生健康委 |
| `hospital` | `institution.html` | 三级医疗机构 |
| `community` | `institution.html` | 基层医疗机构 |
| `doctor` / `doctor_wang` | `institution.html` | 医生账户 |
| `mi` | `insurance.html` | 大连市医保局管理端 |
| `insurance` | `insurance.html` | 大连市医保中心经办端 |
| `district_mi` | `insurance.html` | 区市县医保局管理端 |
| `citizen` | `citizen.html` | 居民端 |
| `county` | `county.html` | 县域医共体平台 |

## 页面入口

| 页面 | 说明 |
|---|---|
| `login.html` | 统一登录入口 |
| `health-city.html` | 健康城市系统总览 |
| `workbench.html` | 统一运营工作台、全流程审计矩阵、路线图、系统就绪报告 |
| `platform.html` | 平台建设驾驶舱、应用目录、信用评价、科研专病库治理、移动无障碍治理、安全信创台账 |
| `index.html` | 卫健委端：慢病、统计、应急、质量、审计、互认、绩效 |
| `institution.html` | 医疗机构端：授权档案、转诊、固定取药、证照、多点执业 |
| `insurance.html` | 医保局/医保中心/区市县医保局：审核、监管、凭证、取药 |
| `citizen.html` | 居民端个人健康信息库、家庭成员、授权共享、适老化服务 |
| `mobile-preview.html` | 居民端手机预览 |
| `county.html` | 县域医共体平台、16255 模型、协同工单、互认、基层 AI |

居民端已提供 PWA 基础壳：`manifest.webmanifest`、`service-worker.js` 和 `pwa-icon.svg` 支持浏览器安装入口、静态资源缓存和弱网/离线回退到居民端健康档案页面；`citizen.html?page=health-record|emr|nursing|escort|registration` 将健康档案、电子病历、护理、陪诊和挂号拆为可分享、可回退的二级页面，桌面服务导航与手机底部导航均按 URL 跳转并优先落到对应业务内容，摘要卡提供当前页面主操作入口，功能审计沉到页面后方作为状态证明；`mobile-preview.html` 提供 390px 手机框、本机/真机访问地址、演示登录方式、服务切换控制和底部服务导航检查项，并适配侧边浏览器等中等宽度窗口，便于发布前预览居民端手机操作；个人健康信息库已细分电子病历、检查检验、用药处方、影像资料和附件资料，正式上线时仍需结合生产域名、HTTPS、PACS/文档存储授权和现场移动端策略复核。

## 数据与存储

本地服务优先使用 SQLite 能力，并持续维护 GitHub Pages 可读的静态快照：

```text
data/health-city.sqlite
data/db.json
```

核心集合包括：

- 居民与身份：`accounts`、`residents`、`authUsers`、`authOrganizations`
- 健康档案：`personalRecords`、`healthArchiveStandard`、`diseases`、`followups`
- 慢病闭环：`chronicScreeningTasks`、`chronicEducationPushes`、`chronicManagementPlans`、`chronicServiceRoles`、`chronicCapabilityConditions`、`chronicServicePathways`、`chronicComorbidityPlans`、`chronicTcmServices`、`chronicSelfManagement`、`chronicMedicationSupport`、`chronicQualityMetrics`
- 协同业务：`careOrders`、`medicationPickups`、`insuranceClaims`、`referralSystem`、`referralTeleconsultations`
- 县域医共体：`countyConsortium`、`countyCollaborationOrders`、`countyMutualRecognitionRecords`、`countyAiDiagnosisCases`
- 证照统计：`deathCertificates`、`birthCertificates`、`healthStatistics`、`healthStatisticsIngestion`
- 治理审计：`securityEvents`、`dataAccessLogs`、`platformRoadmap`、`platformAudit`、`platformProcessAudit`
- 生产部署：`productionDeploymentPlan` 记录发布门禁、正式数据库适配、政务身份适配和审计保全路径
- P2 治理：`institutionCreditEvaluations`、`creditEvaluationRules`、`researchDatasets`、`diseaseRegistryModels`
- P2 体验：`mobileExperienceSettings`、`accessibilityChecklist`、`seniorServices`

SQLite 结构化镜像已覆盖居民、账户、主索引、个人健康档案、慢病业务、随访、医保、证照、诊疗工单、固定取药、县域业务，以及 P2 的机构信用评价、科研数据集、专病库模型和无障碍验收清单。

## 后端 API

主要 API：

| API | 说明 |
|---|---|
| `GET /api/health` | 健康检查，返回服务版本、环境、uptime 和存储元信息 |
| `GET /api/metrics` | 管理端运行指标，返回请求数、状态码、慢请求、任务堆积、死信、质量问题；运营工作台会在服务模式下展示部分指标 |
| `GET /api/system/readiness` | 管理端系统就绪报告，汇总 P2 集合、接口准备度、审计链、运行负载和现场外部依赖边界 |
| `GET /api/process-audit` | 管理端全流程审计报告，汇总居民、慢病、医共体、医保取药、统计证照、安全合规和生产切换证据域 |
| `POST /api/auth/login` / `GET /api/auth/me` / `POST /api/auth/logout` | 登录、会话、退出 |
| `GET /api/state` / `PUT /api/state` | 按角色裁剪读取和管理端持久化状态 |
| `GET /api/multi-practice-registry` | 医师多点执业监管台账，按角色返回公开备案、风险补正队列、材料核验和政策摘要 |
| `GET/POST/PATCH /api/personal-records` | 个人健康档案读写 |
| `POST /api/workflow-actions` | 通用工作流动作 |
| `PATCH /api/chronic-management-plans/:id`、`/api/chronic-comorbidity-plans/:id`、`/api/chronic-tcm-services/:id`、`/api/chronic-self-management/:id`、`/api/chronic-medication-support/:id`、`/api/chronic-quality-metrics/:id` | 慢病管理计划、多病共管、中医药、自我管理、用药保障和质控记录的单条更新，支持机构/卫健委权限、居民授权范围和乐观锁 |
| `GET /api/tasks` / `POST /api/tasks/:id/actions` | 统一任务中心 |
| `GET /api/messages` / `POST /api/messages/:id/receipt` | 站内消息与送达回执 |
| `GET /api/data-quality/issues` / `GET /api/data-quality/scorecard` | 数据质量治理 |
| `GET /api/security/compliance-report` / `GET /api/security/high-risk-events` | 安全合规证据 |
| `GET /api/credit-evaluations/calculate` | 信用评价自动计算 |
| `GET /api/performance/consortium-report` | 医共体绩效、人财物、药耗、基层履约报表 |
| `GET /api/research/datasets` / `POST /api/research/datasets/:id/actions` | 科研数据集治理 |
| `GET /api/research/sandbox` / `POST /api/research/datasets` / `POST /api/research/datasets/:id/approval` / `POST /api/research/datasets/:id/sandbox-access` / `POST /api/research/datasets/:id/outcomes` | Research dataset application, ethics approval, de-identified sandbox access, audit trail, and outcome return |
| `GET /api/research/disease-models` / `POST /api/research/disease-models/:id/review` | 专病库模型和人工复核 |
| `POST /api/auth/identity/preview` | 政务身份 claims 到角色、机构和首页的接入预映射 |
| `GET /api/mobile/experience` / `POST /api/mobile/experience` | 移动体验和居民偏好 |
| `GET /api/mobile/accessibility-checklist` | 无障碍验收清单 |
| `GET /api/service-acceptance-summary` | 慢病和医共体服务域建模、开放事项和 open actions 摘要 |
| `GET /api/site-template-readmes` | 运行时输出 `release/templates/*/README.md` 的当前模板说明、证据接口、行数和预览内容 |

## 环境变量

复制 `.env.example` 作为部署环境配置参考：

```text
PORT=5173
NODE_ENV=production
STORAGE_ENGINE=auto
DATA_DIR=/var/lib/chronic-care-platform
SESSION_SECRETS=replace-with-long-random-secret
INTEGRATION_GATEWAY_SECRET=replace-with-integration-secret
DATABASE_URL=postgres://health:replace-with-password@postgres.internal:5432/chronic_care
OIDC_ISSUER_URL=https://identity.example.gov.cn/real-issuer
OIDC_CLIENT_ID=replace-with-oidc-client-id
OIDC_CLIENT_SECRET=replace-with-oidc-client-secret
AUDIT_EXPORT_PATH=/var/log/chronic-care-platform/audit
SIEM_ENDPOINT=https://siem.example.gov.cn/ingest
RETENTION_POLICY=10y-worm
```

说明：

- `STORAGE_ENGINE=auto` 会在 Node 支持 `node:sqlite` 时使用 SQLite，并继续维护 `data/db.json` 静态快照。
- `SESSION_SECRETS` 支持逗号分隔多密钥，便于会话密钥轮换。
- `INTEGRATION_GATEWAY_SECRET` 用于接口网关 HMAC 签名模拟。
- `DATABASE_URL`、`OIDC_*`、`AUDIT_EXPORT_PATH`/`SIEM_ENDPOINT` 和 `RETENTION_POLICY` 是生产部署路径的正式数据库、政务身份和审计保全配置项。

## 验证与质量门禁

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:coverage
npm.cmd run test:e2e
npm.cmd audit --omit=dev
```

补充部署前检查：

```powershell
npm.cmd run deploy:check
npm.cmd run deploy:check:full
npm.cmd run env:check
npm.cmd run release:report
npm.cmd run release:report:full
npm.cmd run release:manifest
npm.cmd run priority-apps:templates
npm.cmd run maternal-child:readiness
npm.cmd run policy:coverage
```

`deploy:check` 会检查 README、部署文档、静态快照、P2 集合、P2 完成状态、P0 接口准备度、安全验收台账、环境脚本和关键 npm scripts；`deploy:check:full` 还会串行执行 `check`、`test`、`test:coverage`、`test:e2e` 和 `npm audit --omit=dev`。

`env:check` 使用 `.env.example` 做演示/模板级校验，不要求真实密钥；`env:check:production` 会读取 `.env`，并按生产规则校验 `NODE_ENV=production`、非 JSON 存储、非占位且不少于 32 位的 `SESSION_SECRETS` 和 `INTEGRATION_GATEWAY_SECRET`。当前运行时正式支持 `STORAGE_ENGINE=auto` 或 `sqlite`；`postgres/postgresql` 仍在 `productionDeploymentPlan` 中作为后续适配项，配置后会被门禁拦截，避免静默回落。生产模式还要求政务身份 `OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET` 与审计保全 `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT` 至少一项可用。`env:check:production` 与 `release:report` 会附带生产切换清单，按环境文件、生产密钥、统一身份、审计保全、存储适配、现场接口联调、医保/证照交换、监控值守和灾备演练列出责任方、阻断状态和下一步动作；外部系统项必须有 `CUTOVER_SITE_INTERFACE_SIGNOFF`、`CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF`、`CUTOVER_MONITORING_SIGNOFF`、`CUTOVER_DR_REHEARSAL_SIGNOFF` 等现场签字信号才会通过。`release:report` 会汇总代码文件、关键 npm scripts、静态快照、P2 完成状态、接口准备度、安全验收、生产部署计划、验收证据和环境配置，默认输出 `release/release-report.json`、`release/release-report.md`、`release/production-cutover-checklist.json` 与 `release/production-cutover-checklist.md`；`release:manifest` 会生成 `release/release-artifact-manifest.json` 与 `release/release-artifact-manifest.md`，把所有发布报告、模板 README、生成命令和 API 证据整理成发布包目录清单；`release:report:full` 额外执行 `check`、`test`、`test:coverage`、`test:e2e`、`deploy:check` 和 `npm audit --omit=dev`。CI 会在每次检查中生成并上传 `release-readiness-report` artifact，便于发布取证。

`release:report` 同时输出 `release/storage-model-inspection.json` 与 `release/storage-model-inspection.md`，记录 JSON 快照集合数、记录量、最大集合，以及 SQLite 表、schema 版本和迁移元数据；SQLite 文件在干净 checkout 中不存在时只作为提示，不阻断 CI。`production-db:readiness` 会生成 `release/production-db-readiness-report.json` 与 `release/production-db-readiness-report.md`，把 PostgreSQL/正式数据库切换前的 `productionDeploymentPlan`、当前 SQLite/JSON 模型、备份恢复演练文档、RTO/RPO 说明和运行时 PostgreSQL 阻断汇总为专项证据包。

`identity:contract` 会生成 `release/identity-contract.json` 与 `release/identity-contract.md`，固化政务统一身份接入所需 claims、角色到门户映射、机构覆盖度和样例 claim 映射；`release:report` 与 CI 会同步归档该契约，便于现场 OIDC/SAML 联调前逐项确认。

`audit:retention` 会生成 `release/audit-retention-report.json` 与 `release/audit-retention-report.md`，离线验证安全事件和数据访问日志哈希链，记录导出摘要、保全目标和安全验收台账；未配置 `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT` 时只作为演示环境提示，生产切换仍由 `env:check:production` 阻断。

`integration:readiness` 会生成 `release/integration-readiness-report.json` 与 `release/integration-readiness-report.md`，检查 P0 接口台账、HIS/EMR/LIS/PACS/医保/证照/统计契约、幂等键、签名和重试策略，并把身份、主索引、安全审计等 P0 覆盖关系纳入发布取证。

`interface:mapping` 会生成 `release/interface-mapping-report.json` 与 `release/interface-mapping-report.md`，逐项归档 HIS/EMR/LIS/PACS/医保/电子证照/统计契约字段到平台集合和字段的映射、必填字段覆盖、幂等字段落点、签名与重试证据，作为现场接口字段差异确认和联调整改的前置材料。

`research:sandbox` generates `release/research-sandbox-readiness-report.json` and `release/research-sandbox-readiness-report.md`, covering research dataset applications, disease registry models, ethics approval, de-identification release, sandbox access, usage audit, and outcome return evidence.

`data-quality:report` 会生成 `release/data-quality-report.json` 与 `release/data-quality-report.md`，检查居民主索引完整度、跨集合居民引用、personIndex 一致性、来源可追溯和整改闭环。

`environment:matrix` 会生成 `release/environment-matrix-report.json` 与 `release/environment-matrix-report.md`，把 demo、staging、production 三层环境的必填变量、阻断变量、责任人、门禁脚本和上线验收规则固化为可检查矩阵；`release:report` 会同步归档该矩阵，便于生产切换前逐项确认环境分层和签字证据。

`operations:readiness` 会生成 `release/operations-readiness-report.json` 与 `release/operations-readiness-report.md`，检查 `/api/health`、`/api/metrics`、`/api/system/readiness`、生产部署轨道、外部依赖风险和发布运维脚本。

`process:audit` 会生成 `release/process-audit-report.json` 与 `release/process-audit-report.md`，把居民主索引、慢病验收、医共体验收、医保取药、统计证照、安全合规和生产切换汇总为全流程审计证据域；`release:report` 会同步归档该报告。

`release:report` 会额外生成 `release/service-acceptance-summary.json` 与 `release/service-acceptance-summary.md`，把慢病和医共体服务域的建模情况、记录行数、开放事项数和 open actions 整理为单独验收摘要，便于从发布包直接核对 `/api/service-acceptance-summary` 的运行时结果。

`site:pack` 会生成 `release/site-readiness-pack.json` 与 `release/site-readiness-pack.md`，把政务身份源、HIS/EMR/LIS/PACS/医保/证照接口联调、监控值守和生产签字事项转换为现场可填写的字段映射、样例报文、告警、值班和签字模板；同时生成 `release/templates/*/README.md`，按身份源映射、接口联调、监控值守、生产签字四类模板说明当前系统可实现的能力、需收集的输入、产出物和 API 证据。`GET /api/site-template-readmes` 会把这 4 个模板 README 作为运行时审计数据返回，工作台会展示每个模板的状态、责任方、行数、附件类型和 live evidence；`release:report` 会同步归档该准备包与模板 README。

`monitoring:readiness` 会生成 `release/monitoring-readiness-report.json` 与 `release/monitoring-readiness-report.md`，专项检查健康检查、运行指标、慢请求、状态码、死信、数据质量、SLO 阈值、告警信号和 on-call escalation 证据；真实 Prometheus/OpenTelemetry 或平台日志绑定完成后，再用 `CUTOVER_MONITORING_SIGNOFF` 作为现场签字信号。

`referral:readiness` 会生成 `release/referral-teleconsultation-readiness-report.json` 与 `release/referral-teleconsultation-readiness-report.md`，检查医联体转诊、远程会诊、接诊反馈、报告回传、协同工单、绩效评价、居民授权、审计留痕、专用 API 与机构端/县域端入口，作为 HIS/EMR、预约号源、远程视频、PACS/LIS 报告和医共体绩效公式现场联调前的闭环证据。

`evaluation:evidence` 会生成 `release/evaluation-evidence-report.json` 与 `release/evaluation-evidence-report.md`，汇总互联互通四甲/五乙测评所需接口清单、标准映射、交易样例、整改记录、P1 接口需求和流程审计证据。

## 备份、脱敏与回滚

```powershell
npm.cmd run storage:backup
npm.cmd run storage:sanitize
npm.cmd run storage:assess
npm.cmd run rollback:snapshot -- "data/backups/<备份目录>"
```

- `storage:backup`：备份 `db.json` 和 `health-city.sqlite`，生成 SHA-256 清单。
- `storage:sanitize`：生成脱敏演示快照。
- `storage:assess`：生成恢复演练验收报告。
- `rollback:snapshot`：从指定备份或最新备份恢复静态快照，并先创建 `pre-rollback` 安全副本。

## 发布边界

GitHub Pages 只适合发布静态页面和脱敏 `data/db.json` 快照。以下能力必须部署 Node 后端才能使用：

- 登录会话和角色 API 权限
- SQLite 主存储、集合版本和乐观锁
- 工作流动作、任务消息、审计写入
- 接口网关签名、幂等、重试、死信
- `/api/health` 和 `/api/metrics`

在独立后端、身份源、专线网关、生产数据库和现场联调完成前，不应将当前演示站描述为生产系统。

## 后续优化计划

代码库内可继续推进：

1. 生产部署基线：已完成环境模板、demo/staging/production 环境矩阵、健康检查、后端部署说明、发布/部署门禁、CI artifact 取证和静态快照回滚；后续按真实部署平台补密钥注入、现场签字和环境差异参数。
2. 可观测性：已完成 `/api/metrics`、请求状态、慢请求、任务堆积、死信、数据质量和 `/api/system/readiness`；后续接入 Prometheus/OpenTelemetry 或平台日志服务。
3. 数据模型深化：已完成 SQLite schema v7、集合版本、乐观锁、恢复演练和 P2 结构化镜像表；后续继续补生产数据库约束、索引、回滚脚本和原生备份证据。
4. 发布取证：已完成 release report、deploy check、外部依赖风险台账、安全验收台账、慢病/医共体验收台账、全流程审计报告、数据质量/主索引证据、运维就绪证据和 CI 报告归档；后续在真实环境挂接测评报告、联调记录和上线签字。
5. 测试深化：已覆盖 API 回归、覆盖率、E2E、并发冲突、静态快照、备份恢复、接口网关和发布门禁；后续围绕真实接口字段差异、移动弱网和现场权限边界继续扩展。

必须现场资源才能完成：

- 政务统一身份源、机构目录、医生身份源、居民实名关系。
- HIS、EMR、LIS、PACS、心电、医保核心、电子证照、公安民政、妇幼和疾控系统。
- 等保、密评、信创、专线、国密设备、生产密钥和测评报告。
- 数据库原生在线备份、异地副本、RTO/RPO 验收、生产级恢复演练。
- 真实老年用户可用性测试、机构信用公示口径、科研伦理审批和数据使用协议。

更多细节见：

- [部署说明](./DEPLOYMENT.md)
- [后续开发优先级](./docs/后续开发优先级.md)
- [GitHub 拆分部署方案](./docs/GitHub拆分部署方案.md)

## Priority app 3: medical quality and safety supervision

- Runnable portal: `quality-safety.html`
- API evidence: `/api/quality-safety/dashboard`, `/api/quality-safety/issues/:id/dispatch`, `/api/quality-safety/rectifications/:id/feedback`, `/api/quality-safety/rectifications/:id/review`
- Seed collections: `qualitySafetyEvents`, `criticalValueAlerts`, `clinicalPathwayCases`, `medicalRecordQualityReviews`, `mutualRecognitionQualityReviews`, `qualityRectificationOrders`
- Reused collections: `diagnosticReports`, `countyMutualRecognitionRecords`, `dataQualityIssues`, `institutionCreditEvaluations`, `securityEvents`, `hospitalInteroperabilityFunctions`
- Release artifact: `quality-safety-report.md` / `quality-safety-report.json` from `npm.cmd run quality-safety:report`

Site joint-testing boundary: production HIS/EMR/LIS/PACS critical-value rules, real clinical pathway dictionaries, signed medical-record sampling forms, mutual-recognition QC rules, department sign-off evidence, and notification channels remain site-owned inputs.

## Hospital Operations Dispatch

operations.html is the runnable management entry for hospital operation monitoring and resource dispatch. It uses GET /api/operations/dashboard, POST /api/operations/dispatch, and POST /api/operations/reconciliation/:id/review to cover bed, staff, equipment, outpatient, emergency, inpatient, dispatch, alert, and statistics direct-report reconciliation boundaries.

hospital-operations:readiness generates release/hospital-operations-readiness-report.json and release/hospital-operations-readiness-report.md. The report reuses healthStatistics, healthStatisticsIngestion, medicalResources, operations-readiness, /api/metrics, and platformProcessAudit evidence, and is included by release:report and deploy:check.

## Medical Escort Service Platform

`escort.html` is the runnable commission entry for the older adult medical escort service pilot. It uses `GET /api/escort-services/dashboard`, `POST /api/escort-services/orders`, and `POST /api/escort-services/orders/:id/actions` to manage provider registry publication, trained escort workers, service requests, contract and insurance evidence, subsidy categories, risk queue, quality callbacks, and task messages.

`citizen.html` includes a resident-side medical escort appointment form. Citizen users can create an order for themselves or household members through `POST /api/escort-services/orders`; the same scoped dashboard returns only their household orders and published service providers.

`npm.cmd run escort:readiness` generates `release/escort-service-readiness-report.json` and `release/escort-service-readiness-report.md`, proving the policy-to-system mapping, registry, workforce, order evidence, API guard, commission frontend entry, and citizen appointment entry.
## Internet Nursing Pilot

`internet-nursing.html` is the runnable three-role entry for Internet+ Nursing. Citizens can submit nursing appointments, hospital users can complete first-visit assessment, informed consent, and nurse dispatch, and the nurse workstation can accept orders, start tracked home service, complete nursing records, and leave quality-callback evidence.

Demo login: use `nurse` / `123456` to open the nurse workstation directly; it is scoped as an institution user with `nurseId=inn-001`.

The module uses `GET /api/internet-nursing/dashboard`, `POST /api/internet-nursing/orders`, and `POST /api/internet-nursing/orders/:id/actions`. It tracks pilot institutions, qualified nurses, resident appointments, consent, service traces, nursing records, risk level, and task messages.

The handoff document is `docs/互联网护理服务模块说明.md`; it covers role entries, data objects, API permissions, risk controls, workflow diagram, and acceptance evidence.

`npm.cmd run internet-nursing:readiness` generates `release/internet-nursing-readiness-report.json` and `release/internet-nursing-readiness-report.md`, checking the Liaoning pilot policy boundary, institution registry, nurse qualification, order evidence, API guard, three-role frontend, and release script.
## Drug Consumable Supervision Evidence

`drug-consumable:readiness` generates `release/drug-consumable-readiness-report.json` and `release/drug-consumable-readiness-report.md`, covering rational medication, prescription review, fixed pickup, high-value consumable clues, insurance settlement coordination, and remediation-loop evidence for the drug and consumable supervision app.
## Health Dashboard Aggregate Entry

- `health-dashboard.html` is priority application 8: the aggregate entry for the first seven applications.
- `GET /api/health-dashboard/summary` returns application metrics, risk counts, open actions, interface tracks, acceptance evidence, and site dependencies for commission users.
- `GET /api/priority-applications/templates` returns the eight independent conversation handoff templates, including the Chinese conversation titles and the required boundary, reuse, data, API, frontend, test, acceptance, About-page description, module documentation, and workflow-diagram fields.
- Every application in the summary carries the unified development template: functional boundary, reuse points, data collections, API routes, frontend entry, test evidence, and acceptance artifacts.
- Unified template rule: every platform template must include an About feature section, a module document under `docs/`, and a workflow diagram covering data source, business workflow, sharing/collaboration, citizen visibility, and management statistics or alerts. `docs/妇幼健康全模块说明.md` is the reference implementation for this rule.
- Maternal-child policy About page: `maternal-child-about.html` documents the birth certificate policy basis, seventh-version certificate transition, three-role functional boundary, data workflow diagram, and acceptance rule. `docs/maternal-child-policy.md` keeps the policy-to-system mapping for release review.
- `npm.cmd run maternal-child:readiness` writes `release/maternal-child-readiness-report.json` and `release/maternal-child-readiness-report.md`, forming the maternal-child main function report and checking policy basis, About page, module/function documents, birth certificate data, API routes, role boundaries, privacy audit, and release evidence.
- `npm.cmd run policy:coverage` writes `release/policy-coverage-report.json` and `release/policy-coverage-report.md`, checking About-page policy IDs, policy documents, template rules, CI, deploy-check, release manifest, and operator documentation coverage.
- `npm.cmd run health-dashboard:summary` writes `release/health-dashboard-summary.json` and `release/health-dashboard-summary.md`.
- `npm.cmd run priority-apps:templates` writes `release/priority-application-templates.json` and `release/priority-application-templates.md` for the eight independent application handoff templates.
- Each priority application template now carries a copy-ready `conversationStarter`, an `implementationChecklist`, and an `acceptanceGate` so each independent conversation can start with the same release boundary and evidence requirements.
- `release:manifest` indexes `health-dashboard-summary.md` as the release artifact for the eight-application template and aggregate dashboard evidence.
- Boundary: the dashboard does not replace source workflows; source applications remain the system of record for business operations and acceptance.
