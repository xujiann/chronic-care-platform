# 大连卫生健康信息平台 MVP

这是一个面向卫生健康信息化场景的可运行 MVP，用于验证大连市卫生健康委、医疗机构、医保局/医保中心/区市县医保局、居民端、县域医共体平台和统一运营工作台之间的数据贯通、业务闭环、权限隔离、审计保全和静态展示发布。

当前仓库已经完成 P0/P1/P2 的本地演示级与 API 基础闭环；剩余生产化事项主要依赖真实身份源、医疗机构接口、医保核心系统、公安民政共享、安全测评和现场部署资源。

居民健康档案公共接入可通过 `npm.cmd run citizen-records:check`、`npm.cmd run citizen-records:test` 和 `npm.cmd run citizen-records:readiness` 验证。T00 已接入授权策略、照护工作区路由和当前 PWA 缓存；真实身份与关系目录、HIS/EMR/LIS/PACS、对象存储、SIEM、法务同意版本、上线签字及公网 TLS 未提供前，`productionReady` 保持 `false`。

挂号、双向转诊与家庭医生闭环可通过 `npm.cmd run registration-referral:check`、`npm.cmd run registration-referral:test` 和 `npm.cmd run registration-referral:acceptance` 验证。公共 API 使用服务端时间、`Idempotency-Key`、演员/机构范围及既有聚合 `expectedVersion` 执行 40 类命令，并持久化哈希链审计；真实 HIS、支付、医保、转诊和消息回调以及现场责任、SLA、切换和回滚签字未齐前，生产上线继续阻断。

## 当前能力总览

| 范围 | 已完成能力 |
|---|---|
| P0 测试与 CI | Node API、隔离测试数据、角色权限、居民数据裁剪、静态页面守卫、敏感信息扫描、API 契约、覆盖率门禁、Chromium 端到端角色旅程 |
| P0 数据与恢复 | SQLite/JSON 双路径、schema v1-v11 幂等迁移、集合版本、乐观锁、409 冲突契约、PostgreSQL 事务 outbox、基线入队与只读影子核对、备份、恢复演练、脱敏快照、恢复指标验收 |
| P0 认证与隐私 | PBKDF2 密码哈希兼容、签名会话、SQLite 持久化会话与跨进程撤销、密钥轮换、token 篡改拒绝、字段脱敏、授权撤销、访问历史复核、审计哈希链 |
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
| `doctor` / `doctor_wang` | `doctor.html` | 医生账户 |
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
| `research-sandbox-about.html` | 科研数据沙箱政策说明、运行边界、政策依据、现场验收证据和发布证据 |
| `index.html` | 卫健委端：慢病、统计、应急、质量、审计、互认、绩效 |
| `institution.html` | 医疗机构端：授权档案、转诊、固定取药、证照、多点执业 |
| `insurance.html` | 医保局/医保中心/区市县医保局：审核、监管、凭证、取药 |
| `citizen.html` | 居民端个人健康信息库、家庭成员、授权共享、适老化服务 |
| `t10-specialty-cutover.html` | T10 急救、临床用血、区域影像云和健康体检统一切换总控；区分代码就绪与现场生产证据 |
| `physical-examination.html` | 体检中心/医院结果接入、专项体检隔离分流、健康时光机、报告翻译、异常行动、个性计划、辐射管家、质量啄木鸟和城市雷达 |
| `physical-examination-highlights.js` | 居民端与管理端共享的体检创新亮点计算及可审计动作引擎 |
| `docs/体检系统信息化规范基线-2026-07-15.md` | 体检业务、共享文档、数据元/值域、签名、隐私、安全和留存规范目录 |
| `docs/体检系统规范需求追溯矩阵-2026-07-15.md` | 规范条款到代码、测试与上线证据的追溯矩阵 |
| `docs/体检系统创新亮点设计与验收-2026-07-17.md` | 15类体检创新亮点、隐私边界、动作接口与验收依据 |
| `mobile-preview.html` | 居民端手机预览 |
| `county.html` | 县域医共体平台、16255 模型、协同工单、互认、基层 AI |

居民端已提供可安装网页应用基础壳：`manifest.webmanifest`、`service-worker.js` 和 `pwa-icon.svg` 支持浏览器安装入口、静态资源缓存和弱网/离线回退到居民端健康档案页面；`citizen.html?client=mini-program|app&page=health-record|emr|nursing|escort|registration` 将健康档案、电子病历、护理、陪诊和挂号拆为可分享、可回退的二级页面，并区分小程序与手机应用两种上线运行形态；桌面服务导航、手机端压缩服务标签、手机顶部快速切换条与手机底部导航均按 URL 跳转并优先落到对应业务内容，摘要卡提供当前页面主操作入口，陪诊预约会在提交前汇总服务主体、费用、就诊安排、服务内容、医院交接和保障状态，服务待办中心会按居民汇总慢病随访、筛查宣教、固定取药、转诊号源、陪诊和互联网护理事项，并支持确认、取消、反馈、评价和满意度/投诉质控闭环；居民通知面板复用 `/api/messages` 和回执接口展示预约变更、护士接单、陪诊师匹配、授权到期等消息；运行形态面板展示入口、上线能力、发布条件、当前二级页入口、复制入口和发布检查清单，功能审计沉到页面后方作为状态证明；手机应用/可安装网页应用形态已补齐安卓/苹果添加到桌面的 meta、Manifest `id`、展示降级策略和健康档案/电子病历/陪诊快捷入口；`mobile-preview.html` 提供 390px 手机框、本机/真机访问地址、演示登录方式、服务切换控制、双端运行形态切换、底部服务导航和待办通知验收清单，并适配 `?client=app` 直接预览手机应用形态，便于发布前预览居民端手机操作；个人健康信息库已细分电子病历、检查检验、用药处方、影像资料和附件资料，正式上线时仍需结合生产域名、HTTPS、PACS/文档存储授权和现场移动端策略复核。

居民端手机二级页摘要区新增当前页序号、已实现能力数和全宽主操作按钮，方便居民在小程序/手机应用预览里确认当前位置并直接进入业务内容。
手机端底部二级导航同步展示每个服务的实现状态和可用能力数，居民在健康档案、电子病历、护理、陪诊和挂号之间切换时无需回到顶部即可判断功能是否可用。
小程序/手机应用二级页支持在页面空白区域左右滑动切换服务，并避开按钮、表单和链接等交互控件，方便单手连续浏览。
手机预览页现在兼容 `mobile-preview.html?client=app&page=nursing` 这类入口，发布前可直接打开指定手机应用形态和二级服务页。
居民端运行形态面板同步展示小程序与手机应用的 P0 现场材料，包括生产短信网关、实名/家庭关系核验、HTTPS/隐私协议、应用签名、推送证书和崩溃监控，便于上线前把已就绪能力和现场补齐事项分开验收。
P0 现场材料继续补充责任方、验收口径和摘要统计，居民端预览时可直接看到材料总数、现场补齐数和责任方数量，便于现场联调按责任闭环。
运行形态面板提供“复制材料清单”，会按当前小程序/手机应用端型和二级页面生成入口、摘要、责任方、验收口径与材料说明，方便现场交接和微信群/工单同步。
手机预览页会自动带上 `launch=1` 验收参数以显示内部上线材料；普通居民入口不携带该参数，保持居民端页面简洁。
手机预览页新增“复制验收摘要”，会按当前小程序/手机应用端型、二级服务页、真实入口、演示登录和 `launch=1` 材料口径生成现场验收文本，便于直接粘贴到上线工单。
若现场浏览器限制剪贴板，手机预览页会展开独立的验收摘要框并自动选中摘要文本，入口 URL 输入框仍保持真实居民端地址。
手机预览页同步显示当前服务验收卡片，聚合端型、二级页序号、已实现状态、能力数、生产化提示和真实入口，便于现场不进入 iframe 也能核对发布口径。

手机预览页工具栏同步提供“上一个/下一个”快捷切换、左右方向键和手机框左右滑动服务切换、“打开当前页面”“出生健康直达”“复制入口”“当前入口地址”“精简预览”和手机框验收状态，会随小程序/手机应用和健康档案、电子病历、护理、陪诊、挂号切换生成真实居民端 URL；精简预览会进入手机验收模式，隐藏说明区、放大手机框并自动对齐到预览区，手机框顶部保留滑动切换提示，验收状态区会标明滑动切换是否启用，并汇总端型、服务、序号、预览模式和验收方式；预览说明区同步展示 P0-P3 下一步开发优先级，便于现场验收和真机分发。

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
- 医院运行监测：`hospitalOperationSnapshots`、`resourceDispatchRequests`、`emergencyDispatchLoops`、`statisticsReconciliationReviews`、`operationAlertRules`
- 治理审计：`securityEvents`、`dataAccessLogs`、`platformRoadmap`、`platformAudit`、`platformProcessAudit`
- 生产部署：`productionDeploymentPlan` 记录发布门禁、正式数据库适配、政务身份适配和审计保全路径
- P2 治理：`institutionCreditEvaluations`、`creditEvaluationRules`、`researchDatasets`、`diseaseRegistryModels`
- P2 体验：`mobileExperienceSettings`、`accessibilityChecklist`、`seniorServices`

SQLite 结构化镜像已覆盖居民、账户、主索引、个人健康档案、慢病业务、随访、医保、证照、诊疗工单、固定取药、县域业务，以及 P2 的机构信用评价、科研数据集、专病库模型和无障碍验收清单。

## 后端 API

主要 API：

