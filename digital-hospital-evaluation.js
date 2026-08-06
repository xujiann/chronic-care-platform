const { createHash, randomUUID } = require("node:crypto");

const EVALUATION_PACKS = [
  { id: "emr", name: "电子病历应用水平", levelScale: [0, 1, 2, 3, 4, 5, 6, 7, 8], pilotTarget: 4, sourceId: "dhp-emr-leveling-2018" },
  { id: "smart-service", name: "医院智慧服务", levelScale: [0, 1, 2, 3, 4, 5], pilotTarget: 3, sourceId: "dhp-smart-service-2019" },
  { id: "smart-management", name: "医院智慧管理", levelScale: [0, 1, 2, 3, 4, 5], pilotTarget: 2, sourceId: "dhp-smart-management-2021" },
  { id: "interoperability", name: "医院互联互通成熟度", levelScale: ["1", "2", "3", "4B", "4A", "5B", "5A"], pilotTarget: "4A", sourceId: "dhp-interoperability-2020" }
];

const EMR_ROLE_PROJECTS = [
  ["病房医师", ["住院病历结构化", "医嘱全流程处理", "检验检查申请", "病情记录连续性", "出院管理闭环"]],
  ["门诊医师", ["门诊病历结构化", "门诊处方闭环", "门诊检验检查", "复诊连续管理"]],
  ["护理人员", ["护理记录", "医嘱执行", "生命体征采集", "护理评估", "床旁闭环核对"]],
  ["检验人员", ["检验申请接收", "标本采集流转", "检验结果审核", "检验危急值闭环"]],
  ["检查人员", ["检查预约", "检查执行", "检查报告审核", "检查危急值闭环"]],
  ["药事人员", ["处方医嘱审核", "调剂发药", "合理用药监测", "药品使用追溯"]],
  ["手术麻醉人员", ["手术申请与排程", "麻醉记录", "手术安全核查"]],
  ["临床用血人员", ["用血申请", "配血发血", "床旁输注记录"]],
  ["病案管理人员", ["病历归档", "病历质量控制", "病案首页与编码"]],
  ["医疗管理人员", ["临床路径", "医疗质量指标", "临床决策支持", "跨机构信息共享"]]
];

const SMART_SERVICE_PROJECTS = [
  ["诊前服务", "智能导诊与分诊"], ["诊前服务", "预约诊疗"], ["诊前服务", "急救衔接"],
  ["诊中服务", "就诊信息推送"], ["诊中服务", "院内标识与导航"], ["诊中服务", "患者便利保障"],
  ["诊后服务", "患者反馈与评价"], ["诊后服务", "院外患者管理"], ["诊后服务", "基层医师指导"],
  ["全程服务", "费用支付与退费"], ["全程服务", "健康宣教"], ["全程服务", "远程医疗"],
  ["全程服务", "转诊服务"], ["全程服务", "药品配送"], ["全程服务", "检查检验结果服务"],
  ["基础与安全", "患者身份与授权"], ["基础与安全", "服务安全与运行保障"]
];

const SMART_MANAGEMENT_DIMENSIONS = [
  "医疗护理管理", "人力资源管理", "财务资产管理", "设备设施管理", "药品耗材管理",
  "运营管理", "运行保障管理", "教学科研管理", "办公管理", "基础与安全"
];

const INTEROPERABILITY_DIMENSIONS = [
  ["数据资源标准化", "数据集、共享文档、数据元和值域符合性"],
  ["互联互通标准化", "医院信息平台交互服务、接口契约与交易测试"],
  ["基础设施建设", "平台架构、集成设施、安全和运行保障"],
  ["互联互通应用效果", "临床共享、业务协同、患者服务和管理应用"]
];

function makeProject(packId, code, category, title, index, options = {}) {
  const minLevel = options.minLevel ?? Math.min(options.maxLevel || 5, Math.max(1, Math.floor(index / (options.levelSpan || 5)) + 1));
  return {
    id: `${packId}-${code}`,
    packId,
    code,
    category,
    title,
    minLevel,
    itemType: options.itemType || (index % 4 === 3 ? "optional" : "basic"),
    requiredEvidence: options.requiredEvidence || ["功能配置", "脱敏业务样例", "应用范围统计", "数据质量报告"],
    evidenceBoundary: "只登记受控引用、摘要和摘要哈希，不集中采集患者可识别信息",
    sourceId: EVALUATION_PACKS.find((item) => item.id === packId)?.sourceId || ""
  };
}

function buildEvaluationProjects() {
  const projects = [];
  let emrIndex = 0;
  EMR_ROLE_PROJECTS.forEach(([role, titles], roleIndex) => {
    titles.forEach((title, itemIndex) => {
      emrIndex += 1;
      projects.push(makeProject("emr", `P${String(emrIndex).padStart(2, "0")}`, role, title, emrIndex - 1, {
        maxLevel: 8,
        levelSpan: 5,
        itemType: itemIndex < Math.min(3, titles.length) ? "basic" : "optional"
      }));
    });
  });
  SMART_SERVICE_PROJECTS.forEach(([category, title], index) => {
    projects.push(makeProject("smart-service", `S${String(index + 1).padStart(2, "0")}`, category, title, index, { maxLevel: 5, levelSpan: 4 }));
  });
  SMART_MANAGEMENT_DIMENSIONS.forEach((title, index) => {
    projects.push(makeProject("smart-management", `M${String(index + 1).padStart(2, "0")}`, title, `${title}业务联动与决策支持`, index, { maxLevel: 5, levelSpan: 2 }));
  });
  INTEROPERABILITY_DIMENSIONS.forEach(([category, title], index) => {
    projects.push(makeProject("interoperability", `I${String(index + 1).padStart(2, "0")}`, category, title, index, {
      minLevel: index + 1,
      itemType: "basic",
      requiredEvidence: ["标准符合性测试", "应用效果材料", "专家文审材料", "现场查验记录"]
    }));
  });
  return projects;
}

