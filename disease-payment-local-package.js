"use strict";

const { randomUUID } = require("crypto");
const { digest } = require("./disease-payment-intake");

const OFFICIAL_AUTHORITY = "local-medical-insurance-approved";
const WORKFLOW_FIELDS = new Set(["status", "approvals", "createdAt", "createdBy", "updatedAt", "updatedBy", "submittedAt", "submittedBy", "approvedAt", "scheduledAt", "scheduledBy", "publishedAt", "publishedBy", "activatedAt", "activatedBy", "rolledBackAt", "rolledBackBy", "rollbackReason", "latestImpactReportId", "latestDiffReportId", "validationReportId", "activationSnapshotId", "contentDigest", "schemeId", "parameterId", "frozen", "frozenAt", "replacedBy"]);
const SENSITIVE_FIELDS = new Set(["patientName", "residentId", "idCard", "identityNumber", "phone", "mobile"]);

function ensureState(state) {
  state.localPaymentPackages ||= [];
  state.localPaymentPackageValidationReports ||= [];
  state.localPaymentPackageImpactReports ||= [];
  state.localPaymentPackageDiffReports ||= [];
  state.localPaymentPackageActivationSnapshots ||= [];
  state.localPaymentPackageSimulationJobs ||= [];
  state.auditTrail ||= [];
  return state;
}

function packageContent(input) {
  return Object.fromEntries(Object.entries(input || {}).filter(([key]) => !WORKFLOW_FIELDS.has(key)));
}

function findSensitiveFields(value, path = "", found = []) {
  if (Array.isArray(value)) value.forEach((item, index) => findSensitiveFields(item, `${path}[${index}]`, found));
  else if (value && typeof value === "object") Object.entries(value).forEach(([key, item]) => {
    const next = path ? `${path}.${key}` : key;
    if (SENSITIVE_FIELDS.has(key)) found.push(next);
    findSensitiveFields(item, next, found);
  });
  return found;
}

function requiredText(value, field, errors) {
  if (!String(value || "").trim()) errors.push(`${field}不能为空`);
}

function dateOnly(value = new Date()) {
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("日期格式无效");
  return parsed.toISOString().slice(0, 10);
}

function rangesOverlap(left, right) {
  return left.effectiveFrom <= right.effectiveTo && right.effectiveFrom <= left.effectiveTo;
}

function previousDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function validateLocalPaymentPackage(input) {
  const item = packageContent(input);
  const errors = [];
  const warnings = [];
  const mode = item.mode === "DIP" ? "DIP" : item.mode === "DRG" ? "DRG" : "";
  ["id", "regionCode", "regionName", "packageVersion", "nationalVersion", "documentNo", "sourceOrganization", "effectiveFrom", "effectiveTo"].forEach((field) => requiredText(item[field], field, errors));
  if (!mode) errors.push("mode必须为DRG或DIP");
  if (!["full", "incremental"].includes(item.scope)) errors.push("scope必须为full或incremental");
  if (![OFFICIAL_AUTHORITY, "template-only"].includes(item.authority)) errors.push("authority必须标记正式批准或模板用途");
  if (Number.isNaN(Date.parse(item.effectiveFrom)) || Number.isNaN(Date.parse(item.effectiveTo))) errors.push("生效起止日期格式无效");
  else if (new Date(item.effectiveTo) < new Date(item.effectiveFrom)) errors.push("失效日期不能早于生效日期");

  const sensitive = findSensitiveFields(item);
  if (sensitive.length) errors.push(`规则包不得包含患者个人信息字段：${sensitive.join("、")}`);

  const files = Array.isArray(item.sourceFiles) ? item.sourceFiles : [];
  if (!files.length) errors.push("至少登记一个正式来源文件");
  files.forEach((file, index) => {
    requiredText(file.name, `sourceFiles[${index}].name`, errors);
    if (!/^[a-f\d]{64}$/i.test(String(file.sha256 || ""))) errors.push(`sourceFiles[${index}].sha256必须为64位文件摘要`);
    if (!["已核验", "verified"].includes(file.verificationStatus)) errors.push(`sourceFiles[${index}]必须完成来源核验`);
  });
  const approval = item.approvalDocument || {};
  requiredText(approval.documentNo, "approvalDocument.documentNo", errors);
  requiredText(approval.issuedAt, "approvalDocument.issuedAt", errors);
  if (approval.issuedAt && Number.isNaN(Date.parse(approval.issuedAt))) errors.push("approvalDocument.issuedAt日期格式无效");
  if (!/^[a-f\d]{64}$/i.test(String(approval.fileDigest || ""))) errors.push("approvalDocument.fileDigest必须为64位文件摘要");

  const catalog = Array.isArray(item.catalog) ? item.catalog : [];
  if (!catalog.length) errors.push("catalog至少包含一条目录记录");
  if (item.catalogCount != null && Number(item.catalogCount) !== catalog.length) errors.push("catalogCount与实际目录条数不一致");
  const codes = catalog.map((row) => String(row.code || "").trim()).filter(Boolean);
  if (new Set(codes).size !== codes.length) errors.push("catalog存在重复病组/病种编码");
  catalog.forEach((row, index) => {
    requiredText(row.code, `catalog[${index}].code`, errors);
    requiredText(row.name, `catalog[${index}].name`, errors);
    if (!Array.isArray(row.diagnosisPrefixes) || !row.diagnosisPrefixes.length) errors.push(`catalog[${index}].diagnosisPrefixes不能为空`);
    if (mode === "DRG") {
      requiredText(row.mdcCode, `catalog[${index}].mdcCode`, errors);
      requiredText(row.adrgCode, `catalog[${index}].adrgCode`, errors);
      if (!(Number(row.weight) > 0)) errors.push(`catalog[${index}].weight必须大于0`);
    }
    if (mode === "DIP" && !(Number(row.score) > 0)) errors.push(`catalog[${index}].score必须大于0`);
    if (row.adjustment != null && !(Number(row.adjustment) > 0)) errors.push(`catalog[${index}].adjustment必须大于0`);
  });

  const payment = item.payment || {};
  requiredText(payment.rateMethod, "payment.rateMethod", errors);
  if (!(Number(payment.rate) > 0)) errors.push("payment.rate必须大于0");
  if (!Number.isInteger(Number(payment.budgetYear)) || Number(payment.budgetYear) < 2000) errors.push("payment.budgetYear必须为有效年度");
  const coefficients = Array.isArray(payment.institutionCoefficients) ? payment.institutionCoefficients : [];
  const institutionKeys = coefficients.map((row) => String(row.institutionCode || row.institution || "").trim()).filter(Boolean);
  if (new Set(institutionKeys).size !== institutionKeys.length) errors.push("机构系数存在重复机构");
  coefficients.forEach((row, index) => {
    if (!String(row.institutionCode || row.institution || "").trim()) errors.push(`payment.institutionCoefficients[${index}]缺少机构标识`);
    if (!(Number(row.coefficient) > 0)) errors.push(`payment.institutionCoefficients[${index}].coefficient必须大于0`);
  });
  if (!coefficients.length) warnings.push("未配置机构差异系数，系统将按1.0计算");
  if (item.authority !== OFFICIAL_AUTHORITY) warnings.push("当前为模板/联调规则包，不具备正式发布资格");
  if (item.scope === "full" && catalog.length < 2) warnings.push("全量规则包目录条数异常偏少，请复核是否误传样例文件");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    digest: digest(item),
    summary: { mode: mode || item.mode, catalogCount: catalog.length, coefficientCount: coefficients.length, sourceFileCount: files.length, authority: item.authority || "" },
    checkedAt: new Date().toISOString()
  };
}

