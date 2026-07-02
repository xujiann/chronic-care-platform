# 卫生健康综合管理服务系统真实上线需求文档

## 1. 文档目的

本文件用于明确“卫生健康综合管理服务系统”从当前可发布演示版本进入真实上线运行前必须满足的业务、技术、数据、安全、联调和验收要求。

当前代码库已经具备管理端页面、摘要接口、上线门禁、发布报告、发布包清单、测试和 CI 取证能力；真实上线仍必须完成现场环境、政务身份、生产数据库、外部接口、安全测评、监控值守和灾备演练闭环。未取得本文件列明的现场证据前，系统不得被标记为生产 ready。

## 2. 上线范围

### 2.1 使用对象

- 市级卫生健康行政部门：用于跨应用总览、运行监测、风险预警、任务闭环、接口联调和上线验收取证。
- 县级卫生健康行政部门：用于辖区机构协同、现场问题闭环、县域服务指标查看和属地验收材料归集。
- 平台运维和实施团队：用于生产环境、统一身份、审计保全、接口联调、监控告警、灾备演练和发布包归档。

### 2.2 功能边界

系统作为前 7 个业务应用的汇总入口，不替代慢病管理、转诊协同、质量安全、运营调度、证照统计、随访服务、县域医共体等源业务应用。源应用仍是业务办理、状态更新和验收明细的事实来源。

## 3. 当前已具备的发布条件

| 类别 | 已具备能力 | 证据 |
|---|---|---|
| 管理端页面 | `health-dashboard.html` 可展示指标总览、风险、任务、接口、证据、现场依赖和上线门禁 | 本地预览、E2E |
| 摘要 API | `/api/health-dashboard/summary` 汇总指标、风险、open actions 和功能报告 | API 测试 |
| 上线门禁 API | `/api/health-dashboard/production-readiness` 返回门禁、阻塞项、切换清单和证据包 | API 测试、审计事件 |
| 发布报告 | `release:report` 生成发布汇总、生产切换清单和健康驾驶舱摘要 | `release/release-report.md` |
| 发布包索引 | `release:manifest` 索引健康驾驶舱摘要和上线门禁证据入口 | `release/release-artifact-manifest.md` |
| 自动化验证 | `check`、`test`、`test:e2e`、`deploy:check`、CI | GitHub Actions |

## 4. 真实上线前置需求

| 门禁 | 上线要求 | 责任方 | 验收证据 | 当前口径 |
|---|---|---|---|---|
| 生产环境 | Node API、HTTPS 域名、反向代理、内网访问策略、环境变量、证书链和部署账号全部确认 | 平台技术组 | 环境部署单、域名证书、`.env` 审核记录、`env:check:production` 输出 | 未完成前阻断 |
| 统一身份 | 接入政务统一认证或主管部门指定身份源，完成机构、角色、账号、会话、退出和权限拒绝测试 | 主管部门、身份源单位 | OIDC/SAML 参数、claim 映射、角色映射、联调记录、拒绝访问审计 | 未完成前阻断 |
| 审计保全 | 安全事件和数据访问日志接入审计保全目录、SIEM 或日志平台，保留策略和导出摘要可验证 | 安全管理岗 | `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT`、审计导出摘要、保全策略、抽查记录 | 未完成前阻断 |
| 生产数据库 | 明确正式数据库、备份策略、账号权限、迁移脚本、索引约束、回滚脚本和恢复演练 | 数据库管理员、平台技术组 | 数据库验收单、备份恢复报告、RTO/RPO 验收、`production-db:readiness` | 未完成前阻断 |
| 接口联调 | HIS/EMR/LIS/PACS/医保/证照/统计/机构目录等接口完成字段映射、样例报文、签名、幂等和重试测试 | 实施团队、各系统厂商 | 接口联调记录、字段映射表、样例报文、失败重试记录、签字页 | 未完成前阻断 |
| 监控告警 | `/api/health`、`/api/metrics`、慢请求、状态码、任务堆积、死信、数据质量和外部接口异常进入监控平台 | 运维团队 | 告警规则、值班表、通知链路、演练截图、`monitoring:readiness` | 未完成前阻断 |
| 灾备演练 | 完成备份恢复、跨机房或异地副本、恢复时间目标、恢复点目标和切换回退演练 | 运维团队、数据库管理员 | 灾备演练报告、恢复日志、RTO/RPO 结果、回退方案签字 | 未完成前阻断 |
| 安全合规 | 完成等保、密评、信创、国密、脱敏、最小权限、漏洞整改和上线安全评审 | 安全管理岗、测评机构 | 测评报告、整改闭环、账号权限清单、脱敏策略、上线安全评审单 | 未完成前阻断 |

