const { getActiveRegionalRuntime, regionalOrganization } = require("./src/platform/regional/active-region");

const HIGHLIGHT_CAPABILITIES = [
  {
    id: "trigger-engine",
    name: "多点触发监测预警",
    shortName: "监测预警",
    description: "汇聚临床、实验室、药店、学校、环境和公众信号，按规则形成可解释预警。",
    owner: "疾控中心/平台技术组",
    sources: ["临床症候群", "实验室", "药店", "学校/养老", "环境", "公众上报"]
  },
  {
    id: "gis-command-map",
    name: "GIS公共卫生一张图",
    shortName: "一张图",
    description: "将区域、机构、信号、预警、队伍和资源放进同一个事件态势视图。",
    owner: "卫健管理部门/应急办",
    sources: ["区域", "机构", "事件", "资源"]
  },
  {
    id: "ai-investigation-assistant",
    name: "AI流调研判助手",
    shortName: "AI研判",
    description: "基于证据生成线索摘要、关联关系和建议动作，人工确认后才进入处置流程。",
    owner: "疾控中心/流调专班",
    sources: ["信号证据", "规则命中", "关联事件", "人工复核"]
  },
  {
    id: "emergency-command-dispatch",
    name: "应急指挥与资源调度",
    shortName: "应急调度",
    description: "从预警直接派发跨机构任务，锁定责任人、时限、资源和闭环回执。",
    owner: "应急办/卫健管理部门",
    sources: ["处置任务", "值守队伍", "物资资源", "升级路径"]
  },
  {
    id: "evidence-cockpit",
    name: "数据质量与证据链驾驶舱",
    shortName: "证据驾驶舱",
    description: "按来源、规则、动作和审计记录追溯每个指标，持续显示演示就绪与现场证据边界。",
    owner: "项目办/安全管理岗",
    sources: ["来源追溯", "质量校验", "审计链", "现场材料"]
  }
];