function audit(state, action, target, actor, detail = "") {
  state.auditTrail.unshift({ id: randomUUID(), at: new Date().toISOString(), actor: actor || "system", action, target, detail });
  state.auditTrail = state.auditTrail.slice(0, 200);
}

function importLocalPaymentPackage(stateInput, payload, actor = "system") {
  const state = ensureState(stateInput);
  const content = packageContent(payload);
  const validation = validateLocalPaymentPackage(content);
  const existing = state.localPaymentPackages.find((item) => item.id === content.id);
  if (existing && !["校验失败", "校验通过", "已驳回"].includes(existing.status)) throw new Error("当前规则包状态不允许覆盖导入");
  const now = new Date().toISOString();
  const row = {
    ...content,
    status: validation.ok ? "校验通过" : "校验失败",
    approvals: [],
    validationReportId: `local-package-validation-${randomUUID()}`,
    contentDigest: validation.digest,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || actor,
    updatedAt: now,
    updatedBy: actor
  };
  const report = { id: row.validationReportId, packageId: row.id || null, ...validation, checkedBy: actor };
  if (existing) state.localPaymentPackages.splice(state.localPaymentPackages.indexOf(existing), 1, row);
  else state.localPaymentPackages.unshift(row);
  state.localPaymentPackageValidationReports.unshift(report);
  audit(state, "当地医保规则包导入校验", row.id || "缺少编号", actor, `${row.status}，错误${validation.errors.length}项，摘要${validation.digest.slice(0, 12)}`);
  return { state, row, validation: report, replaced: Boolean(existing) };
}

function packageCandidateState(state, row) {
  const catalogCodes = new Set(row.catalog.map((item) => item.code));
  const catalog = row.catalog.map((item) => ({ ...item, mode: row.mode, adjustment: Number(item.adjustment || 1), localPackageId: row.id, localRegionCode: row.regionCode, packageScope: row.scope, authority: "official-local-candidate", simulationCandidate: true }));
  const existingCatalog = state.groupCatalog.filter((item) => item.mode !== row.mode || item.authority === "official-local" || (row.scope !== "full" && !catalogCodes.has(item.code)));
  const scheme = { id: `scheme-${row.id}`, mode: row.mode, name: `${row.regionName}${row.mode}正式方案`, nationalVersion: row.nationalVersion, localVersion: row.packageVersion, status: "已发布", effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, localPackageId: row.id, simulationCandidate: true };
  const parameter = { id: `param-${row.id}`, mode: row.mode, schemeId: scheme.id, name: `${row.regionName}${row.payment.budgetYear}年度${row.mode}支付参数`, rateMethod: row.payment.rateMethod, rate: Number(row.payment.rate), institutionCoefficients: row.payment.institutionCoefficients || [], status: "已发布", effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, localPackageId: row.id, simulationCandidate: true };
  return {
    ...state,
    groupCatalog: [...catalog, ...existingCatalog],
    schemeVersions: [scheme, ...state.schemeVersions.map((item) => item.mode === row.mode && item.status === "已发布" ? { ...item, status: "已冻结" } : item)],
    parameterVersions: [parameter, ...state.parameterVersions.map((item) => item.mode === row.mode && item.status === "已发布" ? { ...item, status: "已冻结" } : item)]
  };
}

