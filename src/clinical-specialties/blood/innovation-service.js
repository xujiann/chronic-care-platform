const { randomUUID } = require("node:crypto");
const { regionalOrganization } = require("../../platform/regional/active-region");

const capabilities = [
  ["digital-twin", "一袋血全生命周期数字孪生", "BOTH"],
  ["safety-gates", "全流程安全门禁", "BOTH"],
  ["dual-center", "血液中心与用血机构双中心协同", "BOTH"],
  ["inventory-map", "区域库存一张图", "BOTH"],
  ["recall-linkage", "报告撤回与血液召回联动", "BOTH"],
  ["reaction-trace", "输血反应反向追溯与风险信号", "BOTH"],
  ["quality-evidence", "质量管理证据链", "BOTH"],
  ["supply-forecast", "供需预测与智能调度", "BIS"],
  ["donor-recruitment", "精准献血者招募", "BIS"],
  ["rational-use", "临床合理用血辅助", "BTIS"],
  ["pda-bedside", "PDA床旁闭环", "BTIS"],
  ["emergency-command", "区域应急用血指挥中心", "BOTH"],
  ["compliance-check", "标准符合性自动检查", "BOTH"]
].map(([id, name, side], index) => ({ id, name, side, order: index + 1, status: "implemented" }));

function seed() {
  return {
    bloodInnovationEvents: [],
    bloodPdaSessions: [],
    bloodRecruitmentCampaigns: [],
    bloodClinicalDecisions: [],
    bloodForecastRuns: [],
    bloodComplianceRuns: []
  };
}

function normalize(data) {
  const initial = seed();
  Object.keys(initial).forEach((key) => { data[key] = Array.isArray(data[key]) ? data[key] : initial[key]; });
  return data;
}

function visible(user, side) {
  return side === "BOTH" || (user.role === "commission" ? side === "BIS" : side === "BTIS");
}

function inventoryNodes(data) {
  const bloodCenter = regionalOrganization("bloodCenter");
  const centralHospital = regionalOrganization("centralHospital");
  const units = Array.isArray(data.bloodUnits) ? data.bloodUnits : [];
  const shipments = Array.isArray(data.bloodShipments) ? data.bloodShipments : [];
  const codes = new Set(["BLOOD-DL", "MR1", ...units.map((x) => x.hospitalCode || x.institutionCode), ...shipments.map((x) => x.destinationInstitution)].filter(Boolean));
  return [...codes].map((code) => {
    const rows = units.filter((x) => (x.hospitalCode || x.institutionCode) === code && !["discarded", "transfused", "recalled"].includes(x.status));
    return {
      institutionCode: code,
      institutionName: code === "BLOOD-DL" || code === bloodCenter.code
        ? bloodCenter.name
        : code === "MR1" || code === centralHospital.code ? centralHospital.name : code,
      role: code === "BLOOD-DL" ? "blood_center" : "medical_institution",
      available: rows.length,
      inTransit: shipments.filter((x) => x.destinationInstitution === code && !["received", "cancelled"].includes(x.status)).length,
      alert: rows.length < 2 ? "low" : "normal",
      bloodTypes: Object.fromEntries([...new Set(rows.map((x) => x.bloodType))].map((type) => [type, rows.filter((x) => x.bloodType === type).length]))
    };
  });
}

function twin(data, code) {
  const unit = (data.bloodUnits || []).find((x) => [x.id, x.donationCode].includes(code)) || (data.bloodUnits || [])[0];
  if (!unit) return null;
  const requestIds = (data.compatibilityTests || []).filter((x) => x.bloodUnitId === unit.id).map((x) => x.requestId);
  const events = [
    ...(data.bloodAuditEvents || []).filter((x) => x.entityId === unit.id || x.entityId === unit.donationCode),
    ...(data.bloodShipments || []).filter((x) => (x.bloodUnitIds || []).includes(unit.id)).map((x) => ({ at: x.createdAt, action: "shipment", detail: `${x.sourceInstitution || "BLOOD-DL"} → ${x.destinationInstitution}`, actor: x.createdBy || "system" })),
    ...(data.compatibilityTests || []).filter((x) => x.bloodUnitId === unit.id).map((x) => ({ at: x.createdAt, action: "compatibility", detail: x.compatible === false ? "不相容" : "相容", actor: x.reviewedBy || "BTIS" })),
    ...(data.transfusionEpisodes || []).filter((x) => x.bloodUnitId === unit.id || requestIds.includes(x.requestId)).map((x) => ({ at: x.startedAt, action: "transfusion", detail: x.status, actor: x.startedBy || "PDA" }))
  ].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  return { unit, events, integrity: events.length ? "complete" : "seeded", currentCustodian: unit.hospitalCode || unit.institutionCode };
}

