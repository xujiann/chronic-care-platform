# 医院运行监测与资源调度平台开发报告

更新时间：2026-07-08

## 1. 模块定位

医院运行监测与资源调度平台面向卫健委管理端、医院运行管理岗、医政医管处、统计办公室、平台运维和现场联调团队，目标是把床位、人员、设备、门急诊、住院运行、资源调度、统计直报对账和上线运行证据串成可操作、可审计、可发布的闭环。

当前入口为 `operations.html`，政策说明入口为 `operations-about.html`，核心 API 位于 `/api/operations/*`，发布证据纳入 `hospital-operations:readiness`、`hospital-operations:release`、`hospital-operations:module-report`、`hospital-operations:brief-pdf`、`release:manifest` 和 `deploy:check`。

## 2. 已实现核心功能

| 功能 | 已实现内容 | 主要证据 |
|---|---|---|
| 运行监测总览 | 汇总床位、人员、设备、门急诊、住院运行、风险预警和上线判定 | `/api/operations/dashboard`、`hospitalOperationSnapshots` |
| 绩效监测口径 | 对齐国家二级、三级公立医院绩效监测操作手册，沉淀指标来源、责任科室、异常说明和字段联调点 | `/api/operations/performance-monitoring` |
| 资源调度闭环 | 调度工单创建、分派、执行、关闭、批量状态更新和审计留痕 | `/api/operations/dispatch`、`resourceDispatchRequests` |
| 医院系统签名接入 | 支持医院侧签名上报运行快照、调度回执和统计对账批次 | `/api/operations/integration/snapshots`、`dispatch-feedback`、`reconciliation` |
| 统计直报对账复核 | 支持阻断、退回、补正、通过等复核状态和异常说明 | `statisticsReconciliationReviews`、`healthStatisticsIngestion` |
| 指挥链与交接班 | 将预警、SLA、责任人、处置动作、交接签收和审计留痕串联 | `/api/operations/command-chains`、`handover`、`handover/signoff` |
| 现场联调闭环 | 样例报文、验签日志、回放记录、失败重试、接收端确认和巡检归档 | `/api/operations/site-joint-tests`、`site-joint-patrol` |
| 生产加固与割接 | 生产密钥、审计保全、监控告警、灾备演练、割接签收和上线后观察 | `/api/operations/production-hardening`、`cutover-command`、`post-cutover-observation` |
| 智能调度建议 | 按机构生成床位缺口、人员缺口、急诊拥堵、直报风险和跨院资源建议 | `/api/operations/intelligence` |
| 跨院资源池 | 汇总床位、ICU、呼吸机、救护车和值班医生可支援能力 | `/api/operations/resource-pool`、`medicalResources` |
| 急诊拥堵调度闭环 | 识别急诊候诊/留观压力，匹配跨院资源，生成调度草稿，支持复核审计 | `/api/operations/emergency-dispatch-loop`、`emergencyDispatchLoops` |
| 移动值守台 | 汇总预警确认、交接签收、调度备注和直报复核提醒 | `/api/operations/mobile-duty`、`taskMessages` |
| 治理报表与导出 | 月度运行报告、直报差异清单、调度复盘、绩效异常说明和附件目录 | `/api/operations/governance-report`、`governance-export-package` |
| 发布证据链 | 模块报告、发布报告、两页 PDF、上线联通需求、完整流程图和开发报告 | `release/*`、`docs/hospital-operations-*.md` |

## 3. 数据与状态设计

| 数据集合 | 用途 | 状态口径 |
|---|---|---|
| `hospitalOperationSnapshots` | 医院运行快照，记录床位、人员、设备、门急诊和住院运行 | 正常、关注、高压、阻断等压力等级 |
| `resourceDispatchRequests` | 资源调度工单，记录来源预警、调度目标、责任人、SLA 和执行状态 | 草稿、已分派、执行中、已关闭、需升级 |
| `emergencyDispatchLoops` | 急诊拥堵调度闭环，记录候诊、留观、资源匹配、调度草稿和复核动作 | 待复核、已确认、执行中、已关闭、需补证 |
| `statisticsReconciliationReviews` | 统计直报差异复核，记录差异字段、复核结论和回执 | 阻断、退回、补正、通过 |
| `operationAlertRules` | 预警规则和压力阈值 | 启用、观察、停用 |
| `platformProcessAudit` | 调度、对账、交接、割接和上线观察审计留痕 | 已记录、待补证、需复核 |

## 4. 前端与 API 入口

| 层级 | 入口 |
|---|---|
| 管理端页面 | `operations.html` |
| 政策说明 | `operations-about.html` |
| 运行总览 | `GET /api/operations/dashboard` |
| 资源池 | `GET /api/operations/resource-pool` |
| 急诊闭环 | `GET /api/operations/emergency-dispatch-loop`、`POST /api/operations/emergency-dispatch-loop/actions` |
| 调度工单 | `POST /api/operations/dispatch`、`POST /api/operations/dispatch/:id/status` |
| 对账复核 | `POST /api/operations/reconciliation/:id/review` |
| 联调巡检 | `GET /api/operations/site-joint-tests`、`GET/POST /api/operations/site-joint-patrol` |
| 上线运行 | `GET /api/operations/production-hardening`、`GET/POST /api/operations/cutover-command`、`GET/POST /api/operations/post-cutover-observation` |
| 上线前门禁 | `GET /api/operations/go-live-gates`，汇总真实报文、审计保全、监控值守和灾备演练签收状态 |