const EVALUATION_PROJECTS = buildEvaluationProjects();
const STANDARD_CLAUSES = EVALUATION_PROJECTS.map((project) => ({
  id: `clause-${project.id}`,
  documentId: project.sourceId,
  evaluationPackId: project.packId,
  projectId: project.id,
  clauseCode: project.code,
  title: project.title,
  category: project.category,
  applicability: "按医院类型、启用业务和申报目标等级判定",
  ruleVersion: "2026.pilot.1",
  effectiveState: "current-reference",
  evidenceRequirements: project.requiredEvidence
}));

const PILOT_PROFILES = [
  {
    id: "profile-tertiary-general-pilot",
    name: "三级综合医院首批试点",
    hospitalType: "三级综合医院",
    targets: { emr: 4, "smart-service": 3, "smart-management": 2, interoperability: "4A" },
    requiredSystems: ["HIS", "EMR", "LIS", "PACS", "HRP", "支付平台"],
    evidenceMode: "controlled-deidentified-sample",
    formalResultBoundary: "平台输出为建设预评和差距分析，不替代国家或省级正式评价结论"
  }
];

const CONNECTOR_TEMPLATES = [
  ["his", "HIS", "his-patient-v1", ["患者主索引", "就诊", "医嘱", "费用"]],
  ["emr", "EMR", "emr-summary-v1", ["病历", "诊断", "医嘱闭环", "病历质控"]],
  ["lis", "LIS", "lis-report-v1", ["检验申请", "标本", "报告", "危急值"]],
  ["pacs", "PACS", "pacs-report-v1", ["检查申请", "影像索引", "报告", "危急值"]],
  ["hrp", "HRP", "hospital-management-metrics-v1", ["人力", "财务", "资产", "运营指标"]],
  ["payment", "支付平台", "payment-transaction-v1", ["支付", "退费", "对账", "回执"]]
];

function seedDigitalHospitalCollectionJobs() {
  return CONNECTOR_TEMPLATES.map(([id, system, contractId, scopes], index) => ({
    id: `dhcj-${id}`,
    institutionId: "MR1",
    system,
    contractId,
    scopes,
    mode: "controlled-deidentified-sample",
    status: "validated",
    noPatientPii: true,
    sampleSize: 120 + index * 10,
    validRows: 118 + index * 10,
    lastRunAt: "2026-07-17T02:00:00.000Z",
    receiptRef: `PILOT-${system}-RECEIPT-001`,
    nextAction: "现场联调时替换为医院生产只读接口并完成厂商签字"
  }));
}

function seedDigitalHospitalEvaluationEvidence() {
  return [
    ["catalog", "四套评价条款与规则包", "platform", "verified"],
    ["connector", "六类医院系统采集契约", "controlled-sample", "verified"],
    ["quality", "应用范围与数据质量报告", "controlled-sample", "verified"],
    ["transactions", "接口交易与回执样例", "controlled-sample", "verified"],
    ["review", "医院自评、补正和独立审核记录", "platform", "verified"],
    ["site", "真实系统联调与现场签字材料", "site", "site-pending"]
  ].map(([id, title, evidenceLevel, status]) => ({
    id: `dhev-${id}`,
    institutionId: "MR1",
    title,
    evidenceLevel,
    status,
    noPatientPii: true,
    evidenceRef: status === "verified" ? `DH-PILOT-${id.toUpperCase()}-001` : "",
    sha256: status === "verified" ? createHash("sha256").update(`DH-PILOT-${id}-001`).digest("hex") : "",
    formalEvidence: evidenceLevel === "site" && status === "verified"
  }));
}

const PILOT_READINESS_KEYS = ["organizationOwner", "scopedAccounts", "dataBoundary", "collectionPlan", "rollbackPlan", "supportRoster"];
const PILOT_STAGES = ["onboarding", "evidence-preparation", "controlled-pilot", "observation", "completed"];

function seedDigitalHospitalPilotInstitutions() {
  return [
    {
      id: "dhpi-mr1",
      institutionId: "MR1",
      institutionName: "区域中心医院",
      institutionType: "tertiary-general",
      owner: "医院信息中心",
      stage: "controlled-pilot",
      status: "active",
      whitelistEnabled: true,
      noPatientPii: true,
      readiness: Object.fromEntries(PILOT_READINESS_KEYS.map((key) => [key, true])),
      evidenceRefs: ["DH-PILOT-ORG-001", "DH-PILOT-ACCOUNT-001", "DH-PILOT-DATA-001", "DH-PILOT-COLLECT-001", "DH-PILOT-ROLLBACK-001", "DH-PILOT-ROSTER-001"],
      submittedBy: "institution:MR1",
      approvedBy: "commission:pilot-reviewer",
      approvedAt: "2026-07-17T03:00:00.000Z",
      launchWindow: "2026-07-18/2026-08-18",
      history: []
    },
    {
      id: "dhpi-pilot-02",
      institutionId: "PILOT-02",
      institutionName: "第二试点医院（待确认）",
      institutionType: "tertiary-general",
      owner: "待分派",
      stage: "onboarding",
      status: "onboarding",
      whitelistEnabled: false,
      noPatientPii: true,
      readiness: Object.fromEntries(PILOT_READINESS_KEYS.map((key) => [key, false])),
      evidenceRefs: [],
      launchWindow: "待确认",
      history: []
    }
  ];
}

function createDigitalHospitalPilotInstitution(payload = {}, user = {}, options = {}) {
  if (user.role !== "commission") {
    const error = new Error("only commission can register a pilot institution");
    error.status = 403;
    throw error;
  }
  const institutionId = String(payload.institutionId || "").trim();
  const institutionName = String(payload.institutionName || "").trim();
  const owner = String(payload.owner || "").trim();
  if (!institutionId || !institutionName || !owner) throw new Error("institutionId, institutionName and owner are required");
  const now = options.now || new Date().toISOString();
  return {
    id: options.id || `dhpi-${randomUUID()}`,
    institutionId,
    institutionName,
    institutionType: String(payload.institutionType || "tertiary-general"),
    owner,
    stage: "onboarding",
    status: "onboarding",
    whitelistEnabled: false,
    noPatientPii: true,
    readiness: Object.fromEntries(PILOT_READINESS_KEYS.map((key) => [key, false])),
    evidenceRefs: [],
    launchWindow: String(payload.launchWindow || "待确认"),
    createdAt: now,
    createdBy: actorKey(user),
    history: [{ action: "register", at: now, actor: actorKey(user), note: String(payload.note || "登记试点机构") }]
  };
}

