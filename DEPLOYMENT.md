# 部署说明

本文说明当前 MVP 的本地运行、静态预览和后续生产化部署方式。

## 本地服务模式

```powershell
cd "C:\Users\drxuj\OneDrive\3.信息化\0.高质量发展 信息化\chronic-care-platform"
npm.cmd run dev
```

访问：

```text
http://localhost:5173/login.html
```

本地服务模式支持：

- 后端登录会话和角色校验。
- API 读写状态。
- SQLite 主存储。
- 同步生成 `data/db.json` 静态快照。
- 安全事件和访问日志留痕。
- `/api/live` 无依赖存活检查、`/api/health` 依赖就绪检查和 `/api/metrics` 管理端运行指标。

## 静态预览模式

可直接打开以下页面：

- `health-city.html`
- `workbench.html`
- `index.html`
- `institution.html`
- `doctor.html`
- `insurance.html`
- `citizen.html`
- `mobile-preview.html`
- `county.html`

静态模式适合演示页面，不适合多人共享数据。数据回退只读取生成的 `data/public-demo.json` 脱敏快照，写入能力会降级到浏览器 `localStorage`。

## GitHub Pages

GitHub Pages 通过 `config/static-publication.json` 和 `scripts/static-publication.js` 构建显式资源集，只部署静态页面、浏览器依赖和生成的 `data/public-demo.json`：

```text
https://xujiann.github.io/chronic-care-platform/
```

可展示：

- 页面 UI。
- 静态演示数据。
- 居民端本地上传和授权记录。

Pages 工作流会在仓库外的临时目录生成脱敏演示快照，并拒绝把仓库根目录、`data/db.json`、服务端源码、未明确列入清单的配置、文档或元数据作为静态制品。制品显式包含公开的 `browser-security-policy.json`，用于声明托管层必须应用的响应头、严格 CSP Report-Only 目标和遗留风险基线；该文件存在不证明真实静态响应头已生效，生产静态入口仍需托管/CDN 配置和独立抓取验收。可先只读检查资产清单：

```powershell
npm.cmd run static:inventory
npm.cmd run security:browser:verify
```

需要本地验证 Pages 制品时，必须把输出放在仓库外的空目录：

```powershell
node scripts/static-publication.js build --output=C:\temp\health-platform-pages
```

不可运行：

- Node.js API。
- SQLite。
- 真实登录会话。
- 跨端共享写入。

## Node API 部署

`server.js` 是当前后端入口。可部署到支持 Node.js 的服务器或平台。

需要保留：

- `package.json`
- `server.js`
- `browser-security-policy.json`
- `data/db.json`
- `data/health-city.sqlite` 或生产数据库连接配置。

建议生产化时迁移到 PostgreSQL 或正式数据库，并拆分表结构：

- 居民与账户。
- 健康档案和个人健康信息库。
- 慢病、随访、筛查、宣教、管理计划。
- 医保审核、固定取药、分级诊疗。
- 医共体协同、互认、AI 辅诊。
- 统计、出生证明、死亡证明。
- 安全审计和访问日志。

## 环境变量建议

复制 `.env.example` 作为环境模板。当前支持：

```text
PORT=5173
NODE_ENV=production
STORAGE_ENGINE=auto
SQLITE_JOURNAL_MODE=WAL
SQLITE_SYNCHRONOUS=FULL
SQLITE_BUSY_TIMEOUT_MS=5000
SQLITE_WAL_AUTOCHECKPOINT_PAGES=1000
SQLITE_HEALTH_CHECK_TTL_MS=30000
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
OIDC_USERINFO_URL=https://identity.example.gov.cn/real-issuer/userinfo
OIDC_CLIENT_ID=replace-with-oidc-client-id
OIDC_CLIENT_SECRET=replace-with-oidc-client-secret
IDENTITY_ADAPTER_TIMEOUT_MS=8000
SMS_GATEWAY_URL=https://sms.example.gov.cn/real-gateway
SMS_GATEWAY_TOKEN=replace-with-provider-token
SMS_TEMPLATE_ID=resident-login-code
SMS_SENDER=health-platform
SMS_GATEWAY_TIMEOUT_MS=8000
SMS_DELIVERY_CALLBACK_SECRET=replace-with-provider-callback-signing-secret
SMS_DELIVERY_CALLBACK_MAX_SKEW_SECONDS=300
HOSPITAL_ADAPTER_SECRET=replace-with-hospital-connector-signing-secret
HIS_ADAPTER_URL=https://his.example.gov.cn/platform/events
EMR_ADAPTER_URL=https://emr.example.gov.cn/platform/events
LIS_ADAPTER_URL=https://lis.example.gov.cn/platform/events
PACS_ADAPTER_URL=https://pacs.example.gov.cn/platform/events
APPOINTMENT_ADAPTER_URL=https://his.example.gov.cn/platform/appointments
HOSPITAL_ADAPTER_TIMEOUT_MS=8000
HOSPITAL_ADAPTER_MAX_ATTEMPTS=3
OBJECT_STORAGE_GATEWAY_URL=https://storage.example.gov.cn/api/
OBJECT_STORAGE_BUCKET=health-platform-attachments
OBJECT_STORAGE_SIGNING_SECRET=replace-with-object-storage-signing-secret
OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION=object-storage-gateway-trust-v1
OBJECT_STORAGE_RECEIPT_SIGNING_SECRET=replace-with-independent-object-storage-receipt-secret
OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS=https://storage-upload.example.gov.cn
OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS=https://storage-download.example.gov.cn
OBJECT_STORAGE_TIMEOUT_MS=8000
OBJECT_STORAGE_MAX_BYTES=104857600
OBJECT_STORAGE_UPLOAD_TTL_SECONDS=900
OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS=300
OBJECT_STORAGE_RESPONSE_MAX_SKEW_SECONDS=300
FINANCIAL_GATEWAY_SECRET=replace-with-financial-gateway-signing-secret
FINANCIAL_CALLBACK_SECRET=replace-with-separate-financial-callback-secret
FINANCIAL_CALLBACK_MAX_SKEW_SECONDS=300
PAYMENT_GATEWAY_URL=https://payment.example.gov.cn/platform/transactions
INSURANCE_GATEWAY_URL=https://insurance.example.gov.cn/platform/settlements
CERTIFICATE_GATEWAY_URL=https://certificate.example.gov.cn/platform/certificates
FINANCIAL_GATEWAY_TIMEOUT_MS=8000
FINANCIAL_GATEWAY_MAX_ATTEMPTS=3
FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS=100000
FINANCIAL_IDEMPOTENCY_LEDGER_MAX_EVENTS_PER_SCOPE=10000
FINANCIAL_CALLBACK_LEDGER_MAX_EVENTS_PER_REQUEST=1000
AUDIT_EXPORT_PATH=/var/log/chronic-care-platform/audit
SIEM_ENDPOINT=https://siem.example.gov.cn/ingest
SIEM_SIGNING_SECRET=replace-with-siem-alert-signing-secret
ALERTING_TIMEOUT_MS=8000
ALERTING_MAX_ATTEMPTS=3
RETENTION_POLICY=10y-worm
# 连续审计 worker 与上面的告警路由是两个独立合同；当前只允许 rehearsal。
SIEM_AUDIT_ENDPOINT=https://siem.example.gov.cn/audit/v1/batches
SIEM_AUDIT_SIGNING_SECRET=inject-from-approved-secret-manager
SIEM_AUDIT_TLS_MODE=system
AUDIT_DELIVERY_CHECKPOINT_PATH=/var/lib/chronic-care-platform/audit-state/checkpoint.json
AUDIT_DELIVERY_SOURCE_CONTRACT=snapshot-rehearsal-v1
AUDIT_DELIVERY_SERVICE_USER=chronic-care-audit
AUDIT_DELIVERY_SERVICE_GROUP=chronic-care-audit
AUDIT_DELIVERY_SERVICE_UID=991
AUDIT_DELIVERY_SERVICE_GID=991
PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE=/var/lib/chronic-care-platform/audit-alerts/journal.json
DEPLOYMENT_SECRET_PROVIDER=vault
DEPLOYMENT_RELEASE_ID=approved-release-id
DEPLOYMENT_ARTIFACT_DIGEST=sha256:replace-with-64-hex-artifact-digest
DEPLOYMENT_APP_DIR=/opt/chronic-care-platform/releases/approved-release-id
DEPLOYMENT_SECRET_ENV_FILE=/run/secrets/chronic-care-platform.env
```

