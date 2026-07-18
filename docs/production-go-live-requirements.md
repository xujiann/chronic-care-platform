# 真实上线需求文档

本文档是卫生健康信息平台进入真实生产运行前的上线需求基线，用于上线评审、现场联调、验收签字和发布阻断判断。当前系统已具备多角色门户、Node API、发布报告、部署检查、上线 smoke、全流程审计和八个优先应用的发布证据；真实上线仍必须由现场业主、医院信息科、承建方、测评机构和运维团队补齐真实身份源、生产数据库、医院接口、医保与证照接口、安全合规、监控告警、备份恢复和签字材料。

## 上线目标

- 部署到可持续运行的 Node.js 后端环境，静态页面只作为预览或前端资源层，不承担真实 API 写入。
- 支撑卫健管理端、医疗机构端、医生端、医保端、居民端、护理端、县域/医联体端的最小业务闭环。
- 完成八个优先应用真实试运行：区域诊疗数据共享、医联体转诊与远程会诊、医疗质量与安全监管、医院运行监测与资源调度、药品耗材与合理用药监管、慢病管理与院后随访、科研数据集与数据沙箱、卫生健康综合驾驶舱。
- 形成可追溯的发布包、环境参数、接口联调记录、测评报告、演练记录、上线签字和回滚方案。

## 上线范围

| 范围 | 必须上线 | 验收说明 |
|---|---|---|
| 前端入口 | `login.html`、`index.html`、`institution.html`、`doctor.html`、`insurance.html`、`citizen.html`、`county.html`、`regional-data-sharing.html`、`quality-safety.html`、`operations.html`、`internet-nursing.html`、`health-dashboard.html` | 角色入口必须通过真实身份源或受控账号访问。 |
| 后端入口 | `server.js`、`/api/health`、`/api/metrics`、`/api/state`、各业务 API | 生产环境必须运行 Node API，不能只发布 GitHub Pages 静态站点。 |
| 运行数据 | 生产数据库、审计日志、备份副本、附件存储 | `data/db.json` 仅可作为演示快照或迁移源，不可作为正式共享生产主库。 |
| 发布证据 | `release/release-report.md`、`release/production-cutover-checklist.md`、`release/site-readiness-pack.md`、`release/launch-smoke-report.md` | 每次上线前重新生成并归档。 |
| 子域需求 | `docs/citizen-production-launch-requirements.md` | 居民端真实上线需求是本文件的居民侧细化证据。 |

## 真实环境前置条件

| 编号 | 类别 | 需求 | 验收证据 | 责任方 |
|---|---|---|---|---|
| GL-01 | 基础设施 | 提供生产域名、HTTPS 证书、反向代理、Node.js 运行环境、进程守护、日志目录和文件权限。 | 访问 `https://<生产域名>/api/health` 返回 HTTP 200；`launch:smoke -- --base-url=<生产地址>` 通过。 | 运维团队 |
| GL-02 | 数据库 | 完成生产数据库选型、初始化、迁移、备份、恢复演练和容量评估。 | `production-db-readiness-report.md`、恢复演练记录、RTO/RPO 签字。 | 数据库管理员 |
| GL-03 | 身份认证 | 接入政务统一身份、机构目录、医生身份源和居民实名能力。 | `identity-contract.md`、OIDC/SAML 参数、回调地址、样例 claims。 | 业主方/身份平台 |
| GL-04 | 短信与移动端 | 接入真实短信网关、APP/小程序入口、推送服务和 HTTPS 签名策略。 | `citizen-launch-foundation-readiness.md`、短信发送记录、移动端访问截图。 | 移动端/网关团队 |
| GL-05 | 医院系统 | HIS、EMR、LIS、PACS、心电、预约号源、电子病历质控、危急值规则完成接口联调。 | `integration-readiness-report.md`、`interface-mapping-report.md`、现场联调单。 | 医院信息科 |
| GL-06 | 医保与证照 | 医保核心、电子证照、出生证、死亡证、公安民政、妇幼、疾控共享接口完成授权。 | 交易样例、回执、授权文件、失败重试记录。 | 医保/证照/政务接口方 |
| GL-07 | 安全合规 | 完成等保、密评、信创、日志留存、国密设备、漏洞扫描和生产密钥管理。 | 测评报告、整改闭环、`audit-retention-report.md`、密钥交接记录。 | 安全团队 |
| GL-08 | 运维监控 | 接入 `/api/health`、`/api/metrics`、业务异常、慢请求、错误率、审计链、备份任务和 on-call。 | `monitoring-readiness-report.md`、告警演练记录、值班表。 | 运维团队 |

## 八个优先应用准入

| 应用 | 真实上线必须补齐 | 仓库内证据 |
|---|---|---|
| 区域诊疗数据共享平台 | 区域主索引、居民授权、跨机构调阅范围、数据脱敏规则、访问审计和撤权流程。 | `regional-data-sharing-report.md`、`data-quality-report.md`、`audit-retention-report.md` |
| 医联体转诊与远程会诊平台 | 号源、会诊排班、视频会议、报告回传、绩效口径和居民知情授权。 | `referral-teleconsultation-readiness-report.md`、`interface-mapping-report.md` |
| 医疗质量与安全监管平台 | 危急值、病历抽样、临床路径、互认质控、整改派单和院内质控部门签字。 | `quality-safety-report.md` |
| 医院运行监测与资源调度平台 | 床位、人力、设备、门急诊、住院、直报统计和资源调度指挥规则。 | `hospital-operations-readiness-report.md`、`operations-readiness-report.md` |
| 药品耗材与合理用药监管平台 | 处方点评、固定取药、耗材线索、医保结算回写、整改闭环和药事会确认。 | `drug-consumable-readiness-report.md` |
| 慢病管理与院后随访平台 | 筛查、分级管理、院后随访、家庭医生、用药提醒、居民反馈和基层协同。 | `chronic-followup-readiness-report.md`、`chronic-launch-core.md` |
| 科研数据集与数据沙箱平台 | 伦理审批、数据使用协议、脱敏发布、沙箱权限、导出审批和成果回流。 | `research-sandbox-readiness-report.md` |
| 卫生健康综合驾驶舱 | 指标口径、刷新频率、领导视图权限、数据源签字和异常解释机制。 | `health-dashboard-summary.md`、`priority-application-templates.md` |