| API | 说明 |
|---|---|
| `GET /api/live` | 无外部依赖的进程存活检查，供编排器判断是否需要重启实例 |
| `GET /api/health` | 依赖就绪检查，返回服务、存储和会话存储状态；中央会话不可用时返回 503 |
| `GET /api/metrics` | 管理端运行指标，返回请求数、状态码、慢请求、任务堆积、死信、质量问题；运营工作台会在服务模式下展示部分指标 |
| `GET /api/system/readiness` | 管理端系统就绪报告，汇总 P2 集合、接口准备度、审计链、运行负载和现场外部依赖边界 |
| `GET /api/t10-specialty/cutover-pack` | 卫健委只读查询四条专科切换轨道、现场阻断、首个灰度增量、演练计划、Go/No-Go 决策矩阵、四眼签收和患者安全降级控制；`/api/t10-specialty-cutover` 保留为兼容路径 |
| `GET /api/physical-exams` | 按角色授权和居民主索引查询全部历史体检报告，返回年度、来源机构、异常项和健康建议 |
| `POST /api/physical-exams/import` | 体检中心或医院单份/批量接入；一般成人体检同步健康档案，职业/专项体检进入受限分流队列，二者均幂等去重 |
| `POST /api/physical-exams/abnormal-cases/:id/actions` | 对体检异常结果执行通知居民、复查安排、专科分派、关闭或重开，并生成消息与审计证据 |
| `POST /api/physical-exams/:id/link-attachment` | 将已完成校验和与恶意文件扫描的原始体检报告安全附件关联到健康档案 |
| `POST /api/physical-exams/joint-tests/:id/actions` | 逐项登记机构现场联调证据；机构提交、不同卫生行政责任人按同一SHA-256摘要独立核验后才完成上线确认 |
| `POST /api/physical-exams/specialized-intakes/:id/actions` | 凭证据编号把专项体检分配到独立画像、退回来源或关闭分流，禁止混入一般体检档案 |
| `GET /api/process-audit` | 管理端全流程审计报告，汇总居民、慢病、医共体、医保取药、统计证照、安全合规和生产切换证据域 |
| `POST /api/auth/login` / `GET /api/auth/me` / `POST /api/auth/logout` | 登录、会话、退出 |
| `GET /api/state` / `PUT /api/state` | 按角色裁剪读取和管理端持久化状态 |
| `GET /api/multi-practice-registry` | 医师多点执业监管台账，按角色返回公开备案、风险补正队列、材料核验和政策摘要 |
| `GET/POST/PATCH /api/personal-records` | 个人健康档案读写 |
| `POST /api/workflow-actions` | 通用工作流动作 |
| `GET /api/regional-data-sharing` / `GET /api/regional-data-sharing/handoff-report` / `POST /api/regional-data-sharing/access-reviews` | 区域诊疗数据共享包、转诊会诊交接清单和调阅审计留痕；管理端全域可见，机构端按来源/接收机构裁剪 |
| `PATCH /api/chronic-management-plans/:id`、`/api/chronic-comorbidity-plans/:id`、`/api/chronic-tcm-services/:id`、`/api/chronic-self-management/:id`、`/api/chronic-medication-support/:id`、`/api/chronic-quality-metrics/:id` | 慢病管理计划、多病共管、中医药、自我管理、用药保障和质控记录的单条更新，支持机构/卫健委权限、居民授权范围和乐观锁 |
| `GET /api/tasks` / `POST /api/tasks/:id/actions` | 统一任务中心 |
| `GET /api/messages` / `POST /api/messages/:id/receipt` | 站内消息与送达回执 |
| `GET /api/data-quality/issues` / `GET /api/data-quality/scorecard` | 数据质量治理 |
| `GET /api/security/compliance-report` / `GET /api/security/high-risk-events` | 安全合规证据 |
| `GET /api/credit-evaluations/calculate` | 信用评价自动计算 |
| `GET /api/performance/consortium-report` | 医共体绩效、人财物、药耗、基层履约报表 |
| `GET /api/research/datasets` / `POST /api/research/datasets/:id/actions` | 科研数据集治理 |
| `GET /api/research/sandbox` / `POST /api/research/datasets` / `POST /api/research/datasets/:id/evidence` / `POST /api/research/datasets/:id/approval` / `POST /api/research/datasets/:id/sandbox-access` / `GET /api/research/compliant-exports` / `POST /api/research/datasets/:id/compliant-exports` / `POST /api/research/datasets/:id/outcomes` | Research dataset application, evidence-document registration, ethics approval, de-identified sandbox access, compliant data export, audit trail, and outcome return |
| `GET /api/research/disease-models` / `POST /api/research/disease-models/:id/review` | 专病库模型和人工复核 |
| `GET /api/operations/dashboard` / `GET /api/operations/resource-pool` / `GET /api/operations/emergency-dispatch-loop` / `GET /api/operations/go-live-gates` | 医院运行监测、跨院资源池、急诊拥堵调度闭环和上线前门禁清单 |
| `POST /api/operations/emergency-dispatch-loop/actions` / `POST /api/operations/go-live-gates/actions` / `POST /api/operations/dispatch` | 急诊拥堵复核留痕、上线前门禁复核和资源调度工单管理 |
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
SESSION_STORE=sqlite
SESSION_TOPOLOGY=single-host
SESSION_EXPIRED_RETENTION_DAYS=7
SESSION_REVOKED_RETENTION_DAYS=30
SESSION_CLEANUP_INTERVAL_MS=900000
INTEGRATION_GATEWAY_SECRET=replace-with-integration-secret
DATABASE_URL=postgres://health:replace-with-password@postgres.internal:5432/chronic_care
OIDC_ISSUER_URL=https://identity.example.gov.cn/real-issuer
OIDC_CLIENT_ID=replace-with-oidc-client-id
OIDC_CLIENT_SECRET=replace-with-oidc-client-secret
SMS_GATEWAY_URL=https://sms.example.gov.cn/real-gateway
SMS_DELIVERY_CALLBACK_SECRET=replace-with-provider-callback-signing-secret
AUDIT_EXPORT_PATH=/var/log/chronic-care-platform/audit
SIEM_ENDPOINT=https://siem.example.gov.cn/ingest
RETENTION_POLICY=10y-worm
```

说明：

- `STORAGE_ENGINE=auto` 会在 Node 支持 `node:sqlite` 时使用 SQLite，并继续维护 `data/db.json` 静态快照。
- `SESSION_SECRETS` 支持逗号分隔多密钥，便于会话密钥轮换。
- 单主机生产环境使用 `SESSION_STORE=sqlite` 时，会话可跨进程读取和撤销并保留撤销审计；多主机生产环境使用中央 PostgreSQL 会话。开发、测试可显式使用 `memory`。
- 单主机可使用 `SESSION_STORE=sqlite`；多主机必须设置 `SESSION_TOPOLOGY=multi-host`、`SESSION_STORE=postgres`、`DATABASE_URL` 和 `POSTGRES_SSL_MODE=verify-full`。每次鉴权请求从中央表装载会话，跨节点签发、撤销和账号停用立即生效。
- `SESSION_EXPIRED_RETENTION_DAYS`、`SESSION_REVOKED_RETENTION_DAYS` 和 `SESSION_CLEANUP_INTERVAL_MS` 控制过期/撤销会话保留期及自动清理周期；启动清理、周期清理和管理员手动清理均通过身份生命周期中心暴露结果。
- `INTEGRATION_GATEWAY_SECRET` 用于接口网关 HMAC 签名模拟。
- `DATABASE_URL`、`OIDC_*`、`SMS_GATEWAY_URL`、`SMS_DELIVERY_CALLBACK_SECRET`、`AUDIT_EXPORT_PATH`/`SIEM_ENDPOINT` 和 `RETENTION_POLICY` 是生产部署路径的正式数据库、政务身份、居民验证码短信网关、最终送达回调和审计保全配置项。

## 验证与质量门禁

`launch:smoke` generates `release/launch-smoke-report.json` and `release/launch-smoke-report.md`. Run it before release packaging for offline source/artifact checks, or run `npm.cmd run launch:smoke -- --base-url=https://your-runtime-host` after deployment to verify both `/api/live` liveness and `/api/health` dependency readiness.

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:coverage
npm.cmd run test:e2e
npm.cmd audit --omit=dev --registry=https://registry.npmjs.org
```

补充部署前检查：

```powershell
npm.cmd run deploy:check
npm.cmd run deploy:check:full
npm.cmd run env:check
npm.cmd run release:report
npm.cmd run release:report:full
npm.cmd run release:manifest
npm.cmd run integration:control
npm.cmd run integration:control:gate
npm.cmd run launch:smoke
npm.cmd run priority-apps:templates
npm.cmd run maternal-child:readiness
npm.cmd run policy:coverage
npm.cmd run hybrid:deployment-readiness
```

`regional-referral:overlap` 会生成 `release/regional-referral-overlap-report.json` 和 `release/regional-referral-overlap-report.md`，用于检查区域诊疗数据共享平台与医联体转诊/远程会诊功能的重合度。当前结论是“部分合并”：合并交接证据、报告和现场验收边界；不合并运行时主模型和 API。

区域诊疗数据共享页面提供“生成交接清单”动作，对应 `GET /api/regional-data-sharing/handoff-report`。该接口复用共享包权限裁剪，输出每个共享包的 6 项交接证据、待补项、Markdown 清单和运行边界，用于现场证明资料可调阅、可追溯、可交接，但不生成或改写医联体转诊单。

`deploy:check` 会检查 README、部署文档、静态快照、P2 集合、P2 完成状态、P0 接口准备度、安全验收台账、环境脚本和关键 npm scripts；`deploy:check:full` 还会串行执行 `check`、`test`、`test:coverage`、`test:e2e` 和 `npm audit --omit=dev`。

`env:check` 使用 `.env.example` 做演示/模板级校验，不要求真实密钥；`env:check:production` 会读取 `.env`，并按生产规则校验 `NODE_ENV=production`、非 JSON 存储、非占位且不少于 32 位的 `SESSION_SECRETS` 和 `INTEGRATION_GATEWAY_SECRET`。当前运行时正式支持 `STORAGE_ENGINE=auto` 或 `sqlite`；`postgres/postgresql` 仍在 `productionDeploymentPlan` 中作为后续适配项，配置后会被门禁拦截，避免静默回落。生产模式还要求政务身份 `OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET`、居民验证码 `SMS_GATEWAY_URL` 与审计保全 `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT` 至少一项可用。`env:check:production` 与 `release:report` 会附带生产切换清单，按环境文件、生产密钥、统一身份和短信网关、审计保全、存储适配、现场接口联调、医保/证照交换、监控值守和灾备演练列出责任方、阻断状态和下一步动作；外部系统项必须有 `CUTOVER_SITE_INTERFACE_SIGNOFF`、`CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF`、`CUTOVER_MONITORING_SIGNOFF`、`CUTOVER_DR_REHEARSAL_SIGNOFF` 等现场签字信号才会通过。`release:report` 会汇总代码文件、关键 npm scripts、静态快照、P2 完成状态、接口准备度、安全验收、生产部署计划、验收证据和环境配置，默认输出 `release/release-report.json`、`release/release-report.md`、`release/production-cutover-checklist.json` 与 `release/production-cutover-checklist.md`；`release:manifest` 会生成 `release/release-artifact-manifest.json` 与 `release/release-artifact-manifest.md`，把所有发布报告、模板 README、生成命令和 API 证据整理成发布包目录清单；`release:report:full` 额外执行 `check`、`test`、`test:coverage`、`test:e2e`、`deploy:check` 和 `npm audit --omit=dev`。CI 会在每次检查中生成并上传 `release-readiness-report` artifact，便于发布取证。

短信生产回调额外要求 `SMS_DELIVERY_CALLBACK_SECRET`，且必须是非占位的 32 位以上密钥。`POST /api/auth/sms-delivery-callback` 完成 HMAC 验签、时钟偏差、nonce 重放、幂等和乱序保护，`GET /api/auth/sms-deliveries` 提供卫健委脱敏送达台账；真实供应商字段映射、密钥托管、网络白名单和联合测试回执仍是上线阻断项。

`release:report` 同时输出 `release/storage-model-inspection.json` 与 `release/storage-model-inspection.md`，记录 JSON 快照集合数、记录量、最大集合，以及 SQLite 表、schema 版本和迁移元数据；SQLite 文件在干净 checkout 中不存在时只作为提示，不阻断 CI。`production-db:readiness` 会生成 `release/production-db-readiness-report.json` 与 `release/production-db-readiness-report.md`，把 PostgreSQL/正式数据库切换前的 `productionDeploymentPlan`、当前 SQLite/JSON 模型、备份恢复演练文档、RTO/RPO 说明和运行时 PostgreSQL 阻断汇总为专项证据包。平台页同时提供生产数据库割接演练中心，通过 `GET /api/production-database/cutover-center`、`POST /api/production-database/cutover-runs` 和 `POST /api/production-database/cutover-runs/:id/actions` 管理四个迁移批次、居民/就诊/报告/统计样例校验、回滚检查点、复核及复测证据；演练成功不会绕过真实数据库驱动、全量迁移、容量测试和签字 gate。

`phase2:citizen-operations-readiness` 会生成居民服务运营专项报告。平台“居民服务运营中心”通过 `GET /api/citizen-operations/center` 和分资源操作 API 管理内容发布、协议版本、实名人工复核、跨服务订单、黑名单及医院服务演示开通；居民端只调用 `GET /api/citizen-operations/public`，不会暴露实名复核和黑名单明细。所有本地动作都保留 `productionReady=false`，正式启用仍需政务实名、法务协议、医院授权、支付退费/医保回调和运营制度签字。

`security:commercial-crypto-readiness` 会生成商用密码能力适配专项报告。平台“商用密码能力适配中心”通过 `GET /api/commercial-crypto/center` 和能力动作 API 管理国密 HTTPS、签名验签、重要数据加密、审计完整性、CA/USBKey 与安全浏览器六类适配合同，执行 SM2/SM3/SM4 运行时兼容性探测并登记现场证据。算法可用不代表产品认证或密评通过，所有记录保持 `productionReady=false`，正式启用仍需合格产品、生产证书与密钥管理、现场验证和第三方密评报告。

`launch:smoke` 会生成 `release/launch-smoke-report.json` 与 `release/launch-smoke-report.md`，离线核对上线前只读运行路由、发布报告、生产割接清单、站点准备包、监控和运维证据是否齐备；传入 `--base-url=http://localhost:5173` 时会额外执行在线健康检查，适合作为发布前最后一跳冒烟。