生产化如迁移 PostgreSQL 或正式数据库，需要先完成 `productionDeploymentPlan` 中的数据库适配器工作，再填入 `DATABASE_URL`；在适配器启用前，运行时和发布门禁会拒绝 `STORAGE_ENGINE=postgres/postgresql`，避免静默回落到 SQLite。单主机认证会话可设置 `SESSION_STORE=sqlite`，支持重启恢复、同机跨进程读取和持久化撤销；多主机必须设置 `SESSION_TOPOLOGY=multi-host` 与 `SESSION_STORE=postgres`，并通过 `DATABASE_URL`、`POSTGRES_SSL_MODE=verify-full` 使用迁移包创建的中央会话表。签发和撤销在响应前写入中央表，每个带令牌请求先从中央表装载会话，数据库不可用时鉴权失败关闭且 `/api/health` 返回 503。还必须显式配置过期/撤销会话保留天数及自动清理周期，清理结果可在身份生命周期中心审计。接入政务统一认证时需要填入 `OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET`，可通过 `OIDC_USERINFO_URL` 跳过发现请求；居民端验证码生产上线必须填入 `SMS_GATEWAY_URL/SMS_TEMPLATE_ID`，凭据仅通过环境变量或密钥托管注入。医院连接器至少配置五类 `*_ADAPTER_URL` 和共享 `HOSPITAL_ADAPTER_SECRET`，也可使用每域独立密钥。安全附件生产环境必须启用 `object-storage-gateway-trust-v1`：请求签名密钥与响应回执验签密钥必须分离，上传/下载签名 URL 必须命中各自精确 HTTPS 源白名单，完成回执必须显式绑定对象版本、扫描证据和生命周期执行证据；旧响应契约只保留为非生产迁移路径。现场仍需完成真实桶最小权限、恶意文件扫描和不可变保留锁验收。支付、医保和电子证照必须配置三类 `*_GATEWAY_URL` 与共享或分域 `*_GATEWAY_SECRET`，回调使用独立 `FINANCIAL_CALLBACK_SECRET` 或三类 `*_CALLBACK_SECRET`，并完成供应商字段映射、来源白名单、账单传输和联合测试。完整运行时边界见 `docs/production-identity-message-adapters.md`、`docs/production-hospital-connectors.md`、`docs/production-object-storage.md` 和 `docs/production-financial-certificate-gateways.md`。旧审计保全至少配置 `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT`；连续审计 worker 另需 `SIEM_AUDIT_*` 或 rehearsal WORM、checkpoint、专用账号与告警 journal。执行 `npm run audit:delivery:preflight` 后仍会因 snapshot source、未签 receipt 和本地 checkpoint anchor 保持生产 NO-GO，不能通过填写变量绕过。

严格生产预检的 external trust verifier 通过仓库外 `PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE`、
`PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256` 与 `PRODUCTION_EVIDENCE_TRUST_ENVELOPE_FILE` 装配。
文件必须为服务账号只读的绝对普通文件，私钥和证据正文不得进入其中；完整签名合同与执行命令见
`docs/production-deployment-automation.md`。provider 通过仍不能替代其他 preflight 门禁或最终切换审批。

短信最终送达还必须配置不少于 32 位的 `SMS_DELIVERY_CALLBACK_SECRET`。供应商回调地址为 `POST /api/auth/sms-delivery-callback`，联调必须验证时间窗、nonce 重放、幂等和乱序终态保护；卫健委从 `GET /api/auth/sms-deliveries` 核对脱敏回执。

金融机构回调地址为 `POST /api/financial-gateways/callbacks/:type`，其中 `:type` 为 PAYMENT、INSURANCE 或 CERTIFICATE。委办通过 `GET /api/financial-gateways/operations` 查看脱敏状态，并以 `POST /api/financial-gateways/reconciliation-runs` 登记账单 SHA-256 摘要和汇总数；摘要一致不替代真实机构验收。

生产环境上线前应执行严格环境校验：

```powershell
npm.cmd run env:check:production
```

该命令读取 `.env`，会拒绝缺失环境文件、占位密钥、过短密钥、生产内存会话、`STORAGE_ENGINE=json` 和尚未启用的 `postgres/postgresql` 运行时适配器；使用 SQLite 时还会要求 `WAL`、`FULL` 同步和不少于 5000ms 的忙等待配置。生产模式还会要求 OIDC 身份适配、居民端短信网关、医院连接器、对象存储、支付/医保/电子证照网关、SIEM/Webhook 告警路由和审计保全目标配置到位。