function normalizeDigitalHospitalPilotInstitutionAction(item = {}, payload = {}, user = {}, options = {}) {
  const action = String(payload.action || "").trim();
  const allowed = new Set(["submit-readiness", "approve-pilot", "pause-pilot", "resume-pilot", "advance-stage", "record-daily-review"]);
  if (!allowed.has(action)) throw new Error("unsupported pilot institution action");
  if (user.role === "institution" && user.orgCode !== item.institutionId) {
    const error = new Error("institution account cannot update another pilot institution");
    error.status = 403;
    throw error;
  }
  const commissionOnly = new Set(["approve-pilot", "pause-pilot", "resume-pilot", "advance-stage"]);
  if (commissionOnly.has(action) && user.role !== "commission") {
    const error = new Error("only commission can change pilot operating state");
    error.status = 403;
    throw error;
  }
  const note = String(payload.note || "").trim();
  if (note.length < 4) throw new Error("note must contain at least 4 characters");
  const now = options.now || new Date().toISOString();
  const next = { ...item, readiness: { ...(item.readiness || {}) }, evidenceRefs: [...(item.evidenceRefs || [])], history: [...(item.history || [])] };
  if (action === "submit-readiness") {
    if (payload.noPatientPii !== true) throw new Error("noPatientPii=true is required");
    const readiness = payload.readiness && typeof payload.readiness === "object" ? payload.readiness : {};
    const evidenceRefs = [...new Set((Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : []).map(String).filter(Boolean))];
    if (!PILOT_READINESS_KEYS.every((key) => readiness[key] === true) || evidenceRefs.length < 3) throw new Error("all readiness checks and at least three evidence references are required");
    next.readiness = Object.fromEntries(PILOT_READINESS_KEYS.map((key) => [key, true]));
    next.evidenceRefs = [...new Set([...next.evidenceRefs, ...evidenceRefs])];
    next.status = "ready-for-review";
    next.stage = "evidence-preparation";
    next.noPatientPii = true;
    next.submittedBy = actorKey(user);
    next.submittedAt = now;
  } else if (action === "approve-pilot") {
    if (next.status !== "ready-for-review") {
      const error = new Error("pilot readiness must be submitted before approval");
      error.status = 409;
      throw error;
    }
    if (next.submittedBy === actorKey(user)) {
      const error = new Error("independent pilot approver is required");
      error.status = 409;
      throw error;
    }
    next.status = "active";
    next.stage = "controlled-pilot";
    next.whitelistEnabled = true;
    next.approvedBy = actorKey(user);
    next.approvedAt = now;
  } else if (action === "pause-pilot") {
    if (next.status !== "active") throw Object.assign(new Error("only an active pilot can be paused"), { status: 409 });
    next.status = "paused";
    next.whitelistEnabled = false;
  } else if (action === "resume-pilot") {
    if (next.status !== "paused") throw Object.assign(new Error("only a paused pilot can be resumed"), { status: 409 });
    next.status = "active";
    next.whitelistEnabled = true;
  } else if (action === "advance-stage") {
    if (next.status !== "active") throw Object.assign(new Error("only an active pilot can advance"), { status: 409 });
    const currentIndex = PILOT_STAGES.indexOf(next.stage);
    if (currentIndex < 2 || currentIndex >= PILOT_STAGES.length - 1) throw Object.assign(new Error("pilot stage cannot advance"), { status: 409 });
    const clearanceRef = String(payload.p0ClearanceRef || "").trim();
    if (!clearanceRef) throw new Error("p0ClearanceRef is required");
    next.evidenceRefs = [...new Set([...next.evidenceRefs, clearanceRef])];
    next.stage = PILOT_STAGES[currentIndex + 1];
    if (next.stage === "completed") {
      next.status = "completed";
      next.whitelistEnabled = false;
    }
  } else {
    if (payload.noPatientPii !== true) throw new Error("noPatientPii=true is required");
    const dailyReportRef = String(payload.dailyReportRef || "").trim();
    if (!dailyReportRef) throw new Error("dailyReportRef is required");
    next.evidenceRefs = [...new Set([...next.evidenceRefs, dailyReportRef])];
    next.lastDailyReview = { at: now, actor: actorKey(user), dailyReportRef, note };
  }
  next.updatedAt = now;
  next.history.unshift({ action, at: now, actor: actorKey(user), note, status: next.status, stage: next.stage });
  return next;
}

function seedDigitalHospitalPilotIssues() {
  return [
    {
      id: "dhissue-mr1-interface-receipt",
      institutionId: "MR1",
      institutionName: "区域中心医院",
      title: "接口回执抽样证据待补齐",
      severity: "P0",
      category: "interface-evidence",
      owner: "医院信息中心",
      dueAt: "2026-07-25",
      status: "in-progress",
      noPatientPii: true,
      evidenceRefs: [],
      history: []
    },
    {
      id: "dhissue-pilot02-owner",
      institutionId: "PILOT-02",
      institutionName: "第二试点医院（待确认）",
      title: "试点责任人和支持排班待确认",
      severity: "P1",
      category: "pilot-governance",
      owner: "待分派",
      dueAt: "2026-07-30",
      status: "open",
      noPatientPii: true,
      evidenceRefs: [],
      history: []
    }
  ];
}

function assertPilotIssueScope(item, user) {
  if (!["commission", "institution"].includes(user.role)) throw Object.assign(new Error("current role cannot operate pilot issues"), { status: 403 });
  if (user.role === "institution" && String(user.orgCode || "") !== item.institutionId) throw Object.assign(new Error("institution account cannot operate another institution issue"), { status: 403 });
}