`identity:contract` 会生成 `release/identity-contract.json` 与 `release/identity-contract.md`，固化政务统一身份接入所需 claims、角色到门户映射、机构覆盖度和样例 claim 映射；`release:report` 与 CI 会同步归档该契约，便于现场 OIDC/SAML 联调前逐项确认。

`audit:retention` 会生成 `release/audit-retention-report.json` 与 `release/audit-retention-report.md`，离线验证安全事件和数据访问日志哈希链，记录导出摘要、保全目标和安全验收台账；默认 `release:report` 在演示环境使用发布包内审计报告作为本地归档目标，生产切换仍必须通过 `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT` 绑定真实保全路径。

`integration:readiness` 会生成 `release/integration-readiness-report.json` 与 `release/integration-readiness-report.md`，检查 P0 接口台账、HIS/EMR/LIS/PACS/医保/证照/统计契约、幂等键、签名和重试策略，并把身份、主索引、安全审计等 P0 覆盖关系纳入发布取证。

`integration:control` 会只读检查 T01-T11 的登记 worktree、统一基线、分支提交、未提交文件和对 `server.js`、`portal.css`、`package.json`、`README.md`、`scripts/release-report.js` 的公共文件占用，并读取 `integration/intake-decisions.json` 中与候选 commit 精确绑定的 T00 审查决定，生成 `release/integration-control-ledger.json` 与 `release/integration-control-ledger.md`。分支新增提交后，旧决定自动转为 `review-stale`，必须重新完成代码审查和定向回归；只有结构检查、commit 绑定接收决定及声明依赖全部通过才进入 `merge-ready`。决定中的 `acceptedCandidateHeads` 只记录已经接收的历史候选，使后续候选被阻塞时仍可验证既有发布回执，但不会把历史接收状态继承给当前 HEAD。`integration/publication-receipts.json` 另行保存经过实际核验的 main/Pages 静态发布回执，包括来源候选、发布提交、CI/Pages run、HTTP 200 资源及内容标记；台账会校验这些回执的提交格式、来源、资源路径、状态和标记完整性，但明确保持 `productionReady=false`，历史回执不代替实时网络探测或生产验收。默认模式用于持续生成台账；`integration:control:gate` 在任一专业线缺失、基线漂移、工作树未清理、触碰 T00 公共文件、审查未接收或专业线尚未全部集成时返回失败。

`interface:mapping` 会生成 `release/interface-mapping-report.json` 与 `release/interface-mapping-report.md`，逐项归档 HIS/EMR/LIS/PACS/医保/电子证照/统计契约字段到平台集合和字段的映射、必填字段覆盖、幂等字段落点、签名与重试证据，作为现场接口字段差异确认和联调整改的前置材料。

`research:sandbox` generates `release/research-sandbox-readiness-report.json` and `release/research-sandbox-readiness-report.md`, covering research dataset applications, disease registry models, ethics approval, data-use agreement evidence documents, de-identification release, sandbox access, compliant data export, usage audit, and outcome return evidence. The first Wave 4.1 smart-hospital research-platform slice is limited to research management and compliant data governance; it does not perform AI diagnosis.

科研数据沙箱的政策说明页为 `research-sandbox-about.html`，基于《中华人民共和国个人信息保护法》《中华人民共和国数据安全法》《网络数据安全管理条例》《涉及人的生命科学和医学研究伦理审查办法》《国家健康医疗大数据标准、安全和服务管理办法（试行）》整理演示边界。当前系统只证明申请、材料登记、审批、脱敏状态、沙箱访问、审计和成果回流的本地闭环；真实科研共享仍需现场提供伦理批件、数据使用协议、字段最小化评审、脱敏/重识别风险评估、日志保全或 SIEM/WORM 留存配置，以及专病库模型复核意见。

`data-quality:report` 会生成 `release/data-quality-report.json` 与 `release/data-quality-report.md`，检查居民主索引完整度、跨集合居民引用、personIndex 一致性、来源可追溯和整改闭环。
`data-governance:readiness` 会生成 `release/data-governance-readiness-report.json` 与 `release/data-governance-readiness-report.md`，把 HIS、EMR、LIS、PACS、医保、公卫、随访/互联网护理等来源系统纳入数据资产台账，汇总 personIndex、机构/科室/人员、疾病/手术/药品/检查检验等标准字典，并把字段映射、必填项、幂等、签名、质量检查和外部/现场阻塞项整理为可审查证据。

`environment:matrix` 会生成 `release/environment-matrix-report.json` 与 `release/environment-matrix-report.md`，把 demo、staging、production 三层环境的必填变量、阻断变量、责任人、门禁脚本和上线验收规则固化为可检查矩阵；`release:report` 会同步归档该矩阵，便于生产切换前逐项确认环境分层和签字证据。

`hybrid:deployment-readiness` 会生成 `release/hybrid-deployment-readiness-report.json` 与 `release/hybrid-deployment-readiness-report.md`，核对 GitHub Pages/静态 HTML 预览层、`data/db.json` 快照回退、`server.js` Node API 后端、存储引擎边界、环境变量模板、CI 和发布门禁接线。

`operations:readiness` 会生成 `release/operations-readiness-report.json` 与 `release/operations-readiness-report.md`，检查 `/api/live`、`/api/health`、`/api/metrics`、`/api/system/readiness`、生产部署轨道、外部依赖风险和发布运维脚本。运行调度页同时提供“生产运维与灾备运行中心”，通过 `GET /api/production-operations/center` 和分资源动作 API 管理 4 类服务级别、3 个 24x365 值班模板、故障事件、恢复演练、RPO/RTO 样例记录及证据包；本地动作均保持 `productionReady=false`，正式运行仍需远端备份、真实监控呼叫/工单、实名排班、全量恢复实测和多方签字。

`registration:journey-readiness` 会生成 `release/registration-journey-readiness-report.json` 与 `release/registration-journey-readiness-report.md`。居民端挂号服务和机构端预约协同工作台通过 `POST /api/registrations/orders/:id/actions` 串联演示支付、HIS 确认、医保预核验确认、到院报到、完诊和退号退款，并把每一步写入消息、访问日志和安全审计；所有演示交易保持 `productionReady=false`，正式上线仍需真实 HIS、支付退款、医保结算和现场验收。

`registration:integration-readiness` 会生成 `release/registration-integration-readiness-report.json` 与 `release/registration-integration-readiness-report.md`。`appointment-order-v1` 通过现有 HMAC 集成网关接收支付、HIS、医保、报到、完诊和退款成功/失败回调，执行必填字段、角色范围、状态顺序、幂等、订单落库、死信、重试和对账校验；机构端预约工作台展示来源、签名、匹配和异常摘要。回调证据仍保持 `productionEvidence=false`，正式切换需真实端点、非占位密钥、机器身份、字段字典、全场景联调和多方签字。

`process:audit` 会生成 `release/process-audit-report.json` 与 `release/process-audit-report.md`，把居民主索引、慢病验收、医共体验收、医保取药、统计证照、安全合规和生产切换汇总为全流程审计证据域；`release:report` 会同步归档该报告。

`release:report` 会额外生成 `release/service-acceptance-summary.json` 与 `release/service-acceptance-summary.md`，把慢病和医共体服务域的建模情况、记录行数、开放事项数和 open actions 整理为单独验收摘要，便于从发布包直接核对 `/api/service-acceptance-summary` 的运行时结果。

慢病信息化文件追溯由 `docs/chronic-informatization-source-inventory.md` 和 `npm.cmd run chronic:informatization-sources` 维护，生成 `release/chronic-informatization-sources.json` 与 `release/chronic-informatization-sources.md`，把 `../慢病` 下的政策规范、建设方案、可研规划、三明/尤溪案例、监测研究和系统设计文件映射到慢病筛查分层、随访反馈、多病共管、用药医保、机构联调和公卫质控能力轨道；该追溯项已进入 `chronic:followup-readiness`、`release:report` 和 `deploy:check`。

`site:pack` 会生成 `release/site-readiness-pack.json` 与 `release/site-readiness-pack.md`，把政务身份源、HIS/EMR/LIS/PACS/医保/证照接口联调、监控值守和生产签字事项转换为现场可填写的字段映射、样例报文、告警、值班和签字模板；同时生成 `release/templates/*/README.md`，按身份源映射、接口联调、监控值守、生产签字四类模板说明当前系统可实现的能力、需收集的输入、产出物和 API 证据。`GET /api/site-template-readmes` 会把这 4 个模板 README 作为运行时审计数据返回，工作台会展示每个模板的状态、责任方、行数、附件类型和 live evidence；`release:report` 会同步归档该准备包与模板 README。

`GET /api/site-launch-evidence` 与 `POST /api/site-launch-evidence` 已支持委端登记现场上线证据，把身份源、接口联调、监控值守和生产签字模板转成可审计的 `siteLaunchEvidence` 台账；统一工作台的 Site readiness pack 面板可以选择模板、填写外部系统、联调单号、附件摘要和验收状态，并在提交后刷新证据缺口。`verified` 状态必须带联调单号或附件摘要，台账会分别统计已登记模板和已验收模板，避免把仅提交材料误判为可上线签字证据。

`onsite:launch-requirements` 会生成 `release/onsite-launch-requirements.json` 与 `release/onsite-launch-requirements.md`，把正式上线现场必须补齐的生产域名、密钥、统一身份、短信、HIS/EMR/LIS/PACS、陪诊/护理/挂号、医保/证照、生产数据库、安全、监控、灾备、居民移动端和灰度签字要求转成 P0/P1 阻断清单；`release:report` 和 `release:manifest` 会同步归档该产物。

