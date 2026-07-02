# 医院运行监测平台上线联通需求文档

## 上线目标

医院运行监测与资源调度平台上线前，需要完成医院侧运行数据、资源调度回执、统计直报对账、生产安全和移动值守通道的真实联通。代码侧已提供 `/api/operations/dashboard`、`/api/operations/integration/snapshots`、`/api/operations/integration/dispatch-feedback`、`/api/operations/integration/reconciliation`、`/api/operations/production-hardening`、`/api/operations/cutover-command` 和 `/api/operations/post-cutover-observation`，现场上线以真实报文、验签日志、接收端确认、割接签收和 T+1 观察签收为准。

## 接入系统清单

| 系统 | 接口方向 | 必要数据 | 更新频率 | 验收证据 | 责任方 |
|---|---|---|---|---|---|
| HIS/住院管理 | 医院到平台 | 开放床位、占用床位、ICU/重症床位、急诊留观、住院在院数 | 15 分钟或日内变更 | 真实快照报文、验签日志、平台快照、医院端截图 | 医务部、病案室、信息中心 |
| HR/排班系统 | 医院到平台 | 在岗医生、在岗护士、急诊医生、人员缺口、临时调班 | 日内变更 | 排班接口样例、调班回执、人员缺口复核 | 人事科、护理部、医务部 |
| 设备管理系统 | 医院到平台 | CT 可用台数、呼吸机可用数、救护车可用数、设备停机状态 | 30 分钟或设备状态变更 | 设备台账截图、接口回放、异常停机说明 | 设备科、急诊科 |
| 门急诊/分诊系统 | 医院到平台 | 门诊人次、急诊人次、候诊超过 30 分钟人数、急诊拥堵状态 | 15-30 分钟 | 分诊系统截图、拥堵阈值确认、平台预警记录 | 门诊部、急诊科 |
| 卫生统计直报 | 双向对账 | 直报批次、差异字段、平台值、直报暂存值、复核状态、回执编号 | 日报/周报/月报 | 对账批次、退回/补正/通过记录、直报系统回执 | 统计办公室、规划发展与信息化处 |
| 绩效监测/满意度平台 | 医院到平台 | 二级/三级绩效指标数据源、满意度样本、异常说明、责任科室 | 月度或指标周期 | 指标口径确认表、异常说明模板、平台指标详情 | 行风办、门诊部、护理部 |
| 120/转运调度 | 平台到系统/人工回执 | 救护车可调拨能力、跨院转运申请、执行状态、预计到达时间 | 调度事件触发 | 调度单、回执截图、闭环时间戳 | 急救中心、医政医管处 |
| 医保/电子证照交换 | 外部校验 | 医保基金相关指标、电子证照交换签收、跨部门回执 | 按业务批次 | 交换签字、回执编号、失败重试记录 | 医保接口组、跨部门交换负责人 |
| 统一身份/权限 | 外部到平台 | 用户身份、机构编码、角色、审计主体 | 登录和授权变更 | OIDC/SAML claims 映射、角色登录记录、权限抽检 | 统一身份负责人 |
| 监控日志/SIEM | 平台到外部 | `/api/health`、`/api/metrics`、慢请求、错误率、安全事件、审计哈希链 | 实时或 1 分钟 | 监控面板截图、告警规则、审计保全路径 | 平台运维、安全管理岗 |
| 短信/企业微信/App | 平台到外部 | 预警确认、交接签收、调度备注、直报复核提醒、移动值守回执 | 事件触发 | 消息发送记录、弱网补传说明、回执日志 | 值班长、运行监测岗 |
| 生产数据库/备份 | 平台基础设施 | 正式存储、备份恢复、RTO/RPO、回退快照 | 上线前演练和日常备份 | 备份文件、恢复演练记录、回退确认 | 数据平台、基础设施组 |

## API 对接要求

| 平台接口 | 用途 | 调用方 | 上线阻断条件 |
|---|---|---|---|
| `POST /api/operations/integration/snapshots` | 上报医院运行快照 | HIS、住院、HR、设备、门急诊聚合网关 | 缺少机构编码、签名失败、床位/人员/设备关键字段为空 |
| `POST /api/operations/integration/dispatch-feedback` | 回写资源调度执行状态 | HIS、转运调度、医院值班端 | 调度单不存在、状态不可识别、无执行人或回执时间 |
| `POST /api/operations/integration/reconciliation` | 上报统计直报对账批次 | 卫生统计直报或医院统计接口 | 差异字段缺失、复核状态缺失、回执编号缺失 |
| `GET /api/operations/dashboard` | 委端运行监测总览和上线判定 | 管理端 | `launchReadiness.decision` 仍为暂缓上线运行 |
| `GET /api/operations/production-hardening` | 生产加固清单 | 平台运维、安全管理岗 | 生产密钥、审计保全、监控值守、灾备演练任一阻断 |
| `POST /api/operations/cutover-command/actions` | 割接签收留痕 | 值班长、平台运维 | 高优先级割接项未签收 |
| `POST /api/operations/post-cutover-observation/actions` | 上线后观察留痕 | 运行监测岗、值班长 | T+0/T+1 观察窗口证据未齐套或待签收 |

## 安全和审计要求

- 所有医院侧写入接口必须使用约定签名密钥，生产前完成密钥轮换和最小权限账号配置。
- 机构端只能写入本机构运行快照、调度回执和统计对账批次，委端负责跨机构总览和调度审核。
- 生产模式必须配置非占位 `SESSION_SECRETS`、`INTEGRATION_GATEWAY_SECRET`、统一身份 claims 映射和审计保全路径。
- 调度、对账、交接、割接、观察动作必须写入 `platformProcessAudit` 或安全事件台账，便于上线后追溯。

## 上线验收口径

1. 每个接入系统至少完成一轮真实报文上报、验签、回放和接收端确认。
2. `hospital-operations:readiness`、`hospital-operations:release`、`hospital-operations:module-report`、`release:manifest`、`deploy:check:full`、`release:report:full` 全部通过。
3. `/api/operations/dashboard` 返回 `launchReadiness.decision=可上线运行`；如为暂缓上线运行，必须逐项关闭 `launchReadiness.blockers`。
4. 生产割接完成签字后，按 T+0 2 小时、T+0 8 小时、T+1 24 小时完成观察窗口证据归档和签收。
5. 最终上线材料归档：接口字段映射、样例报文、验签日志、回放记录、失败重试记录、接收端截图、割接签字、观察签收、监控值守和灾备演练记录。