function createDigitalHospitalPilotIssue(payload = {}, user = {}, options = {}) {
  if (!["commission", "institution"].includes(user.role)) throw Object.assign(new Error("current role cannot create pilot issues"), { status: 403 });
  const institutionId = String(payload.institutionId || (user.role === "institution" ? user.orgCode : "") || "").trim();
  if (user.role === "institution" && institutionId !== String(user.orgCode || "")) throw Object.assign(new Error("institution account cannot create another institution issue"), { status: 403 });
  const institutionName = String(payload.institutionName || (user.role === "institution" ? user.orgName : "") || "").trim();
  const title = String(payload.title || "").trim();
  const owner = String(payload.owner || "").trim();
  const dueAt = String(payload.dueAt || "").trim();
  const severity = String(payload.severity || "P1").toUpperCase();
  const note = String(payload.note || "").trim();
  if (!institutionId || !institutionName || !title || !owner || !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) throw new Error("institutionId, institutionName, title, owner and YYYY-MM-DD dueAt are required");
  if (!["P0", "P1", "P2"].includes(severity)) throw new Error("severity must be P0, P1 or P2");
  if (payload.noPatientPii !== true) throw new Error("noPatientPii=true is required");
  if (note.length < 4) throw new Error("note must contain at least 4 characters");
  const at = options.now || new Date().toISOString();
  return {
    id: options.id || `dhissue-${randomUUID()}`,
    institutionId,
    institutionName,
    title,
    severity,
    category: String(payload.category || "pilot-operations").trim(),
    owner,
    dueAt,
    status: "open",
    noPatientPii: true,
    evidenceRefs: [],
    createdAt: at,
    createdBy: actorKey(user),
    history: [{ action: "create", at, actor: actorKey(user), note, status: "open" }]
  };
}

function normalizeDigitalHospitalPilotIssueAction(item = {}, payload = {}, user = {}, options = {}) {
  assertPilotIssueScope(item, user);
  const action = String(payload.action || "").trim();
  if (!["assign", "start-remediation", "record-evidence", "submit-review", "verify-close", "reopen"].includes(action)) throw new Error("unsupported pilot issue action");
  if (["verify-close", "reopen"].includes(action) && user.role !== "commission") throw Object.assign(new Error("only commission can verify or reopen a pilot issue"), { status: 403 });
  const note = String(payload.note || "").trim();
  if (note.length < 4) throw new Error("note must contain at least 4 characters");
  const at = options.now || new Date().toISOString();
  const next = { ...item, evidenceRefs: [...(item.evidenceRefs || [])], history: [...(item.history || [])] };
  if (action === "assign") {
    if (!["open", "reopened", "in-progress"].includes(next.status)) throw Object.assign(new Error("issue cannot be assigned from current status"), { status: 409 });
    const owner = String(payload.owner || "").trim();
    const dueAt = String(payload.dueAt || "").trim();
    if (!owner || !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) throw new Error("owner and YYYY-MM-DD dueAt are required");
    next.owner = owner;
    next.dueAt = dueAt;
    next.status = "in-progress";
  } else if (action === "start-remediation") {
    if (!["open", "reopened", "in-progress"].includes(next.status)) throw Object.assign(new Error("issue cannot start remediation from current status"), { status: 409 });
    next.status = "in-progress";
  } else if (action === "record-evidence") {
    if (!["open", "reopened", "in-progress"].includes(next.status)) throw Object.assign(new Error("issue evidence cannot be changed from current status"), { status: 409 });
    if (payload.noPatientPii !== true) throw new Error("noPatientPii=true is required");
    const evidenceRef = String(payload.evidenceRef || "").trim();
    if (!evidenceRef) throw new Error("evidenceRef is required");
    next.evidenceRefs = [...new Set([...next.evidenceRefs, evidenceRef])];
    next.status = "in-progress";
  } else if (action === "submit-review") {
    if (next.status !== "in-progress") throw Object.assign(new Error("only an in-progress issue can be submitted for review"), { status: 409 });
    if (!next.evidenceRefs.length) throw Object.assign(new Error("at least one evidence reference is required before review"), { status: 409 });
    next.status = "pending-review";
    next.submittedBy = actorKey(user);
    next.submittedAt = at;
  } else if (action === "verify-close") {
    if (next.status !== "pending-review") throw Object.assign(new Error("issue must be pending review before closure"), { status: 409 });
    if (next.submittedBy === actorKey(user)) throw Object.assign(new Error("independent issue reviewer is required"), { status: 409 });
    next.status = "verified-closed";
    next.verifiedBy = actorKey(user);
    next.verifiedAt = at;
  } else {
    if (next.status !== "verified-closed") throw Object.assign(new Error("only a verified closed issue can be reopened"), { status: 409 });
    next.status = "reopened";
    next.reopenedBy = actorKey(user);
    next.reopenedAt = at;
  }
  next.updatedAt = at;
  next.updatedBy = actorKey(user);
  next.history.unshift({ action, at, actor: actorKey(user), note, status: next.status, evidenceRef: String(payload.evidenceRef || "").trim() });
  return next;
}

function normalizeLevel(packId, level) {
  if (packId === "interoperability") return String(level || "1").toUpperCase();
  return Number(level) || 0;
}

function levelIndex(pack, level) {
  return pack.levelScale.map(String).indexOf(String(normalizeLevel(pack.id, level)));
}

function projectRequiredForLevel(project, pack, level) {
  if (pack.id !== "interoperability") return Number(project.minLevel) <= Number(level);
  return Number(project.minLevel) <= Math.max(1, levelIndex(pack, level));
}

function normalizeResponse(response = {}) {
  return {
    projectId: String(response.projectId || "").trim(),
    implemented: response.implemented === true,
    applicationCoverage: Math.max(0, Math.min(100, Number(response.applicationCoverage) || 0)),
    dataQualityIndex: Math.max(0, Math.min(1, Number(response.dataQualityIndex) || 0)),
    evidenceRefs: [...new Set((Array.isArray(response.evidenceRefs) ? response.evidenceRefs : []).map(String).filter(Boolean))],
    noPatientPii: response.noPatientPii === true,
    criticalBlocker: response.criticalBlocker === true,
    note: String(response.note || "").slice(0, 500)
  };
}