`monitoring:readiness` 会生成 `release/monitoring-readiness-report.json` 与 `release/monitoring-readiness-report.md`，专项检查健康检查、运行指标、慢请求、状态码、死信、数据质量、SLO 阈值、告警信号和 on-call escalation 证据；真实 Prometheus/OpenTelemetry 或平台日志绑定完成后，再用 `CUTOVER_MONITORING_SIGNOFF` 作为现场签字信号。

`referral:readiness` 会生成 `release/referral-teleconsultation-readiness-report.json` 与 `release/referral-teleconsultation-readiness-report.md`，检查医联体转诊、远程会诊、接诊反馈、报告回传、协同工单、绩效评价、居民授权、审计留痕、专用 API 与机构端/县域端入口，作为 HIS/EMR、预约号源、远程视频、PACS/LIS 报告和医共体绩效公式现场联调前的闭环证据。县域端已把医共体协同闭环呈现为 `发起 -> 受理 -> 执行/会诊 -> 报告回传 -> 反馈/评价 -> 绩效归档` 六步状态链，并联动 action queue、taskReceipts、exportSummary 与角色跳转按钮；真实 HIS/EMR/LIS/PACS/医保回调、现场签字、生产身份、审计和监控仍保留为 external/onsite blockers。

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
- `/api/live`、`/api/health` 和 `/api/metrics`

在独立后端、身份源、专线网关、生产数据库和现场联调完成前，不应将当前演示站描述为生产系统。

同一平台向多个地区交付时，应采用“统一平台核心 + 独立地区组合发布 + 每地区独立进程/数据/密钥/域名/验收”的部署模型。完整功能清单、新地区接入、环境准备、批量发布、验证和回滚步骤见 [多地区部署功能清单与操作指南](./docs/多地区部署功能清单与操作指南.md)。

地区产品线已提供无密钥部署计划、资源冲突阻断、Docker/Compose 验证模板、六状态发布治理、多地区运维清单和第二地区复制演练。使用 `regional:deploy-plan` 生成逐站点 systemd/激活/Compose 制品，使用 `regional:release-governance` 管理不可变发布账本，使用 `regional:operations` 与 `regional:replication` 验证集中运维和跨地区复制边界。上述工具均保持 `productionReady=false`，不能替代真实现场批准。

四条开发线及六个迭代的交付范围、统一边界和现场后续事项见 [多地区产品线四线六迭代交付报告](docs/多地区产品线四线六迭代交付报告-2026-08-06.md)。

## 后续优化计划

代码库内可继续推进：

1. 生产部署基线：已完成环境模板、demo/staging/production 环境矩阵、健康检查、后端部署说明、发布/部署门禁、CI artifact 取证和静态快照回滚；后续按真实部署平台补密钥注入、现场签字和环境差异参数。
2. 可观测性：已完成 `/api/metrics`、请求状态、慢请求、任务堆积、死信、数据质量和 `/api/system/readiness`；后续接入 Prometheus/OpenTelemetry 或平台日志服务。
3. 数据模型深化：已完成 SQLite schema v11、集合版本、乐观锁、持久化认证会话、恢复演练、P2 结构化镜像表、PostgreSQL 迁移包、事务 outbox、基线入队、只读影子核对及差异处置闭环；后续继续补生产主存储读路径、领域表转换、容量切换和原生备份证据。
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

## Referral Teleconsultation Callback

The runnable policy and about page for this application is `referral-teleconsultation-about.html`; it maps graded diagnosis, county medical consortium informatization, telemedicine governance, and insurance-payment boundaries to the platform workflow.

Receiving systems can use `POST /api/referral-teleconsultations/:id/feedback-callback` with `idempotencyKey` and `x-integration-signature`; accepted callbacks update `receivingFeedback`, status, performance evidence, institution/resident `taskMessages`, audit logs, and a matched integration gateway event.

Scheduling systems can use `POST /api/referral-teleconsultations/:id/schedule-callback` with `idempotencyKey` and `x-integration-signature`; accepted callbacks update `meetingWindow`, receiving doctor, target institution fields, performance evidence, create institution/resident `taskMessages`, and write a matched integration gateway event.

HIS/EMR report callback can use `POST /api/referral-teleconsultations/:id/report-callback` with `idempotencyKey` and `x-integration-signature`; accepted callbacks update report return status, append audit evidence, archive a `teleconsultation-report` personal record, create institution/resident `taskMessages`, and write a matched integration gateway event.

The field contracts are tracked as `referral-feedback-callback-v1`, `referral-schedule-callback-v1`, and `referral-report-callback-v1` in the interface mapping report.

`GET /api/referral-teleconsultations/joint-test-pack` returns the onsite joint-test pack for referral-center, receiving-hospital scheduling, hospital EMR report callback, county performance, and insurance signoff. It includes callback sample payloads, checklist rows, role responsibilities, joint-test task receipt summaries, an export summary showing whether each role is ready for final signoff, a cutover readiness blocker summary, and a structured next-development plan for field replay, onsite archive, insurance performance cutover, and production controls.

`GET /api/referral-teleconsultations/joint-test-ledger` returns the joint-test reconciliation ledger across callback replay events, local demo evidence, onsite signoff status, SLA supervision, and insurance payment-policy rows.

`POST /api/referral-teleconsultations/joint-test-ledger/tasks` lets county or commission users create idempotent `taskMessages` from unresolved ledger rows, so callback replay, onsite signoff, SLA supervision, and insurance-policy follow-up can be assigned before final acceptance.

`POST /api/referral-teleconsultations/joint-test-ledger/tasks/:role/complete` records the owner receipt for a joint-test task. Commission and county coordinators can close any role row; institution and insurance users can close tasks targeted to their role, with receipt and audit evidence retained on the original `taskMessages` row.

`GET /api/referral-teleconsultations/signoff-summary` returns the demo-ready/site-pending signoff summary for referral center, receiving hospital, hospital IT, county performance, and insurance review, so onsite teams can see which local evidence is ready before attaching real signed records.

`POST /api/referral-teleconsultations/signoff-summary/:role/evidence` archives an onsite signoff record for an approved role. Commission/county users can archive any role, institution users can archive referral-center/receiving-hospital/hospital-it evidence, and insurance users can archive insurance evidence; every write records signer, organization, note, audit log, and security event.

`POST /api/referral-teleconsultations/:id/escalations/ack` lets institution, county, or commission users acknowledge or close an SLA reminder. The action updates the teleconsultation `slaDisposition`, county supervision status, reminder message receipts, data-access logs, and security audit trail.

`GET /api/referral-teleconsultations/performance-policy` exposes the referral teleconsultation payment and performance policy, including report-return rate, follow-up closure, repeat-exam control, and payment-path metrics for insurance review and medical consortium settlement.

`GET /api/referral-teleconsultations/consortium-metrics` exposes the G-end collectible medical-consortium closed-loop metrics for commission/county users: loop completion, collaboration response hours, report-return rate, mutual-recognition evidence rows, grassroots follow-up return, quality feedback closure, and role todo backlog. The endpoint is release and indicator-center evidence; it still marks production HIS/EMR/LIS/PACS/insurance callbacks, onsite signatures, production identity, audit export, and monitoring as external or onsite blockers.

The "medical consortium closed loop" task from `chronic-care-platform/docs/浪潮方案4.1立即采纳开发任务分派表.md` is tracked in this thread as a runnable county-portal slice: the six-step closed-loop chain, role-based todos, mutual-recognition light evidence, primary follow-up return, quality/SLA feedback closure, and G-end collectible metrics (`consortium-loop-completion-rate`, `collaboration-efficiency-hours`, `grassroots-followup-return`, `quality-feedback-closure`). These fields are release evidence only; real HIS/EMR/LIS/PACS/insurance callbacks, onsite signatures, production identity, audit export, and monitoring remain external or onsite blockers.

## Priority app 3: medical quality and safety supervision

- Runnable portal: `quality-safety.html`
- About and policy page: `quality-safety-about.html`
- Role access: commission dispatches and reviews; institution/county users can open the same portal for scoped dashboard and rectification feedback.
- API evidence: `/api/quality-safety/dashboard`, `/api/quality-safety/interface-standard`, `/api/quality-safety/interface-joint-test-pack`, `/api/quality-safety/interface-messages/validate`, `/api/quality-safety/issues/:id/dispatch`, `/api/quality-safety/rectifications/:id/feedback`, `/api/quality-safety/rectifications/:id/review`, `/api/quality-safety/critical-values/:id/acknowledge`, `/api/quality-safety/critical-values/:id/dispose`, `/api/quality-safety/clinical-pathways/:id/review`, `/api/quality-safety/core-systems/:id/evidence`, `/api/quality-safety/site-signoffs/:id/evidence`, `/api/quality-safety/site-signoffs/:id/review`
- Seed collections: `qualitySafetyEvents`, `criticalValueAlerts`, `clinicalPathwayCases`, `medicalRecordQualityReviews`, `mutualRecognitionQualityReviews`, `qualityRectificationOrders`, `qualitySafetySiteSignoffs`
- Reused collections: `diagnosticReports`, `countyMutualRecognitionRecords`, `dataQualityIssues`, `institutionCreditEvaluations`, `securityEvents`, `hospitalInteroperabilityFunctions`
- Release artifacts: `quality-safety-report.md` / `quality-safety-report.json` from `npm.cmd run quality-safety:report`, `quality-safety-interface-standard.md` / `quality-safety-interface-standard.json` from `npm.cmd run quality-safety:interface-standard`, and `quality-safety-interface-joint-test-pack.md` / `quality-safety-interface-joint-test-pack.json` from `npm.cmd run quality-safety:joint-test`
- National quality goals: the dashboard and release report map all 10 2025 national medical quality and safety improvement goals to evidence collections, monitoring cadence, site input fields, and next collection boundaries; the module report now gates site input coverage as release evidence.
- National goal cadence plan: the dashboard and module report group the 10 goals into monthly review, quarterly department feedback, and continuous monitoring plans with owners, review windows, evidence counts, and site input coverage.
- Institution interface standard: the interface standard fixes document control, HTTPS/JSON transport, HMAC signature, idempotency key, message envelope, status codes, field dictionary requirements, sample payloads, retry/compensation, and joint-test acceptance checklist for HIS/EMR/LIS/PACS and mutual-recognition platform docking.
- Institution joint-test pack: the portal and API expose sample requests, HMAC-SHA256 signature fixtures, body hash, idempotency replay checks, field dictionaries, site sample acceptance rows, and negative validation cases for missing fields, invalid signatures, and duplicate replay.
- Go-live readiness: the dashboard, module report, and release report compute `controlled_pilot_ready` status with a score, evidence checks, blockers, and production sign-off items.
- Pre-launch tracker: the runnable portal displays production sign-off gaps as owner, status, evidence, and next-action rows before the detailed site sign-off table.
- Onsite requirements: the dashboard and release report list go-live functional requirements with onsite inputs, acceptance evidence, owner roles, status, and source collections.
- Cutover sequence: the dashboard and release report group onsite requirements into before-cutover, cutover-day, and post-cutover stabilization phases.
- Next development plan: the dashboard and module report convert live-interface docking, closed-loop drills, national-goal review, and production audit/operations gaps into prioritized development increments with owners, acceptance evidence, verification commands, and current status.
- Department task queue: attention-required cutover phases are promoted to the top role queue and jump directly to the cutover sequence panel.
- Operations runbook: the dashboard and release report derive module on-call watch items from critical values, rectification SLA, clinical pathways, mutual-recognition QC, site sign-offs, and audit-retention evidence.
- Warning indicators: the dashboard, module report, and release report now expose a first runnable Inspur 4.1 quality-safety increment that normalizes critical-value, rectification SLA, pathway variance, mutual-recognition QC, live sign-off, and audit-retention signals into closed-loop warning rows with thresholds, owners, evidence, and UI targets.
- Site sign-off tracker: production cutover items for live feeds, critical-value routing, pathway dictionaries, mutual-recognition rules, department attachments, and audit retention are tracked with owner, status, required evidence, and audit trail.
- SLA evidence: rectification orders include due-date status, evidence completeness, and commission escalation records.
- Risk ranking: the portal and release report derive institution priority from severity, open issues, SLA pressure, missing feedback, and escalations.
- Regulatory action plan: the dashboard and release report turn risk, SLA, critical-value, pathway, and mutual-recognition signals into prioritized next actions with owner and evidence fields.
- Critical-value loop: institution and commission users can acknowledge and dispose critical value alerts with audit records and linked event status updates.
- Clinical-pathway loop: commission users can review pathway variance cases from the runnable portal, close or return the linked quality event, and preserve audit evidence.
- Policy basis: the about page links the module to the Medical Quality Management Measures, 18 core safety systems, 2023-2025 quality action plan, inspection/test mutual-recognition rules, 2025 national improvement goals, and clinical pathway guidance.
- Pre-launch development gaps: the about page now separates production interface joint-testing, local rule dictionaries, signed evidence attachments, notification/escalation receipts, audit/security hardening, and operations support as the remaining work before formal production launch.