function catalogComparisonFields(mode) {
  return mode === "DRG"
    ? ["name", "mdcCode", "adrgCode", "groupType", "complicationLevel", "diagnosisPrefixes", "weight", "adjustment"]
    : ["name", "diagnosisPrefixes", "mainOperationPrefixes", "relatedOperationPrefixes", "treatmentTags", "score", "adjustment"];
}

function changedFields(before, after, fields) {
  return fields.filter((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null));
}

function coefficientMap(payment = {}) {
  return new Map((payment.institutionCoefficients || []).map((item) => [String(item.institutionCode || item.institution), item]));
}

function compareLocalPaymentPackage(stateInput, id, actor = "system", baselineId = "") {
  const state = ensureState(stateInput);
  const row = state.localPaymentPackages.find((item) => item.id === id);
  if (!row) throw new Error("当地医保规则包不存在");
  const baselinePackage = baselineId
    ? state.localPaymentPackages.find((item) => item.id === baselineId)
    : state.localPaymentPackages.find((item) => item.id !== row.id && item.regionCode === row.regionCode && item.mode === row.mode && item.status === "已发布");
  if (baselineId && !baselinePackage) throw new Error("指定的基线规则包不存在");
  const baselineCatalog = baselinePackage?.catalog || state.groupCatalog.filter((item) => item.mode === row.mode);
  const baselineParameter = baselinePackage?.payment || state.parameterVersions.find((item) => item.mode === row.mode && item.status === "已发布") || {};
  const beforeByCode = new Map(baselineCatalog.map((item) => [item.code, item]));
  const afterByCode = new Map(row.catalog.map((item) => [item.code, item]));
  const fields = catalogComparisonFields(row.mode);
  const added = row.catalog.filter((item) => !beforeByCode.has(item.code)).map((item) => ({ code: item.code, name: item.name }));
  const removed = row.scope === "full" ? baselineCatalog.filter((item) => !afterByCode.has(item.code)).map((item) => ({ code: item.code, name: item.name })) : [];
  const changed = row.catalog.filter((item) => beforeByCode.has(item.code)).map((item) => ({ code: item.code, name: item.name, fields: changedFields(beforeByCode.get(item.code), item, fields) })).filter((item) => item.fields.length);
  const beforeCoefficients = coefficientMap(baselineParameter);
  const afterCoefficients = coefficientMap(row.payment);
  const coefficientAdded = [...afterCoefficients].filter(([key]) => !beforeCoefficients.has(key)).map(([key, value]) => ({ key, coefficient: Number(value.coefficient) }));
  const coefficientRemoved = [...beforeCoefficients].filter(([key]) => !afterCoefficients.has(key)).map(([key, value]) => ({ key, coefficient: Number(value.coefficient) }));
  const coefficientChanged = [...afterCoefficients].filter(([key, value]) => beforeCoefficients.has(key) && Number(beforeCoefficients.get(key).coefficient) !== Number(value.coefficient)).map(([key, value]) => ({ key, before: Number(beforeCoefficients.get(key).coefficient), after: Number(value.coefficient) }));
  const report = {
    id: `local-package-diff-${randomUUID()}`,
    packageId: row.id,
    baselinePackageId: baselinePackage?.id || null,
    baselineType: baselinePackage ? "official-local-package" : "current-active-state",
    mode: row.mode,
    catalog: { beforeCount: baselineCatalog.length, afterCount: row.catalog.length, added, removed, changed },
    payment: { rateBefore: Number(baselineParameter.rate || 0), rateAfter: Number(row.payment.rate), rateDelta: Number(row.payment.rate) - Number(baselineParameter.rate || 0), rateMethodBefore: baselineParameter.rateMethod || "", rateMethodAfter: row.payment.rateMethod, coefficientAdded, coefficientRemoved, coefficientChanged },
    inputDigest: digest({ packageDigest: row.contentDigest, baselinePackageDigest: baselinePackage?.contentDigest || digest({ baselineCatalog, baselineParameter }) }),
    generatedAt: new Date().toISOString(),
    generatedBy: actor
  };
  state.localPaymentPackageDiffReports.unshift(report);
  row.latestDiffReportId = report.id;
  audit(state, "当地医保规则包版本差异", row.id, actor, `新增${added.length}、删除${removed.length}、变更${changed.length}，费率变化${report.payment.rateDelta}`);
  return { state, row, report };
}