function riskSignals(data) {
  const signals = [];
  (data.transfusionReactions || []).filter((x) => x.status !== "closed").forEach((x) => signals.push({ id: `reaction-${x.id}`, level: x.severity === "严重" ? "critical" : "high", type: "transfusion_reaction", subjectId: x.id, message: `输血反应待闭环：${x.patientId}`, bloodUnitIds: x.bloodUnitIds || [] }));
  (data.bloodRecalls || []).filter((x) => x.status !== "closed").forEach((x) => signals.push({ id: `recall-${x.id}`, level: "critical", type: "recall", subjectId: x.id, message: "召回血液仍有机构未确认", bloodUnitIds: x.bloodUnitIds || [] }));
  (data.bloodSafetyIncidents || []).filter((x) => !["closed", "released", "discarded"].includes(x.status)).forEach((x) => signals.push({ id: `incident-${x.id}`, level: "high", type: "cold_chain", subjectId: x.id, message: "冷链异常待质控处置", bloodUnitIds: x.bloodUnitIds || [x.bloodUnitId].filter(Boolean) }));
  return signals;
}

function forecast(data, horizonDays = 7) {
  const nodes = inventoryNodes(data);
  const requests = data.transfusionRequests || [];
  const types = [...new Set(["A Rh+", "B Rh+", "O Rh+", "AB Rh+", ...(data.bloodUnits || []).map((x) => x.bloodType)])];
  return types.map((bloodType) => {
    const available = nodes.reduce((n, x) => n + Number(x.bloodTypes[bloodType] || 0), 0);
    const demand = requests.filter((x) => x.bloodType === bloodType && !["cancelled", "completed"].includes(x.status)).length;
    const predictedDemand = Math.max(demand, Math.ceil((demand || 1) * horizonDays / 3));
    return { bloodType, horizonDays, available, predictedDemand, gap: available - predictedDemand, recommendation: available < predictedDemand ? "启动招募并预调拨" : "维持动态监测" };
  });
}

function rationalUse(payload) {
  const hb = Number(payload.hemoglobin);
  const amount = Number(payload.amount || 0);
  const flags = [];
  if (!payload.indication) flags.push("缺少临床输血指征");
  if (!payload.consentSigned && payload.urgency !== "抢救") flags.push("知情同意未完成");
  if (payload.component === "悬浮红细胞" && Number.isFinite(hb) && hb >= 100) flags.push("Hb不支持常规红细胞输注，请复核");
  if (amount > 4 && payload.urgency !== "抢救") flags.push("单次申请量超过4U，需上级审核");
  return { decision: flags.length ? "review_required" : "supported", flags, rules: ["临床指征完整性", "知情同意", "限制性输血阈值", "大剂量分级审核"] };
}

function compliance(data) {
  const checks = [
    ["唯一标识", (data.bloodUnits || []).every((x) => x.id && x.donationCode)],
    ["检测报告签发", (data.bloodUnits || []).every((x) => x.status === "testing" || x.testReportSigned !== false)],
    ["双人放行", (data.bloodUnits || []).every((x) => !["released", "allocated", "in_transit", "hospital_received", "transfused"].includes(x.status) || x.dualReview)],
    ["冷链证据", (data.bloodShipments || []).every((x) => x.temperatureOk !== false || (data.bloodSafetyIncidents || []).some((i) => i.shipmentId === x.id))],
    ["召回机构确认", (data.bloodRecalls || []).every((x) => x.status === "closed" || (x.affectedInstitutions || []).length === (x.acknowledgements || []).length)],
    ["床旁身份核对", (data.transfusionEpisodes || []).every((x) => x.patientMatched !== false && x.bloodUnitMatched !== false)],
    ["不良反应闭环", (data.transfusionReactions || []).every((x) => ["closed", "reported", "investigating"].includes(x.status))]
  ].map(([name, ok]) => ({ name, ok: Boolean(ok), evidence: ok ? "系统记录满足" : "存在待补证据" }));
  return { passed: checks.filter((x) => x.ok).length, total: checks.length, ok: checks.every((x) => x.ok), checks };
}

