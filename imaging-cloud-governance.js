const { createHash, randomUUID } = require("node:crypto");

const PERFORMANCE_LIMITS = Object.freeze({ firstFrameMs: 5000, seriesLoadMs: 15000, interactionMs: 200 });
const RECOGNITION_STATUSES = new Set(["active", "suspended"]);

function seed() {
  return {
    imagingRecognitionCatalog: [
      ["IMG-RC-CT-CHEST", "CT", "胸部", 14, "dicom-complete", "manual"],
      ["IMG-RC-MR-BRAIN", "MR", "头部", 14, "dicom-complete", "manual"],
      ["IMG-RC-DR-CHEST", "DR", "胸片", 14, "image-quality-passed", "manual"],
      ["IMG-RC-DX-CHEST", "DX", "胸部", 14, "image-quality-passed", "manual"],
      ["IMG-RC-CR-CHEST", "CR", "胸部", 14, "image-quality-passed", "manual"]
    ].map(([id, modality, bodyPart, validDays, qualityRule, recognitionMode]) => ({
      id,
      modality,
      bodyPart,
      validDays,
      qualityRule,
      recognitionMode,
      status: "active",
      policyVersion: "2024.11",
      updatedAt: "",
      updatedBy: ""
    })),
    imagingRecognitionInstitutions: [],
    imagingRecognitionNegativeRules: [
      { id: "IMG-NR-01", code: "clinical-change", title: "病情变化或诊疗需要", status: "active" },
      { id: "IMG-NR-02", code: "expired", title: "超过项目有效时限", status: "active" },
      { id: "IMG-NR-03", code: "quality-not-qualified", title: "影像或报告质控不合格", status: "active" },
      { id: "IMG-NR-04", code: "dicom-incomplete", title: "诊断级 DICOM 序列或完整性校验不合格", status: "active" },
      { id: "IMG-NR-05", code: "emergency-or-major-procedure", title: "急危重症或重大医疗措施前复查", status: "active" },
      { id: "IMG-NR-06", code: "legal-or-appraisal", title: "司法、伤残或其他依法需复查情形", status: "active" }
    ],
    imagingQualityPlans: [
      { id: "IMG-QP-CT", name: "CT 抽样质量计划", modality: "CT", sampleRate: 0.1, scanPassScore: 85, reportPassScore: 85, status: "active" },
      { id: "IMG-QP-DR", name: "基层 DR 全量质量计划", modality: "DR", sampleRate: 1, scanPassScore: 80, reportPassScore: 80, status: "active" }
    ],
    imagingPerformanceEvents: [],
    imagingGovernanceAudit: []
  };
}

function mergeById(defaultRows, currentRows) {
  const current = new Map((Array.isArray(currentRows) ? currentRows : []).filter((item) => item?.id).map((item) => [item.id, item]));
  return defaultRows.map((item) => ({ ...item, ...(current.get(item.id) || {}) }));
}

function ensure(data) {
  const defaults = seed();
  data.imagingRecognitionCatalog = mergeById(defaults.imagingRecognitionCatalog, data.imagingRecognitionCatalog);
  data.imagingRecognitionNegativeRules = mergeById(defaults.imagingRecognitionNegativeRules, data.imagingRecognitionNegativeRules);
  data.imagingQualityPlans = mergeById(defaults.imagingQualityPlans, data.imagingQualityPlans);
  if (!Array.isArray(data.imagingRecognitionInstitutions)) data.imagingRecognitionInstitutions = defaults.imagingRecognitionInstitutions;
  if (!Array.isArray(data.imagingPerformanceEvents)) data.imagingPerformanceEvents = [];
  if (!Array.isArray(data.imagingGovernanceAudit)) data.imagingGovernanceAudit = [];
  return data;
}

function positiveQuality(value) {
  return /通过|passed|qualified/i.test(String(value || ""));
}

function studyAgeDays(study, now = Date.now()) {
  const time = Date.parse(String(study?.studyDate || ""));
  return Number.isFinite(time) ? Math.max(0, (now - time) / 86_400_000) : Number.POSITIVE_INFINITY;
}

function catalogForStudy(data, study) {
  const modality = String(study?.modality || "").trim().toUpperCase();
  const bodyPart = String(study?.bodyPart || "").trim();
  return data.imagingRecognitionCatalog.find((item) => item.status === "active" && item.modality === modality && item.bodyPart === bodyPart)
    || data.imagingRecognitionCatalog.find((item) => item.status === "active" && item.modality === modality)
    || null;
}