## 5. 现场联调需求

### 5.1 身份与权限联调

- 确认市级、县级、机构、医保、居民等角色的账号来源、组织编码和机构层级。
- 完成 `commission` 角色访问 `health-dashboard.html`、`health-dashboard-about.html`、`/api/health-dashboard/summary` 和 `/api/health-dashboard/production-readiness` 的正向测试。
- 完成非管理端角色访问管理页面和管理 API 的拒绝测试，并核查审计事件。

### 5.2 数据与接口联调

- 出生、死亡、就诊、入院数据按日、周、月、年提供统计口径和来源系统字段。
- 医疗机构、医保、证照、统计、公安民政共享等接口必须提供字段映射表、样例报文和异常样例。
- 所有写入或状态回流接口必须明确幂等键、签名规则、重试策略、死信处理和人工补偿流程。

### 5.3 发布和切换联调

- 发布前运行 `npm.cmd run check`、`npm.cmd test`、`npm.cmd run test:e2e`、`npm.cmd run release:report`、`npm.cmd run release:manifest`、`npm.cmd run deploy:check`。
- 生产环境运行 `npm.cmd run env:check:production`，并归档输出。
- 使用 `/api/health-dashboard/production-readiness` 核对门禁状态；只有全部门禁为 ready 且现场签字齐全，才允许生产切换。

## 6. 验收材料清单

| 材料 | 必要性 | 来源 |
|---|---|---|
| 发布报告 | 必须 | `release/release-report.md` |
| 发布包清单 | 必须 | `release/release-artifact-manifest.md` |
| 健康驾驶舱摘要 | 必须 | `release/health-dashboard-summary.md` |
| 生产切换清单 | 必须 | `release/production-cutover-checklist.md` |
| 真实上线需求文档 | 必须 | `docs/health-dashboard-production-launch-requirements.md` |
| 身份接入契约 | 必须 | `release/identity-contract.md` |
| 接口准备度报告 | 必须 | `release/integration-readiness-report.md` |
| 字段映射报告 | 必须 | `release/interface-mapping-report.md` |
| 审计保全报告 | 必须 | `release/audit-retention-report.md` |
| 监控就绪报告 | 必须 | `release/monitoring-readiness-report.md` |
| 数据库就绪报告 | 必须 | `release/production-db-readiness-report.md` |
| 现场签字模板 | 必须 | `release/templates/production-signoff/README.md` |

## 7. 上线判定

满足以下条件后，方可将系统标记为真实生产 ready：

1. `release:report`、`release:manifest`、`deploy:check`、`check`、`test`、`test:e2e` 全部通过。
2. `env:check:production` 在真实 `.env` 下通过。
3. `/api/health-dashboard/production-readiness` 返回 `productionReady: true`，且无 blocked gates。
4. 统一身份、审计保全、生产数据库、接口联调、监控告警、灾备演练和安全合规均有现场签字材料。
5. 市级和县级卫生健康行政部门完成业务验收，确认系统仅承担综合管理服务入口职责，不替代源业务系统。

## 8. 不满足上线条件时的处理

- 可继续发布为演示、试运行或联调环境，但页面和报告必须保留上线门禁阻断状态。
- 不得对外宣称已完成生产上线。
- 未闭环项必须进入现场问题台账，并明确责任方、下一步动作和预计完成时间。
