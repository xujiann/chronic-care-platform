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

## 验证与发布验收

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:coverage
npm.cmd run test:e2e
npm.cmd run deploy:check
npm.cmd run env:check
npm.cmd run release:report
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

`release:report` 默认生成 `release/release-report.json` 和 `release/release-report.md`，汇总代码文件、关键脚本、静态快照、P2 完成状态、接口准备度、安全验收、生产部署计划、验收证据和环境校验；`release:report:full` 会额外执行 `check`、`test`、`test:coverage`、`test:e2e`、`deploy:check` 和 `npm audit --omit=dev`。CI 会上传 `release-readiness-report` artifact；发布归档时建议保存这两个报告文件和对应 CI artifact，作为上线前人工审查材料。

静态快照中的 `productionDeploymentPlan` 是 P0 生产化路线台账，覆盖发布门禁、PostgreSQL/正式数据库适配、政务统一身份适配和审计保全。`/api/system/readiness` 与 `release:report` 都会检查该台账是否存在，避免生产化路径只停留在文档中。

## 存储迁移与备份

SQLite 启动时会通过 `schema_migrations` 自动执行幂等迁移，当前 schema 版本为 7。部署升级前应先停止写入并创建备份。v7 已把机构信用评价、科研数据集、专病库模型和无障碍验收清单纳入结构化镜像表：

```powershell
npm.cmd run storage:backup
```

备份保存在 `data/backups/`，清单记录文件大小和 SHA-256。恢复前必须停止服务并先校验：

```powershell
node scripts/storage-admin.js verify "data/backups/<备份目录>"
node scripts/storage-admin.js rehearse "data/backups/<备份目录>" --max-duration-ms=60000
node scripts/storage-admin.js assess "data/backups/<备份目录>" --max-backup-age-ms=86400000 --max-duration-ms=60000 --min-file-count=2 --min-total-bytes=1 --required-files=db.json,health-city.sqlite
node scripts/storage-admin.js restore "data/backups/<备份目录>" --confirm
npm.cmd run rollback:snapshot -- "data/backups/<备份目录>"
```

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