Site joint-testing boundary: production HIS/EMR/LIS/PACS critical-value rules, real clinical pathway dictionaries, signed medical-record sampling forms, mutual-recognition QC rules, department sign-off evidence, and notification channels remain site-owned inputs.

## Hospital Operations Dispatch

operations.html is the runnable management entry for hospital operation monitoring and resource dispatch. It uses GET /api/operations/dashboard, GET /api/operations/site-joint-tests, GET /api/operations/production-hardening, GET /api/operations/go-live-gates, GET /api/operations/intelligence, GET /api/operations/governance-report, GET /api/operations/handover, GET /api/operations/handover/owners, POST /api/operations/handover/signoff, POST /api/operations/go-live-gates/actions, POST /api/operations/dispatch, and POST /api/operations/reconciliation/:id/review to cover bed, staff, equipment, outpatient, emergency, inpatient, dispatch, alert, site joint-test closeout, production hardening, go-live gate evidence, go-live gate review audit, intelligent dispatch recommendations, governance reporting, shift handover owner assignment, shift handover signoff, and statistics direct-report reconciliation boundaries.

上线运行判定由 `/api/operations/dashboard` 中的 `launchReadiness` 汇总生成，统一核对生产加固阻断项、割接签收阻断项、上线后观察异常、待补证据和观察窗口签收状态，并在 `operations.html` 生产加固面板顶部展示可上线运行或暂缓上线运行结论。

`docs/hospital-operations-integration-requirements.md` 列出上线前与 HIS/住院、HR/排班、设备、门急诊、统计直报、绩效监测、120/转运、医保/证照、统一身份、监控/SIEM、移动消息和生产数据库联通的接口、数据、证据、责任方和阻断条件。

`docs/hospital-operations-flow.md` 补充医院运行监测平台完整流程图，覆盖数据接入、状态规范化、运行监测、预警研判、资源调度、急诊拥堵闭环、统计直报对账、移动值守、审计归档和上线观察。

`docs/hospital-operations-development-report.md` 是本模块开发报告，汇总模块定位、已实现功能、数据集合、API 入口、发布验收证据、当前上线边界和下一步开发计划。

operations-about.html is the policy and scope page for the hospital operations platform. It summarizes the 2025 secondary and tertiary public hospital performance monitoring manuals, hospital operation monitoring boundaries, direct-report reconciliation requirements, data source ownership, and on-site joint-test handoff points.

hospital-operations:readiness generates release/hospital-operations-readiness-report.json and release/hospital-operations-readiness-report.md. The report reuses healthStatistics, healthStatisticsIngestion, medicalResources, operations-readiness, /api/metrics, and platformProcessAudit evidence, and is included by release:report and deploy:check.

`hospital-operations:release` generates `release/hospital-operations-release-report.json` and `release/hospital-operations-release-report.md`; `hospital-operations:module-report` generates `release/hospital-operations-module-report.json` and `release/hospital-operations-module-report.md`; `hospital-operations:brief-pdf` generates `release/hospital-operations-module-brief-report.pdf`. The runnable gate and review APIs are `GET /api/operations/go-live-gates` and `POST /api/operations/go-live-gates/actions`.

## Medical Escort Service Platform

`escort.html` is the runnable commission entry for the older adult medical escort service pilot. It uses `GET /api/escort-services/dashboard`, `POST /api/escort-services/orders`, `POST /api/escort-services/orders/:id/actions`, and `POST /api/escort-services/orders/:id/hospital-handoff` to manage provider registry publication, trained escort workers, service requests, hospital handoff confirmation, contract and insurance evidence, subsidy categories, risk queue, quality callbacks, and task messages.

`docs/陪诊信息平台研发报告.md` consolidates the policy basis, implemented escort capabilities, go-live boundary, responsible departments, and next development plan for R&D and pilot reporting. `docs/陪诊信息平台功能责任与下一步计划.md` lists the current escort functions, responsible departments, evidence, next planned development items, go-live responsibility split, on-site handoff evidence, and production blockers; the same responsibility board, owner handoff checklist, and external-dependency blocker table are visible in `escort.html` for on-site review. `docs/陪诊服务上线服务器采购与部署方案.md` explains why the escort module should normally share the platform Node backend during pilot launch, when to buy a separate server, and how to purchase and configure cloud server, domain, HTTPS, database, object storage, SMS, identity, hospital interface, monitoring, and live smoke-test evidence.

`citizen.html` includes a resident-side medical escort appointment form. Citizen users can create an order for themselves or household members through `POST /api/escort-services/orders`; the same scoped dashboard returns only their household orders and published service providers. The resident form now shows a five-item submit-readiness checklist for provider, hospital, department, date, and service items, and blocks incomplete requests before POST. The order API rejects missing provider registry rows, unpublished providers, missing hospital, department, appointment date, or service items, past appointment dates, and duplicate active appointments for the same registration or visit slot before creating the resident appointment.

The hospital interface development handoff is `docs/escort-hospital-interface.md`. It documents HIS/outpatient guidance boundaries, `hospitalCode` scoping, request/response fields, the `hospital-handoff` API, resident notification behavior, audit requirements, and joint-test acceptance steps.

`npm.cmd run escort:readiness` generates `release/escort-service-readiness-report.json` and `release/escort-service-readiness-report.md`, proving the policy-to-system mapping, registry, workforce, order evidence, API guard, commission frontend entry, citizen appointment entry, and resident submit-readiness checklist.

## Digital Hospital Standards Platform

`digital-hospital-standards.html` is the runnable management entry for the digital hospital standards and evaluation platform. It models the standards center, official policy mapping, indicator inheritance, data/evidence collection, automatic validation, tiered review, pilot blockers, and security boundary for a national/provincial/hospital evaluation workflow.

`digital-hospital-standard-platform/` is the public GitHub Pages entry for the v0.21 new-standard platform. It includes pilot operations, pilot collaboration, hospital onboarding, integration certification and execution control, pilot assessment, the evaluation assistant, rollout readiness, operational monitoring, public-health coordination, 57 trial indicators, tiered review, scoring and rectification, and downloadable interface packages. The public-health workbench covers eight governed lanes, chained continuity campaigns, incident registration, optimistic revisions, organization-scoped hospital authorization, independent evidence acceptance, level-specific closure gates, hospital/status/level/SLA filters, overdue escalation, operational statistics, safe JSON/CSV export and read-only links to the professional public-health event, exchange receipt, trusted endpoint-probe summary and evidence packet. The production evidence view separates implemented software controls from externally activated controls, tracks ten digest-only cutover evidence requirements, enforces independent verification and four unique approval roles, and keeps the final decision at `NO-GO` while any runtime, evidence, queue, quarantine or cutover-window gate is incomplete.

The authenticated backend now exposes a durable task runtime based on SQLite WAL and atomic `BEGIN IMMEDIATE` transactions. It supports capability-based Worker registration and claims, one-time lease tokens stored only as hashes, heartbeat renewal, expired-lease recovery, exponential retry, dead-letter review and approved redrive. Server-side callback verification uses a transient managed-key loader, HMAC-SHA256, timestamp windows, nonce replay protection and production mTLS fingerprints. Raw credentials, vault references, lease tokens, signatures, nonces, payloads and idempotency keys are rejected at the persistence boundary. The implementation and acceptance boundary are documented in `docs/数智医院标准平台v0.18生产运行与投产证据.md`; the task and code consolidation decision is recorded in `docs/数智医院标准平台v0.19任务与代码合并记录.md`; the public-health operations increment is recorded in `docs/数智医院标准平台v0.20公共卫生运营增强记录.md`; the evidence and independent acceptance increment is recorded in `docs/数智医院标准平台v0.21公共卫生证据与双人复核闭环.md`.

`npm.cmd run digital-hospital:execution-check` runs the production-runtime domain, repository, security, governance and API tests. `npm.cmd run digital-hospital:production-runtime-readiness` generates `release/digital-hospital-production-runtime-readiness-report.json` and `.md`. A passing software report intentionally remains `software-complete-external-activation-required` until the managed callback key, callback and Worker mTLS identities, independently verified hospital evidence, and approved production change are configured.

`GET /api/digital-hospital/standards` is the commission-only runtime summary for standards, evaluation tasks, evidence packets, review queues, risk blockers, and the no-patient-PII evidence boundary. The page uses `HealthCityAuth.authFetch` against this API and keeps a static fallback for offline preview.

`GET /api/digital-hospital/public-health/coordination` exposes the v0.21 public-health operations board and accepts `hospitalCode`, `laneId`, `level`, `status` and `overdueOnly` filters after intersecting them with the authenticated user's institution-bound hospital scope. `POST /api/digital-hospital/public-health/incidents` registers a minimized incident. `POST /api/digital-hospital/public-health/incidents/:id/evidence` records a governed evidence type, external reference number, minimized summary and SHA-256 digest; `POST /api/digital-hospital/public-health/evidence/:id/actions` independently accepts or rejects it while checking both evidence and incident revisions. `POST /api/digital-hospital/public-health/incidents/:id/actions` advances handling and review, blocks closure until the P0/P1/P2 evidence requirements are independently accepted, or records a separate `escalate-overdue` action without changing lifecycle status. `GET /api/digital-hospital/public-health/incidents/export?format=json|csv` exports only the authorized, filtered ledger and safe summaries. Raw attachments and security material remain outside the coordination ledger, and `productionReady=false` remains fixed until real field evidence and approvals are accepted.

