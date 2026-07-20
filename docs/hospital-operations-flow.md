# 医院运行监测平台完整流程图

更新时间：2026-07-08

本文用于说明医院运行监测与资源调度平台从数据接入、运行监测、预警研判、资源调度、复核对账、审计归档到上线观察的完整业务流程。流程图中的接口和数据集合均已接入现有模块证据链，生产上线仍需现场真实系统完成报文、验签、回放、接收端确认和签收归档。

## 1. 端到端业务总流程

```mermaid
flowchart TB
  subgraph Source["医院与外部来源系统"]
    His["HIS/住院管理<br/>开放床位、占用床位、ICU、在院人数"]
    Hr["HR/排班系统<br/>医生、护士、急诊值班、临时调班"]
    Device["设备管理系统<br/>CT、呼吸机、救护车、设备停机"]
    Emergency["门急诊/分诊系统<br/>门诊量、急诊量、候诊、留观"]
    Statistics["卫生统计直报<br/>批次、字段、平台值、直报值"]
    Performance["绩效监测来源<br/>二级/三级公立医院绩效口径"]
    Transfer["120/转运调度<br/>转运申请、执行状态、预计到达"]
  end

  subgraph Ingest["接入与规范化"]
    SnapshotApi["POST /api/operations/integration/snapshots<br/>签名快照上报"]
    FeedbackApi["POST /api/operations/integration/dispatch-feedback<br/>调度回执上报"]
    ReconciliationApi["POST /api/operations/integration/reconciliation<br/>直报对账上报"]
    Normalize["状态规范化<br/>机构、压力等级、风险域、幂等键"]
    State["运行状态集合<br/>hospitalOperationSnapshots<br/>resourceDispatchRequests<br/>emergencyDispatchLoops"]
  end

  subgraph Monitor["运行监测与研判"]
    Dashboard["GET /api/operations/dashboard<br/>运行监测总览"]
    PerformanceApi["GET /api/operations/performance-monitoring<br/>绩效口径对齐"]
    Alerts["预警队列<br/>床位、人员、设备、急诊、直报"]
    Intelligence["GET /api/operations/intelligence<br/>智能调度建议"]
    ResourcePool["GET /api/operations/resource-pool<br/>跨院资源池"]
  end

  subgraph Dispatch["资源调度闭环"]
    Draft["调度草稿<br/>资源匹配、SLA、责任人"]
    DispatchApi["POST /api/operations/dispatch<br/>生成调度工单"]
    StatusApi["POST /api/operations/dispatch/:id/status<br/>执行状态更新"]
    EmergencyLoop["GET /api/operations/emergency-dispatch-loop<br/>急诊拥堵调度闭环"]
    EmergencyAction["POST /api/operations/emergency-dispatch-loop/actions<br/>复核与审计留痕"]
  end

  subgraph Review["复核、值守与审计"]
    Reconciliation["POST /api/operations/reconciliation/:id/review<br/>统计直报对账复核"]
    Handover["交接班闭环<br/>责任矩阵、签收、待办"]
    Mobile["移动值守台<br/>提醒、回执、弱网补传说明"]
    Audit["platformProcessAudit<br/>调度、对账、交接、割接审计"]
  end

  subgraph Release["上线与持续运行"]
    SiteTest["现场联调闭环<br/>样例报文、验签、回放、接收端确认"]
    Hardening["生产加固<br/>密钥、审计保全、监控、灾备"]
    Cutover["生产割接签收<br/>阻断项、回退策略、责任人"]
    Observation["上线后观察<br/>T+0 2小时、T+0 8小时、T+1 24小时"]
    Reports["发布证据<br/>readiness、release、manifest、PDF、开发报告"]
  end

  His --> SnapshotApi
  Hr --> SnapshotApi
  Device --> SnapshotApi
  Emergency --> SnapshotApi
  Statistics --> ReconciliationApi
  Transfer --> FeedbackApi
  Performance --> PerformanceApi

  SnapshotApi --> Normalize
  FeedbackApi --> Normalize
  ReconciliationApi --> Normalize
  Normalize --> State
  State --> Dashboard
  Dashboard --> Alerts
  Dashboard --> Intelligence
  Dashboard --> ResourcePool
  PerformanceApi --> Alerts

  Alerts --> Draft
  Intelligence --> Draft
  ResourcePool --> Draft
  Draft --> DispatchApi
  DispatchApi --> StatusApi
  FeedbackApi --> StatusApi
  Emergency --> EmergencyLoop
  ResourcePool --> EmergencyLoop
  EmergencyLoop --> EmergencyAction
  EmergencyAction --> Audit

  ReconciliationApi --> Reconciliation
  Reconciliation --> Audit
  StatusApi --> Handover
  Handover --> Mobile
  Mobile --> Audit
  Audit --> SiteTest
  SiteTest --> Hardening
  Hardening --> Cutover
  Cutover --> Observation
  Observation --> Reports
```