生产可观测性闭环使用 `GET /api/observability/alerts`、`POST /api/observability/alerts/dispatch` 和 `POST /api/observability/alert-deliveries/:id/retry`。运行时会对慢请求、集成死信、数据质量、医院运行和高风险审计信号生成去标识化告警；投递失败自动进入运维事件，重放成功后自动关闭。完整边界见 `docs/production-observability-alerting.md`。

生产部署必须先执行 `deployment:package` 生成运行文件 SHA-256 清单、整体制品摘要、进程契约和回滚契约，再执行 `deployment:verify` 复算验证。密钥只允许由 Vault、KMS 或编排器注入，部署包不读取或保存密钥值；systemd 最小权限模板位于 `deploy/chronic-care-platform.service.template`，完整流程见 `docs/production-deployment-automation.md`。

`env:check:production` 和 `release:report` 还会输出 `cutoverChecklist` / `productionCutover`，按环境文件、生产密钥、统一身份、审计保全、存储适配、现场接口联调、医保/证照交换、监控值守和灾备演练列出责任方、阻断状态、当前证据和下一步动作。真实参数到位后，应先让环境与基础设施类通过，再进入外部接口联调和现场测评；外部系统项必须有 `CUTOVER_SITE_INTERFACE_SIGNOFF`、`CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF`、`CUTOVER_MONITORING_SIGNOFF`、`CUTOVER_DR_REHEARSAL_SIGNOFF` 等现场签字信号才会通过。