`GET /api/digital-hospital/launch-readiness` returns the pilot launch gate, formal production signoff blockers, owner approvals, P0 requirements, production evidence packet coverage, and action audit state. `POST /api/digital-hospital/launch-readiness/:id/actions` records site evidence or signoff actions into the digital hospital launch ledger and security event chain.

`GET /api/digital-hospital/production-evidence-packets` exposes the formal cutover evidence packet board for HIS/EMR/LIS/PACS samples, security assessment material, rollback rehearsal receipts, and specialty casebook evidence. `POST /api/digital-hospital/production-evidence-packets/:id/actions` verifies one evidence item, writes a security event, and signs the linked launch requirement when the packet is complete.

`GET /api/digital-hospital/launch-command-briefs` exposes the launch command desk for go/no-go, first interface receipt, security observation, rollback standby, and first-day closure briefs. `POST /api/digital-hospital/launch-command-briefs/:id/actions` publishes or archives one command brief and links it back to the affected launch requirements.

`GET /api/digital-hospital/formal-cutover-approvals` exposes the independent formal production approval desk. `POST /api/digital-hospital/formal-cutover-approvals/:id/actions` remains blocked until every site signoff and production evidence item is complete, then requires a change ticket, cutover window, exact confirmation phrase, and a signer not reused by another approval role. Formal production readiness requires all four approvals.

`npm.cmd run digital-hospital:standards-readiness` generates `release/digital-hospital-standards-readiness-report.json` and `release/digital-hospital-standards-readiness-report.md`. The release gate checks the commission-only page guard, standard domains, workflow loop, evidence modes, official source links, API contract, launch readiness gate, production evidence packet board, launch command brief desk, formal cutover approval desk, no patient-identifiable collection boundary, CI wiring, deploy check, release report, launch smoke, and release artifact manifest.

`digital-hospital-evaluation.html` is the commission/institution workbench for P0-P1 pilot evaluation. `GET /api/digital-hospital/evaluation-catalog` exposes 4 rule packs, 70 clause-level projects and the tertiary-general-hospital pilot profile; `GET /api/digital-hospital/pilot-readiness` separates `pilot-launch-ready` from `blocked-until-site-evidence-signed`. Collection, evidence and pre-assessment actions are available under `/api/digital-hospital/collection-jobs/:id/actions`, `/api/digital-hospital/evaluation-evidence/:id/actions`, `/api/digital-hospital/pre-assessments/actions` and `/api/digital-hospital/pre-assessments/:id/actions`. `npm.cmd run digital-hospital:pilot-readiness` generates the release-visible pilot report.

The same workbench now includes multi-hospital pilot operations. `/api/digital-hospital/pilot-institutions/actions` registers institutions, while `/api/digital-hospital/pilot-institutions/:id/actions` enforces six readiness checks, independent approval, whitelist activation, pause/resume, observation-stage advancement, daily-review evidence, institution scope, and the no-patient-PII boundary.

The pilot workbench also includes an institution-scoped issue desk. `/api/digital-hospital/pilot-issues/actions` registers P0/P1/P2 issues against the pilot roster, while `/api/digital-hospital/pilot-issues/:id/actions` controls assignment, remediation, minimized evidence, review submission, independent closure, and commission-only reopening with SLA and audit history.

`digital-hospital-self-assessment.html` now carries the tiered review queue from institution submission through provincial preliminary review and disputed-indicator expert review. Expert opinions can confirm, revise, or return an assessment for correction; submitter, preliminary reviewer, expert reviewer, and final acceptance reviewer are independently checked and every transition is audited.

## Internet Nursing Pilot

`internet-nursing.html` is the runnable three-role entry for Internet+ Nursing. Citizens can submit nursing appointments, hospital users can complete first-visit assessment, informed consent, and nurse dispatch, and the nurse workstation can accept orders, start tracked home service, complete nursing records, and leave quality-callback evidence.

Demo login: use `nurse` / `123456` to open the nurse workstation directly; it is scoped as an institution user with `nurseId=inn-001`.

The module uses `GET /api/internet-nursing/dashboard`, `POST /api/internet-nursing/orders`, and `POST /api/internet-nursing/orders/:id/actions`. It tracks pilot institutions, qualified nurses, resident appointments, consent, service traces, nursing records, risk level, and task messages.

The handoff document is `docs/互联网护理服务模块说明.md`; it covers role entries, data objects, API permissions, risk controls, workflow diagram, and acceptance evidence.

`npm.cmd run internet-nursing:readiness` generates `release/internet-nursing-readiness-report.json` and `release/internet-nursing-readiness-report.md`, checking the Liaoning pilot policy boundary, institution registry, nurse qualification, order evidence, API guard, three-role frontend, closed-loop summary, and release script.

`npm.cmd run citizen:launch-foundation` generates `release/citizen-launch-foundation-readiness.json` and `release/citizen-launch-foundation-readiness.md`; `release:report` includes the same resident phone-code login, account provisioning boundary, PWA/mobile shell, mini-program/APP routing, and production dependency gates. `docs/citizen-production-launch-requirements.md` is the resident-side real production launch requirements document, covering account owner evidence, role permissions, external interfaces, non-functional requirements, security/privacy, acceptance gates, rollout, and rollback.

`docs/居民端下一步开发优先级.md` lists the resident-side next development priorities from P0 production launch foundation through P1 medical data read-only integration, P2 nursing/escort/registration service closure, and P3 pilot operations and accessibility optimization.

`docs/production-go-live-requirements.md` is the platform-level real production go-live requirements baseline. Use it with `release/production-cutover-checklist.md`, `release/site-readiness-pack.md`, `release/launch-smoke-report.md`, `release/release-report.md`, and `release/release-artifact-manifest.md` before deciding that a deployment is ready for real users.

T10 specialty cutover control is available at `t10-specialty-cutover.html`, through the commission-scoped `GET /api/t10-specialty/cutover-pack` endpoint, and as `npm.cmd run t10:specialty-cutover`. The legacy `GET /api/t10-specialty-cutover` path remains available for older previews. Its generated `release/t10-specialty-cutover-pack.json` and `.md` artifacts keep all four tracks `productionReady=false` until real external receipts, independent site verification, four-eyes signoff, duty arrangements, Go/No-Go hard-stop review and downgrade evidence are accepted.

The independently deployable clinical-blood, emergency-life-chain and imaging-cloud gates are registered through `t10:clinical-blood:readiness`, `t10:clinical-blood:smoke`, `t10:emergency-module:smoke`, `imaging-cloud:readiness` and `imaging-cloud:test`. Commission-only readiness summaries are exposed at `/api/t10-specialty/modules/clinical-blood/readiness` and `/api/t10-specialty/modules/emergency-life-chain/readiness`; the imaging workbench uses the nine role-guarded `/api/imaging-cloud/production/*` contracts. Module evidence can become complete without opening the platform: every public response keeps `productionReady=false` until trusted site identity/evidence, the T00 launch approval, duty/SIEM, disaster-recovery and rollback evidence are independently accepted.

T11 production security evidence is governed by `docs/production-security-release-execution-pack.md` and five placeholder-safe templates under `docs/evidence-templates/production-security-release/`. Run `npm.cmd run production-release:evidence:check`, `npm.cmd run production-release:evidence:test` and `npm.cmd run production-release:evidence:readiness`; the last command intentionally exits No-Go while the server-configured controlled evidence directory is incomplete. `GET /api/production-release/evidence-readiness` is commission-only and returns only document/check counts, gate IDs, a digest and safe failed-check IDs. Query/body values cannot select an evidence directory or turn on production, and the response omits paths, signer accounts, attachment references and evidence bodies. Even a structurally valid evidence package does not by itself authorize platform production cutover.

`docs/on-site-launch-materials.md` is the field-owned material checklist for real go-live. It names the production environment, secrets, identity, SMS, HIS/EMR/LIS/PACS, nursing/escort/registration, insurance/certificate, database, security, monitoring, disaster recovery, resident mobile acceptance, gray release, and signoff materials that must be attached before opening to real residents.
## Drug Consumable Supervision Evidence

`drug-consumable:readiness` generates `release/drug-consumable-readiness-report.json` and `release/drug-consumable-readiness-report.md`, covering rational medication, prescription review, fixed pickup, high-value consumable clues, insurance settlement coordination, and remediation-loop evidence for the drug and consumable supervision app.

Implemented drug-consumable capabilities include role-scoped supervision access, rational-medication and prescription-review rows, fixed-pickup and high-value consumable clues, insurance settlement coordination, institution remediation actions, traceability policy sources, traceability evidence requirements and submission, per-row evidence coverage, audit logging, runnable insurance/institution/commission panels, `drug-consumable-about.html`, and release artifacts through `drug-consumable:readiness`, `deploy:check`, `release:report`, and `release:manifest`.

Before production launch, bind real scanner/HIS/pharmacy fields to `traceabilityEvidenceRequirements`, ingest real insurance-code/commodity-code/trace-code mapping versions, connect insurance settlement callbacks, attach high-value consumable catalog and charge-item cross-checks, configure production identity/secrets/audit-retention storage, and archive signed site evidence for interface joint tests, monitoring, and disaster-recovery rehearsal.

## Unified Quality and Operations Governance

`quality-operations-governance-adapter.js` adapts the existing `qualityRectificationOrders`, `resourceDispatchRequests`, and `drugConsumableSupervisions` collections into one canonical governance record without copying resident identifiers. The public read surface is `GET /api/quality-operations-governance/catalog`, `GET /api/quality-operations-governance/items`, and `GET /api/quality-operations-governance/items/:id/audit`; role and institution scope are applied before records or audit events are returned.

Writes use `POST /api/quality-operations-governance/items/:id/actions`. The server requires an `Idempotency-Key` header and a non-negative `expectedVersion`, derives actor identity and institution scope only from the authenticated session, and assigns server time. Successful and rejected attempts are persisted in the domain audit ledger and projected into the platform process and sealed security audit collections; idempotent replay does not duplicate those events.

Run `npm.cmd run quality-operations:governance-readiness` to generate `release/quality-operations-governance-readiness-report.json` and `release/quality-operations-governance-readiness-report.md`. Local routing readiness does not mean production readiness: `productionReady` remains `false` until trusted identity and institution directories, HIS/EMR/LIS/PACS, bed/roster/equipment/transfer sources, scanner and insurance callbacks, production database, SIEM, alert duty coverage, and disaster-recovery evidence are connected and accepted.

## Public Health External Coordination and Key Rotation

T00 registers the eight-lane coordination runtime and external outbox through `GET /api/public-health/coordination-runtime`, versioned coordination actions, external enqueue, due-worker claim and attempt, signed public callback, governed dead-letter recovery, operations-board, and key-rotation routes under `/api/public-health/external/`. Every write uses the server receive time; client-supplied validation time is ignored.

`public-health-external-key-provider.js` loads separate request and receipt keyrings by lane plus an independent contract-governance keyring through an injectable managed-key-service contract. Keyring values are non-enumerable and are never merged into shared state, logs, responses, or release reports. Non-production static secrets remain compatibility-only, while production fails closed without keyring references and a managed loader. Claim, attempt, recovery, audit reconciliation, and operations-board verification receive the complete request keyring so records signed by a grace key remain verifiable; external runtime calls receive only the server-built `credentials.contractGovernance` snapshot.