function projectPasses(project, response) {
  if (!response || !response.implemented || !response.noPatientPii || response.evidenceRefs.length === 0 || response.criticalBlocker) return false;
  if (project.packId === "emr") {
    const coverageThreshold = project.itemType === "basic" ? 80 : 50;
    return response.applicationCoverage >= coverageThreshold && response.dataQualityIndex >= 0.5;
  }
  if (project.packId === "interoperability") return response.applicationCoverage >= 80 && response.dataQualityIndex >= 0.8;
  return response.applicationCoverage >= 70 && response.dataQualityIndex >= 0.6;
}

function calculatePackResult(packId, responses = [], targetLevel) {
  const pack = EVALUATION_PACKS.find((item) => item.id === packId);
  if (!pack) throw new Error("evaluation pack not found");
  const responseMap = new Map(responses.map(normalizeResponse).map((item) => [item.projectId, item]));
  const levels = pack.levelScale;
  let achievedLevel = levels[0];
  const levelResults = levels.slice(1).map((level) => {
    const required = EVALUATION_PROJECTS.filter((item) => item.packId === packId && projectRequiredForLevel(item, pack, level));
    const basic = required.filter((item) => item.itemType === "basic");
    const optional = required.filter((item) => item.itemType === "optional");
    const passed = required.filter((item) => projectPasses(item, responseMap.get(item.id)));
    const basicPassed = basic.filter((item) => projectPasses(item, responseMap.get(item.id))).length;
    const optionalPassed = optional.filter((item) => projectPasses(item, responseMap.get(item.id))).length;
    const pass = basicPassed === basic.length && (optional.length === 0 || optionalPassed / optional.length >= 0.5);
    if (pass) achievedLevel = level;
    return { level, pass, required: required.length, passed: passed.length, basic: basic.length, basicPassed, optional: optional.length, optionalPassed };
  });
  const normalizedTarget = normalizeLevel(packId, targetLevel ?? pack.pilotTarget);
  const targetProjects = EVALUATION_PROJECTS.filter((item) => item.packId === packId && projectRequiredForLevel(item, pack, normalizedTarget));
  const gaps = targetProjects.filter((project) => !projectPasses(project, responseMap.get(project.id))).map((project) => ({
    projectId: project.id,
    category: project.category,
    title: project.title,
    itemType: project.itemType,
    reason: !responseMap.get(project.id) ? "未填报" : responseMap.get(project.id).criticalBlocker ? "存在关键阻断" : "应用范围、数据质量或证据未达到预评阈值"
  }));
  return {
    packId,
    packName: pack.name,
    targetLevel: normalizedTarget,
    achievedLevel,
    targetMet: levelIndex(pack, achievedLevel) >= levelIndex(pack, normalizedTarget),
    targetProjects: targetProjects.length,
    passedProjects: targetProjects.length - gaps.length,
    gapCount: gaps.length,
    gaps,
    levelResults,
    resultType: "pilot-simulation",
    formalResult: false
  };
}

function seedPilotResponses(institutionId = "MR1") {
  return EVALUATION_PROJECTS.map((project, index) => ({
    institutionId,
    projectId: project.id,
    implemented: index % 9 !== 8,
    applicationCoverage: index % 9 === 8 ? 45 : 88,
    dataQualityIndex: index % 11 === 10 ? 0.48 : 0.86,
    evidenceRefs: [`PILOT-${project.id.toUpperCase()}-001`],
    noPatientPii: true,
    criticalBlocker: false,
    note: "受控试点脱敏样本，用于建设预评，不作为正式测评结论"
  }));
}

function runDigitalHospitalPreAssessment(payload = {}, user = {}, options = {}) {
  const institutionId = String(payload.institutionId || user.orgCode || "").trim();
  const institutionName = String(payload.institutionName || user.orgName || institutionId).trim();
  const profileId = String(payload.profileId || PILOT_PROFILES[0].id).trim();
  const profile = PILOT_PROFILES.find((item) => item.id === profileId);
  if (!institutionId || !profile) throw new Error("institutionId and valid profileId are required");
  if (user.role === "institution" && user.orgCode !== institutionId) {
    const error = new Error("institution account cannot run another institution pre-assessment");
    error.status = 403;
    throw error;
  }
  const responses = Array.isArray(payload.responses) && payload.responses.length ? payload.responses : seedPilotResponses(institutionId);
  const results = EVALUATION_PACKS.map((pack) => calculatePackResult(pack.id, responses, profile.targets[pack.id]));
  const now = options.now || new Date().toISOString();
  const findings = results.flatMap((result) => result.gaps.map((gap) => ({
    id: `dhf-${randomUUID()}`,
    packId: result.packId,
    projectId: gap.projectId,
    title: gap.title,
    category: gap.category,
    severity: gap.itemType === "basic" ? "P0" : "P1",
    status: "open",
    reason: gap.reason,
    assignedTo: "",
    dueAt: "",
    evidenceRefs: [],
    history: []
  })));
  return {
    id: options.id || `dhpa-${randomUUID()}`,
    institutionId,
    institutionName,
    profileId,
    cycle: String(payload.cycle || "2026-pilot").trim(),
    status: "rectification-required",
    resultType: "pilot-simulation",
    formalResult: false,
    responses: responses.map(normalizeResponse),
    results,
    findings,
    summary: {
      packs: results.length,
      targetMet: results.filter((item) => item.targetMet).length,
      gaps: findings.length,
      p0Gaps: findings.filter((item) => item.severity === "P0").length
    },
    generatedAt: now,
    generatedBy: user.name || user.username || user.role || "evaluation engine",
    history: [{ action: "run-preassessment", at: now, actor: user.name || user.username || user.role, note: "生成四体系建设预评和整改清单" }]
  };
}

function actorKey(user = {}) {
  return String(user.id || user.username || `${user.role || "user"}:${user.orgCode || ""}`);
}