## 验证与发布验收

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:coverage
npm.cmd run test:e2e
npm.cmd run deploy:check
npm.cmd run env:check
npm.cmd run release:report
npm.cmd run release:manifest
npm.cmd run launch:smoke
npm.cmd run priority-apps:templates
npm.cmd run maternal-child:readiness
npm.cmd run policy:coverage
npm.cmd run hybrid:deployment-readiness
npm.cmd run deployment:package
npm.cmd run deployment:verify
```

`regional-referral:overlap` 会生成 `release/regional-referral-overlap-report.json` 和 `release/regional-referral-overlap-report.md`，把区域诊疗数据共享平台与医联体转诊/远程会诊的共享集合、共享居民、重合能力、可合并项和不可合并运行时边界整理为现场报告。该报告建议合并交接证据、发布报告和现场验收边界，但保留区域共享与转诊会诊两套运行时主模型和 API。

区域诊疗数据共享平台还提供 `GET /api/regional-data-sharing/handoff-report` 和页面“生成交接清单”按钮，用于按卫健委/机构端权限生成区域共享-转诊会诊交接清单。现场联调时只校验证据调阅、互认依据、接口契约、授权质控、审计留痕和接收范围；转诊单主表、号源床位、接诊反馈、服务时限督办和绩效结算仍由医联体转诊会诊模块联调。
`deploy:check` 和 `release:report` 会将该运行时清单 API 与页面入口作为发布门禁，避免只保留离线报告而丢失现场可操作能力。
交接清单响应和 Markdown 会返回 `reportId`，同一编号会写入安全事件，可用于现场把清单截图、导出内容与审计留痕对账。

本地服务启动后可访问：

```text
http://localhost:5173/login.html
http://localhost:5173/workbench.html
http://localhost:5173/api/live
http://localhost:5173/api/health
```

`/api/live` 不访问存储或外部依赖，只用于判断 Node 进程是否存活；`/api/health` 校验存储与中央会话依赖，任一关键依赖不可用时返回 503。`/api/metrics` 需要卫健委管理端 token，可用于检查请求数、状态码、慢请求、统一任务堆积、死信事件和数据质量问题。`/api/system/readiness` 同样需要管理端 token，汇总 P2 集合完整性、审计哈希链、运行负载和仍需现场资源的外部依赖，可作为发布前人工审查入口。

部署前如需执行完整命令门禁：

```powershell
npm.cmd run deploy:check:full
npm.cmd run release:report:full
```

`release:report` 默认生成 `release/release-report.json`、`release/release-report.md`、`release/production-cutover-checklist.json` 和 `release/production-cutover-checklist.md`，汇总代码文件、关键脚本、静态快照、P2 完成状态、接口准备度、安全验收、生产部署计划、验收证据、环境校验和生产切换清单；`release:manifest` 会生成 `release/release-artifact-manifest.json` 和 `release/release-artifact-manifest.md`，汇总每个发布报告、模板 README、生成命令和 API 证据；`release:report:full` 会额外执行 `check`、`test`、`test:coverage`、`test:e2e`、`deploy:check` 和 `npm audit --omit=dev`。CI 会上传 `release-readiness-report` artifact；发布归档时建议保存这些报告文件和对应 CI artifact，作为上线前人工审查材料。

同一次报告还会生成 `release/storage-model-inspection.json` 和 `release/storage-model-inspection.md`，用于归档 JSON 快照集合/记录规模、最大集合、SQLite 表清单、schema 版本和迁移元数据；干净 CI checkout 中缺少 SQLite 文件时仅记录为提示，不影响演示快照发布门禁。

`production-db:readiness` 会生成 `release/production-db-readiness-report.json` 和 `release/production-db-readiness-report.md`，专项检查 PostgreSQL/正式数据库切换前的生产轨道、必填配置、当前 SQLite/JSON 模型证据、事务 outbox、影子同步 worker、基线入队、只读一致性核对、备份恢复演练文档、RTO/RPO 说明和运行时阻断，避免在正式适配器完成前误启用 `STORAGE_ENGINE=postgres/postgresql`。

PostgreSQL 切换还必须先生成无业务正文的迁移清单包并复核文件摘要：

```powershell
npm.cmd run postgres:migration-package
npm.cmd run postgres:migration-verify
```

默认制品位于 `release/postgres-migration-package/`，只包含 `health_platform` 落地区 schema、集合与记录计数、逐集合摘要、装载/校验/回滚模板和文件摘要，不包含居民记录正文或数据库凭据。真实全量导出必须使用 `--mode=full --acknowledge-sensitive-data` 并写入仓库之外的受控目录，完整流程见 `docs/postgresql-migration-package.md`。迁移包通过不代表 PostgreSQL 运行时适配器已经启用；`STORAGE_ENGINE=postgres` 继续保持阻断，直到全量迁移、读写一致性、容量、故障切换、原生备份恢复和现场签字全部完成。

基线装载验收后，可设置 `POSTGRES_SYNC_MODE=outbox` 启用 SQLite schema v10 事务 outbox，先执行 `npm.cmd run postgres:sync-bootstrap` 入队当前集合基线，再使用 `npm.cmd run postgres:sync-worker` 增量同步。`npm.cmd run postgres:shadow-reconcile` 以 PostgreSQL 只读事务比较集合版本和 SHA-256；差异进入带责任人、清除门禁、证据化关闭和自动重开的处置工单。同步与核对均提供加固的 service/timer 模板。完整启用顺序、TLS 配置、敏感数据边界和退出条件见 `docs/postgresql-runtime-sync.md`。影子核对通过仍不允许 PostgreSQL 成为生产主库。

`identity:contract` 会生成 `release/identity-contract.json` 和 `release/identity-contract.md`，记录政务统一身份接入所需 claims、角色到门户映射、机构覆盖度和样例 claim 映射；`release:report` 会同步写出这些文件，作为 OIDC/SAML 联调前的身份契约验收材料。

`audit:retention` 会生成 `release/audit-retention-report.json` 和 `release/audit-retention-report.md`，离线验证安全事件与数据访问日志哈希链，记录导出摘要、保全目标、安全验收台账和生产审计保全路径；默认演示发布报告使用发布包内审计报告作为本地归档目标，正式生产切换仍必须通过 `env:check:production` 并配置 `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT`。

`integration:readiness` 会生成 `release/integration-readiness-report.json` 和 `release/integration-readiness-report.md`，检查 P0 接口台账、HIS/EMR/LIS/PACS/医保/证照/统计契约、幂等键、签名和重试策略，并将统一身份、居民主索引、医疗业务系统、分级诊疗和安全审计的覆盖关系归档为联调验收材料。

`interface:mapping` 会生成 `release/interface-mapping-report.json` 和 `release/interface-mapping-report.md`，逐项检查外部契约必填字段、幂等字段、目标集合、目标字段、签名和重试策略是否有平台落点；现场 HIS/EMR/LIS/PACS/医保/证照/统计联调前，应把该报告与真实字段对照表、样例报文和整改记录一起归档。

`research:sandbox` generates `release/research-sandbox-readiness-report.json` and `release/research-sandbox-readiness-report.md`, covering research dataset applications, disease registry models, ethics approval, data-use agreement evidence documents, de-identification release, sandbox access, compliant data export, usage audit, and outcome return evidence. Before production, confirm that compliant exports are limited to approved de-identified fields, have destination approval, watermarking, retention days, and data-access audit retention; this thread does not add AI diagnosis.

`data-quality:report` 会生成 `release/data-quality-report.json` 和 `release/data-quality-report.md`，检查居民主索引完整度、跨集合居民引用、personIndex 一致性、来源可追溯和整改闭环，作为 P1 数据质量治理和主索引现场规则确认前的证据包。
`data-governance:readiness` 会生成 `release/data-governance-readiness-report.json` 和 `release/data-governance-readiness-report.md`，检查数据资产台账、标准字典/主数据、字段映射、必填项、幂等键、签名校验、质量检查和来源系统到平台集合的血缘落点；医保核心、院内 HIS/EMR/LIS/PACS 等未完成真实外部联调的项会保留为 external/onsite blocked，不能作为生产已接入结论。

`environment:matrix` 会生成 `release/environment-matrix-report.json` 和 `release/environment-matrix-report.md`，把 demo、staging、production 三层环境的必填变量、阻断变量、责任人、门禁脚本和上线验收规则固化为可检查矩阵；`release:report` 会同步写出这些文件，作为环境分层、密钥注入、现场签字和生产切换审查的前置材料。

`hybrid:deployment-readiness` 会生成 `release/hybrid-deployment-readiness-report.json` 和 `release/hybrid-deployment-readiness-report.md`，专项核对静态预览层、`data/public-demo.json` 脱敏快照、显式发布清单、Node API 后端、存储引擎边界、环境模板、CI 和发布门禁接线。

`operations:readiness` 会生成 `release/operations-readiness-report.json` 和 `release/operations-readiness-report.md`，检查健康检查、运行指标、系统就绪报告、生产部署轨道、外部依赖风险和发布运维脚本，作为上线前运维审查证据。`GET /api/production-operations/center` 和运行调度页进一步提供服务级别、24x365 值班、事件响应、RPO/RTO 恢复演练和证据门禁；本地样例演练不替代远端备份、全量恢复、真实呼叫渠道和灾备签字。

`registration:journey-readiness` 会生成 `release/registration-journey-readiness-report.json` 和 `release/registration-journey-readiness-report.md`，核对预约号源、订单、支付、HIS 确认、医保预核验、到院报到、完诊、退号退款、消息和审计证据。居民端与机构端共用 `POST /api/registrations/orders/:id/actions`，但本地支付和退款凭据不代表真实交易；生产切换前必须完成医院 HIS、支付退款网关、医保结算回调和现场业务签字。

`registration:integration-readiness` 会生成 `release/registration-integration-readiness-report.json` 和 `release/registration-integration-readiness-report.md`，核对 `appointment-order-v1` 契约、HMAC 签名、`externalId` 幂等、预约订单落库、成功/失败状态顺序、死信重试、机构范围和对账中心。正式环境必须配置非占位 `INTEGRATION_GATEWAY_SECRET`、机器身份/证书、网络白名单、真实状态字典和多方联调证据；本地签名回调不自动打开生产门禁。

`process:audit` 会生成 `release/process-audit-report.json` 和 `release/process-audit-report.md`，把居民主索引、慢病验收、医共体验收、医保取药、统计证照、安全合规和生产切换汇总为全流程审计证据域；`release:report` 会同步写出这些文件，作为上线前跨模块审查和现场签字材料。

`release:report` 会额外生成 `release/service-acceptance-summary.json` 和 `release/service-acceptance-summary.md`，汇总慢病与医共体服务域的建模状态、记录行数、开放事项数和 open actions，用于发布归档时核对 `/api/service-acceptance-summary` 与演示台账是否一致。

`site:pack` 会生成 `release/site-readiness-pack.json` 和 `release/site-readiness-pack.md`，把身份源映射、接口联调字段表、样例报文取证、监控值守、灾备演练和生产签字要求整理为现场准备模板；同时生成 `release/templates/*/README.md`，分别说明身份源映射、接口联调、监控值守、生产签字模板的当前能力、输入、输出、必备附件和 API 证据。`GET /api/site-template-readmes` 会在 Node 运行时返回这 4 份模板 README 的状态、责任方、行数、附件类型、live evidence 和文本预览，工作台可直接用于全流程审计；`release:report` 会同步写出这些文件，便于实施团队逐项挂接真实材料。

委端统一工作台的 Site readiness pack 面板已支持通过 `POST /api/site-launch-evidence` 登记现场证据，写入 `siteLaunchEvidence` 台账；上线前可用该台账核对每个身份、接口、监控和签字模板是否已有联调号、附件摘要和验收状态。`verified` 证据必须带联调单号或附件摘要，工作台会单独显示已验收模板缺口，避免把仅提交材料当作生产切换签字依据。

`onsite:launch-requirements` 会生成 `release/onsite-launch-requirements.json` 和 `release/onsite-launch-requirements.md`，把现场上线必须交付的生产环境、密钥、身份、短信、医疗接口、居民服务、医保证照、数据库、安全、监控、灾备、移动端验收和灰度签字拆成可审计的 P0/P1 需求矩阵；该产物由 `release:report` 同步写出，并由 `release:manifest` 纳入发布包目录。

`monitoring:readiness` 会生成 `release/monitoring-readiness-report.json` 和 `release/monitoring-readiness-report.md`，把 `/api/live`、`/api/health`、`/api/metrics`、`/api/system/readiness`、请求状态码、慢请求、死信、数据质量、SLO 阈值、告警信号和 on-call escalation 归档为监控接入证据；生产切换前仍需将这些信号绑定到现场 Prometheus/OpenTelemetry 或平台日志服务，并取得 `CUTOVER_MONITORING_SIGNOFF`。

`referral:readiness` 会生成 `release/referral-teleconsultation-readiness-report.json` 和 `release/referral-teleconsultation-readiness-report.md`，把双向转诊、远程会诊、接诊反馈、报告回传、协同工单、居民授权、审计留痕和绩效评价归档为专项证据；县域端同步展示医共体协同闭环六步状态链，并把牵头医院、基层机构、接诊医院、医院 IT、医保/绩效等角色的回执、终签、现场签字和阻塞项纳入可机检证据。现场联调仍需接入 HIS/EMR 真实转诊单、预约号源/床位、远程视频系统、PACS/LIS 报告回传、医保支付路径、医共体绩效结算公式、生产身份、审计保全和监控签字。

`evaluation:evidence` 会生成 `release/evaluation-evidence-report.json` 和 `release/evaluation-evidence-report.md`，汇总互联互通四甲/五乙测评所需接口清单、标准映射、交易样例、整改记录、P1 接口需求和流程审计证据，作为现场截图、第三方测评结论和整改复测记录的前置材料。

静态快照中的 `productionDeploymentPlan` 是 P0 生产化路线台账，覆盖发布门禁、PostgreSQL/正式数据库适配、政务统一身份适配和审计保全。`/api/system/readiness` 与 `release:report` 都会检查该台账是否存在，避免生产化路径只停留在文档中。

## 存储迁移与备份

SQLite 启动时会通过 `schema_migrations` 自动执行幂等迁移，当前 schema 版本为 9。每个运行时连接都会启用外键、`WAL`、`FULL` 同步、忙等待和 WAL 自动检查点，并在 `/api/health` 的 `storage.sqliteProfile` 中暴露 `quickCheck` 与生产配置判定。部署升级前应先停止写入并创建备份。v7 已把机构信用评价、科研数据集、专病库模型和无障碍验收清单纳入结构化镜像表，v8 新增 PostgreSQL 事务 outbox，v9 新增无正文的影子核对台账：

```powershell
npm.cmd run storage:backup
npm.cmd run storage:inspect
```

备份保存在 `data/backups/`，清单记录文件大小和 SHA-256。恢复前必须停止服务并先校验：

```powershell
node scripts/storage-admin.js verify "data/backups/<备份目录>"
node scripts/storage-admin.js rehearse "data/backups/<备份目录>" --max-duration-ms=60000
node scripts/storage-admin.js assess "data/backups/<备份目录>" --max-backup-age-ms=86400000 --max-duration-ms=60000 --min-file-count=2 --min-total-bytes=1 --required-files=db.json,health-city.sqlite
node scripts/storage-admin.js restore "data/backups/<备份目录>" --confirm
npm.cmd run rollback:snapshot -- "data/backups/<备份目录>"
```

`storage:inspect` 会输出当前 JSON 快照集合数量、数组集合数量、记录量、最大集合，以及 SQLite 文件、表、`schema_migrations` 和 schema 版本；用于迁移前后比对正式数据模型是否完整。

恢复演练会把备份恢复到临时目录并重新校验清单，不覆盖当前 `data`。正式恢复操作会先自动创建 `pre-restore` 安全备份。真实生产数据库仍需使用数据库原生在线备份、时间点恢复和异地副本。

`rollback:snapshot` 面向静态快照和演示数据快速回退：它会先创建 `pre-rollback-*` 安全副本，再从指定备份目录恢复 `db.json` 和可选的 `health-city.sqlite`。

`assess` 会在校验备份后执行一次恢复演练，并输出可机器判断的验收报告：

- `maxBackupAgeMs`：备份年龄，作为 RPO 近似约束。
- `maxDurationMs`：恢复演练耗时，作为 RTO 近似约束。
- `requiredFiles`：必须存在的恢复文件。
- `minFileCount` / `minTotalBytes`：防止空备份或不完整备份误判通过。
- `dataQuality`：复用 JSON 快照基础质量校验。

### 恢复演练操作手册

建议每次部署前至少执行一次离线恢复演练：

1. 停止写入或确认当前为演示/维护窗口。
2. 执行 `npm.cmd run storage:backup` 生成新备份。
3. 执行 `node scripts/storage-admin.js verify "data/backups/<备份目录>"` 校验清单、大小、SHA-256 和 JSON 快照基础数据质量。
4. 执行 `node scripts/storage-admin.js rehearse "data/backups/<备份目录>" --max-duration-ms=60000` 将备份恢复到临时目录并重新校验。
5. 执行 `node scripts/storage-admin.js assess "data/backups/<备份目录>" --max-backup-age-ms=86400000 --max-duration-ms=60000 --min-file-count=2 --min-total-bytes=1 --required-files=db.json,health-city.sqlite` 生成机器可读验收报告。
6. 确认演练输出 `ok: true`、`objectives.passed: true`，且验收报告 `passed: true`，并记录 `rehearsalDataDir`、备份目录、执行人、时间、`metrics.backupAgeMs`、`metrics.rehearsalDurationMs`、`metrics.totalBytes` 和所有未通过检查。
7. 只有在真实恢复时，才执行 `node scripts/storage-admin.js restore "data/backups/<备份目录>" --confirm`。

恢复演练通过不等于生产级容灾完成；正式环境仍需补充数据库原生备份、跨机房副本、恢复时间目标和恢复点目标验收。

## 现场实施待办

- 政务统一认证和机构权限。
- 人口库、电子健康码、医保电子凭证。
- HIS/EMR/LIS/PACS。
- 医保核心结算。
- 卫生统计直报。
- 出生/死亡电子证照。
- 公安、民政共享。
- 等保、密评、日志保全、脱敏和容灾。

## Referral Teleconsultation Callback

Open `referral-teleconsultation-about.html` during onsite review to align policy basis, workflow boundaries, callback contracts, and signoff responsibilities before testing real HIS/EMR/referral-center payloads.

Use `POST /api/referral-teleconsultations/:id/feedback-callback` for receiving-hospital acceptance, triage note, or down-referral acceptance joint testing. Requests must include `idempotencyKey` and `x-integration-signature`; successful callbacks update `receivingFeedback`, feedback timestamp, performance evidence, audit/data-access logs, institution/resident `taskMessages`, and a matched `integrationGatewayEvents` record.

Use `POST /api/referral-teleconsultations/:id/schedule-callback` for appointment-slot, bed-resource, or tele-video room callback joint testing. Requests must include `idempotencyKey` and `x-integration-signature`; successful callbacks update `meetingWindow`, target institution fields, receiving doctor, performance evidence, audit/data-access logs, institution/resident `taskMessages`, and a matched `integrationGatewayEvents` record.

Use `POST /api/referral-teleconsultations/:id/report-callback` for HIS/EMR report return joint testing. Requests must include `idempotencyKey` and `x-integration-signature`; successful callbacks move the teleconsultation to `report-returned`, merge performance evidence, archive the `teleconsultation-report` personal record, append audit/data-access logs, create institution/resident `taskMessages`, and create a matched `integrationGatewayEvents` record.

Use `GET /api/referral-teleconsultations/joint-test-pack` before field testing to export the callback sample payloads, checklist, task receipt summaries, final-signoff export summary, cutover readiness blockers, next-development plan, and signoff matrix for referral center, receiving hospital, hospital IT, county performance, and insurance review.

Use `GET /api/referral-teleconsultations/joint-test-ledger` during field testing to reconcile signed callback replay events, local demo evidence, onsite signoff status, SLA supervision, and insurance payment-policy readiness before final acceptance.

Use `POST /api/referral-teleconsultations/joint-test-ledger/tasks` from the county command board when the ledger still has pending replay or signoff rows. The endpoint creates idempotent `taskMessages` for institution, county, or insurance owners without duplicating existing joint-test tasks.

Use `POST /api/referral-teleconsultations/joint-test-ledger/tasks/:role/complete` when a responsible owner confirms callback replay, SLA supervision, or insurance-policy follow-up. The route records a completion receipt on the original `taskMessages` row and keeps an audit event before final onsite signoff evidence is archived.

Use `GET /api/referral-teleconsultations/signoff-summary` during field testing to review demo-ready evidence and site-pending signoff rows for referral center, receiving hospital, hospital IT, county performance, and insurance review before archiving real signatures.

Use `POST /api/referral-teleconsultations/signoff-summary/:role/evidence` to archive onsite signoff evidence after each role validates its callback replay, report archive, SLA supervision, or payment-policy row. Keep the original signed file in the project evidence pack and store its attachment name or storage pointer in the request note.

Use `POST /api/referral-teleconsultations/:id/escalations/ack` after an SLA reminder is sent. Institution and county users can acknowledge or close the supervision item; the platform updates `slaDisposition`, county supervision status, reminder receipts, and audit logs.

Use `GET /api/referral-teleconsultations/performance-policy` to confirm insurance-payment and medical-consortium performance rules. The report includes report-return rate, follow-up closure, repeat-exam control, and configured payment paths before site settlement formulas are finalized.

Use `GET /api/referral-teleconsultations/consortium-metrics` as the G-end indicator-center collection endpoint for the closed-loop slice. It reports loop completion, collaboration efficiency, report return, mutual-recognition light evidence, grassroots follow-up return, quality feedback closure, role backlog, and the remaining external/onsite blockers before production callbacks and signoffs are available.

For the "medical consortium closed loop" task in `chronic-care-platform/docs/浪潮方案4.1立即采纳开发任务分派表.md`, release evidence must include the county portal DOM markers for six closed-loop stages, role-based todos, G-end collectible indicators, mutual-recognition light evidence, primary follow-up return, and quality/SLA feedback closure. These are pre-field acceptance signals; production HIS/EMR/LIS/PACS/insurance callbacks, onsite signatures, production identity, audit export, and monitoring remain required site inputs.

Before onsite testing, compare `referral-feedback-callback-v1`, `referral-schedule-callback-v1`, and `referral-report-callback-v1` in `release/interface-mapping-report.md` with the real HIS/EMR scheduling, receiving feedback, and report payloads.

## Medical quality and safety supervision release boundary

Run `npm.cmd run quality-safety:report` before release. The generated `release/quality-safety-report.md` and `release/quality-safety-report.json` prove the demo boundary for medical quality, safety events, critical value acknowledgement and disposition, clinical pathway variance review, medical record QC, mutual-recognition QC, dispatch, feedback, review, permission trimming, policy-basis references, prioritized action-plan evidence, go-live readiness, site joint-testing sign-off tracking, and audit evidence.

Site joint testing still requires live HIS/EMR/LIS/PACS feeds, production critical-value acknowledgement routing, medical-record sampling signatures, clinical pathway rule dictionaries, mutual-recognition QC rules, and department rectification sign-off attachments.

## Hospital Operations Dispatch

operations.html is the runnable management entry for hospital operation monitoring and resource dispatch. It uses GET /api/operations/dashboard, GET /api/operations/site-joint-tests, GET /api/operations/production-hardening, GET /api/operations/go-live-gates, GET /api/operations/intelligence, GET /api/operations/governance-report, GET /api/operations/handover, GET /api/operations/handover/owners, POST /api/operations/handover/signoff, POST /api/operations/go-live-gates/actions, POST /api/operations/dispatch, and POST /api/operations/reconciliation/:id/review to cover bed, staff, equipment, outpatient, emergency, inpatient, dispatch, alert, site joint-test closeout, production hardening, go-live gate evidence, go-live gate review audit, intelligent dispatch recommendations, governance reporting, shift handover owner assignment, shift handover signoff, and statistics direct-report reconciliation boundaries.

`docs/hospital-operations-flow.md` is the end-to-end hospital operations flow diagram. It covers source-system ingest, normalization, monitoring, alert triage, resource dispatch, emergency congestion handling, reconciliation review, audit evidence, cutover, and post-cutover observation.

`docs/hospital-operations-development-report.md` is the module development report. It summarizes delivered capabilities, data collections, API entry points, release evidence, go-live boundaries, and the next implementation plan.

operations-about.html is the policy and scope page for the hospital operations platform. It summarizes the 2025 secondary and tertiary public hospital performance monitoring manuals, hospital operation monitoring boundaries, direct-report reconciliation requirements, data source ownership, and on-site joint-test handoff points.

## Medical Escort Service Platform

Open `escort.html` after commission login to review the older adult medical escort service pilot dashboard. Open `citizen.html` with the citizen demo account to create a resident-side medical escort appointment for the current household; the appointment panel should show the provider, hospital, department, appointment date, and service-item submit-readiness checklist before the request is posted. Run `npm.cmd run escort:readiness` before release; the generated `release/escort-service-readiness-report.md` and `release/escort-service-readiness-report.json` cover provider registry, trained escort workers, service order evidence, subsidy and time-bank coverage, contract and insurance risk controls, quality callbacks, API routes, commission frontend evidence, citizen appointment evidence, and resident submit-readiness evidence.

Open `internet-nursing.html` after citizen, hospital, or commission login to review the Internet+ Nursing pilot. Run `npm.cmd run internet-nursing:readiness` before release; the generated `release/internet-nursing-readiness-report.md` and `release/internet-nursing-readiness-report.json` cover resident appointment, first-visit assessment, informed consent, qualified nurse dispatch, nurse acceptance, location tracking, service record, closed-loop summary, quality callback, and API route evidence.

Use `docs/互联网护理服务模块说明.md` as the module handoff document for role entry, data object, API permission, workflow diagram, risk control, and browser acceptance checks.

hospital-operations:readiness generates release/hospital-operations-readiness-report.json and release/hospital-operations-readiness-report.md. The report reuses healthStatistics, healthStatisticsIngestion, medicalResources, operations-readiness, /api/metrics, and platformProcessAudit evidence, and is included by release:report and deploy:check.

hospital-operations:release generates release/hospital-operations-release-report.json and release/hospital-operations-release-report.md. The release report verifies the completed directions: field mapping for site integration, SLA command chains, alert playbooks, shift handover, shift handover owner matrix, shift handover signoff and audit trace, multi-status reconciliation review, performance-indicator details, dispatch lifecycle evidence, site joint-test closeout, production hardening, intelligent dispatch recommendations, and governance reporting. release:report and the CI release artifact upload include this report.

hospital-operations:module-report generates release/hospital-operations-module-report.json and release/hospital-operations-module-report.md. The report summarizes the hospital operations module capabilities, signed hospital system ingest APIs, release evidence, audit checks, and completed development directions for site joint testing, production hardening, intelligent dispatch, and governance reporting; real production cutover still requires site payloads, signoffs, monitoring, and DR evidence.

`hospital-operations:brief-pdf` verifies `output/pdf/hospital-operations-module-brief-report.pdf` before release. The PDF is the concise two-page on-site brief linked from `operations.html` and should be archived with the module report, release report, and integration requirements.

## Drug Consumable Supervision Evidence

Before site joint testing for the drug and consumable supervision app, run `npm.cmd run drug-consumable:readiness` and archive `release/drug-consumable-readiness-report.json` plus `release/drug-consumable-readiness-report.md`. The report is the pre-field evidence bundle for rational medication, prescription review, fixed pickup, high-value consumable clues, insurance settlement coordination, and remediation-loop signoff.

Use `drug-consumable-about.html` as the role-facing scope, policy-source, evidence, and acceptance boundary for this application during pilot training and go-live signoff.

## Health Dashboard Deployment Evidence

- Open `health-dashboard.html` after commission login to review the aggregate health dashboard.
- Run `npm.cmd run health-dashboard:summary` to generate `release/health-dashboard-summary.json` and `release/health-dashboard-summary.md`.
- Run `npm.cmd run priority-apps:templates` to generate `release/priority-application-templates.json` and `release/priority-application-templates.md`.
- Run `npm.cmd run pilot:acceptance-readiness` to generate the eight-application regression matrix, production alerting preflight, P0 onsite acceptance task pack, synthetic joint-test samples, trial-run evidence and issue ledger. Use `deploy/pilot-alerting.env.template` only as a variable contract; inject real endpoint and secret values through the deployment secret provider.
- Run `npm.cmd run maternal-child:readiness` to generate the maternal-child main function report: `release/maternal-child-readiness-report.json` and `release/maternal-child-readiness-report.md`.
- Run `npm.cmd run policy:coverage` to generate `release/policy-coverage-report.json` and `release/policy-coverage-report.md`.
- Use `GET /api/priority-applications/templates` as the live handoff API for the eight independent application conversations.
- Archive the generated development-template section as the handoff checklist for each of the eight application conversations: boundary, reuse, data, API, frontend entry, tests, and acceptance evidence.
- Use the generated `conversationStarter`, `implementationChecklist`, and `acceptanceGate` fields as the required kickoff, build checklist, and release gate for every independent application conversation.
- Enforce the unified template rule for every platform module: About feature description, `docs/` module document, workflow diagram, API/data/test/acceptance evidence. Use `docs/妇幼健康全模块说明.md` as the reference module package.
- Maternal-child policy release evidence must include `maternal-child-about.html`, `docs/maternal-child-policy.md`, and the policy-to-system mapping for birth certificate signing, seventh-version certificate transition, blank certificate distribution, invalid certificate handling, permanent archiving, privacy, public-security sharing, and maternal-child enrollment.
- `release:manifest` must include `health-dashboard-summary.md` so the eight-application template is part of the formal release package.
- `release:manifest` must also include `priority-application-templates.md` so the standalone handoff contract is archived with the release package.
- The dashboard remains blocked on real site joint-test inputs for identity, HIS/EMR/LIS/PACS, insurance, certificates, statistics, monitoring, and disaster recovery signoff.
## Hybrid Deployment Readiness

`hybrid:deployment-readiness` writes `release/hybrid-deployment-readiness-report.json` and `release/hybrid-deployment-readiness-report.md`. Use it before productionization reviews to confirm the intended hybrid topology: GitHub Pages/static HTML is only the preview layer, while `server.js` and `/api/*` require a Node-capable backend host.

## Real Production Go-Live Requirements

Use `docs/production-go-live-requirements.md` as the platform-level launch requirements baseline. It covers site-owned inputs, real interface joint testing, production database migration, identity and SMS integration, HIS/EMR/LIS/PACS, insurance, certificate sharing, security compliance, monitoring, backup/restore rehearsal, blocking conditions, and final signoff evidence.

Use `docs/on-site-launch-materials.md` as the field material collection checklist before formal go-live. The checklist maps GLM/CIT evidence IDs to owners, acceptance criteria, archive locations, resident mobile validation, gray release controls, and hard blocking conditions.

## Protected production promotion preflight

`.github/workflows/production-promotion.yml` is manual-only and can run only from `main` through the protected
`production` environment on a runner labeled `self-hosted, production-promotion`. It verifies the immutable deployment
package, the signed production evidence decision and all 14 signed cutover-action decisions before issuing a
create-once digest-only receipt. It does not deploy the platform or replace external change approval, environment
reviewers, target credentials, joint testing, site acceptance or rollback execution.

## PostgreSQL controlled transition readiness

`npm.cmd run postgres:transition-readiness` reads the absolute path in
`POSTGRES_PRIMARY_TRANSITION_INPUT_FILE` and requires its 64-character lowercase digest in
`POSTGRES_PRIMARY_TRANSITION_INPUT_SHA256`. The input must be a non-empty regular non-symlink JSON file of at most
1 MiB and must contain only the closed metadata fields for requested mode, migration, reconciliation, delivery,
recovery, capacity, failover and fallback. Missing, malformed, oversized or expanded input fails closed without
printing the path, credentials or input body. The bounded bytes read from the opened descriptor must match the
declared digest, so same-size in-place replacement also fails closed.

The configured `POSTGRES_PRIMARY_STORAGE_MODE` must exactly match the input `requestedMode`; readiness for one
mode cannot be reused to approve another mode.

The immutable deployment package now carries the transition CLI, migration package, primary-read rehearsal,
adapter verification, storage-admin, PostgreSQL schema, shadow-sync and shadow-reconciliation service/timer templates,
and their environment contract. Render both services with `__SERVICE_USER__`, `__SERVICE_GROUP__`, `__APP_DIR__`,
`__SECRET_ENV_FILE__`, `__NODE_BINARY__`, `__DATA_DIR__` and `__LOG_DIR__`; inject `DATABASE_URL` only through the
declared secret provider.

Run the repository-side sequence in a controlled rehearsal environment:

```powershell
npm.cmd run postgres:migration-package
npm.cmd run postgres:migration-verify
npm.cmd run storage:backup
npm.cmd run storage:inspect
npm.cmd run storage:assess -- <backup-dir>
npm.cmd run postgres:sync-worker
npm.cmd run postgres:shadow-reconcile
npm.cmd run postgres:primary-read-rehearsal
npm.cmd run postgres:adapter-verify
npm.cmd run postgres:transition-readiness
```

Do not enable either timer from repository automation. Even when all seven gates pass, the result only permits an
independently approved controlled rehearsal: `activationAuthorized=false`, `productionPrimary=false`,
`runtimeCutoverEnabled=false` and `productionReady=false`. Real migration, capacity, failover, native restore,
fallback, monitoring, approvals and site acceptance remain external blockers.

## Pre-production onsite control

The deployment package carries one read-only CLI with five closed commands. Each command accepts only its documented
flags; unknown, positional, duplicate, empty, or value-bearing boolean flags fail with exit code 1 and a stable redacted
error. A completed non-candidate evaluation exits 0 by default; `--require-ready` exits 2 when the evidence remains
`NO-GO`. The `candidate` command always exits 2 for `NO-GO`, even if `--require-go-candidate` is omitted.

```powershell
npm.cmd run platform:preproduction:environment -- --input=<absolute-file> --release-id=<release-id> --package-fingerprint=<sha256> --require-ready
npm.cmd run platform:preproduction:joint-test -- --campaign=<absolute-file> --trust-registry=<absolute-file> --evidence=<absolute-file> --release-id=<release-id> --package-fingerprint=<sha256> --require-ready
npm.cmd run platform:preproduction:monitoring -- --journal=<absolute-file> --input=<absolute-file> --release-id=<release-id> --package-fingerprint=<sha256> --require-ready
npm.cmd run platform:preproduction:rehearsal -- --input=<absolute-file> --release-id=<release-id> --package-fingerprint=<sha256> --require-ready
npm.cmd run platform:preproduction:candidate -- --authorization=<signed-envelope> --preproduction=<signed-envelope> --joint-tests=<signed-envelope> --monitoring=<signed-envelope> --rehearsal=<signed-envelope> --release-id=<release-id> --package-fingerprint=<sha256> --require-go-candidate
```

JSON inputs and the alert journal must be absolute, bounded, ordinary non-symlink files. The reader opens a descriptor,
performs bounded reads, and rejects path replacement that changes the opened inode. Generic files do not gain a new
content digest from this CLI: signatures, existing evidence fingerprints, service-account permissions, and controlled
mounts remain authoritative. The joint-test command reads campaign, trust registry, and evidence through the same
boundary before evaluating all 12 systems × 8 scenarios, including timeout/retry and reconciliation.

Monitoring requires the existing `receiver-outage-dead-letter-redrive` evidence and a closed alert journal. Rehearsal
requires freeze, snapshot, read switch, business verification, rollback, post-rollback verification, plus outbox/
reconciliation observation. Every command requires the operator-supplied release ID and immutable package digest and
uses the process system clock; no CLI time override is accepted. `candidate` reads the existing
`PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE` and digest environment contract to detect file drift, but does not treat those
same-process values as an unreplaceable authority. It requires five at-most-48-hour, digest-bound Ed25519 report envelopes with distinct
key IDs, accounts, and public-key fingerprints, then validates the upstream report and authorization-ledger contracts
instead of accepting self-reported `ready` JSON. A trusted, structurally valid NO-GO set exits 2; bad signatures or
invalid evidence exit 1. The ordinary CLI remains NO-GO/exit 2 even when these local checks pass. The external deployment-host trust
integration required for `GO-CANDIDATE` is not implemented in this slice and remains an onsite blocker.
Every process-contract entry fixes `cutoverExecutionAuthorized=false`, `executionAuthorized=false`,
`runtimeCutoverEnabled=false`, `productionPrimary=false`, and `productionReady=false`. These commands do not call an
external system, start a worker, switch storage, execute rollback, write a database, or replace four-party approval.
Real signed evidence, 120 field integration, object storage, production monitoring, DR, and site signoff remain `NO-GO`.