function simulateLocalPaymentPackage(stateInput, id, actor, calculateCase) {
  const state = ensureState(stateInput);
  const row = state.localPaymentPackages.find((item) => item.id === id);
  if (!row) throw new Error("当地医保规则包不存在");
  if (!row.validationReportId || !state.localPaymentPackageValidationReports.find((item) => item.id === row.validationReportId)?.ok) throw new Error("规则包必须先通过完整性校验");
  if (!["校验通过", "已试算", "已驳回"].includes(row.status)) throw new Error("当前规则包状态不允许影响试算");
  const comparison = compareLocalPaymentPackage(state, id, actor);
  const candidateState = packageCandidateState(state, row);
  const details = state.cases.map((item) => {
    const current = calculateCase(state, item, row.mode);
    const candidate = calculateCase(candidateState, item, row.mode);
    return { caseId: item.id, institution: item.institution, groupCodeBefore: current.grouping?.groupCode || "UNGROUPED", groupCodeAfter: candidate.grouping?.groupCode || "UNGROUPED", currentAmount: Number(current.paymentStandard || 0), candidateAmount: Number(candidate.paymentStandard || 0), delta: Number(candidate.paymentStandard || 0) - Number(current.paymentStandard || 0), candidateOk: candidate.ok };
  });
  const byInstitution = [...new Set(details.map((item) => item.institution))].map((institution) => {
    const rows = details.filter((item) => item.institution === institution);
    const currentAmount = rows.reduce((sum, item) => sum + item.currentAmount, 0);
    const candidateAmount = rows.reduce((sum, item) => sum + item.candidateAmount, 0);
    return { institution, caseCount: rows.length, currentAmount, candidateAmount, delta: candidateAmount - currentAmount, changeRate: currentAmount ? (candidateAmount - currentAmount) / currentAmount : null };
  });
  const currentTotal = details.reduce((sum, item) => sum + item.currentAmount, 0);
  const candidateTotal = details.reduce((sum, item) => sum + item.candidateAmount, 0);
  const report = { id: `local-package-impact-${randomUUID()}`, packageId: row.id, mode: row.mode, caseCount: details.length, groupedCount: details.filter((item) => item.candidateOk).length, currentTotal, candidateTotal, delta: candidateTotal - currentTotal, changeRate: currentTotal ? (candidateTotal - currentTotal) / currentTotal : null, byInstitution, details, inputDigest: digest({ packageDigest: row.contentDigest, cases: state.cases.map((item) => ({ id: item.id, principalDiagnosis: item.principalDiagnosis, totalAmount: item.totalAmount })) }), generatedAt: new Date().toISOString(), generatedBy: actor };
  state.localPaymentPackageImpactReports.unshift(report);
  row.status = "已试算";
  row.latestImpactReportId = report.id;
  audit(state, "当地医保规则包影响试算", row.id, actor, `候选入组${report.groupedCount}/${report.caseCount}，影响${report.delta}`);
  return { state, row, report, diffReport: comparison.report };
}

function simulationCaseDigest(item) {
  return digest({ id: item.id, settlementListNo: item.settlementListNo, institutionCode: item.institutionCode, institution: item.institution, principalDiagnosis: item.principalDiagnosis, otherDiagnoses: item.otherDiagnoses || [], procedures: item.procedures || [], totalAmount: Number(item.totalAmount || 0), admissionDate: item.admissionDate, dischargeDate: item.dischargeDate });
}

function addSimulationJobEvent(job, type, actor, detail = "") {
  job.events ||= [];
  job.events.push({ id: `local-simulation-event-${randomUUID()}`, type, actor, detail, at: new Date().toISOString() });
}

function createLocalPaymentPackageSimulationJob(stateInput, id, payload = {}, actor = "system") {
  const state = ensureState(stateInput);
  const row = state.localPaymentPackages.find((item) => item.id === id);
  if (!row) throw new Error("当地医保规则包不存在");
  if (!row.validationReportId || !state.localPaymentPackageValidationReports.find((item) => item.id === row.validationReportId)?.ok) throw new Error("规则包必须先通过完整性校验");
  if (!["校验通过", "已试算", "已驳回"].includes(row.status)) throw new Error("当前规则包状态不允许创建批量影响试算");
  const requestedIds = Array.isArray(payload.caseIds) && payload.caseIds.length ? payload.caseIds.map(String) : state.cases.map((item) => item.id);
  const caseIds = [...new Set(requestedIds)];
  if (!caseIds.length) throw new Error("批量影响试算至少需要一个病例");
  const caseSnapshots = caseIds.map((caseId) => {
    const item = state.cases.find((candidate) => candidate.id === caseId);
    if (!item) throw new Error(`病例不存在：${caseId}`);
    return { caseId, inputDigest: simulationCaseDigest(item) };
  });
  const idempotencyKey = String(payload.idempotencyKey || digest({ packageDigest: row.contentDigest, caseSnapshots })).trim();
  const existing = state.localPaymentPackageSimulationJobs.find((item) => item.idempotencyKey === idempotencyKey && !["cancelled", "failed"].includes(item.status));
  if (existing) return { state, row, job: existing, idempotent: true };
  const comparison = compareLocalPaymentPackage(state, id, actor, payload.baselineId);
  const job = {
    id: String(payload.jobId || `local-simulation-job-${Date.now()}-${randomUUID().slice(0, 8)}`),
    packageId: row.id,
    mode: row.mode,
    packageDigest: row.contentDigest,
    idempotencyKey,
    caseSnapshots,
    total: caseSnapshots.length,
    cursor: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    ungrouped: 0,
    processingErrors: 0,
    batchSize: Math.min(5000, Math.max(1, Number(payload.batchSize || 500))),
    status: "queued",
    details: [],
    institutionTotals: {},
    createdAt: new Date().toISOString(),
    createdBy: actor,
    events: []
  };
  addSimulationJobEvent(job, "queued", actor, `${job.total}例，批大小${job.batchSize}`);
  state.localPaymentPackageSimulationJobs.unshift(job);
  audit(state, "当地医保规则包批量试算作业创建", row.id, actor, `${job.id}，${job.total}例`);
  return { state, row, job, diffReport: comparison.report, idempotent: false };
}