## 数据迁移与治理要求

- 建立居民主索引、机构编码、医生编码、疾病编码、药品耗材编码和检查检验项目编码的现场对照表。
- 演示数据、历史数据和真实生产数据必须分区管理，禁止把演示账号、演示手机号、演示证件号混入生产库。
- 首次导入前输出数据质量报告，至少覆盖重复居民、空身份证、空手机号、跨集合断链、居民授权缺失、审计链断裂和接口回执缺失。
- 出生证、死亡证、慢病、转诊、护理、医保、科研沙箱等敏感业务必须设置最小权限、用途限定和留痕策略。
- 生产备份必须覆盖数据库、上传附件、审计导出、配置文件和发布包，并完成至少一次恢复演练。

## 接口联调要求

| 接口域 | 交易要求 | 失败处理 |
|---|---|---|
| 统一身份 | 登录、登出、token 刷新、角色映射、机构映射、医生映射、居民实名映射。 | 登录失败需可追踪到身份平台错误码，不得降级为匿名管理权限。 |
| 医疗数据 | 患者摘要、诊断、处方、检查、检验、影像、病历、随访、转诊和会诊记录。 | 支持幂等键、签名校验、重试、死信记录和人工补偿。 |
| 医保结算 | 处方、取药、费用、结算状态、异常退回和整改反馈。 | 医保失败不得阻断临床记录归档，必须形成待处理队列。 |
| 电子证照 | 出生证、死亡证、医生执业、机构资质和居民授权凭证。 | 证照共享失败必须保留原始请求、响应、签名摘要和重试次数。 |
| 监控审计 | 健康检查、指标、访问日志、审计链、告警事件和导出归档。 | 监控不可用时生产发布自动阻断，除非有书面应急审批。 |

## 安全与合规要求

- 所有生产密钥必须通过受控密钥管理或部署平台注入，禁止写入仓库、脚本、截图或发布报告。
- 生产会话密钥、接口网关密钥和短信网关密钥不得使用 `.env.example` 中的占位值。
- 居民身份证号、手机号、住址、证照号、检查检验结果、病历摘要和科研数据导出必须按最小必要原则展示。
- 审计日志必须覆盖登录、登出、授权、撤权、跨机构调阅、接口回调、数据导出、管理员操作和发布操作。
- 上线前必须完成至少一次漏洞扫描和权限穿透测试，问题分级、整改人、复测结论和放行意见需要归档。

## 上线演练与签字

| 阶段 | 动作 | 通过标准 |
|---|---|---|
| T-7 天 | 冻结上线范围、确定回滚窗口、确认责任人和值班表。 | 范围清单、风险清单、回滚方案完成评审。 |
| T-3 天 | 完成生产环境参数、真实接口联调、备份恢复演练。 | `release:report --profile=production` 无阻断项，或阻断项有书面豁免。 |
| T-1 天 | 生成发布包、执行 smoke、完成现场签字。 | `launch:smoke -- --base-url=<生产地址>` 通过，签字模板归档。 |
| T 日 | 灰度开放、观察核心 API、登录、接口回调、审计链和告警。 | 首小时无 P0/P1 故障，关键业务闭环可人工复核。 |
| T+1 天 | 复盘上线结果、处理遗留问题、固化运维手册。 | 形成上线复盘、缺陷台账和下一批需求。 |

## 发布前命令清单

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run release:report
npm.cmd run deploy:check
npm.cmd run launch:smoke
npm.cmd run launch:smoke -- --base-url=https://your-production-host
```

生产环境还需要使用真实 `.env` 执行：

```powershell
npm.cmd run release:report -- --profile=production --config-env=.env
```

## 发布阻断条件

- 生产环境仍使用 JSON 文件作为主存储，且没有正式数据库或受控 SQLite 部署方案。
- `/api/health`、`/api/metrics`、登录、角色权限、居民授权、审计链或备份恢复任一核心能力不可用。
- 统一身份、短信、HIS/EMR/LIS/PACS、医保、电子证照等 P0 接口没有现场联调记录。
- 生产密钥、短信网关、身份源、数据库连接、审计导出路径仍为占位值。
- 等保、密评、漏洞扫描或权限测试存在未豁免的高危问题。
- 没有回滚方案、现场值班表、监控告警和业务方上线签字。

## 验收交付物

- 真实上线需求文档：`docs/production-go-live-requirements.md`
- 居民端真实上线需求：`docs/citizen-production-launch-requirements.md`
- 发布报告：`release/release-report.md`
- 生产割接清单：`release/production-cutover-checklist.md`
- 现场就绪包：`release/site-readiness-pack.md`
- 上线 smoke 报告：`release/launch-smoke-report.md`
- 发布产物清单：`release/release-artifact-manifest.md`
- 环境矩阵：`release/environment-matrix-report.md`
- 生产数据库就绪报告：`release/production-db-readiness-report.md`
- 接口联调与字段映射报告：`release/integration-readiness-report.md`、`release/interface-mapping-report.md`
- 审计留存与数据质量报告：`release/audit-retention-report.md`、`release/data-quality-report.md`