`public-health-external-worker.js` is the transport-injected worker boundary. It obtains lane credentials at execution time, persists the signed claim lease before calling transport, assigns server time to the attempt, and persists the signed result afterward. It does not contain a real network connector or trusted credential implementation; those remain production-owned dependencies.

`PUBLIC_HEALTH_EXTERNAL_RESILIENCE_POLICIES` is the server-only JSON configuration for all eight lanes. Production startup paths fail closed when any lane is missing or when `failureThreshold`, `openSeconds`, `halfOpenMaxProbes`, `rateLimitPerMinute`, or `maxPending` is outside the governed range. The policy map is non-enumerable in the credential context; enqueue, claim, and attempt payloads cannot replace it.

The due endpoint is candidate scanning only. A worker must call the claim controller with the current dispatch version; the server reads the current lane-control version, and the claimed attempt returns that version for the next CAS. The shared writer checks `dispatch.outboxVersion` and `laneControl.version` together and persists `publicHealthExternalDispatches`, `publicHealthExternalDispatchAudit`, `publicHealthExternalLaneControls`, and `publicHealthExternalLaneControlAudit` in one SQLite transaction. Operations-board output includes the P0 lane-control integrity risks and P1 open/half-open circuit alerts.

Contract governance is read through `GET /api/public-health/external/contracts/governance`. Only an authenticated health-administration governance actor can call `POST /api/public-health/external/contracts/attestations`; the request requires `Idempotency-Key` and `expectedVersion: 0`. The server ignores client-reported approval status, identities, digests and contract bindings, then reconstructs the attestation from `PUBLIC_HEALTH_EXTERNAL_CONTRACT_RELEASE_EVIDENCE`, verifies the deployed T08/T00 artifact binding, field dictionary, bidirectional samples, joint test and rollback evidence, assigns server time and calls `signPublicHealthExternalContractAttestation()`. Signed credentials are unique on `laneId + fromContract`, so one lane can append v1→v2→v3 transitions while the same source version cannot acquire two successors. The durable writer locks and verifies the complete lane chain in the same transaction; branch conflict, missing predecessor, approval-order inversion and overlapping compatibility windows fail closed as P0 `contract-transition-conflict`, `contract-transition-disconnected`, `contract-transition-approval-order-invalid` and `contract-transition-window-overlap`. Accepted and rejected attempts are persisted without raw approver identity or key material.

After each `effectiveAt`, new enqueue resolves only `currentContract` from the server snapshot and emits the matching signed request/receipt Schema; once v3 is active, v1 is retired and v2 is deprecated. Compatibility-period older work can still be claimed, while each transition sunset blocks its own old-version track. Existing dead-letter recovery creates exactly one later chain-version successor and seals the predecessor, successor, two audit relationships and coordination retry in the same durable state update. The operations board embeds one `contractCutover` track per `fromContract`, reporting P1 compatibility backlog, P0 post-sunset backlog and P0 stale/missing successors while excluding delivered history and valid recovered predecessors. Historical verification keys must remain in the production keyring through their signed sunset reconstruction horizon; unknown or revoked keys fail closed and are never silently replaced.

Only commission users can register a trusted endpoint receipt through `POST /api/public-health/external/endpoints/receipts` or read the redacted result from `GET /api/public-health/external/endpoints/summary`. Expected endpoints, current contracts, receive time and verification keyrings come only from server configuration; request bodies and query strings cannot override them. Accepted signed receipts are stored with durable `receiptId` and `nonce` uniqueness in the same SQLite transaction boundary. The summary exposes digests and connectivity state only—not URLs, resolved IP addresses, key identifiers, key material or receipt evidence—and the raw receipt collection is excluded from `/api/state`.

Commission users can trigger a controlled active check at `POST /api/public-health/external/endpoints/probes` with only `laneId`; body and query parameters cannot provide an endpoint, contract, policy, time, keyring, TLS option or transport setting. The server resolves the active contract, independent endpoint-probe keyring, `PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_POLICIES`, certificate pins, mTLS requirement and managed TLS reference (`*_ENDPOINT_PROBE_TLS_REF`). A bounded worker enforces global/lane concurrency and per-lane minimum intervals, rejects mixed public/private DNS answers, pins HTTPS lookup and peer addresses, disables redirects, requires 2xx and governed latency, TLS 1.2/1.3, certificate authorization, configured pins and mTLS, then self-verifies the signed receipt before reusing the durable `receiptId`/`nonce` insert. Started, succeeded and rejected audit rows contain only stable codes and actor scope; URLs, IPs, certificate material, keys and raw network errors never enter the response or audit.

Commission users can trigger one server-controlled eight-lane campaign at `POST /api/public-health/external/endpoints/campaigns`; the body and query must both be empty. The worker resolves every endpoint, active contract, policy, threshold, TLS credential, time and keyring from server configuration, runs all eight probes in one bounded 300-second window, then signs and self-verifies the campaign. `PUBLIC_HEALTH_EXTERNAL_ENDPOINT_PROBE_CAMPAIGN_KEYRING_REF` must resolve a global managed keyring whose purpose is `public-health-endpoint-probe-campaign`; the provider rejects reuse of request, receipt or single-probe signing material. Campaign ID, campaign nonce, cross-campaign receipt ID and receipt nonce uniqueness are checked in the same SQLite transaction as the attestation, eight receipt references and success audit. Each v2 attestation signs the digest of the current trusted predecessor; the worker captures that chain head before probing and the durable writer compares campaign count and head digest again inside the SQLite transaction, rejecting concurrent forks with `ENDPOINT_PROBE_CAMPAIGN_CHAIN_CAS_CONFLICT`. `GET /api/public-health/external/endpoints/campaigns/summary` returns only a commission-scoped redacted continuity view. The current window is evaluated newest-first without filtering rejected records: a failed latest campaign or a failed/tampered campaign between successes breaks the chain, while a rejection already outside the required fresh window remains visible without blocking the current window. Missing or mismatched predecessor links fail closed as `ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISSING` or `ENDPOINT_PROBE_CAMPAIGN_CHAIN_LINK_MISMATCH`; operations, release and deployment checks treat both as blockers. The response exposes only `summary.campaignChainLinksVerified`, `summary.continuityBreaks` and `continuityBreak` with campaign ID and a stable safe code; it never returns predecessor/campaign digests, raw verification reasons, URLs, IPs, certificates, keys, signatures, or evidence bodies. Three fresh, non-overlapping campaigns with two verified predecessor links and no interval above 900 seconds are required for `continuousConnectivityReady=true`; that flag remains separate from `endpointConnectivityReady` and never changes `productionReady=false`.

The commission-only `public-health.html` workspace now loads the endpoint and campaign summary routes into an “外部端点与连续探测” panel. It shows only eight-lane configured/verified counts, endpoint and continuity gates, campaign progress, a “签名前序链 2/2” count or stable safe blocker, continuity-break campaign ID/code, worker success/rejection counts and normalized blockers. The same panel can run one controlled lane probe or one controlled eight-lane campaign: a lane probe submits only one allowlisted `laneId`, while a campaign submits an empty command; endpoint, contract, policy, TLS credentials, time, thresholds and keyrings remain server-owned. Missing configuration, permission, concurrency, frequency, chain-head conflict and network failures map to safe readable messages and fail closed without interrupting the rest of the page. URL, resolved IP, certificate, predecessor/campaign digest, key, signature, raw server message and raw verification reason fields are never rendered, while endpoint connectivity, continuous connectivity and production authorization remain three explicitly separate states.

The enforced rotation sequence is new active key, old grace key, cross-key audit smoke, cross-key callback smoke, then old-key expiry or revocation. An emergency revocation creates a P0 security-quarantine disposition; automatic resign and automatic recovery remain disabled. Run `npm.cmd run public-health:resilience-test` for the focused contract/resilience/modernization/UI regression and `npm.cmd run public-health:final-readiness` for the aggregate 91-check report: 70 T08 functional checks plus 21 T00 public integration and safety-boundary checks. The compatibility field `remainingT00Integration` now aliases `remainingProductionBoundaries`; completed public wiring is not reported as unfinished work. `endpointConnectivityReady`, `continuousConnectivityReady` and respiratory-network `technicalLaunchReady` are independent of production authorization, and all contract, cutover, endpoint and respiratory-network views keep `productionReady=false`. Production remains blocked until real identity and institution directories, HIS/EMR/LIS/PACS, respiratory sentinel and laboratory feeds, bed/roster/equipment/transfer sources, scanner and insurance callbacks, a production database, SIEM, alert duty coverage, P0/P1 closure, trusted site evidence, production handoff, launch approval and disaster-recovery evidence are connected and accepted.

T00 also registers the fifteenth-plan public-health modernization boundary. Commission users read minimized data-foundation, surveillance-model, respiratory-pathogen, respiratory-network, surveillance and medical-prevention boards through `GET /api/public-health/data-foundation`, `GET /api/public-health/surveillance-model-governance`, `GET /api/public-health/respiratory-pathogen-surveillance`, `GET /api/public-health/respiratory-network-readiness`, `GET /api/public-health/surveillance-center` and `GET /api/public-health/medical-prevention-tasks`; governed writes use `POST /api/public-health/surveillance-signals`, `POST /api/public-health/respiratory-pathogen-batches`, shadow-run and model-validation routes, plus the signal, alert, batch, validation and task `/:id/actions` routes. Respiratory-network receipts can only be issued through commission-controlled `POST /api/public-health/respiratory-network-evidence/:id/actions`; the client provides evidence business fields and `expectedVersion=0`, while actor, organization scope, server time, signer/verifier, receipt ID and trust metadata are server-owned. The same route governs `request-suspend`, `request-reinstate`, `request-revoke` and `request-supersede` as pending requests; a different authenticated commission user must then perform `approve-lifecycle` or `reject-lifecycle`. Requester and reviewer identities, server approval time, signed event ID and receipt ID are never client-supplied, revocation is terminal, supersede requires a trusted successor on the same institution/type/panel track, and any active evidence with fewer than 30 validity days blocks `technicalLaunchReady`. `PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_KEYRING_JSON` must contain a managed active/grace/revoked keyring with purpose `public-health-respiratory-network-evidence`; key IDs, signatures, digests, operator identifiers and trust evidence are never returned by the public summary. The public server supplies actor identity, organization scope, receive/action time and header-based idempotency, requires `expectedVersion`, delegates domain transitions to the T08 services and persists their outputs or T00 evidence-store records. Twenty-two collections share a SQLite transaction boundary with entity CAS and unique source-record/idempotency/evidence-ID/receipt-ID/lifecycle-request/event/audit constraints; respiratory publication atomically stores the batch, audit, minimized signals and lineage, respiratory-network issuance atomically stores the signed evidence plus audit, lifecycle approval atomically stores the request decision, signed immutable event and minimized audit, and `/api/state` never exposes those raw collections. The public-health page provides data-foundation, source-operations, rule-governance, surveillance-model, respiratory-pathogen, respiratory-network, monitoring-warning, trusted official-exchange and medical-prevention workbenches while preserving human review. Respiratory intake stores no raw batch, person or specimen identifier; a confirmed aggregate batch may publish only received, unverified signals and cannot create alerts. Model output remains advisory-only, requires independent performance review, expires into `review-due` after 90 days and never grants production authorization. Run `npm.cmd run public-health:modernization-readiness`; real source interfaces, respiratory sentinel/laboratory authorization and mappings, official receipts, staffed review, verified handoffs, approved datasets, sustained quality and drift monitoring, central site evidence, P0/P1 closure, production handoff and launch approval remain production blockers.