function finalizeSimulationJob(state, row, job, actor) {
  const byInstitution = Object.values(job.institutionTotals).map((item) => ({ ...item, changeRate: item.currentAmount ? (item.candidateAmount - item.currentAmount) / item.currentAmount : null }));
  const currentTotal = job.details.reduce((sum, item) => sum + Number(item.currentAmount || 0), 0);
  const candidateTotal = job.details.reduce((sum, item) => sum + Number(item.candidateAmount || 0), 0);
  const report = { id: `local-package-impact-${randomUUID()}`, packageId: row.id, simulationJobId: job.id, mode: row.mode, caseCount: job.total, groupedCount: job.succeeded, ungroupedCount: job.ungrouped, processingErrorCount: job.processingErrors, currentTotal, candidateTotal, delta: candidateTotal - currentTotal, changeRate: currentTotal ? (candidateTotal - currentTotal) / currentTotal : null, byInstitution, details: job.details, inputDigest: digest({ packageDigest: row.contentDigest, caseSnapshots: job.caseSnapshots }), generatedAt: new Date().toISOString(), generatedBy: actor };
  state.localPaymentPackageImpactReports.unshift(report);
  if (!job.processingErrors) {
    row.status = "已试算";
    row.latestImpactReportId = report.id;
  }
  job.status = job.processingErrors ? "completed-with-errors" : "completed";
  job.completedAt = report.generatedAt;
  job.impactReportId = report.id;
  delete job.details;
  delete job.institutionTotals;
  addSimulationJobEvent(job, job.status, actor, `入组${job.succeeded}、未入组${job.ungrouped}、处理错误${job.processingErrors}`);
  audit(state, "当地医保规则包批量试算完成", row.id, actor, `${job.id}，入组${job.succeeded}/${job.total}，处理错误${job.processingErrors}`);
  return report;
}

function processLocalPaymentPackageSimulationJob(stateInput, jobId, payload = {}, actor = "system", calculateCase) {
  const state = ensureState(stateInput);
  const job = state.localPaymentPackageSimulationJobs.find((item) => item.id === jobId);
  if (!job) throw new Error("批量影响试算作业不存在");
  if (!["queued", "running", "retry-ready"].includes(job.status)) throw new Error("当前作业状态不允许继续处理");
  const row = state.localPaymentPackages.find((item) => item.id === job.packageId);
  if (!row || row.contentDigest !== job.packageDigest) {
    job.status = "failed";
    job.lastError = "规则包已变化，请重新创建试算作业";
    addSimulationJobEvent(job, "failed", actor, job.lastError);
    return { state, row, job, report: null };
  }
  const batchSize = Math.min(5000, Math.max(1, Number(payload.batchSize || job.batchSize)));
  const batch = job.caseSnapshots.slice(job.cursor, job.cursor + batchSize);
  const candidateState = packageCandidateState(state, row);
  job.status = "running";
  job.startedAt ||= new Date().toISOString();
  addSimulationJobEvent(job, "batch-started", actor, `${job.cursor + 1}-${job.cursor + batch.length}/${job.total}`);
  batch.forEach((snapshot) => {
    const item = state.cases.find((candidate) => candidate.id === snapshot.caseId);
    if (!item || simulationCaseDigest(item) !== snapshot.inputDigest) {
      job.details.push({ caseId: snapshot.caseId, candidateOk: false, error: !item ? "病例不存在" : "病例在作业创建后发生变化", currentAmount: 0, candidateAmount: 0, delta: 0 });
      job.failed += 1;
      job.processingErrors += 1;
      return;
    }
    try {
      const current = calculateCase(state, item, row.mode);
      const candidate = calculateCase(candidateState, item, row.mode);
      const detail = { caseId: item.id, institution: item.institution, groupCodeBefore: current.grouping?.groupCode || "UNGROUPED", groupCodeAfter: candidate.grouping?.groupCode || "UNGROUPED", currentAmount: Number(current.paymentStandard || 0), candidateAmount: Number(candidate.paymentStandard || 0), delta: Number(candidate.paymentStandard || 0) - Number(current.paymentStandard || 0), candidateOk: candidate.ok };
      job.details.push(detail);
      if (candidate.ok) job.succeeded += 1; else { job.failed += 1; job.ungrouped += 1; }
      const key = `institution:${item.institution}`;
      const total = job.institutionTotals[key] || { institution: item.institution, caseCount: 0, currentAmount: 0, candidateAmount: 0, delta: 0 };
      total.caseCount += 1; total.currentAmount += detail.currentAmount; total.candidateAmount += detail.candidateAmount; total.delta += detail.delta;
      job.institutionTotals[key] = total;
    } catch (error) {
      job.details.push({ caseId: snapshot.caseId, institution: item.institution, candidateOk: false, error: error.message, currentAmount: 0, candidateAmount: 0, delta: 0 });
      job.failed += 1;
      job.processingErrors += 1;
    }
  });
  job.cursor += batch.length;
  job.processed = job.cursor;
  job.progress = job.total ? job.processed / job.total : 1;
  job.updatedAt = new Date().toISOString();
  addSimulationJobEvent(job, "batch-completed", actor, `已处理${job.processed}/${job.total}`);
  const report = job.cursor >= job.total ? finalizeSimulationJob(state, row, job, actor) : null;
  return { state, row, job, report };
}

function retryLocalPaymentPackageSimulationJob(stateInput, jobId, actor = "system") {
  const state = ensureState(stateInput);
  const job = state.localPaymentPackageSimulationJobs.find((item) => item.id === jobId);
  if (!job || job.status !== "failed") throw new Error("只有失败的批量试算作业可以重试");
  const row = state.localPaymentPackages.find((item) => item.id === job.packageId);
  if (!row || row.contentDigest !== job.packageDigest) throw new Error("规则包内容已变化，必须重新创建作业");
  job.status = "retry-ready";
  job.lastError = undefined;
  addSimulationJobEvent(job, "retry-ready", actor, `从${job.cursor}/${job.total}继续`);
  return { state, row, job };
}