function normalizeDigitalHospitalCollectionJobAction(job = {}, payload = {}, user = {}, options = {}) {
  if (String(payload.action || "") !== "run-validation") throw new Error("unsupported collection job action");
  if (user.role === "institution" && user.orgCode !== job.institutionId) {
    const error = new Error("institution account cannot run another institution collection job");
    error.status = 403;
    throw error;
  }
  if (payload.noPatientPii !== true) throw new Error("noPatientPii=true is required");
  const receiptRef = String(payload.receiptRef || "").trim();
  const note = String(payload.note || "").trim();
  const sampleSize = Math.max(1, Number(payload.sampleSize) || 0);
  const validRows = Math.max(0, Math.min(sampleSize, Number(payload.validRows) || 0));
  if (!receiptRef || note.length < 4 || !sampleSize) throw new Error("receiptRef, sampleSize and note are required");
  const now = options.now || new Date().toISOString();
  const event = { action: "run-validation", at: now, actor: actorKey(user), receiptRef, sampleSize, validRows, note };
  return {
    ...job,
    mode: String(payload.mode || job.mode || "controlled-deidentified-sample"),
    status: "validated",
    noPatientPii: true,
    sampleSize,
    validRows,
    dataQualityIndex: Number((validRows / sampleSize).toFixed(4)),
    receiptRef,
    lastRunAt: now,
    latestRun: event,
    history: [event, ...(job.history || [])].slice(0, 30)
  };
}

function normalizeDigitalHospitalEvaluationEvidenceAction(item = {}, payload = {}, user = {}, options = {}) {
  const action = String(payload.action || "").trim();
  if (!["record-evidence", "verify-evidence"].includes(action)) throw new Error("unsupported evaluation evidence action");
  if (user.role === "institution" && user.orgCode !== item.institutionId) {
    const error = new Error("institution account cannot update another institution evidence");
    error.status = 403;
    throw error;
  }
  const note = String(payload.note || "").trim();
  if (note.length < 4) throw new Error("note must contain at least 4 characters");
  const now = options.now || new Date().toISOString();
  const next = { ...item, history: [...(item.history || [])] };
  if (action === "record-evidence") {
    if (payload.noPatientPii !== true) throw new Error("noPatientPii=true is required");
    const evidenceRef = String(payload.evidenceRef || "").trim();
    const evidenceLevel = String(payload.evidenceLevel || item.evidenceLevel || "controlled-sample").trim();
    if (!evidenceRef || !["platform", "controlled-sample", "site"].includes(evidenceLevel)) throw new Error("valid evidenceRef and evidenceLevel are required");
    next.evidenceRef = evidenceRef;
    next.evidenceLevel = evidenceLevel;
    next.sha256 = String(payload.sha256 || createHash("sha256").update(evidenceRef).digest("hex")).trim();
    next.status = "evidence-recorded";
    next.noPatientPii = true;
    next.submittedBy = actorKey(user);
    next.formalEvidence = false;
  } else {
    if (user.role !== "commission") {
      const error = new Error("only commission reviewer can verify evidence");
      error.status = 403;
      throw error;
    }
    if (next.status !== "evidence-recorded" || !next.evidenceRef || !next.sha256) {
      const error = new Error("evidence must be recorded before verification");
      error.status = 409;
      throw error;
    }
    if (next.submittedBy === actorKey(user)) {
      const error = new Error("independent reviewer is required");
      error.status = 409;
      throw error;
    }
    next.status = "verified";
    next.verifiedBy = actorKey(user);
    next.verifiedAt = now;
    next.formalEvidence = next.evidenceLevel === "site";
  }
  const event = { action, at: now, actor: actorKey(user), note, evidenceRef: next.evidenceRef || "" };
  next.history.unshift(event);
  next.updatedAt = now;
  return next;
}

function normalizeDigitalHospitalPreAssessmentAction(assessment = {}, payload = {}, user = {}, options = {}) {
  const action = String(payload.action || "").trim();
  const allowed = new Set(["assign-finding", "record-finding-evidence", "resolve-finding", "submit-review", "accept-preassessment"]);
  if (!allowed.has(action)) throw new Error("unsupported pre-assessment action");
  if (user.role === "institution" && user.orgCode !== assessment.institutionId) {
    const error = new Error("institution account cannot update another institution pre-assessment");
    error.status = 403;
    throw error;
  }
  const now = options.now || new Date().toISOString();
  const next = { ...assessment, findings: (assessment.findings || []).map((item) => ({ ...item, history: [...(item.history || [])], evidenceRefs: [...(item.evidenceRefs || [])] })), history: [...(assessment.history || [])] };
  const note = String(payload.note || "").trim();
  if (note.length < 4) throw new Error("note must contain at least 4 characters");

  if (["assign-finding", "record-finding-evidence", "resolve-finding"].includes(action)) {
    const findingId = String(payload.findingId || "").trim();
    const finding = next.findings.find((item) => item.id === findingId);
    if (!finding) throw new Error("finding not found");
    if (action === "assign-finding") {
      finding.assignedTo = String(payload.assignedTo || "").trim();
      finding.dueAt = String(payload.dueAt || "").trim();
      if (!finding.assignedTo || !/^\d{4}-\d{2}-\d{2}$/.test(finding.dueAt)) throw new Error("assignedTo and dueAt are required");
      finding.status = "in-progress";
    } else {
      if (payload.noPatientPii !== true) throw new Error("noPatientPii=true is required");
      const evidenceRef = String(payload.evidenceRef || "").trim();
      if (!evidenceRef) throw new Error("evidenceRef is required");
      finding.evidenceRefs = [...new Set([...finding.evidenceRefs, evidenceRef])];
      finding.status = action === "resolve-finding" ? "resolved" : "evidence-recorded";
      if (action === "resolve-finding") finding.resolvedBy = actorKey(user);
    }
    const event = { action, at: now, actor: actorKey(user), note };
    finding.history.push(event);
    next.history.push({ ...event, findingId });
  } else if (action === "submit-review") {
    if (next.findings.some((item) => item.status !== "resolved")) {
      const error = new Error("all findings must be resolved before review submission");
      error.status = 409;
      throw error;
    }
    next.status = "submitted-review";
    next.submittedBy = actorKey(user);
    next.history.push({ action, at: now, actor: actorKey(user), note });
  } else {
    if (user.role !== "commission") {
      const error = new Error("only commission reviewer can accept pre-assessment");
      error.status = 403;
      throw error;
    }
    if (next.status !== "submitted-review") {
      const error = new Error("pre-assessment must be submitted for review");
      error.status = 409;
      throw error;
    }
    if (next.submittedBy === actorKey(user)) {
      const error = new Error("independent reviewer is required");
      error.status = 409;
      throw error;
    }
    next.status = "accepted-for-pilot";
    next.review = { reviewedBy: actorKey(user), reviewedAt: now, note, decision: "accepted-for-pilot" };
    next.history.push({ action, at: now, actor: actorKey(user), note });
  }
  next.updatedAt = now;
  return next;
}

