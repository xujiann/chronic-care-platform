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
- `/api/health` 健康检查和 `/api/metrics` 管理端运行指标。

## 静态预览模式

可直接打开以下页面：

- `health-city.html`
- `workbench.html`
- `index.html`
- `institution.html`
- `insurance.html`
- `citizen.html`
- `mobile-preview.html`
- `county.html`

静态模式适合演示页面和文档，不适合多人共享数据。写入能力会降级到浏览器 `localStorage`。

## GitHub Pages

GitHub Pages 可部署静态页面和 `data/db.json` 快照：

```text
https://xujiann.github.io/chronic-care-platform/
```

可展示：

- 页面 UI。
- 静态演示数据。
- 居民端本地上传和授权记录。

发布静态快照前，先生成脱敏副本，避免把正式居民证件号、手机号、地址、证照编号等敏感字段带入演示发布物：

```powershell
npm.cmd run storage:sanitize
```

默认输出到 `data/sanitized/`，同时生成 `.report.json` 脱敏报告。报告会记录源文件 SHA-256、输出文件 SHA-256、脱敏字段计数和总脱敏数量。静态站或外发演示包应使用脱敏副本，不直接外发生产 `data/db.json`。

如需生成固定文件名用于静态发布流水线，可显式指定输出目录和文件名：

```powershell
node scripts/storage-admin.js sanitize data/sanitized --file-name=db.json
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

生产化如迁移 PostgreSQL 或正式数据库，需要先完成 `productionDeploymentPlan` 中的数据库适配器工作，再填入 `DATABASE_URL`；在适配器启用前，运行时和发布门禁会拒绝 `STORAGE_ENGINE=postgres/postgresql`，避免静默回落到 SQLite。接入政务统一认证时需要填入 `OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET`；审计保全至少配置 `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT`，并补充现场短信、CA、网关地址等变量。

生产环境上线前应执行严格环境校验：

```powershell
npm.cmd run env:check:production
```

该命令读取 `.env`，会拒绝缺失环境文件、占位密钥、过短密钥、`STORAGE_ENGINE=json` 和尚未启用的 `postgres/postgresql` 运行时适配器；生产模式还会要求 OIDC 身份适配和审计保全目标配置到位。

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
```

本地服务启动后可访问：

```text
http://localhost:5173/login.html
http://localhost:5173/workbench.html
http://localhost:5173/api/health
```

`/api/metrics` 需要卫健委管理端 token，可用于检查请求数、状态码、慢请求、统一任务堆积、死信事件和数据质量问题。`/api/system/readiness` 汇总 P2 集合完整性、审计哈希链、运行负载和仍需现场资源的外部依赖，可作为发布前人工审查入口。

部署前如需执行完整命令门禁：

```powershell
npm.cmd run deploy:check:full
npm.cmd run release:report:full
```

`release:report` 默认生成 `release/release-report.json`、`release/release-report.md`、`release/production-cutover-checklist.json` 和 `release/production-cutover-checklist.md`，汇总代码文件、关键脚本、静态快照、P2 完成状态、接口准备度、安全验收、生产部署计划、验收证据、环境校验和生产切换清单；`release:manifest` 会生成 `release/release-artifact-manifest.json` 和 `release/release-artifact-manifest.md`，汇总每个发布报告、模板 README、生成命令和 API 证据；`release:report:full` 会额外执行 `check`、`test`、`test:coverage`、`test:e2e`、`deploy:check` 和 `npm audit --omit=dev`。CI 会上传 `release-readiness-report` artifact；发布归档时建议保存这些报告文件和对应 CI artifact，作为上线前人工审查材料。

同一次报告还会生成 `release/storage-model-inspection.json` 和 `release/storage-model-inspection.md`，用于归档 JSON 快照集合/记录规模、最大集合、SQLite 表清单、schema 版本和迁移元数据；干净 CI checkout 中缺少 SQLite 文件时仅记录为提示，不影响演示快照发布门禁。

`production-db:readiness` 会生成 `release/production-db-readiness-report.json` 和 `release/production-db-readiness-report.md`，专项检查 PostgreSQL/正式数据库切换前的生产轨道、必填配置、当前 SQLite/JSON 模型证据、备份恢复演练文档、RTO/RPO 说明和运行时阻断，避免在正式适配器完成前误启用 `STORAGE_ENGINE=postgres/postgresql`。

`identity:contract` 会生成 `release/identity-contract.json` 和 `release/identity-contract.md`，记录政务统一身份接入所需 claims、角色到门户映射、机构覆盖度和样例 claim 映射；`release:report` 会同步写出这些文件，作为 OIDC/SAML 联调前的身份契约验收材料。

`audit:retention` 会生成 `release/audit-retention-report.json` 和 `release/audit-retention-report.md`，离线验证安全事件与数据访问日志哈希链，记录导出摘要、保全目标、安全验收台账和生产审计保全路径；演示环境缺少 `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT` 时仅提示，正式生产切换仍必须通过 `env:check:production`。

`integration:readiness` 会生成 `release/integration-readiness-report.json` 和 `release/integration-readiness-report.md`，检查 P0 接口台账、HIS/EMR/LIS/PACS/医保/证照/统计契约、幂等键、签名和重试策略，并将统一身份、居民主索引、医疗业务系统、分级诊疗和安全审计的覆盖关系归档为联调验收材料。

`interface:mapping` 会生成 `release/interface-mapping-report.json` 和 `release/interface-mapping-report.md`，逐项检查外部契约必填字段、幂等字段、目标集合、目标字段、签名和重试策略是否有平台落点；现场 HIS/EMR/LIS/PACS/医保/证照/统计联调前，应把该报告与真实字段对照表、样例报文和整改记录一起归档。