## 5. 发布与验收证据

| 命令或文件 | 作用 |
|---|---|
| `npm.cmd run check` | JavaScript 语法与静态入口检查 |
| `npm.cmd test` | API、静态页面、模块报告、发布证据回归测试 |
| `npm.cmd run hospital-operations:readiness` | 运行监测准备度检查 |
| `npm.cmd run hospital-operations:release` | 医院运行模块发布检查 |
| `npm.cmd run hospital-operations:module-report` | 生成模块功能报告 |
| `npm.cmd run hospital-operations:brief-pdf` | 验证两页 PDF 简报 |
| `npm.cmd run release:manifest` | 汇总发布包清单 |
| `npm.cmd run deploy:check` | 上线前部署门禁 |
| `docs/hospital-operations-flow.md` | 完整业务流程图 |
| `docs/hospital-operations-development-report.md` | 本开发报告 |
| `docs/hospital-operations-integration-requirements.md` | 上线联通需求文档 |

## 6. 本次验证结果

| 验证项 | 结果 |
|---|---|
| `npm.cmd run check` | 通过 |
| `node --test test/hospital-operations-module-report.test.js test/release-artifact-manifest.test.js test/deploy-check.test.js test/static.test.js` | 通过，25/25 |
| `npm.cmd test` | 通过，135/135 |
| `npm.cmd run hospital-operations:readiness` | 通过 |
| `npm.cmd run hospital-operations:release` | 通过 |
| `npm.cmd run hospital-operations:module-report` | 通过，模块报告 20/20 能力就绪，已索引流程图和开发报告 |
| `npm.cmd run hospital-operations:brief-pdf` | 通过 |
| `npm.cmd run operations:readiness` | 通过 |
| `npm.cmd run release:manifest` | 通过，发布清单 29 项交付物，包含流程图和开发报告 |
| `npm.cmd run release:report` | 通过，105 项检查中 104 项通过、0 失败、1 个生产切换提示 |
| `npm.cmd run deploy:check` | 通过 |

`release:report` 当前唯一提示为 `audit:retentionTargetConfigured`：演示环境已通过审计链校验，但正式生产割接前仍需配置 `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT`，并完成现场日志保全、留存年限、访问审计和导出权限签收。

## 7. 当前上线边界

代码侧已经具备演示发布和试运行准备能力，能够支撑管理端查看、调度复核、对账复核、移动值守、治理导出和发布证据归档。正式生产上线仍应以现场联调为准，至少完成以下事项：

| 上线前门禁 | 责任方 | 必备证据 | 当前状态 |
|---|---|---|---|
| 真实报文联调签收 | 医院信息中心、接口联调组 | 运行快照、调度回执、统计对账真实报文，验签日志、回放记录、失败重试记录和接收端截图 | 现场待签收 |
| 审计保全目标配置 | 平台运维、安全管理岗 | 生产环境配置 `AUDIT_EXPORT_PATH` 或 `SIEM_ENDPOINT`，确认日志保全、留存年限、访问审计和导出权限 | 生产割接前必填 |
| 监控值守联通 | 平台运维、值班长 | `/api/health`、`/api/metrics`、慢请求、错误率、死信、数据质量和 on-call escalation 接入现场监控平台 | 现场待签收 |
| 灾备演练签收 | 数据平台、基础设施组 | 备份文件、恢复演练记录、RTO/RPO 说明、回退快照和割接回退策略确认 | 现场待签收 |

以上门禁未完成前，当前系统应表述为“演示级与试运行准备系统”；完成现场签收后，再进入正式割接和上线后 T+1 观察。

## 8. 下一步开发计划

| 优先级 | 方向 | 开发内容 | 验收标准 |
|---|---|---|---|
| P0 | 真实床位与急诊联调包 | 床位快照、急诊候诊、留观转床、ICU 缺口和调度回执真实报文联调 | 一家医院完成端到端快照、调度、回执和审计归档 |
| P0 | 生产审计保全 | 对接正式审计导出路径或 SIEM，补齐保全策略、留存周期和告警规则 | `env:check:production` 审计项通过，release warning 关闭 |
| P1 | 手术运行监测 | 手术排程、手术室利用率、择期手术延误、术后床位占用和取消原因 | 手术运行面板和接口证据进入 release 链 |
| P1 | 效率指标复盘 | 平均住院日、床位周转率、急诊停留时间、检查等待时间和绩效异常说明 | 指标趋势、异常说明和责任科室可导出 |
| P1 | 智能调度效果评估 | 建议采纳率、驳回原因、模型版本、次日压力回看和复盘评分 | 调度建议形成闭环效果指标 |
| P2 | 移动消息通道 | 企业微信、短信或 App 消息发送、回执、弱网补传和离线记录 | 现场确认消息通道并完成值班长签收 |
| P2 | 领导大屏与地图 | 院区/区县压力热力、床位与急诊态势、上线观察和治理报告摘要 | 大屏入口可演示，指标来源和刷新周期可追溯 |