function seedDigitalHospitalPreAssessments() {
  return [runDigitalHospitalPreAssessment({ institutionId: "MR1", institutionName: "区域中心医院", profileId: PILOT_PROFILES[0].id }, { role: "commission", name: "试点评价规则引擎" }, { id: "dhpa-mr1-pilot", now: "2026-07-17T03:00:00.000Z" })];
}

function buildDigitalHospitalEvaluationCatalog() {
  const packSummary = EVALUATION_PACKS.map((pack) => ({
    ...pack,
    projects: EVALUATION_PROJECTS.filter((item) => item.packId === pack.id).length,
    clauses: STANDARD_CLAUSES.filter((item) => item.evaluationPackId === pack.id).length
  }));
  return {
    ok: EVALUATION_PROJECTS.length === 70 && STANDARD_CLAUSES.length === 70,
    generatedAt: new Date().toISOString(),
    summary: { packs: EVALUATION_PACKS.length, projects: EVALUATION_PROJECTS.length, clauses: STANDARD_CLAUSES.length, profiles: PILOT_PROFILES.length },
    packs: packSummary,
    projects: EVALUATION_PROJECTS,
    clauses: STANDARD_CLAUSES,
    profiles: PILOT_PROFILES,
    boundary: PILOT_PROFILES[0].formalResultBoundary
  };
}

function buildDigitalHospitalPilotOperations(data = {}, user = {}, filters = {}) {
  const requestedInstitution = String(filters.institutionId || "").trim();
  const scopedInstitution = user.role === "institution" ? String(user.orgCode || "") : requestedInstitution;
  const institutions = (Array.isArray(data.digitalHospitalPilotInstitutions) ? data.digitalHospitalPilotInstitutions : seedDigitalHospitalPilotInstitutions())
    .filter((item) => !scopedInstitution || item.institutionId === scopedInstitution);
  const assessments = Array.isArray(data.digitalHospitalPreAssessments) ? data.digitalHospitalPreAssessments : seedDigitalHospitalPreAssessments();
  const jobs = Array.isArray(data.digitalHospitalCollectionJobs) ? data.digitalHospitalCollectionJobs : seedDigitalHospitalCollectionJobs();
  const evidence = Array.isArray(data.digitalHospitalEvaluationEvidence) ? data.digitalHospitalEvaluationEvidence : seedDigitalHospitalEvaluationEvidence();
  const issues = (Array.isArray(data.digitalHospitalPilotIssues) ? data.digitalHospitalPilotIssues : seedDigitalHospitalPilotIssues())
    .filter((item) => !scopedInstitution || item.institutionId === scopedInstitution);
  const today = String(filters.today || new Date().toISOString().slice(0, 10));
  const rows = institutions.map((institution) => {
    const ownAssessments = assessments.filter((item) => item.institutionId === institution.institutionId);
    const findings = ownAssessments.flatMap((item) => item.findings || []);
    const openFindings = findings.filter((item) => item.status !== "resolved");
    const overdue = openFindings.filter((item) => item.dueAt && item.dueAt < today);
    const ownJobs = jobs.filter((item) => item.institutionId === institution.institutionId);
    const ownEvidence = evidence.filter((item) => item.institutionId === institution.institutionId);
    const ownIssues = issues.filter((item) => item.institutionId === institution.institutionId);
    const openIssues = ownIssues.filter((item) => item.status !== "verified-closed");
    return {
      ...institution,
      operations: {
        preAssessments: ownAssessments.length,
        acceptedAssessments: ownAssessments.filter((item) => item.status === "accepted-for-pilot").length,
        openP0: openFindings.filter((item) => item.severity === "P0").length,
        openP1: openFindings.filter((item) => item.severity === "P1").length,
        overdueP0: overdue.filter((item) => item.severity === "P0").length,
        validatedJobs: ownJobs.filter((item) => item.status === "validated").length,
        totalJobs: ownJobs.length,
        verifiedEvidence: ownEvidence.filter((item) => item.status === "verified").length,
        totalEvidence: ownEvidence.length,
        openIssues: openIssues.length,
        openIssueP0: openIssues.filter((item) => item.severity === "P0").length,
        overdueIssues: openIssues.filter((item) => item.dueAt && item.dueAt < today).length,
        pendingIssueReviews: openIssues.filter((item) => item.status === "pending-review").length
      },
      readinessComplete: PILOT_READINESS_KEYS.every((key) => institution.readiness?.[key] === true)
    };
  });
  return {
    ok: rows.some((item) => item.status === "active" && item.whitelistEnabled) && rows.every((item) => item.noPatientPii === true),
    generatedAt: new Date().toISOString(),
    summary: {
      institutions: rows.length,
      active: rows.filter((item) => item.status === "active").length,
      paused: rows.filter((item) => item.status === "paused").length,
      readyForReview: rows.filter((item) => item.status === "ready-for-review").length,
      onboarding: rows.filter((item) => item.status === "onboarding").length,
      overdueP0: rows.reduce((sum, item) => sum + item.operations.overdueP0, 0),
      whitelistEnabled: rows.filter((item) => item.whitelistEnabled).length,
      openIssues: issues.filter((item) => item.status !== "verified-closed").length,
      overdueIssues: issues.filter((item) => item.status !== "verified-closed" && item.dueAt && item.dueAt < today).length,
      pendingIssueReviews: issues.filter((item) => item.status === "pending-review").length
    },
    institutions: rows,
    issues,
    readinessKeys: PILOT_READINESS_KEYS,
    stages: PILOT_STAGES,
    boundary: "试点白名单和阶段状态不等同于正式评价授权或生产上线签字"
  };
}