`data-quality:report` 会生成 `release/data-quality-report.json` 和 `release/data-quality-report.md`，检查居民主索引完整度、跨集合居民引用、personIndex 一致性、来源可追溯和整改闭环，作为 P1 数据质量治理和主索引现场规则确认前的证据包。

`environment:matrix` 会生成 `release/environment-matrix-report.json` 和 `release/environment-matrix-report.md`，把 demo、staging、production 三层环境的必填变量、阻断变量、责任人、门禁脚本和上线验收规则固化为可检查矩阵；`release:report` 会同步写出这些文件，作为环境分层、密钥注入、现场签字和生产切换审查的前置材料。

`operations:readiness` 会生成 `release/operations-readiness-report.json` 和 `release/operations-readiness-report.md`，检查健康检查、运行指标、系统就绪报告、生产部署轨道、外部依赖风险和发布运维脚本，作为上线前运维审查证据。

`process:audit` 会生成 `release/process-audit-report.json` 和 `release/process-audit-report.md`，把居民主索引、慢病验收、医共体验收、医保取药、统计证照、安全合规和生产切换汇总为全流程审计证据域；`release:report` 会同步写出这些文件，作为上线前跨模块审查和现场签字材料。

`release:report` 会额外生成 `release/service-acceptance-summary.json` 和 `release/service-acceptance-summary.md`，汇总慢病与医共体服务域的建模状态、记录行数、开放事项数和 open actions，用于发布归档时核对 `/api/service-acceptance-summary` 与演示台账是否一致。

`site:pack` 会生成 `release/site-readiness-pack.json` 和 `release/site-readiness-pack.md`，把身份源映射、接口联调字段表、样例报文取证、监控值守、灾备演练和生产签字要求整理为现场准备模板；同时生成 `release/templates/*/README.md`，分别说明身份源映射、接口联调、监控值守、生产签字模板的当前能力、输入、输出、必备附件和 API 证据。`GET /api/site-template-readmes` 会在 Node 运行时返回这 4 份模板 README 的状态、责任方、行数、附件类型、live evidence 和文本预览，工作台可直接用于全流程审计；`release:report` 会同步写出这些文件，便于实施团队逐项挂接真实材料。

`monitoring:readiness` 会生成 `release/monitoring-readiness-report.json` 和 `release/monitoring-readiness-report.md`，把 `/api/health`、`/api/metrics`、`/api/system/readiness`、请求状态码、慢请求、死信、数据质量、SLO 阈值、告警信号和 on-call escalation 归档为监控接入证据；生产切换前仍需将这些信号绑定到现场 Prometheus/OpenTelemetry 或平台日志服务，并取得 `CUTOVER_MONITORING_SIGNOFF`。

`evaluation:evidence` 会生成 `release/evaluation-evidence-report.json` 和 `release/evaluation-evidence-report.md`，汇总互联互通四甲/五乙测评所需接口清单、标准映射、交易样例、整改记录、P1 接口需求和流程审计证据，作为现场截图、第三方测评结论和整改复测记录的前置材料。

静态快照中的 `productionDeploymentPlan` 是 P0 生产化路线台账，覆盖发布门禁、PostgreSQL/正式数据库适配、政务统一身份适配和审计保全。`/api/system/readiness` 与 `release:report` 都会检查该台账是否存在，避免生产化路径只停留在文档中。

## 存储迁移与备份

SQLite 启动时会通过 `schema_migrations` 自动执行幂等迁移，当前 schema 版本为 7。部署升级前应先停止写入并创建备份。v7 已把机构信用评价、科研数据集、专病库模型和无障碍验收清单纳入结构化镜像表：

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
## Drug Consumable Supervision Evidence

Before site joint testing for the drug and consumable supervision app, run `npm.cmd run drug-consumable:readiness` and archive `release/drug-consumable-readiness-report.json` plus `release/drug-consumable-readiness-report.md`. The report is the pre-field evidence bundle for rational medication, prescription review, fixed pickup, high-value consumable clues, insurance settlement coordination, and remediation-loop signoff.

Before publishing any platform template, page, remediation record, joint-test file, or generated artifact that cites a policy, standard, attachment, or source file, keep the related runnable page and `about.html#policy-source-rules` aligned with the policy basis, official source link, applicability boundary, and verification evidence. The drug traceability-code source list is seeded as `drugTraceabilityPolicySources` and is validated by `drug-consumable:readiness`, `site:pack`, `deploy:check`, and `release:report`.

For drug traceability-code field joint testing, keep `drugTraceabilityEvidenceRequirements` aligned with site scanner fields,医保编码/商品码/追溯码映射, no-code exception handling, high-value consumable catalog versions, and remediation audit attachments. `drug-consumable:readiness`, `deploy:check`, and `release:report` now fail if these evidence requirements are missing or disconnected from official policy sources.

During scanner, pharmacy, and insurance settlement joint testing, submit sample evidence through `POST /api/drug-consumable-supervision/:id/traceability-evidence` or the insurance/institution portal buttons. Archive the returned `traceabilityEvidenceSubmissions`, completed/missing fields, and audit action with the site signoff package.

When archiving `release/drug-consumable-readiness-report.md`, verify the summary line `Traceability coverage: ready` before signoff so the Markdown bundle matches the API coverage gate.

Use `drug-consumable-about.html` during site walkthroughs as the policy explanation page for drug traceability-code collection, rational medication review, fixed pickup, high-value consumable clues, insurance settlement coordination, remediation evidence, role boundaries, and remaining field integration work.