const SOURCE_TYPES = ["临床症候群", "实验室", "药店", "学校/养老", "环境", "公众上报"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function seedPublicHealthTriggerRules() {
  return [
    {
      id: "phhr-rule-fever-cluster",
      name: "发热门诊呼吸道病例聚集",
      sourceType: "临床症候群",
      metric: "fever-respiratory-cases",
      threshold: 5,
      windowHours: 24,
      severity: "high",
      enabled: true,
      actionTemplate: "24小时内完成病例核实、采样和流调派单"
    },
    {
      id: "phhr-rule-lab-positive",
      name: "实验室阳性结果聚集",
      sourceType: "实验室",
      metric: "same-pathogen-positive",
      threshold: 3,
      windowHours: 48,
      severity: "critical",
      enabled: true,
      actionTemplate: "锁定阳性样本、复核检验质量并启动关联病例核查"
    },
    {
      id: "phhr-rule-pharmacy-surge",
      name: "药店对症药品异常增长",
      sourceType: "药店",
      metric: "antipyretic-sales-index",
      threshold: 130,
      windowHours: 24,
      severity: "medium",
      enabled: true,
      actionTemplate: "核验销售异常来源并与医疗机构症候群信号交叉分析"
    },
    {
      id: "phhr-rule-school-cluster",
      name: "学校/养老机构聚集性症状",
      sourceType: "学校/养老",
      metric: "clustered-symptoms",
      threshold: 4,
      windowHours: 24,
      severity: "high",
      enabled: true,
      actionTemplate: "派发机构核实任务并同步健康提示和重点人员名单"
    },
    {
      id: "phhr-rule-public-report",
      name: "公众异常健康事件上报",
      sourceType: "公众上报",
      metric: "verified-public-report",
      threshold: 2,
      windowHours: 72,
      severity: "medium",
      enabled: true,
      actionTemplate: "人工核验公众线索，必要时转入事件处置"
    }
  ];
}

function seedPublicHealthSignals() {
  const regionalValues = getActiveRegionalRuntime().values;
  const centralHospital = regionalOrganization("centralHospital");
  const communityHealthCenter = regionalOrganization("communityHealthCenter");
  const districtHospital = regionalOrganization("districtHospital");
  const primaryDistrict = regionalValues.area("primaryDistrict").name;
  const secondaryDistrict = regionalValues.area("secondaryDistrict").name;
  const tertiaryDistrict = regionalValues.area("tertiaryDistrict").name;
  const laboratoryDistrict = regionalValues.area("laboratoryDistrict").name;
  const peripheralDistrict = regionalValues.area("peripheralDistrict").name;
  return [
    {
      id: "phsig-fever-001",
      ruleId: "phhr-rule-fever-cluster",
      sourceType: "临床症候群",
      sourceSystem: "市级医院EMR/发热门诊",
      metric: "fever-respiratory-cases",
      value: 8,
      baseline: 3,
      unit: "例/24小时",
      region: primaryDistrict,
      institution: centralHospital.name,
      observedAt: "2026-07-17T07:40:00+08:00",
      location: { x: 48, y: 32 },
      qualityStatus: "verified",
      status: "evaluated",
      evidenceRefs: ["EMR-FEVER-20260717-001", "LIS-RESP-20260717-004"]
    },
    {
      id: "phsig-fever-002",
      ruleId: "phhr-rule-fever-cluster",
      sourceType: "临床症候群",
      sourceSystem: "社区门诊症候群上报",
      metric: "fever-respiratory-cases",
      value: 6,
      baseline: 2,
      unit: "例/24小时",
      region: primaryDistrict,
      institution: communityHealthCenter.name,
      observedAt: "2026-07-17T08:05:00+08:00",
      location: { x: 54, y: 38 },
      qualityStatus: "verified",
      status: "evaluated",
      evidenceRefs: ["PRIMARY-RESP-20260717-012"]
    },
    {
      id: "phsig-lab-001",
      ruleId: "phhr-rule-lab-positive",
      sourceType: "实验室",
      sourceSystem: "区域LIS阳性结果回传",
      metric: "same-pathogen-positive",
      value: 4,
      baseline: 1,
      unit: "例/48小时",
      region: laboratoryDistrict,
      institution: districtHospital.name,
      observedAt: "2026-07-17T06:55:00+08:00",
      location: { x: 65, y: 53 },
      qualityStatus: "verified",
      status: "evaluated",
      evidenceRefs: ["LIS-POS-20260717-008", "LIS-POS-20260717-009"]
    },
    {
      id: "phsig-pharmacy-001",
      ruleId: "phhr-rule-pharmacy-surge",
      sourceType: "药店",
      sourceSystem: "零售药店销售监测",
      metric: "antipyretic-sales-index",
      value: 162,
      baseline: 100,
      unit: "指数",
      region: secondaryDistrict,
      institution: "区域药店哨点集群",
      observedAt: "2026-07-17T08:10:00+08:00",
      location: { x: 37, y: 44 },
      qualityStatus: "received",
      status: "evaluated",
      evidenceRefs: ["PHARMACY-DAILY-20260717-01"]
    },
    {
      id: "phsig-school-001",
      ruleId: "phhr-rule-school-cluster",
      sourceType: "学校/养老",
      sourceSystem: "学校晨检上报",
      metric: "clustered-symptoms",
      value: 7,
      baseline: 1,
      unit: "人/24小时",
      region: tertiaryDistrict,
      institution: `${tertiaryDistrict}实验小学`,
      observedAt: "2026-07-17T07:15:00+08:00",
      location: { x: 45, y: 58 },
      qualityStatus: "verified",
      status: "evaluated",
      evidenceRefs: ["SCHOOL-MORNING-20260717-021"]
    },
    {
      id: "phsig-public-001",
      ruleId: "phhr-rule-public-report",
      sourceType: "公众上报",
      sourceSystem: "居民健康事件上报",
      metric: "verified-public-report",
      value: 2,
      baseline: 0,
      unit: "条/72小时",
      region: peripheralDistrict,
      institution: "居民线索核验队列",
      observedAt: "2026-07-16T19:30:00+08:00",
      location: { x: 22, y: 72 },
      qualityStatus: "manual-review",
      status: "evaluated",
      evidenceRefs: ["CITIZEN-REPORT-20260716-004", "CITIZEN-REPORT-20260716-006"]
    }
  ];
}

function seedPublicHealthAlerts() {
  const regionalValues = getActiveRegionalRuntime().values;
  const primaryDistrict = regionalValues.area("primaryDistrict").name;
  const secondaryDistrict = regionalValues.area("secondaryDistrict").name;
  const tertiaryDistrict = regionalValues.area("tertiaryDistrict").name;
  const laboratoryDistrict = regionalValues.area("laboratoryDistrict").name;
  return [
    {
      id: "phalert-fever-zhongshan",
      ruleId: "phhr-rule-fever-cluster",
      title: `${primaryDistrict}呼吸道症候群聚集预警`,
      severity: "high",
      status: "open",
      region: primaryDistrict,
      sourceTypes: ["临床症候群"],
      signalIds: ["phsig-fever-001", "phsig-fever-002"],
      triggerCount: 14,
      threshold: 5,
      confidence: 0.91,
      createdAt: "2026-07-17T08:12:00+08:00",
      evidenceRefs: ["EMR-FEVER-20260717-001", "PRIMARY-RESP-20260717-012"],
      recommendedAction: "24小时内完成病例核实、采样和流调派单",
      actionHistory: []
    },
    {
      id: "phalert-lab-ganjingzi",
      ruleId: "phhr-rule-lab-positive",
      title: `${laboratoryDistrict}实验室阳性结果聚集预警`,
      severity: "critical",
      status: "acknowledged",
      region: laboratoryDistrict,
      sourceTypes: ["实验室"],
      signalIds: ["phsig-lab-001"],
      triggerCount: 4,
      threshold: 3,
      confidence: 0.96,
      createdAt: "2026-07-17T07:10:00+08:00",
      evidenceRefs: ["LIS-POS-20260717-008", "LIS-POS-20260717-009"],
      recommendedAction: "锁定阳性样本、复核检验质量并启动关联病例核查",
      actionHistory: [{ action: "acknowledge", actor: "疾控值守员", at: "2026-07-17T07:22:00+08:00", note: "已接收并启动实验室复核" }]
    },
    {
      id: "phalert-pharmacy-xigang",
      ruleId: "phhr-rule-pharmacy-surge",
      title: `${secondaryDistrict}对症药品销售异常增长`,
      severity: "medium",
      status: "investigating",
      region: secondaryDistrict,
      sourceTypes: ["药店"],
      signalIds: ["phsig-pharmacy-001"],
      triggerCount: 162,
      threshold: 130,
      confidence: 0.78,
      createdAt: "2026-07-17T08:14:00+08:00",
      evidenceRefs: ["PHARMACY-DAILY-20260717-01"],
      recommendedAction: "核验销售异常来源并与医疗机构症候群信号交叉分析",
      actionHistory: []
    },
    {
      id: "phalert-school-shahekou",
      ruleId: "phhr-rule-school-cluster",
      title: `${tertiaryDistrict}学校聚集性症状预警`,
      severity: "high",
      status: "dispatched",
      region: tertiaryDistrict,
      sourceTypes: ["学校/养老"],
      signalIds: ["phsig-school-001"],
      triggerCount: 7,
      threshold: 4,
      confidence: 0.87,
      createdAt: "2026-07-17T07:28:00+08:00",
      evidenceRefs: ["SCHOOL-MORNING-20260717-021"],
      recommendedAction: "派发机构核实任务并同步健康提示和重点人员名单",
      actionHistory: [{ action: "dispatch", actor: "应急值守员", at: "2026-07-17T07:45:00+08:00", note: "已派发学校核实与健康提示任务" }]
    }
  ];
}

function seedPublicHealthCommandTasks() {
  const regionalValues = getActiveRegionalRuntime().values;
  const centralHospital = regionalOrganization("centralHospital");
  const communityHealthCenter = regionalOrganization("communityHealthCenter");
  const primaryDistrict = regionalValues.area("primaryDistrict").name;
  const secondaryDistrict = regionalValues.area("secondaryDistrict").name;
  const tertiaryDistrict = regionalValues.area("tertiaryDistrict").name;
  const laboratoryDistrict = regionalValues.area("laboratoryDistrict").name;
  return [
    {
      id: "phcmd-task-fever-investigation",
      alertId: "phalert-fever-zhongshan",
      title: `${primaryDistrict}呼吸道聚集事件核实与流调`,
      stage: "investigation",
      status: "pending-acceptance",
      priority: "high",
      owner: `${primaryDistrict}疾控流调一组`,
      institution: `${centralHospital.name}/${communityHealthCenter.name}`,
      region: primaryDistrict,
      dueAt: "2026-07-18T08:12:00+08:00",
      requiredActions: ["病例清单核对", "采样复核", "密接线索登记"],
      resourceIds: ["phres-team-cdc-1", "phres-lab-rapid"],
      evidenceRefs: ["phalert-fever-zhongshan"],
      actionHistory: []
    },
    {
      id: "phcmd-task-lab-review",
      alertId: "phalert-lab-ganjingzi",
      title: `${laboratoryDistrict}阳性样本实验室质量复核`,
      stage: "laboratory-review",
      status: "in-progress",
      priority: "critical",
      owner: "市疾控实验室质量组",
      institution: regionalOrganization("districtHospital").name,
      region: laboratoryDistrict,
      dueAt: "2026-07-17T19:10:00+08:00",
      requiredActions: ["样本链核对", "复检", "关联病例核查"],
      resourceIds: ["phres-lab-rapid", "phres-ppe-stock"],
      evidenceRefs: ["phalert-lab-ganjingzi"],
      actionHistory: [{ action: "accept", actor: "实验室质量组", at: "2026-07-17T07:24:00+08:00", note: "已接单" }]
    },
    {
      id: "phcmd-task-pharmacy-correlation",
      alertId: "phalert-pharmacy-xigang",
      title: `${secondaryDistrict}药店异常销售交叉分析`,
      stage: "correlation",
      status: "pending-acceptance",
      priority: "medium",
      owner: "市疾控监测分析组",
      institution: `${secondaryDistrict}市场监测哨点`,
      region: secondaryDistrict,
      dueAt: "2026-07-18T08:14:00+08:00",
      requiredActions: ["销售数据质量复核", "医院症候群比对", "形成研判意见"],
      resourceIds: ["phres-analysis-1"],
      evidenceRefs: ["phalert-pharmacy-xigang"],
      actionHistory: []
    },
    {
      id: "phcmd-task-school-health",
      alertId: "phalert-school-shahekou",
      title: `${tertiaryDistrict}学校健康提示和重点人员随访`,
      stage: "institution-response",
      status: "in-progress",
      priority: "high",
      owner: `${tertiaryDistrict}卫健局联络员`,
      institution: `${tertiaryDistrict}实验小学`,
      region: tertiaryDistrict,
      dueAt: "2026-07-17T18:00:00+08:00",
      requiredActions: ["机构核实", "家长健康提示", "重点人员随访回执"],
      resourceIds: ["phres-team-primary-2", "phres-ppe-stock"],
      evidenceRefs: ["phalert-school-shahekou"],
      actionHistory: [{ action: "dispatch", actor: "应急值守员", at: "2026-07-17T07:45:00+08:00", note: "已派发基层协同任务" }]
    }
  ];
}

function seedPublicHealthResources() {
  const regionalValues = getActiveRegionalRuntime().values;
  const primaryDistrict = regionalValues.area("primaryDistrict").name;
  const tertiaryDistrict = regionalValues.area("tertiaryDistrict").name;
  const laboratoryDistrict = regionalValues.area("laboratoryDistrict").name;
  return [
    { id: "phres-team-cdc-1", type: "流调队伍", name: "市疾控流调一组", region: primaryDistrict, capacity: 8, available: 5, unit: "人", status: "available", lastUpdatedAt: "2026-07-17T08:00:00+08:00" },
    { id: "phres-team-primary-2", type: "基层协同队伍", name: `${tertiaryDistrict}基层公卫队`, region: tertiaryDistrict, capacity: 6, available: 4, unit: "人", status: "available", lastUpdatedAt: "2026-07-17T07:50:00+08:00" },
    { id: "phres-lab-rapid", type: "实验室能力", name: "区域快速复检能力", region: laboratoryDistrict, capacity: 30, available: 18, unit: "样本/日", status: "available", lastUpdatedAt: "2026-07-17T07:35:00+08:00" },
    { id: "phres-ppe-stock", type: "防护物资", name: "应急防护物资储备", region: "市级储备库", capacity: 1000, available: 760, unit: "套", status: "available", lastUpdatedAt: "2026-07-17T06:30:00+08:00" },
    { id: "phres-analysis-1", type: "分析席位", name: "监测分析席位", region: "市疾控中心", capacity: 10, available: 7, unit: "席", status: "available", lastUpdatedAt: "2026-07-17T08:05:00+08:00" }
  ];
}

function seedPublicHealthAiReviews() {
  const regionalValues = getActiveRegionalRuntime().values;
  const primaryDistrict = regionalValues.area("primaryDistrict").name;
  const laboratoryDistrict = regionalValues.area("laboratoryDistrict").name;
  return [
    {
      id: "phai-review-fever-zhongshan",
      alertId: "phalert-fever-zhongshan",
      title: `建议优先核查${primaryDistrict}医疗机构间的共同暴露线索`,
      status: "pending-review",
      confidence: 0.88,
      modelVersion: "ph-risk-assist-demo-1.0",
      generatedAt: "2026-07-17T08:18:00+08:00",
      summary: "两个机构在24小时窗口内同时超过症候群基线，建议先核对就诊时间、居住地和共同场所。",
      reasoning: ["两个机构信号时间窗口重叠", "触发值为规则阈值的2.8倍", "两条信号均已通过来源校验"],
      recommendedActions: ["生成病例核查表", "按机构分派流调任务", "保留人工复核意见"],
      evidenceRefs: ["EMR-FEVER-20260717-001", "PRIMARY-RESP-20260717-012"],
      humanApprovalRequired: true,
      reviewHistory: []
    },
    {
      id: "phai-review-lab-ganjingzi",
      alertId: "phalert-lab-ganjingzi",
      title: `建议对${laboratoryDistrict}阳性样本执行复检和样本链核验`,
      status: "approved",
      confidence: 0.94,
      modelVersion: "ph-risk-assist-demo-1.0",
      generatedAt: "2026-07-17T07:16:00+08:00",
      summary: "同一时间窗出现4例阳性结果，超过3例阈值，优先确认样本链和实验室质量。",
      reasoning: ["阳性结果数量超过阈值", "样本证据引用完整", "已有人工值守员接收预警"],
      recommendedActions: ["锁定样本", "复检", "关联病例核查"],
      evidenceRefs: ["LIS-POS-20260717-008", "LIS-POS-20260717-009"],
      humanApprovalRequired: true,
      approvedBy: "市疾控实验室质量组",
      approvedAt: "2026-07-17T07:25:00+08:00",
      reviewHistory: [{ action: "approve", actor: "市疾控实验室质量组", at: "2026-07-17T07:25:00+08:00", note: "建议与样本复核任务一致" }]
    }
  ];
}

function seedPublicHealthEvidenceRecords() {
  return [
    { id: "phec-source-lineage", domain: "source-lineage", name: "多源信号来源可追溯", sourceCollection: "publicHealthSignals", expected: 6, observed: 6, status: "verified", owner: "平台技术组", evidenceRefs: ["source-system", "observedAt", "evidenceRefs"] },
    { id: "phec-rule-evaluation", domain: "rule-evaluation", name: "预警规则命中可解释", sourceCollection: "publicHealthTriggerRules", expected: 5, observed: 5, status: "verified", owner: "疾控监测组", evidenceRefs: ["threshold", "windowHours", "signalIds"] },
    { id: "phec-alert-action", domain: "alert-action", name: "预警动作闭环可回放", sourceCollection: "publicHealthAlerts", expected: 4, observed: 4, status: "recorded", owner: "应急办", evidenceRefs: ["actionHistory", "status", "recommendedAction"] },
    { id: "phec-command-dispatch", domain: "command-dispatch", name: "任务责任人与时限已配置", sourceCollection: "publicHealthCommandTasks", expected: 4, observed: 4, status: "recorded", owner: "项目办", evidenceRefs: ["owner", "dueAt", "resourceIds"] },
    { id: "phec-resource-inventory", domain: "resource-inventory", name: "资源可用量可追踪", sourceCollection: "publicHealthResources", expected: 5, observed: 5, status: "verified", owner: "应急物资保障组", evidenceRefs: ["capacity", "available", "lastUpdatedAt"] },
    { id: "phec-ai-human-review", domain: "ai-human-review", name: "AI建议具备人工确认边界", sourceCollection: "publicHealthAiReviews", expected: 2, observed: 2, status: "verified", owner: "疾控研判组", evidenceRefs: ["modelVersion", "evidenceRefs", "humanApprovalRequired"] },
    { id: "phec-audit-chain", domain: "audit-chain", name: "五件套动作写入安全审计", sourceCollection: "securityEvents", expected: 1, observed: 1, status: "recorded", owner: "安全管理岗", evidenceRefs: ["actor", "target", "action", "detail"] },
    { id: "phec-site-boundary", domain: "site-boundary", name: "正式上线现场材料边界明确", sourceCollection: "publicHealthReadinessEvidence", expected: 1, observed: 1, status: "verified", owner: "项目办", evidenceRefs: ["functionalState", "formalGoLiveState"] }
  ];
}

function mergeRows(seed, current) {
  const map = new Map((Array.isArray(seed) ? seed : []).map((item) => [item.id, clone(item)]));
  (Array.isArray(current) ? current : []).forEach((item) => {
    if (!item?.id) return;
    map.set(item.id, { ...(map.get(item.id) || {}), ...item });
  });
  return [...map.values()];
}

function openStatus(status) {
  return !/closed|resolved|complete|verified|已关闭|已完成|已核验/i.test(String(status || ""));
}

function scoreEvidence(records) {
  const rows = Array.isArray(records) ? records : [];
  const verified = rows.filter((item) => /verified|已核验|signed|已签署/i.test(String(item.status || ""))).length;
  const recorded = rows.filter((item) => /verified|recorded|已核验|已记录|signed|已签署/i.test(String(item.status || ""))).length;
  return {
    total: rows.length,
    verified,
    recorded,
    pending: rows.length - recorded,
    score: rows.length ? Math.round((recorded / rows.length) * 100) : 0,
    status: rows.length && recorded === rows.length ? "evidence-ready" : "evidence-pending"
  };
}

function buildMapBoard(signals, alerts, tasks, resources) {
  const nodes = [];
  const signalById = new Map((Array.isArray(signals) ? signals : []).map((item) => [item.id, item]));
  (Array.isArray(signals) ? signals : []).forEach((signal) => nodes.push({
    id: signal.id,
    type: "signal",
    label: signal.sourceType,
    region: signal.region,
    institution: signal.institution,
    status: signal.qualityStatus,
    value: signal.value,
    unit: signal.unit,
    location: signal.location || { x: 50, y: 50 }
  }));
  (Array.isArray(alerts) ? alerts : []).forEach((alert) => nodes.push({
    id: alert.id,
    type: "alert",
    label: alert.title,
    region: alert.region,
    status: alert.status,
    severity: alert.severity,
    location: alert.location || signalById.get(alert.signalIds?.[0])?.location || { x: 50, y: 50 }
  }));
  const regionNames = [...new Set(nodes.map((item) => item.region).filter(Boolean))];
  return {
    projection: `schematic-${getActiveRegionalRuntime().context.regionCode}-regional-grid`,
    legend: ["signal", "alert", "resource", "task"],
    regions: regionNames.map((region, index) => ({ id: `region-${index + 1}`, name: region, signalCount: nodes.filter((item) => item.region === region && item.type === "signal").length, alertCount: nodes.filter((item) => item.region === region && item.type === "alert").length })),
    nodes,
    resourceSummary: (Array.isArray(resources) ? resources : []).map((item) => ({ id: item.id, name: item.name, region: item.region, available: item.available, unit: item.unit, status: item.status })),
    taskSummary: (Array.isArray(tasks) ? tasks : []).map((item) => ({ id: item.id, region: item.region, status: item.status, dueAt: item.dueAt }))
  };
}

function buildPublicHealthHighlights({ data = {} } = {}) {
  const triggerRules = mergeRows(seedPublicHealthTriggerRules(), data.publicHealthTriggerRules);
  const signals = mergeRows(seedPublicHealthSignals(), data.publicHealthSignals);
  const alerts = mergeRows(seedPublicHealthAlerts(), data.publicHealthAlerts);
  const commandTasks = mergeRows(seedPublicHealthCommandTasks(), data.publicHealthCommandTasks);
  const resources = mergeRows(seedPublicHealthResources(), data.publicHealthResources);
  const aiReviews = mergeRows(seedPublicHealthAiReviews(), data.publicHealthAiReviews);
  const evidenceRecords = mergeRows(seedPublicHealthEvidenceRecords(), data.publicHealthEvidenceRecords);
  const activeAlerts = alerts.filter((item) => openStatus(item.status));
  const evidence = scoreEvidence(evidenceRecords);
  const quality = {
    verifiedSignals: signals.filter((item) => item.qualityStatus === "verified").length,
    reviewSignals: signals.filter((item) => /review|pending/i.test(String(item.qualityStatus || ""))).length,
    ruleCoverage: triggerRules.filter((item) => item.enabled && item.threshold > 0).length,
    sourceTypes: [...new Set(signals.map((item) => item.sourceType))]
  };
  const command = {
    tasks: commandTasks,
    openTasks: commandTasks.filter((item) => openStatus(item.status)),
    resources,
    readyResources: resources.filter((item) => item.status === "available" && Number(item.available) > 0),
    escalationQueue: commandTasks.filter((item) => item.priority === "critical" || item.status === "escalated")
  };
  return {
    ok: true,
    generatedAt: nowIso(),
    functionalState: "five-suite-runnable",
    formalGoLiveState: "blocked-until-site-evidence-signed",
    capabilities: clone(HIGHLIGHT_CAPABILITIES),
    summary: {
      capabilities: HIGHLIGHT_CAPABILITIES.length,
      rules: triggerRules.length,
      signals: signals.length,
      sourceTypes: quality.sourceTypes.length,
      activeAlerts: activeAlerts.length,
      criticalAlerts: activeAlerts.filter((item) => item.severity === "critical").length,
      openTasks: command.openTasks.length,
      resources: resources.length,
      readyResources: command.readyResources.length,
      aiReviews: aiReviews.length,
      aiPendingReviews: aiReviews.filter((item) => item.status === "pending-review").length,
      evidenceScore: evidence.score,
      evidenceVerified: evidence.verified,
      evidencePending: evidence.pending,
      auditEvents: Array.isArray(data.securityEvents) ? data.securityEvents.filter((item) => String(item.action || "").includes("public-health-highlight")).length : 0
    },
    triggerCenter: { rules: triggerRules, signals, alerts: activeAlerts, quality },
    mapBoard: buildMapBoard(signals, activeAlerts, commandTasks, resources),
    aiCenter: {
      reviews: aiReviews,
      modelCard: {
        modelVersion: "ph-risk-assist-demo-1.0",
        purpose: "公共卫生线索摘要、关联和动作建议",
        humanApprovalRequired: true,
        forbiddenUses: ["自动发布疫情信息", "替代人工流调结论", "自动升级重大事件"]
      }
    },
    commandCenter: command,
    evidenceCenter: { records: evidenceRecords, summary: evidence, quality, auditPolicy: "五件套动作必须保留操作者、时间、对象、动作和证据引用" }
  };
}

function normalizedAction(item, payload, user, allowedActions, statusMap, name) {
  const action = String(payload?.action || "").trim();
  if (!allowedActions.includes(action)) throw new Error(`${name} action must be one of ${allowedActions.join(", ")}`);
  const at = nowIso();
  const history = {
    id: `${item.id}-${action}-${Date.now()}`,
    action,
    actor: user?.name || user?.username || "commission",
    role: user?.role || "commission",
    at,
    note: String(payload?.note || "").trim(),
    evidenceRefs: Array.isArray(payload?.evidenceRefs) ? payload.evidenceRefs.slice(0, 12) : []
  };
  return {
    item: {
      ...item,
      status: statusMap[action] || item.status,
      lastAction: history,
      actionHistory: [history, ...(Array.isArray(item.actionHistory) ? item.actionHistory : [])].slice(0, 20),
      updatedAt: at,
      updatedBy: history.actor
    },
    history
  };
}

function normalizePublicHealthHighlightAlertAction(alert, payload = {}, user = {}) {
  return normalizedAction(alert, payload, user, ["acknowledge", "investigate", "dispatch", "escalate", "close", "reopen"], {
    acknowledge: "acknowledged",
    investigate: "investigating",
    dispatch: "dispatched",
    escalate: "escalated",
    close: "closed",
    reopen: "open"
  }, "alert");
}

function normalizePublicHealthCommandTaskAction(task, payload = {}, user = {}) {
  return normalizedAction(task, payload, user, ["accept", "dispatch", "complete", "escalate", "reopen"], {
    accept: "in-progress",
    dispatch: "dispatched",
    complete: "completed",
    escalate: "escalated",
    reopen: "pending-acceptance"
  }, "command task");
}

function normalizePublicHealthAiReviewAction(review, payload = {}, user = {}) {
  const action = String(payload.action || "").trim();
  if (!["approve", "reject", "request-more-evidence"].includes(action)) throw new Error("AI review action must be approve, reject or request-more-evidence");
  const at = nowIso();
  const history = { id: `${review.id}-${action}-${Date.now()}`, action, actor: user.name || user.username || "commission", role: user.role || "commission", at, note: String(payload.note || "").trim(), evidenceRefs: Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.slice(0, 12) : [] };
  return {
    item: {
      ...review,
      status: action === "approve" ? "approved" : action === "reject" ? "rejected" : "evidence-requested",
      approvedBy: action === "approve" ? history.actor : review.approvedBy,
      approvedAt: action === "approve" ? at : review.approvedAt,
      lastAction: history,
      reviewHistory: [history, ...(Array.isArray(review.reviewHistory) ? review.reviewHistory : [])].slice(0, 20)
    },
    history
  };
}

function normalizePublicHealthEvidenceAction(record, payload = {}, user = {}) {
  const action = String(payload.action || "").trim();
  if (!["record", "verify", "reopen"].includes(action)) throw new Error("evidence action must be record, verify or reopen");
  const at = nowIso();
  const history = { id: `${record.id}-${action}-${Date.now()}`, action, actor: user.name || user.username || "commission", role: user.role || "commission", at, note: String(payload.note || "").trim(), artifactName: String(payload.artifactName || "").trim() };
  return {
    item: {
      ...record,
      status: action === "verify" ? "verified" : action === "record" ? "recorded" : "pending",
      artifactName: history.artifactName || record.artifactName || "",
      lastAction: history,
      actionHistory: [history, ...(Array.isArray(record.actionHistory) ? record.actionHistory : [])].slice(0, 20)
    },
    history
  };
}

function normalizePublicHealthSignal(payload = {}, user = {}) {
  const sourceType = String(payload.sourceType || "").trim();
  if (!SOURCE_TYPES.includes(sourceType)) throw new Error(`sourceType must be one of ${SOURCE_TYPES.join(", ")}`);
  const value = Number(payload.value);
  if (!Number.isFinite(value) || value < 0) throw new Error("value must be a non-negative number");
  const signal = {
    id: String(payload.id || `phsig-${Date.now()}`).trim(),
    ruleId: String(payload.ruleId || "").trim(),
    sourceType,
    sourceSystem: String(payload.sourceSystem || "人工上报").trim(),
    metric: String(payload.metric || "manual-signal").trim(),
    value,
    baseline: Number.isFinite(Number(payload.baseline)) ? Number(payload.baseline) : 0,
    unit: String(payload.unit || "条").trim(),
    region: String(payload.region || "未分区").trim(),
    institution: String(payload.institution || "待核实机构").trim(),
    observedAt: String(payload.observedAt || nowIso()).trim(),
    location: { x: Math.max(5, Math.min(95, Number(payload.x) || 50)), y: Math.max(5, Math.min(90, Number(payload.y) || 50)) },
    qualityStatus: "manual-review",
    status: "received",
    evidenceRefs: Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.slice(0, 12) : [],
    createdAt: nowIso(),
    createdBy: user.name || user.username || "commission"
  };
  return signal;
}

module.exports = {
  HIGHLIGHT_CAPABILITIES,
  SOURCE_TYPES,
  buildPublicHealthHighlights,
  normalizePublicHealthAiReviewAction,
  normalizePublicHealthCommandTaskAction,
  normalizePublicHealthEvidenceAction,
  normalizePublicHealthHighlightAlertAction,
  normalizePublicHealthSignal,
  scoreEvidence,
  seedPublicHealthAiReviews,
  seedPublicHealthAlerts,
  seedPublicHealthCommandTasks,
  seedPublicHealthEvidenceRecords,
  seedPublicHealthResources,
  seedPublicHealthSignals,
  seedPublicHealthTriggerRules
};