function cancelLocalPaymentPackageSimulationJob(stateInput, jobId, payload = {}, actor = "system") {
  const state = ensureState(stateInput);
  const job = state.localPaymentPackageSimulationJobs.find((item) => item.id === jobId);
  if (!job || !["queued", "running", "retry-ready", "failed"].includes(job.status)) throw new Error("当前作业状态不允许取消");
  job.status = "cancelled";
  job.cancelledAt = new Date().toISOString();
  job.cancelledBy = actor;
  job.cancelReason = String(payload.reason || "操作人员取消批量影响试算");
  addSimulationJobEvent(job, "cancelled", actor, job.cancelReason);
  return { state, job };
}

function submitLocalPaymentPackage(stateInput, id, actor = "system") {
  const state = ensureState(stateInput);
  const row = state.localPaymentPackages.find((item) => item.id === id);
  if (!row) throw new Error("当地医保规则包不存在");
  if (row.status !== "已试算" || !row.latestImpactReportId || !row.latestDiffReportId) throw new Error("规则包必须先完成版本差异和病例机构影响试算");
  row.status = "待复核";
  row.approvals = [];
  row.submittedAt = new Date().toISOString();
  row.submittedBy = actor;
  audit(state, "当地医保规则包提交复核", row.id, actor, row.latestImpactReportId);
  return { state, row };
}

function reviewLocalPaymentPackage(stateInput, id, payload, actor = "system") {
  const state = ensureState(stateInput);
  const row = state.localPaymentPackages.find((item) => item.id === id);
  if (!row) throw new Error("当地医保规则包不存在");
  if (!["待复核", "复核中"].includes(row.status)) throw new Error("当前规则包状态不允许复核");
  if (row.approvals.some((item) => item.reviewer === actor)) throw new Error("同一复核人不得重复签署");
  const approval = { reviewer: actor, role: String(payload.role || "医保规则包复核"), approved: payload.approved === true, opinion: String(payload.opinion || ""), reviewedAt: new Date().toISOString() };
  row.approvals.push(approval);
  row.status = !approval.approved ? "已驳回" : row.approvals.filter((item) => item.approved).length >= 2 ? "已批准" : "复核中";
  audit(state, "当地医保规则包复核", row.id, actor, `${approval.approved ? "通过" : "驳回"}，已签署${row.approvals.length}人`);
  return { state, row, approval };
}

function activationSnapshot(state, row, actor, at) {
  const base = {
    id: `local-package-snapshot-${randomUUID()}`,
    packageId: row.id,
    mode: row.mode,
    regionCode: row.regionCode,
    groupCatalog: state.groupCatalog.filter((item) => item.mode === row.mode).map((item) => ({ ...item })),
    schemeVersions: state.schemeVersions.filter((item) => item.mode === row.mode).map((item) => ({ ...item })),
    parameterVersions: state.parameterVersions.filter((item) => item.mode === row.mode).map((item) => ({ ...item })),
    packageStatuses: state.localPaymentPackages.filter((item) => item.regionCode === row.regionCode && item.mode === row.mode).map((item) => ({ id: item.id, status: item.status, frozenAt: item.frozenAt, replacedBy: item.replacedBy })),
    createdAt: new Date().toISOString(),
    createdBy: actor,
    activationDate: at
  };
  return { ...base, snapshotDigest: digest(base) };
}

function activatePackage(state, row, actor, at) {
  const snapshot = activationSnapshot(state, row, actor, at);
  state.localPaymentPackageActivationSnapshots.unshift(snapshot);
  const candidate = packageCandidateState(state, row);
  const activatedAt = new Date().toISOString();
  state.localPaymentPackages.filter((item) => item.id !== row.id && item.regionCode === row.regionCode && item.mode === row.mode && item.status === "已发布").forEach((item) => { item.status = "已冻结"; item.frozenAt = activatedAt; item.replacedBy = row.id; });
  state.groupCatalog = candidate.groupCatalog.map((item) => {
    if (item.localPackageId === row.id) return { ...item, authority: "official-local", catalogStatus: "active", effectiveFrom: row.effectiveFrom, effectiveTo: row.effectiveTo, simulationCandidate: undefined };
    if (item.mode === row.mode && item.authority === "official-local") return { ...item, catalogStatus: "frozen" };
    return item;
  });
  state.schemeVersions = candidate.schemeVersions;
  state.parameterVersions = candidate.parameterVersions;
  const scheme = state.schemeVersions[0];
  const parameter = state.parameterVersions[0];
  const previousEffectiveTo = previousDate(row.effectiveFrom);
  state.schemeVersions.filter((item) => item.id !== scheme.id && item.mode === row.mode && item.status === "已冻结" && (!item.effectiveTo || item.effectiveTo >= row.effectiveFrom)).forEach((item) => { item.effectiveTo = previousEffectiveTo; });
  state.parameterVersions.filter((item) => item.id !== parameter.id && item.mode === row.mode && item.status === "已冻结" && (!item.effectiveTo || item.effectiveTo >= row.effectiveFrom)).forEach((item) => { item.effectiveTo = previousEffectiveTo; });
  Object.assign(scheme, { authority: "official-local", documentNo: row.documentNo, publishedAt: row.publishedAt || activatedAt, publishedBy: row.publishedBy || actor, activatedAt, activatedBy: actor, frozen: true, simulationCandidate: undefined });
  Object.assign(parameter, { authority: "official-local", documentNo: row.documentNo, approvals: row.approvals, publishedAt: row.publishedAt || activatedAt, publishedBy: row.publishedBy || actor, activatedAt, activatedBy: actor, frozen: true, simulationCandidate: undefined });
  const adapter = (state.grouperAdapters || []).find((item) => item.id === "official-adapter-v1");
  if (adapter) [scheme.id, row.packageVersion].forEach((version) => { if (!adapter.acceptedSchemeVersions.includes(version)) adapter.acceptedSchemeVersions.push(version); });
  row.status = "已发布";
  row.activatedAt = activatedAt;
  row.activatedBy = actor;
  row.activationSnapshotId = snapshot.id;
  row.schemeId = scheme.id;
  row.parameterId = parameter.id;
  row.frozen = true;
  audit(state, "当地医保规则包生效", row.id, actor, `${at}生效，目录${row.catalog.length}条，参数${parameter.rate}，快照${snapshot.id}`);
  return { state, row, scheme, parameter, snapshot };
}