function buildDigitalHospitalPilotBoard(data = {}, user = {}, filters = {}) {
  const requestedInstitution = String(filters.institutionId || "").trim();
  const scopedInstitution = user.role === "institution" ? String(user.orgCode || "") : requestedInstitution;
  const jobs = (Array.isArray(data.digitalHospitalCollectionJobs) ? data.digitalHospitalCollectionJobs : seedDigitalHospitalCollectionJobs())
    .filter((item) => !scopedInstitution || item.institutionId === scopedInstitution);
  const evidence = (Array.isArray(data.digitalHospitalEvaluationEvidence) ? data.digitalHospitalEvaluationEvidence : seedDigitalHospitalEvaluationEvidence())
    .filter((item) => !scopedInstitution || item.institutionId === scopedInstitution);
  const preAssessments = (Array.isArray(data.digitalHospitalPreAssessments) ? data.digitalHospitalPreAssessments : seedDigitalHospitalPreAssessments())
    .filter((item) => !scopedInstitution || item.institutionId === scopedInstitution);
  const operations = buildDigitalHospitalPilotOperations(data, user, filters);
  const checks = [
    { id: "pilot:catalog", passed: EVALUATION_PACKS.length === 4 && EVALUATION_PROJECTS.length === 70 && STANDARD_CLAUSES.length === 70, detail: `${EVALUATION_PACKS.length} packs / ${EVALUATION_PROJECTS.length} projects / ${STANDARD_CLAUSES.length} clauses` },
    { id: "pilot:emrProjects", passed: EVALUATION_PROJECTS.filter((item) => item.packId === "emr").length === 39, detail: "39 EMR evaluation projects" },
    { id: "pilot:smartServiceProjects", passed: EVALUATION_PROJECTS.filter((item) => item.packId === "smart-service").length === 17, detail: "17 smart service projects" },
    { id: "pilot:smartManagementDimensions", passed: EVALUATION_PROJECTS.filter((item) => item.packId === "smart-management").length === 10, detail: "10 smart management dimensions" },
    { id: "pilot:interoperabilityDimensions", passed: EVALUATION_PROJECTS.filter((item) => item.packId === "interoperability").length === 4, detail: "4 interoperability dimensions" },
    { id: "pilot:collectionAdapters", passed: jobs.length >= 6 && jobs.every((item) => item.status === "validated" && item.noPatientPii === true && item.receiptRef), detail: `${jobs.filter((item) => item.status === "validated").length}/${jobs.length} controlled adapters validated` },
    { id: "pilot:evidenceBoundary", passed: evidence.length >= 6 && evidence.every((item) => item.noPatientPii === true), detail: `${evidence.length} evidence records with no-patient-PII boundary` },
    { id: "pilot:preAssessment", passed: preAssessments.length >= 1 && preAssessments.every((item) => item.results?.length === 4 && item.formalResult === false), detail: `${preAssessments.length} four-pack pilot simulations` },
    { id: "pilot:rectification", passed: preAssessments.some((item) => item.findings?.length > 0 && item.findings.every((finding) => Array.isArray(finding.history))), detail: `${preAssessments.reduce((sum, item) => sum + (item.findings?.length || 0), 0)} traceable findings` },
    { id: "pilot:operations", passed: operations.ok, detail: `${operations.summary.active} active / ${operations.summary.institutions} pilot institutions / ${operations.summary.overdueP0} overdue P0` },
    { id: "pilot:issueClosure", passed: (user.role === "institution" || operations.issues.length >= 2) && operations.issues.every((item) => item.institutionId && item.owner && item.dueAt && item.noPatientPii === true && Array.isArray(item.history)), detail: `${operations.summary.openIssues} open / ${operations.summary.overdueIssues} overdue / ${operations.summary.pendingIssueReviews} pending review` }
  ];
  const sitePending = evidence.filter((item) => item.status === "site-pending");
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    functionalState: checks.every((item) => item.passed) ? "pilot-launch-ready" : "pilot-blocked",
    formalGoLiveState: sitePending.length === 0 ? "site-evidence-ready-for-formal-review" : "blocked-until-site-evidence-signed",
    summary: {
      packs: EVALUATION_PACKS.length,
      projects: EVALUATION_PROJECTS.length,
      clauses: STANDARD_CLAUSES.length,
      collectionJobs: jobs.length,
      evidenceRecords: evidence.length,
      sitePendingEvidence: sitePending.length,
      preAssessments: preAssessments.length,
      openFindings: preAssessments.reduce((sum, item) => sum + (item.findings || []).filter((finding) => finding.status !== "resolved").length, 0),
      pilotInstitutions: operations.summary.institutions,
      activePilotInstitutions: operations.summary.active,
      overdueP0: operations.summary.overdueP0,
      pilotIssues: operations.issues.length,
      openPilotIssues: operations.summary.openIssues,
      overduePilotIssues: operations.summary.overdueIssues,
      pendingPilotIssueReviews: operations.summary.pendingIssueReviews
    },
    checks,
    jobs,
    evidence,
    preAssessments,
    operations,
    profiles: PILOT_PROFILES,
    siteBlockers: sitePending.map((item) => ({ id: item.id, title: item.title, nextAction: "接入真实医院系统后完成脱敏抽样、厂商确认和现场签字" }))
  };
}

module.exports = {
  EVALUATION_PACKS,
  EVALUATION_PROJECTS,
  PILOT_PROFILES,
  STANDARD_CLAUSES,
  buildDigitalHospitalEvaluationCatalog,
  buildDigitalHospitalPilotBoard,
  buildDigitalHospitalPilotOperations,
  calculatePackResult,
  createDigitalHospitalPilotInstitution,
  createDigitalHospitalPilotIssue,
  normalizeDigitalHospitalCollectionJobAction,
  normalizeDigitalHospitalEvaluationEvidenceAction,
  normalizeDigitalHospitalPreAssessmentAction,
  normalizeDigitalHospitalPilotInstitutionAction,
  normalizeDigitalHospitalPilotIssueAction,
  runDigitalHospitalPreAssessment,
  seedDigitalHospitalCollectionJobs,
  seedDigitalHospitalEvaluationEvidence,
  seedDigitalHospitalPreAssessments,
  seedDigitalHospitalPilotInstitutions,
  seedDigitalHospitalPilotIssues,
  seedPilotResponses
};