The official report/feedback exchange is server-only: authenticated adapters call `POST /api/public-health/official-exchange/official-report-receipts` or `POST /api/public-health/official-exchange/feedback-receipts`, while browser alert actions may submit only `trustedReceiptId`, `expectedVersion` and an `Idempotency-Key`. `PUBLIC_HEALTH_OFFICIAL_EXCHANGE_RECEIPT_KEYRING_JSON` must resolve an active/grace/revoked keyring whose purpose is exactly `public-health-official-exchange-receipt`; `PUBLIC_HEALTH_OFFICIAL_EXCHANGE_CALLBACK_TOKEN` authenticates the adapter boundary. The server assigns time, record ID, server receipt ID, signer/verifier identity and trust metadata, self-verifies every receipt, binds feedback to the current official-report predecessor, then atomically appends the immutable receipt, minimized audit, alert transition and surveillance audit. SQLite independently constrains record ID, server receipt ID, external receipt code and callback idempotency. Public summaries expose only trusted report/feedback counts, stable finding codes and minimized external business status/code; they never expose evidence references, key IDs, signatures, server receipt IDs, verifier identities or secrets. Reopened investigations cannot reuse earlier receipts, and the panel continues to show `productionReady=false` plus production-endpoint acceptance, continuous receipts, site evidence, P0/P1 closure, production handoff and launch approval blockers.

`GET /api/public-health/data-source-operations` derives `fresh`, `delayed`, `stale`, `no-data`, `clock-skew` and `quality-review` only from persisted minimized signals and the server clock. `GET /api/public-health/surveillance-rule-governance`, `POST /api/public-health/surveillance-rule-changes` and the rule-change `/:id/actions` route enforce submit → independent commission review → trusted server activation or rejection. The server resolves `PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_KEYRING_JSON`; its purpose must be `public-health-surveillance-rule-activation`, it must contain exactly one currently valid active key, grace keys may verify historical receipts, and revoked keys fail closed. Signal evaluation, alert actions, governance reads and surveillance-center reads receive that full server-owned ring, while public responses expose only active/grace/revoked counts and stable blocker codes. Client bodies and queries cannot supply a secret, keyring, key ID, trusted source, verification flag, actor or signed receipt; secrets never enter API responses, UI, logs or SQLite state. `publicHealthSurveillanceRuleChanges` and the trusted `publicHealthSurveillanceRules` materialization commit atomically with entity CAS, while historical alerts remain bound to their original verified rule version. `PUBLIC_HEALTH_SURVEILLANCE_RULE_ACTIVATION_SECRET` remains a non-production compatibility/test path only and never satisfies production readiness; production thresholds, managed-key custody, controlled change windows and sustained source-quality observation remain formal No-Go blockers, and `productionReady` remains `false`.

## Nursing and Escort Transactional Runtime

The public nursing and escort create and transition APIs now call `care-service-platform-adapter.js`; they no longer persist privileged order fields through the legacy server normalizers. Every write requires an `Idempotency-Key`, derives actor and organization scope from the authenticated session, assigns server time and commits the order plus its domain outbox event through the existing SQLite collection-version CAS.

Notification receipts use the signed, order/message/channel-bound route `POST /api/care-services/:domain/orders/:id/notification-receipts/:messageId`. Operations users can read `/api/care-services/outbox/health` and `/api/care-services/outbox/dead-letters`; controlled replay requires the exact confirmation phrase and an evidence reference. The independent worker loads `care-service-production-runtime.js` through `CARE_SERVICE_RUNTIME_MODULE` and sends HMAC-bound HTTPS envelopes. Endpoint, transport or secret failures are retried and dead-lettered rather than reported as successful.

Production cutover approval is accepted only from the exact file configured by `CARE_CUTOVER_EVIDENCE_FILE` when its bytes match `CARE_CUTOVER_EVIDENCE_SHA256`. The manifest must contain current, production- and policy-bound, independently signed approvals for business, interface, security, disaster recovery and on-call scopes; standalone `CARE_CUTOVER_*_SIGNOFF=signed` flags are ignored. Commission users can read the redacted gate at `GET /api/care-services/readiness`; it exposes only the formal state, blocker counts, per-scope pass/fail and safe validation error codes.

Production dependency health is accepted only from the exact `CARE_DEPENDENCY_EVIDENCE_FILE` bytes pinned by `CARE_DEPENDENCY_EVIDENCE_SHA256`. Its 13 storage, identity, messaging, hospital, object-storage, financial, audit, worker and care-delivery probes must be fresh, healthy, independently receipted and bound to the currently configured target digest. `npm.cmd run care-service:dependency-targets` prints digest-only bindings without URLs or credentials; it does not perform or replace the probes. Example, demo, localhost and loopback targets remain blocked even when a probe manifest claims success. The commission readiness response exposes only per-dependency pass/fail and allowlisted error codes.

Run `npm.cmd run care-service:test` and `npm.cmd run care-service:readiness`. Platform integration does not make the module production-ready: real identity/organization directories, HIS and appointment interfaces, message/payment/insurance/signature callbacks, production transactional storage, fresh dependency receipts, SIEM/alert duty, disaster recovery evidence and all five evidence-bound site approvals remain hard blockers.

## Insurance Payment and Disease Payment Production Boundary

The insurance-payment public boundary exposes the 23 reviewed refund, formal grouping, special-case appeal and annual-clearance routes recorded by `npm.cmd run insurance-payment:acceptance`. Actors and institution scope come from the authenticated server session. Refund requests retain their trusted organization binding, dual review ignores client-supplied roles, and outbound dispatches use the signed financial adapter. Signed financial callbacks synchronize payment refunds and insurance settlements in the same durable state update.

Formal grouping dispatch and failure commands require a server-system HMAC over the action, path, resource and payload. Grouper receipts are accepted only through the configured callback source, nonce/timestamp window and signature verification. Expert reselection and appeal actions apply the responsibility matrix; finance-only refund reconciliation/closure and annual-clearance posting/locking remain fail-closed until a trusted finance identity source is connected.

Run `npm.cmd run insurance-payment:check`, `npm.cmd run insurance-payment:test`, `npm.cmd run insurance-payment:acceptance` and `npm.cmd run insurance-payment:evidence`. The generated acceptance report and evidence packet verify the local contract and public wiring, but `productionReady` remains false until the listed live identity, institution, insurance-core, financial, database, SIEM, duty, disaster-recovery and signed site-acceptance evidence is independently supplied.

## Health Dashboard Aggregate Entry

- `health-dashboard.html` is priority application 8: the aggregate entry for the first seven applications.
- `GET /api/health-dashboard/summary` returns application metrics, risk counts, open actions, interface tracks, acceptance evidence, and site dependencies for commission users.
- `GET /api/health-dashboard/industry-governance-indicators` returns the commission-only phase-2 indicator center covering physical examinations, fever clinics, disease reporting, clinical assistance, archive access, appointment reconciliation, family doctor fulfillment, and regional performance. The dashboard supports category/status/period filtering, monthly and yearly snapshot views, source drilldown, and JSON export while keeping missing production sources blocked.
- `GET /api/priority-applications/templates` returns the eight independent conversation handoff templates, including the Chinese conversation titles and the required boundary, reuse, data, API, frontend, test, acceptance, About-page description, module documentation, and workflow-diagram fields.
- Every application in the summary carries the unified development template: functional boundary, reuse points, data collections, API routes, frontend entry, test evidence, and acceptance artifacts.
- Unified template rule: every platform template must include an About feature section, a module document under `docs/`, and a workflow diagram covering data source, business workflow, sharing/collaboration, citizen visibility, and management statistics or alerts. `docs/妇幼健康全模块说明.md` is the reference implementation for this rule.
- Maternal-child policy About page: `maternal-child-about.html` documents the birth certificate policy basis, seventh-version certificate transition, three-role functional boundary, data workflow diagram, and acceptance rule. `docs/maternal-child-policy.md` keeps the policy-to-system mapping for release review.
- `npm.cmd run maternal-child:readiness` writes `release/maternal-child-readiness-report.json` and `release/maternal-child-readiness-report.md`, forming the maternal-child main function report and checking policy basis, About page, module/function documents, birth certificate data, API routes, role boundaries, privacy audit, and release evidence.
- `npm.cmd run policy:coverage` writes `release/policy-coverage-report.json` and `release/policy-coverage-report.md`, checking About-page policy IDs, policy documents, template rules, CI, deploy-check, release manifest, and operator documentation coverage.
- `npm.cmd run health-dashboard:summary` writes `release/health-dashboard-summary.json` and `release/health-dashboard-summary.md`.
- `docs/health-dashboard-indicator-center-report.md` documents the eight governance topics, source boundary, monthly/yearly views, export contract, API and release evidence.
- `npm.cmd run priority-apps:templates` writes `release/priority-application-templates.json` and `release/priority-application-templates.md` for the eight independent application handoff templates.
- `npm.cmd run pilot:acceptance-readiness` writes `release/pilot-acceptance-readiness-report.json` and `release/pilot-acceptance-readiness-report.md`. The report verifies all eight application entries, API routes, tests and release artifacts; validates the SIEM/Webhook configuration contract; packages P0-01 through P0-10 onsite tasks; publishes four synthetic no-patient-data interface samples; and records seven end-to-end trial scenarios plus the open issue ledger. The same model is available at `GET /api/pilot-acceptance/center` and in `platform.html#pilot-acceptance-center`.
- `docs/试点现场验收与接口联调工作包-2026-07-23.md` provides the ten-item P0 checklist, production alert drill sheet, four-interface execution sheet, evidence directory and four-party signature page; `docs/平台开发今日进展报告-2026-07-23.md` records the completed development, verification results and remaining site boundaries.
- Each priority application template now carries a copy-ready `conversationStarter`, an `implementationChecklist` with the Codex loop execution step, and an `acceptanceGate` so each independent conversation can start with the same release boundary and evidence requirements.
- `release:report` fails the priority application template gate if any generated checklist drops the Codex loop execution step.
- Development loop: plan first, make one small change, run the matching test or build, observe and fix failures, update docs and acceptance notes, then repeat until the module passes release gates.
- Thread control: `docs/codex-loop-thread-control.md` records the active project thread groups and the small-batch loop for continuing all worktrees without mixing unrelated changes.
- Function-thread responsibility map: `docs/卫生健康信息平台功能线程与部门责任梳理.md` consolidates implemented platform threads, responsible departments, resident-first launch scope, next development queue, and residual go-live risks for cross-department review.
- `release:manifest` indexes `health-dashboard-summary.md` as the release artifact for the eight-application template and aggregate dashboard evidence.
- Boundary: the dashboard does not replace source workflows; source applications remain the system of record for business operations and acceptance.