function publishLocalPaymentPackage(stateInput, id, actor = "system", options = {}) {
  const state = ensureState(stateInput);
  const row = state.localPaymentPackages.find((item) => item.id === id);
  if (!row) throw new Error("当地医保规则包不存在");
  if (row.authority !== OFFICIAL_AUTHORITY) throw new Error("模板或联调规则包不得发布为正式参数");
  if (row.status !== "已批准" || new Set(row.approvals.filter((item) => item.approved).map((item) => item.reviewer)).size < 2) throw new Error("规则包发布需要两名不同复核人批准");
  const validation = validateLocalPaymentPackage(row);
  if (!validation.ok || validation.digest !== row.contentDigest) throw new Error("规则包内容已变化或校验失效，请重新导入校验");
  const at = dateOnly(options.at || new Date());
  if (row.effectiveTo < at) throw new Error("规则包有效期已结束，不得发布");
  const conflict = state.localPaymentPackages.find((item) => item.id !== row.id && item.regionCode === row.regionCode && item.mode === row.mode && ["待生效", "已发布"].includes(item.status) && rangesOverlap(item, row) && row.supersedesPackageId !== item.id);
  if (conflict) throw new Error(`规则包有效期与${conflict.id}重叠；如为正式替代，请填写supersedesPackageId`);
  row.publishedAt = new Date().toISOString();
  row.publishedBy = actor;
  row.approvedAt ||= row.approvals.map((item) => item.reviewedAt).sort().at(-1);
  if (row.effectiveFrom > at) {
    row.status = "待生效";
    row.scheduledAt = row.publishedAt;
    row.scheduledBy = actor;
    row.frozen = true;
    audit(state, "当地医保规则包发布待生效", row.id, actor, `计划${row.effectiveFrom}生效，当前有效参数保持不变`);
    return { state, row, scheme: null, parameter: null, scheduled: true };
  }
  return { ...activatePackage(state, row, actor, at), scheduled: false };
}

function activateLocalPaymentPackage(stateInput, id, actor = "system", options = {}) {
  const state = ensureState(stateInput);
  const row = state.localPaymentPackages.find((item) => item.id === id);
  if (!row) throw new Error("当地医保规则包不存在");
  if (row.status !== "待生效") throw new Error("只有已发布待生效的规则包可以激活");
  const at = dateOnly(options.at || new Date());
  if (row.effectiveFrom > at) throw new Error(`尚未到生效日期${row.effectiveFrom}`);
  if (row.effectiveTo < at) throw new Error("规则包尚未激活即已过期，请重新履行发布流程");
  return activatePackage(state, row, actor, at);
}

function activateDueLocalPaymentPackages(stateInput, actor = "system", options = {}) {
  const state = ensureState(stateInput);
  const at = dateOnly(options.at || new Date());
  const due = state.localPaymentPackages.filter((item) => item.status === "待生效" && item.effectiveFrom <= at && item.effectiveTo >= at).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const activated = due.map((item) => activatePackage(state, item, actor, at).row);
  return { state, activated, at };
}

function rollbackLocalPaymentPackage(stateInput, id, payload = {}, actor = "system") {
  const state = ensureState(stateInput);
  const row = state.localPaymentPackages.find((item) => item.id === id);
  if (!row || row.status !== "已发布") throw new Error("只有当前已生效规则包可以回退");
  const reason = String(payload.reason || "").trim();
  if (!reason) throw new Error("规则包回退必须填写原因");
  const laterPackage = state.localPaymentPackages.find((item) => item.id !== row.id && item.regionCode === row.regionCode && item.mode === row.mode && item.status === "已发布" && item.activatedAt > row.activatedAt);
  if (laterPackage) throw new Error("该规则包已被后续版本替代，不能直接回退");
  const financialPosting = state.settlementBatches?.find((item) => item.createdAt && item.createdAt >= row.activatedAt);
  if (financialPosting) throw new Error(`规则包生效后已生成结算批次${financialPosting.id}，必须走财务冲正流程`);
  const snapshot = state.localPaymentPackageActivationSnapshots.find((item) => item.id === row.activationSnapshotId);
  if (!snapshot) throw new Error("缺少生效前回退快照");
  const { snapshotDigest, ...snapshotBase } = snapshot;
  if (digest(snapshotBase) !== snapshotDigest) throw new Error("回退快照完整性校验失败");
  state.groupCatalog = [...snapshot.groupCatalog, ...state.groupCatalog.filter((item) => item.mode !== row.mode)];
  state.schemeVersions = [...snapshot.schemeVersions, ...state.schemeVersions.filter((item) => item.mode !== row.mode)];
  state.parameterVersions = [...snapshot.parameterVersions, ...state.parameterVersions.filter((item) => item.mode !== row.mode)];
  snapshot.packageStatuses.forEach((saved) => {
    const item = state.localPaymentPackages.find((candidate) => candidate.id === saved.id);
    if (item) Object.assign(item, { status: saved.status, frozenAt: saved.frozenAt, replacedBy: saved.replacedBy });
  });
  row.status = "已回退";
  row.rolledBackAt = new Date().toISOString();
  row.rolledBackBy = actor;
  row.rollbackReason = reason;
  audit(state, "当地医保规则包安全回退", row.id, actor, `${reason}；恢复快照${snapshot.id}`);
  return { state, row, snapshot };
}

