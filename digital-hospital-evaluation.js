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
  return [runDigitalHospitalPreAssessment({ institutionId: "MR1", institutionName: "大连市中心医院", profileId: PILOT_PROFILES[0].id }, { role: "commission", name: "试点评价规则引擎" }, { id: "dhpa-mr1-pilot", now: "2026-07-17T03:00:00.000Z" })];
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

function buildDigitalHospitalPilotBoard(data = {}, user = {}, filters = {}) {
  const requestedInstitution = String(filters.institutionId || "").trim();
  const scopedInstitution = user.role === "institution" ? String(user.orgCode || "") : requestedInstitution;
  const jobs = (Array.isArray(data.digitalHospitalCollectionJobs) ? data.digitalHospitalCollectionJobs : seedDigitalHospitalCollectionJobs())
    .filter((item) => !scopedInstitution || item.institutionId === scopedInstitution);
  const evidence = (Array.isArray(data.digitalHospitalEvaluationEvidence) ? data.digitalHospitalEvaluationEvidence : seedDigitalHospitalEvaluationEvidence())
    .filter((item) => !scopedInstitution || item.institutionId === scopedInstitution);
  const preAssessments = (Array.isArray(data.digitalHospitalPreAssessments) ? data.digitalHospitalPreAssessments : seedDigitalHospitalPreAssessments())
    .filter((item) => !scopedInstitution || item.institutionId === scopedInstitution);
  const checks = [
    { id: "pilot:catalog", passed: EVALUATION_PACKS.length === 4 && EVALUATION_PROJECTS.length === 70 && STANDARD_CLAUSES.length === 70, detail: `${EVALUATION_PACKS.length} packs / ${EVALUATION_PROJECTS.length} projects / ${STANDARD_CLAUSES.length} clauses` },
    { id: "pilot:emrProjects", passed: EVALUATION_PROJECTS.filter((item) => item.packId === "emr").length === 39, detail: "39 EMR evaluation projects" },
    { id: "pilot:smartServiceProjects", passed: EVALUATION_PROJECTS.filter((item) => item.packId === "smart-service").length === 17, detail: "17 smart service projects" },
    { id: "pilot:smartManagementDimensions", passed: EVALUATION_PROJECTS.filter((item) => item.packId === "smart-management").length === 10, detail: "10 smart management dimensions" },
    { id: "pilot:interoperabilityDimensions", passed: EVALUATION_PROJECTS.filter((item) => item.packId === "interoperability").length === 4, detail: "4 interoperability dimensions" },
    { id: "pilot:collectionAdapters", passed: jobs.length >= 6 && jobs.every((item) => item.status === "validated" && item.noPatientPii === true && item.receiptRef), detail: `${jobs.filter((item) => item.status === "validated").length}/${jobs.length} controlled adapters validated` },
    { id: "pilot:evidenceBoundary", passed: evidence.length >= 6 && evidence.every((item) => item.noPatientPii === true), detail: `${evidence.length} evidence records with no-patient-PII boundary` },
    { id: "pilot:preAssessment", passed: preAssessments.length >= 1 && preAssessments.every((item) => item.results?.length === 4 && item.formalResult === false), detail: `${preAssessments.length} four-pack pilot simulations` },
    { id: "pilot:rectification", passed: preAssessments.some((item) => item.findings?.length > 0 && item.findings.every((finding) => Array.isArray(finding.history))), detail: `${preAssessments.reduce((sum, item) => sum + (item.findings?.length || 0), 0)} traceable findings` }
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
      openFindings: preAssessments.reduce((sum, item) => sum + (item.findings || []).filter((finding) => finding.status !== "resolved").length, 0)
    },
    checks,
    jobs,
    evidence,
    preAssessments,
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
  calculatePackResult,
  normalizeDigitalHospitalCollectionJobAction,
  normalizeDigitalHospitalEvaluationEvidenceAction,
  normalizeDigitalHospitalPreAssessmentAction,
  runDigitalHospitalPreAssessment,
  seedDigitalHospitalCollectionJobs,
  seedDigitalHospitalEvaluationEvidence,
  seedDigitalHospitalPreAssessments,
  seedPilotResponses
};