function evaluateStudy(data, study, options = {}) {
  ensure(data);
  const catalog = catalogForStudy(data, study);
  const reasons = [];
  if (!catalog) reasons.push("not-in-recognition-catalog");
  if (catalog && studyAgeDays(study, options.now) > Number(catalog.validDays)) reasons.push("expired");
  if (!positiveQuality(study?.qcStatus)) reasons.push("quality-not-qualified");
  if (!study?.diagnosticLevel || !positiveQuality(study?.integrityCheck)) reasons.push("dicom-incomplete");
  if (options.clinicalChange) reasons.push("clinical-change");
  if (options.emergencyOrMajorProcedure) reasons.push("emergency-or-major-procedure");
  if (options.legalOrAppraisal) reasons.push("legal-or-appraisal");
  return {
    eligible: reasons.length === 0,
    decision: reasons.length ? "manual-review-or-recheck" : catalog.recognitionMode === "auto" ? "eligible-for-auto-recognition" : "eligible-for-manual-recognition",
    catalog,
    reasons,
    negativeRules: data.imagingRecognitionNegativeRules.filter((item) => reasons.includes(item.code))
  };
}

function appendAudit(data, user, action, target, detail) {
  const row = { id: randomUUID(), at: new Date().toISOString(), actor: user.id || user.username || user.role, role: user.role, action, target, detail };
  row.digest = `sha256:${createHash("sha256").update(JSON.stringify(row)).digest("hex")}`;
  data.imagingGovernanceAudit.unshift(row);
  data.imagingGovernanceAudit = data.imagingGovernanceAudit.slice(0, 500);
}

function updateCatalog(data, user, id, payload = {}) {
  ensure(data);
  const row = data.imagingRecognitionCatalog.find((item) => item.id === id);
  if (!row) throw Object.assign(new Error("imaging recognition catalog item not found"), { status: 404 });
  const status = String(payload.status || "").trim();
  const policyVersion = String(payload.policyVersion || "").trim();
  const evidenceRef = String(payload.evidenceRef || "").trim();
  if (!RECOGNITION_STATUSES.has(status) || !policyVersion || !evidenceRef) throw Object.assign(new Error("status, policyVersion and evidenceRef are required"), { status: 400 });
  Object.assign(row, { status, policyVersion, updatedAt: new Date().toISOString(), updatedBy: user.id || user.username || user.role, evidenceRef });
  appendAudit(data, user, "update-imaging-recognition-catalog", id, `${status}; ${policyVersion}; ${evidenceRef}`);
  return row;
}

function recordPerformance(data, user, study, payload = {}) {
  ensure(data);
  const measurements = ["firstFrameMs", "seriesLoadMs", "interactionMs"];
  const values = Object.fromEntries(measurements.map((name) => [name, Number(payload[name])]).filter(([, value]) => Number.isFinite(value) && value >= 0 && value <= 120_000));
  if (!Object.keys(values).length) throw Object.assign(new Error("at least one bounded performance measurement is required"), { status: 400 });
  const event = {
    id: `imaging-rum-${randomUUID()}`,
    studyId: study.id,
    modality: study.modality,
    institutionCode: study.institutionCode,
    networkClass: ["wifi", "4g", "5g", "unknown"].includes(String(payload.networkClass || "")) ? String(payload.networkClass) : "unknown",
    viewportClass: ["mobile", "tablet", "desktop", "unknown"].includes(String(payload.viewportClass || "")) ? String(payload.viewportClass) : "unknown",
    ...values,
    withinTarget: Object.entries(values).every(([name, value]) => value <= PERFORMANCE_LIMITS[name]),
    recordedAt: new Date().toISOString(),
    actorRole: user.role
  };
  data.imagingPerformanceEvents.unshift(event);
  data.imagingPerformanceEvents = data.imagingPerformanceEvents.slice(0, 2000);
  appendAudit(data, user, "record-imaging-performance", study.id, Object.keys(values).join(","));
  return event;
}

function dashboard(data, studies = []) {
  ensure(data);
  const performance = data.imagingPerformanceEvents;
  const sum = (key) => performance.reduce((total, item) => total + (Number(item[key]) || 0), 0);
  const samples = performance.length;
  return {
    recognitionCatalog: data.imagingRecognitionCatalog,
    institutions: data.imagingRecognitionInstitutions,
    negativeRules: data.imagingRecognitionNegativeRules,
    qualityPlans: data.imagingQualityPlans,
    recognitionAssessment: studies.map((study) => ({ studyId: study.id, ...evaluateStudy(data, study) })),
    performance: {
      targets: PERFORMANCE_LIMITS,
      samples,
      withinTarget: performance.filter((item) => item.withinTarget).length,
      averageFirstFrameMs: samples ? Math.round(sum("firstFrameMs") / samples) : null,
      averageSeriesLoadMs: samples ? Math.round(sum("seriesLoadMs") / samples) : null
    },
    audit: data.imagingGovernanceAudit.slice(0, 50)
  };
}

module.exports = { PERFORMANCE_LIMITS, dashboard, ensure, evaluateStudy, recordPerformance, seed, updateCatalog };