## 2. 运行监测状态流转

```mermaid
stateDiagram-v2
  [*] --> 快照接收
  快照接收 --> 验签失败: 签名、机构或幂等键不通过
  验签失败 --> 联调退回: 写入接口巡检问题
  快照接收 --> 状态规范化: 字段完整且签名通过
  状态规范化 --> 正常观察: 压力等级正常
  状态规范化 --> 风险预警: 床位、人员、设备、急诊或直报异常
  风险预警 --> 调度建议: 命中调度规则或智能建议
  调度建议 --> 人工复核: 管理端确认资源、SLA、责任人
  人工复核 --> 调度执行: 生成或更新调度工单
  调度执行 --> 调度关闭: 医院或转运系统回执完成
  调度执行 --> 调度升级: 超时、资源不足或回执异常
  调度升级 --> 人工复核
  调度关闭 --> 复盘归档: 写入审计、治理报表和交接班
  正常观察 --> 复盘归档: 纳入运行月报
  复盘归档 --> [*]
```

## 3. 急诊拥堵调度闭环

```mermaid
sequenceDiagram
  participant ED as 急诊/分诊系统
  participant OPS as 运行监测平台
  participant Pool as 跨院资源池
  participant Cmd as 管理端调度席
  participant Hospital as 接收医院/转运调度
  participant Audit as 审计与发布证据

  ED->>OPS: 上报候诊、留观、CT、救护车能力
  OPS->>OPS: 识别急诊拥堵等级和阻断因素
  OPS->>Pool: 查询可支援床位、ICU、救护车、值班医生
  Pool-->>OPS: 返回资源匹配、SLA、审批边界
  OPS->>Cmd: 生成调度草稿和复核任务
  Cmd->>OPS: 确认调度、驳回或补充说明
  OPS->>Hospital: 推送调度单或生成现场执行任务
  Hospital-->>OPS: 回写接收、转运、到达、关闭状态
  OPS->>Audit: 归档复核说明、调度结果和处置时长
  Audit-->>Cmd: 进入交接班、治理报表和上线观察证据
```

## 4. 统计直报对账复核流程

```mermaid
flowchart LR
  Batch["直报批次接入<br/>healthStatisticsIngestion"] --> Diff["差异识别<br/>字段、平台值、直报值"]
  Diff --> Review["管理端复核<br/>退回、补正、通过、阻断"]
  Review --> Reason["异常说明模板<br/>责任科室、补证材料、口径依据"]
  Reason --> Direct["直报系统回执<br/>回执编号、接收端截图"]
  Direct --> Audit["platformProcessAudit<br/>复核动作、时间戳、复核人"]
  Audit --> Report["治理报表<br/>月报、差异清单、绩效说明"]
```

## 5. 上线验收与现场联调流程

```mermaid
flowchart TB
  Dev["代码侧完成<br/>UI、API、seed、测试、报告"] --> Check["npm.cmd run check<br/>npm.cmd test"]
  Check --> Readiness["hospital-operations:readiness<br/>运行监测准备度"]
  Readiness --> Release["hospital-operations:release<br/>接口、调度、对账、上线检查"]
  Release --> Module["hospital-operations:module-report<br/>能力、流程图、开发报告"]
  Module --> Manifest["release:manifest<br/>发布包清单"]
  Manifest --> Deploy["deploy:check<br/>上线前门禁"]
  Deploy --> Joint["现场联调<br/>真实报文、验签日志、回放记录"]
  Joint --> Cutover["割接签收<br/>阻断项关闭、回退策略确认"]
  Cutover --> Observe["上线观察<br/>T+0/T+1 证据归档"]
  Observe --> Run["试运行/上线运行<br/>监控值守和持续复盘"]
```

## 6. 现场交付边界

| 边界 | 代码侧已完成 | 现场仍需完成 |
|---|---|---|
| 数据接入 | 签名接入 API、状态规范化、演示数据集合 | 真实 HIS/住院、HR、设备、急诊、统计直报报文 |
| 资源调度 | 调度工单、跨院资源池、急诊拥堵闭环 | 跨院协议、转运责任、接收医院签收、120 回执 |
| 对账复核 | 差异批次、复核动作、异常说明、审计留痕 | 直报系统回执、补正材料、统计办公室签收 |
| 上线运行 | 加固清单、割接签收、上线后观察、发布证据 | 正式密钥、统一身份、监控/SIEM、灾备演练、现场签字 |