function dashboard(data, user, code = "") {
  normalize(data);
  const scopedCapabilities = capabilities.filter((x) => visible(user, x.side));
  const nodes = inventoryNodes(data).filter((x) => user.role === "commission" || x.institutionCode === user.orgCode || x.institutionCode === "BLOOD-DL");
  const signals = riskSignals(data).filter((x) => user.role === "commission" || !(x.type === "recall") || (data.bloodRecalls || []).some((r) => r.id === x.subjectId && (r.affectedInstitutions || []).includes(user.orgCode)));
  return {
    capabilities: scopedCapabilities,
    summary: { implemented: scopedCapabilities.length, total: scopedCapabilities.length, institutions: nodes.length, openRisks: signals.length },
    digitalTwin: twin(data, code), inventoryNodes: nodes, riskSignals: signals,
    qualityEvidence: (data.bloodAuditEvents || []).slice(0, 100), forecast: forecast(data),
    recruitmentCampaigns: user.role === "commission" ? data.bloodRecruitmentCampaigns.slice(0, 50) : [],
    clinicalDecisions: user.role === "institution" ? data.bloodClinicalDecisions.filter((x) => x.institutionCode === user.orgCode).slice(0, 50) : [],
    pdaSessions: user.role === "institution" ? data.bloodPdaSessions.filter((x) => x.institutionCode === user.orgCode).slice(0, 50) : data.bloodPdaSessions.slice(0, 50),
    emergencyAllocations: (data.emergencyBloodAllocations || []).filter((x) => user.role === "commission" || x.requestedBy === user.orgCode || x.destinationInstitution === user.orgCode),
    compliance: compliance(data)
  };
}

function appendEvent(data, user, capabilityId, action, subjectId, detail) {
  const event = { id: `bie-${randomUUID()}`, capabilityId, action, subjectId, detail, actor: user.name || user.username, orgCode: user.orgCode, at: new Date().toISOString() };
  data.bloodInnovationEvents = [event, ...data.bloodInnovationEvents].slice(0, 2000);
  data.bloodAuditEvents = [event, ...(data.bloodAuditEvents || [])].slice(0, 2000);
  return event;
}

function execute(data, user, capabilityId, payload = {}) {
  normalize(data);
  const capability = capabilities.find((x) => x.id === capabilityId);
  if (!capability) return { status: 404, body: { error: "Not Found", message: "未知创新能力" } };
  if (!visible(user, capability.side)) return { status: 403, body: { error: "Forbidden", message: "当前岗位无权执行该能力" } };
  const now = new Date().toISOString();
  let result;
  if (capabilityId === "supply-forecast") {
    result = { id: `forecast-${randomUUID()}`, createdAt: now, horizonDays: Number(payload.horizonDays || 7), rows: forecast(data, Number(payload.horizonDays || 7)) };
    data.bloodForecastRuns.unshift(result);
  } else if (capabilityId === "donor-recruitment") {
    const gaps = forecast(data).filter((x) => x.gap < 0);
    result = { id: `campaign-${randomUUID()}`, status: "draft", targetBloodTypes: payload.targetBloodTypes || gaps.map((x) => x.bloodType), channels: payload.channels || ["短信", "微信服务号"], audience: payload.audience || "近24个月合格且当前可献血者", createdAt: now, institutionCode: user.orgCode };
    data.bloodRecruitmentCampaigns.unshift(result);
  } else if (capabilityId === "rational-use") {
    result = { id: `decision-${randomUUID()}`, ...rationalUse(payload), requestId: payload.requestId || "", institutionCode: user.orgCode, createdAt: now };
    data.bloodClinicalDecisions.unshift(result);
  } else if (capabilityId === "pda-bedside") {
    const checks = { patient: Boolean(payload.patientCode), order: Boolean(payload.requestId), bloodUnit: Boolean(payload.bloodUnitCode), operator: Boolean(payload.operatorId) };
    result = { id: `pda-${randomUUID()}`, institutionCode: user.orgCode, checks, status: Object.values(checks).every(Boolean) ? "verified" : "blocked", scannerId: payload.scannerId || "PDA", createdAt: now, ...payload };
    data.bloodPdaSessions.unshift(result);
  } else if (capabilityId === "compliance-check") {
    result = { id: `compliance-${randomUUID()}`, ...compliance(data), createdAt: now };
    data.bloodComplianceRuns.unshift(result);
  } else {
    result = dashboard(data, user, payload.code || "")[capabilityId === "digital-twin" ? "digitalTwin" : capabilityId === "inventory-map" ? "inventoryNodes" : capabilityId === "reaction-trace" ? "riskSignals" : capabilityId === "quality-evidence" ? "qualityEvidence" : capabilityId === "emergency-command" ? "emergencyAllocations" : "capabilities"];
  }
  const event = appendEvent(data, user, capabilityId, "execute", result?.id || payload.code || capabilityId, `执行${capability.name}`);
  return { status: 200, body: { capability, result, evidence: event } };
}

module.exports = { capabilities, seed, normalize, inventoryNodes, twin, riskSignals, forecast, rationalUse, compliance, dashboard, execute };