function packageSummary(item) {
  const { catalog = [], ...summary } = item;
  return { ...summary, catalogCount: catalog.length, payment: { ...(summary.payment || {}), institutionCoefficients: undefined, coefficientCount: summary.payment?.institutionCoefficients?.length || 0 } };
}

function diffReportSummary(item) {
  return { ...item, catalog: { beforeCount: item.catalog.beforeCount, afterCount: item.catalog.afterCount, addedCount: item.catalog.added.length, removedCount: item.catalog.removed.length, changedCount: item.catalog.changed.length }, payment: { ...item.payment, coefficientAddedCount: item.payment.coefficientAdded.length, coefficientRemovedCount: item.payment.coefficientRemoved.length, coefficientChangedCount: item.payment.coefficientChanged.length, coefficientAdded: undefined, coefficientRemoved: undefined, coefficientChanged: undefined } };
}

function impactReportSummary(item) {
  const { details, ...summary } = item;
  return { ...summary, detailCount: details.length };
}

function simulationJobSummary(item) {
  const { caseSnapshots, events, ...summary } = item;
  return { ...summary, snapshotCount: (caseSnapshots || []).length, latestEvent: (events || []).at(-1) || null };
}

function getLocalPaymentPackageCatalogPage(stateInput, id, options = {}) {
  const state = ensureState(stateInput);
  const row = state.localPaymentPackages.find((item) => item.id === id);
  if (!row) throw new Error("当地医保规则包不存在");
  const pageSize = Math.min(500, Math.max(1, Number(options.pageSize || 100)));
  const page = Math.max(1, Number(options.page || 1));
  const query = String(options.query || "").trim().toLowerCase();
  const filtered = row.catalog.filter((item) => !query || [item.code, item.name, item.mdcCode, item.adrgCode].some((value) => String(value || "").toLowerCase().includes(query)));
  const offset = (page - 1) * pageSize;
  return { package: packageSummary(row), page, pageSize, total: filtered.length, pages: Math.max(1, Math.ceil(filtered.length / pageSize)), items: filtered.slice(offset, offset + pageSize) };
}

function getLocalPaymentPackageReport(stateInput, id, type) {
  const state = ensureState(stateInput);
  const row = state.localPaymentPackages.find((item) => item.id === id);
  if (!row) throw new Error("当地医保规则包不存在");
  const collection = type === "diff" ? state.localPaymentPackageDiffReports : state.localPaymentPackageImpactReports;
  const reportId = type === "diff" ? row.latestDiffReportId : row.latestImpactReportId;
  const report = collection.find((item) => item.id === reportId);
  if (!report) throw new Error(type === "diff" ? "版本差异报告不存在" : "影响试算报告不存在");
  return report;
}

function buildLocalPaymentPackageView(stateInput) {
  const state = ensureState(stateInput);
  return {
    packages: state.localPaymentPackages.map(packageSummary),
    validationReports: state.localPaymentPackageValidationReports,
    impactReports: state.localPaymentPackageImpactReports.map(impactReportSummary),
    diffReports: state.localPaymentPackageDiffReports.map(diffReportSummary),
    simulationJobs: state.localPaymentPackageSimulationJobs.map(simulationJobSummary),
    activationSnapshots: state.localPaymentPackageActivationSnapshots.map(({ groupCatalog, schemeVersions, parameterVersions, ...item }) => ({ ...item, catalogCount: groupCatalog.length, schemeCount: schemeVersions.length, parameterCount: parameterVersions.length })),
    published: ["DRG", "DIP"].map((mode) => { const item = state.localPaymentPackages.find((candidate) => candidate.mode === mode && candidate.status === "已发布"); return { mode, package: item ? packageSummary(item) : null }; }),
    scheduled: state.localPaymentPackages.filter((item) => item.status === "待生效").map(packageSummary),
    workflow: ["校验通过", "版本差异+影响试算", "待复核", "复核中", "已批准", "待生效/已发布", "已冻结/已回退"],
    officialAuthority: OFFICIAL_AUTHORITY,
    checklist: ["当地医保正式目录（含编码、名称及匹配依据）", "DRG权重或DIP分值", "费率/点值及其测算年度", "医疗机构差异系数（如适用）", "正式发文或批复文件", "所有源文件SHA-256摘要与来源核验记录", "生效与失效日期", "业务和基金财务双人复核"]
  };
}

module.exports = { OFFICIAL_AUTHORITY, activateDueLocalPaymentPackages, activateLocalPaymentPackage, buildLocalPaymentPackageView, cancelLocalPaymentPackageSimulationJob, compareLocalPaymentPackage, createLocalPaymentPackageSimulationJob, getLocalPaymentPackageCatalogPage, getLocalPaymentPackageReport, importLocalPaymentPackage, processLocalPaymentPackageSimulationJob, publishLocalPaymentPackage, retryLocalPaymentPackageSimulationJob, reviewLocalPaymentPackage, rollbackLocalPaymentPackage, simulateLocalPaymentPackage, submitLocalPaymentPackage, validateLocalPaymentPackage };
