"use strict";

const { createHash, randomUUID } = require("crypto");
const GrouperContract = require("./disease-payment-grouper-contract");

const QUALITY_CATEGORIES = ["format", "coding", "business", "cost", "timeline", "linkage", "completeness"];

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function ensureIntakeState(state) {
  if (!Array.isArray(state.settlementListImports)) state.settlementListImports = [];
  if (!Array.isArray(state.settlementLists)) state.settlementLists = [];
  if (!Array.isArray(state.medicalCostItems)) state.medicalCostItems = [];
  if (!Array.isArray(state.groupingRuns)) state.groupingRuns = [];
  if (!Array.isArray(state.paymentCalculationLedger)) state.paymentCalculationLedger = [];
  if (!Array.isArray(state.importRetryQueue)) state.importRetryQueue = [];
  if (!Array.isArray(state.formalGroupingJobs)) state.formalGroupingJobs = [];
  if (!Array.isArray(state.formalGroupingDeadLetters)) state.formalGroupingDeadLetters = [];
  if (!Array.isArray(state.grouperAdapters)) state.grouperAdapters = [
    { id: "simulation-local-v1", environment: "simulation", name: "本地可解释模拟分组器", status: "ready", authority: "non-binding" },
    { id: "official-adapter-v1", environment: "formal", name: "国家/地方正式分组器适配器", status: "external-blocked", authority: "official-receipt-required", acceptedSchemeVersions: ["DRG-2.0-DL", "drg-demo-2026", "DIP-2.0-DL", "dip-demo-2026"], verificationContract: "detached-signature-attestation-v1" }
  ];
  return state;
}

function normalizeCostItem(item, listNo, index) {
  return {
    id: String(item.id || `${listNo}-cost-${index + 1}`),
    settlementListNo: listNo,
    itemCode: String(item.itemCode || "").trim().toUpperCase(),
    itemName: String(item.itemName || "").trim(),
    category: String(item.category || "诊疗项目").trim(),
    amount: Number(item.amount || 0),
    catalogVersion: String(item.catalogVersion || "").trim()
  };
}

function normalizeSettlementList(payload, sourceSystem = "manual-import") {
  const listNo = String(payload.settlementListNo || "").trim();
  const institutionCode = String(payload.institutionCode || "").trim().toUpperCase();
  const normalized = {
    id: String(payload.id || `sl-${digest([institutionCode, listNo]).slice(0, 16)}`),
    idempotencyKey: `${institutionCode}:${listNo}:${String(payload.dischargeDate || "").slice(0, 10)}`,
    settlementListNo: listNo,
    institutionCode,
    institution: String(payload.institution || "").trim(),
    residentId: String(payload.residentId || "").trim(),
    patientName: String(payload.patientName || "").trim(),
    admissionDate: String(payload.admissionDate || "").slice(0, 10),
    dischargeDate: String(payload.dischargeDate || "").slice(0, 10),
    principalDiagnosis: String(payload.principalDiagnosis || "").trim().toUpperCase(),
    principalDiagnosisName: String(payload.principalDiagnosisName || "").trim(),
    otherDiagnoses: Array.isArray(payload.otherDiagnoses) ? payload.otherDiagnoses.map((item) => String(item).trim().toUpperCase()).filter(Boolean) : [],
    procedures: Array.isArray(payload.procedures) ? payload.procedures : [],
    totalAmount: Number(payload.totalAmount || 0),
    declaredFundAmount: Number(payload.declaredFundAmount || 0),
    insuranceType: String(payload.insuranceType || "基本医保").trim(),
    dischargeMethod: String(payload.dischargeMethod || "").trim(),
    sourceSystem,
    receivedAt: new Date().toISOString()
  };
  const costItems = (Array.isArray(payload.costItems) ? payload.costItems : []).map((item, index) => normalizeCostItem(item, listNo, index));
  normalized.sourceDigest = digest(payload);
  normalized.normalizedDigest = digest({ ...normalized, receivedAt: undefined });
  return { normalized, costItems };
}

function issue(category, code, message, field, severity = "error") {
  return { category, code, message, field, severity };
}

function validateSettlementList(list, costItems, existingLists = []) {
  const issues = [];
  if (!/^[A-Z0-9._-]{3,64}$/i.test(list.settlementListNo)) issues.push(issue("format", "LIST_NO_FORMAT", "结算清单号格式不正确", "settlementListNo"));
  if (!/^[A-Z0-9._-]{2,40}$/i.test(list.institutionCode)) issues.push(issue("format", "ORG_CODE_FORMAT", "机构编码格式不正确", "institutionCode"));
  if (list.principalDiagnosis && !/^[A-Z][0-9]{2}(\.[A-Z0-9]{1,4})?$/i.test(list.principalDiagnosis)) issues.push(issue("coding", "ICD10_FORMAT", "主要诊断不符合ICD-10编码格式", "principalDiagnosis"));
  list.otherDiagnoses.forEach((code) => { if (!/^[A-Z][0-9]{2}(\.[A-Z0-9]{1,4})?$/i.test(code)) issues.push(issue("coding", "OTHER_ICD10_FORMAT", `其他诊断编码不规范：${code}`, "otherDiagnoses")); });
  if (list.declaredFundAmount > list.totalAmount) issues.push(issue("business", "FUND_GT_TOTAL", "申报基金金额不能超过总费用", "declaredFundAmount"));
  if (list.totalAmount <= 0) issues.push(issue("cost", "TOTAL_NOT_POSITIVE", "总费用必须大于0", "totalAmount"));
  if (costItems.some((item) => item.amount < 0)) issues.push(issue("cost", "NEGATIVE_COST", "费用明细不能为负数", "costItems"));
  const detailTotal = costItems.reduce((sum, item) => sum + item.amount, 0);
  if (costItems.length && Math.abs(detailTotal - list.totalAmount) > 0.01) issues.push(issue("cost", "DETAIL_TOTAL_MISMATCH", `费用明细合计${detailTotal.toFixed(2)}与总费用不一致`, "costItems"));
  if (!Number.isFinite(Date.parse(list.admissionDate)) || !Number.isFinite(Date.parse(list.dischargeDate))) issues.push(issue("timeline", "DATE_INVALID", "入出院日期无效", "admissionDate"));
  else if (new Date(list.dischargeDate) < new Date(list.admissionDate)) issues.push(issue("timeline", "DISCHARGE_BEFORE_ADMISSION", "出院日期不能早于入院日期", "dischargeDate"));
  if (costItems.some((item) => item.settlementListNo !== list.settlementListNo)) issues.push(issue("linkage", "DETAIL_LINK_BROKEN", "费用明细未与结算清单唯一关联", "costItems"));
  if (existingLists.some((item) => item.idempotencyKey === list.idempotencyKey && item.normalizedDigest !== list.normalizedDigest)) issues.push(issue("linkage", "IDEMPOTENCY_CONFLICT", "相同幂等键对应不同内容", "idempotencyKey"));
  ["settlementListNo", "institutionCode", "institution", "admissionDate", "dischargeDate", "principalDiagnosis"].forEach((field) => { if (!String(list[field] || "").trim()) issues.push(issue("completeness", "REQUIRED_MISSING", `${field}不能为空`, field)); });
  if (!costItems.length) issues.push(issue("completeness", "COST_ITEMS_EMPTY", "缺少费用明细", "costItems", "warning"));
  const categories = Object.fromEntries(QUALITY_CATEGORIES.map((category) => [category, { passed: !issues.some((item) => item.category === category && item.severity === "error"), issues: issues.filter((item) => item.category === category) }]));
  return { ok: issues.every((item) => item.severity !== "error"), issues, categories, detailTotal, checkedAt: new Date().toISOString() };
}

function importBatch(stateInput, payload, actor = "system") {
  const state = ensureIntakeState(stateInput);
  const importId = `import-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const results = [];
  rows.forEach((row, index) => {
    const { normalized, costItems } = normalizeSettlementList(row, payload.sourceSystem || "batch-import");
    const quality = validateSettlementList(normalized, costItems, state.settlementLists);
    const duplicate = state.settlementLists.find((item) => item.idempotencyKey === normalized.idempotencyKey && item.normalizedDigest === normalized.normalizedDigest);
    if (duplicate) {
      results.push({ rowNumber: index + 1, settlementListNo: normalized.settlementListNo, status: "duplicate", recordId: duplicate.id, quality });
      return;
    }
    if (!quality.ok) {
      const retry = { id: `retry-${randomUUID()}`, importId, rowNumber: index + 1, payload: row, issues: quality.issues, status: "pending-correction", attempts: 0, createdAt: new Date().toISOString() };
      state.importRetryQueue.unshift(retry);
      results.push({ rowNumber: index + 1, settlementListNo: normalized.settlementListNo, status: "rejected", retryId: retry.id, quality });
      return;
    }
    const listRecord = { ...normalized, importId, quality, formalStatus: "not-submitted", simulationStatus: "not-run", importedBy: actor };
    state.settlementLists.push(listRecord);
    state.medicalCostItems.push(...costItems.map((item) => ({ ...item, importId })));
    const caseIndex = state.cases.findIndex((item) => item.settlementListNo === normalized.settlementListNo);
    const caseRow = { ...normalized, id: caseIndex >= 0 ? state.cases[caseIndex].id : `dp-case-${randomUUID()}`, costItemCount: costItems.length, qualityStatus: "已通过", status: "待测算", specialCaseStatus: caseIndex >= 0 ? state.cases[caseIndex].specialCaseStatus : "未申报" };
    if (caseIndex >= 0) state.cases[caseIndex] = { ...state.cases[caseIndex], ...caseRow };
    else state.cases.push(caseRow);
    results.push({ rowNumber: index + 1, settlementListNo: normalized.settlementListNo, status: "accepted", recordId: normalized.id, quality });
  });
  const report = { id: importId, sourceSystem: payload.sourceSystem || "batch-import", rowCount: rows.length, accepted: results.filter((item) => item.status === "accepted").length, rejected: results.filter((item) => item.status === "rejected").length, duplicates: results.filter((item) => item.status === "duplicate").length, status: results.some((item) => item.status === "rejected") ? "completed-with-errors" : "completed", results, createdAt: new Date().toISOString(), createdBy: actor, inputDigest: digest(rows) };
  state.settlementListImports.unshift(report);
  return { state, report };
}

function retryImport(stateInput, retryId, correctedPayload, actor = "system") {
  const state = ensureIntakeState(stateInput);
  const item = state.importRetryQueue.find((row) => row.id === retryId);
  if (!item) throw new Error("未找到重试记录");
  if (item.status === "resolved") return { state, retry: item, idempotent: true };
  item.attempts += 1;
  item.lastAttemptAt = new Date().toISOString();
  const result = importBatch(state, { sourceSystem: "correction-retry", rows: [{ ...item.payload, ...correctedPayload }] }, actor);
  const accepted = result.report.results[0]?.status === "accepted" || result.report.results[0]?.status === "duplicate";
  item.status = accepted ? "resolved" : "pending-correction";
  item.resolvedAt = accepted ? new Date().toISOString() : undefined;
  item.resolvedBy = accepted ? actor : undefined;
  item.issues = accepted ? [] : result.report.results[0]?.quality?.issues || item.issues;
  return { state: result.state, retry: item, report: result.report };
}

function appendImmutable(collection, record) {
  const previousHash = collection.length ? collection[collection.length - 1].recordHash : "GENESIS";
  const base = { ...record, sequence: collection.length + 1, previousHash };
  const sealed = Object.freeze({ ...base, recordHash: digest(base) });
  collection.push(sealed);
  return sealed;
}

function officialCaseDigest(item, mode = "DRG") {
  return GrouperContract.caseInputDigest(item, mode);
}

function validateOfficialReceipt(state, item, official, mode) {
  const errors = [];
  if (!official?.receiptId) errors.push("缺少回执编号");
  if (!official?.groupCode) errors.push("缺少正式分组编码");
  if (!official?.schemeVersion) errors.push("缺少正式方案版本");
  if (!official?.signedAt || Number.isNaN(Date.parse(official.signedAt))) errors.push("缺少有效签发时间");
  const adapter = (state.grouperAdapters || []).find((row) => row.id === "official-adapter-v1");
  const signatureVerification = GrouperContract.verifyReceiptSignature(official, { trustedSignerFingerprints: adapter?.trustedSignerFingerprints || [] });
  if (!signatureVerification.ok) errors.push(...signatureVerification.errors);
  if (adapter?.acceptedSchemeVersions?.length && official?.schemeVersion && !adapter.acceptedSchemeVersions.includes(official.schemeVersion)) errors.push("正式回执方案版本未获适配器接受");
  const expectedInputDigest = officialCaseDigest(item, mode);
  if (official?.inputDigest !== expectedInputDigest) errors.push("正式回执未绑定当前病例输入摘要");
  const usedReceipt = (state.groupingRuns || []).flatMap((run) => run.results || []).find((result) => result.environment === "formal" && result.ok && result.receiptId === official?.receiptId);
  if (usedReceipt) errors.push(`正式回执已被病例${usedReceipt.caseId}使用`);
  return { ok: errors.length === 0, errors: [...new Set(errors)], expectedInputDigest, signatureVerification, verificationContract: adapter?.verificationContract || GrouperContract.SIGNATURE_SCHEMA_VERSION };
}

function runGrouping(stateInput, payload, actor, calculateCase) {
  const state = ensureIntakeState(stateInput);
  const environment = payload.environment === "formal" ? "formal" : "simulation";
  const mode = payload.mode === "DIP" ? "DIP" : "DRG";
  const caseIds = Array.isArray(payload.caseIds) && payload.caseIds.length ? payload.caseIds : state.cases.map((item) => item.id);
  const officialResults = new Map((payload.officialResults || []).map((item) => [item.caseId, item]));
  const runId = `group-run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const results = caseIds.map((caseId) => {
    const item = state.cases.find((row) => row.id === caseId);
    if (!item) return { caseId, ok: false, error: "病例不存在" };
    if (environment === "formal") {
      const official = officialResults.get(caseId);
      const receiptValidation = validateOfficialReceipt(state, item, official, mode);
      if (!receiptValidation.ok) return { caseId, ok: false, error: "正式分组回执验证失败", receiptErrors: receiptValidation.errors, expectedInputDigest: receiptValidation.expectedInputDigest };
      const result = { caseId, ok: true, environment, authority: "official", mode, groupCode: official.groupCode, groupName: official.groupName || "", mdcCode: official.mdcCode || "", adrgCode: official.adrgCode || "", schemeVersion: official.schemeVersion, receiptId: official.receiptId, inputDigest: official.inputDigest, receiptDigest: digest(official), verification: { ...receiptValidation.signatureVerification.verification, contract: receiptValidation.verificationContract }, signedAt: official.signedAt, groupedAt: new Date().toISOString() };
      item.formalStatus = "grouped";
      item.formalGrouping = result;
      return result;
    }
    const calculation = calculateCase(state, item, mode);
    const result = { caseId, ok: calculation.ok, environment, authority: "non-binding", grouping: calculation.grouping, calculation, groupedAt: new Date().toISOString() };
    item.simulationStatus = calculation.ok ? "calculated" : "failed";
    item.simulationCalculation = calculation;
    return result;
  });
  const run = appendImmutable(state.groupingRuns, { id: runId, environment, mode, adapterId: environment === "formal" ? "official-adapter-v1" : "simulation-local-v1", caseCount: results.length, succeeded: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results, createdAt: new Date().toISOString(), createdBy: actor, inputDigest: digest({ caseIds, mode, environment }) });
  results.filter((item) => item.ok).forEach((result) => appendImmutable(state.paymentCalculationLedger, { id: `calc-ledger-${randomUUID()}`, groupingRunId: run.id, caseId: result.caseId, environment, mode, authority: result.authority, schemeVersion: result.schemeVersion || result.grouping?.schemeId || "simulation", groupCode: result.groupCode || result.grouping?.groupCode, paymentStandard: result.calculation?.paymentStandard ?? null, parameterId: result.calculation?.parameterId ?? null, createdAt: new Date().toISOString(), createdBy: actor }));
  return { state, run };
}

function addFormalJobEvent(job, type, actor, detail = "") {
  job.events ||= [];
  job.events.push({ id: `fg-event-${randomUUID()}`, type, actor, detail, at: new Date().toISOString() });
}

function formalGroupingEnvelope(job) {
  return GrouperContract.buildRequestEnvelope(job);
}

function createFormalGroupingJob(stateInput, payload, actor = "system") {
  const state = ensureIntakeState(stateInput);
  const mode = payload.mode === "DIP" ? "DIP" : "DRG";
  const adapter = state.grouperAdapters.find((item) => item.id === "official-adapter-v1");
  const schemeVersion = String(payload.schemeVersion || adapter?.acceptedSchemeVersions?.find((item) => item.startsWith(mode)) || "").trim();
  if (!schemeVersion || (adapter?.acceptedSchemeVersions?.length && !adapter.acceptedSchemeVersions.includes(schemeVersion))) throw new Error("正式分组作业必须绑定适配器接受的方案版本");
  const caseIds = [...new Set((Array.isArray(payload.caseIds) && payload.caseIds.length ? payload.caseIds : state.cases.map((item) => item.id)).map(String))];
  if (!caseIds.length) throw new Error("正式分组作业至少包含一个病例");
  const caseSnapshots = caseIds.map((caseId) => {
    const item = state.cases.find((row) => row.id === caseId);
    if (!item) throw new Error(`病例不存在：${caseId}`);
    const normalizedCase = GrouperContract.normalizedCaseSnapshot(item, mode);
    return { caseId, settlementListNo: item.settlementListNo, normalizedCase, inputDigest: GrouperContract.sha256(normalizedCase) };
  });
  const idempotencyKey = String(payload.idempotencyKey || digest({ mode, schemeVersion, caseSnapshots })).trim();
  const existing = state.formalGroupingJobs.find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) return { state, job: existing, envelope: formalGroupingEnvelope(existing), idempotent: true };
  const job = {
    id: String(payload.id || `formal-job-${Date.now()}-${randomUUID().slice(0, 8)}`),
    correlationId: String(payload.correlationId || `fg-${randomUUID()}`),
    idempotencyKey,
    adapterId: "official-adapter-v1",
    mode,
    schemeVersion,
    caseIds,
    caseSnapshots,
    status: "queued",
    attemptCount: 0,
    maxAttempts: Math.min(5, Math.max(1, Number(payload.maxAttempts || 3))),
    createdAt: new Date().toISOString(),
    createdBy: actor,
    events: []
  };
  const envelope = formalGroupingEnvelope(job);
  const contractValidation = GrouperContract.validateRequestEnvelope(envelope);
  if (!contractValidation.ok) throw new Error(`正式分组契约校验失败：${contractValidation.errors.join("；")}`);
  job.requestDigest = contractValidation.digest;
  addFormalJobEvent(job, "queued", actor, `${caseIds.length}个病例，方案${schemeVersion}`);
  state.formalGroupingJobs.unshift(job);
  return { state, job, envelope, idempotent: false };
}

function registerFormalJobFailure(state, job, payload, actor) {
  const errorCode = String(payload.errorCode || "ADAPTER_DELIVERY_FAILED");
  const errorMessage = String(payload.errorMessage || "正式分组适配器派发或回执处理失败").slice(0, 300);
  if (job.attemptCount === 0) job.attemptCount = 1;
  job.lastError = { code: errorCode, message: errorMessage, at: new Date().toISOString(), actor };
  if (job.attemptCount >= job.maxAttempts) {
    job.status = "dead-letter";
    job.deadLetteredAt = new Date().toISOString();
    const existing = state.formalGroupingDeadLetters.find((item) => item.jobId === job.id && item.status === "pending-reconciliation");
    if (!existing) state.formalGroupingDeadLetters.unshift({ id: `fg-dead-${randomUUID()}`, jobId: job.id, correlationId: job.correlationId, errorCode, errorMessage, attempts: job.attemptCount, status: "pending-reconciliation", createdAt: job.deadLetteredAt, createdBy: actor });
    addFormalJobEvent(job, "dead-letter", actor, `${errorCode}：${errorMessage}`);
  } else {
    const delaySeconds = 60 * (2 ** Math.max(0, job.attemptCount - 1));
    job.status = "retry-scheduled";
    job.nextRetryAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
    addFormalJobEvent(job, "retry-scheduled", actor, `${errorCode}，${delaySeconds}秒后可重试`);
  }
  return job;
}

function dispatchFormalGroupingJob(stateInput, id, payload = {}, actor = "system") {
  const state = ensureIntakeState(stateInput);
  const job = state.formalGroupingJobs.find((item) => item.id === id);
  if (!job) throw new Error("正式分组作业不存在");
  if (!['queued', 'retry-scheduled'].includes(job.status)) throw new Error("当前状态不允许派发正式分组作业");
  job.attemptCount += 1;
  job.dispatchedAt = new Date().toISOString();
  job.transportReceipt = { accepted: payload.accepted !== false, transportId: String(payload.transportId || `transport-${randomUUID()}`), endpoint: String(payload.endpoint || "official-grouper-adapter"), at: job.dispatchedAt };
  addFormalJobEvent(job, "dispatched", actor, `第${job.attemptCount}次，${job.transportReceipt.transportId}`);
  if (!job.transportReceipt.accepted) registerFormalJobFailure(state, job, payload, actor);
  else {
    job.status = "awaiting-receipt";
    job.nextRetryAt = undefined;
  }
  return { state, job, envelope: formalGroupingEnvelope(job) };
}

function receiveFormalGroupingReceipt(stateInput, id, payload, actor, calculateCase) {
  const state = ensureIntakeState(stateInput);
  const job = state.formalGroupingJobs.find((item) => item.id === id);
  if (!job) throw new Error("正式分组作业不存在");
  const callbackDigest = digest(payload);
  if (job.status === "completed" && job.callbackDigest === callbackDigest) return { state, job, run: state.groupingRuns.find((item) => item.id === job.groupingRunId), idempotent: true };
  if (job.status !== "awaiting-receipt") throw new Error("正式分组作业尚未处于回执等待状态");
  if (payload.correlationId !== job.correlationId) throw new Error("正式分组回执关联号不匹配");
  const officialResults = Array.isArray(payload.officialResults) ? payload.officialResults : [];
  const resultByCase = new Map(officialResults.map((item) => [item.caseId, item]));
  const receiptErrors = [];
  if (officialResults.length !== job.caseSnapshots.length || resultByCase.size !== job.caseSnapshots.length) receiptErrors.push("正式分组回执病例数量或唯一性不匹配");
  job.caseSnapshots.forEach((snapshot) => {
    const item = state.cases.find((row) => row.id === snapshot.caseId);
    const official = resultByCase.get(snapshot.caseId);
    if (!item) receiptErrors.push(`病例不存在：${snapshot.caseId}`);
    else if (officialCaseDigest(item, job.mode) !== snapshot.inputDigest) receiptErrors.push(`病例提交后发生变化：${snapshot.caseId}`);
    if (!official) receiptErrors.push(`缺少病例回执：${snapshot.caseId}`);
    else {
      if (official.schemeVersion !== job.schemeVersion) receiptErrors.push(`方案版本不匹配：${snapshot.caseId}`);
      if (official.inputDigest !== snapshot.inputDigest) receiptErrors.push(`病例摘要不匹配：${snapshot.caseId}`);
      const validation = item ? validateOfficialReceipt(state, item, official, job.mode) : { ok: false, errors: [] };
      if (!validation.ok) receiptErrors.push(...validation.errors.map((error) => `${snapshot.caseId}：${error}`));
    }
  });
  if (receiptErrors.length) {
    job.status = "receipt-rejected";
    job.receiptErrors = [...new Set(receiptErrors)];
    addFormalJobEvent(job, "receipt-rejected", actor, job.receiptErrors.join("；"));
    return { state, job, receiptErrors: job.receiptErrors, idempotent: false };
  }
  const grouped = runGrouping(state, { environment: "formal", mode: job.mode, caseIds: job.caseIds, officialResults }, actor, calculateCase);
  if (grouped.run.failed) {
    job.status = "receipt-rejected";
    job.receiptErrors = grouped.run.results.flatMap((item) => item.receiptErrors || [item.error]).filter(Boolean);
    addFormalJobEvent(job, "receipt-rejected", actor, job.receiptErrors.join("；"));
    return { state: grouped.state, job, run: grouped.run, receiptErrors: job.receiptErrors };
  }
  job.status = "completed";
  job.callbackDigest = callbackDigest;
  job.groupingRunId = grouped.run.id;
  job.completedAt = new Date().toISOString();
  job.receiptCount = officialResults.length;
  job.receiptErrors = [];
  addFormalJobEvent(job, "completed", actor, `${officialResults.length}个正式回执已入账`);
  return { state: grouped.state, job, run: grouped.run, idempotent: false };
}

function failFormalGroupingJob(stateInput, id, payload = {}, actor = "system") {
  const state = ensureIntakeState(stateInput);
  const job = state.formalGroupingJobs.find((item) => item.id === id);
  if (!job) throw new Error("正式分组作业不存在");
  if (!['queued', 'awaiting-receipt', 'receipt-rejected'].includes(job.status)) throw new Error("当前状态不允许登记失败");
  registerFormalJobFailure(state, job, payload, actor);
  return { state, job };
}

function retryFormalGroupingJob(stateInput, id, actor = "system") {
  const state = ensureIntakeState(stateInput);
  const job = state.formalGroupingJobs.find((item) => item.id === id);
  if (!job) throw new Error("正式分组作业不存在");
  if (!['retry-scheduled', 'receipt-rejected'].includes(job.status)) throw new Error("当前状态不允许重试");
  if (job.attemptCount >= job.maxAttempts) throw new Error("正式分组作业已达到最大尝试次数，需先完成死信对账");
  job.status = "queued";
  job.correlationId = `fg-${randomUUID()}`;
  job.requestDigest = GrouperContract.validateRequestEnvelope(formalGroupingEnvelope(job)).digest;
  job.nextRetryAt = undefined;
  job.receiptErrors = [];
  addFormalJobEvent(job, "retry-queued", actor, `准备第${job.attemptCount + 1}次派发`);
  return { state, job, envelope: formalGroupingEnvelope(job) };
}

function reconcileFormalGroupingDeadLetter(stateInput, id, payload = {}, actor = "system") {
  const state = ensureIntakeState(stateInput);
  const job = state.formalGroupingJobs.find((item) => item.id === id);
  if (!job || job.status !== "dead-letter") throw new Error("待对账的正式分组死信不存在");
  const deadLetter = state.formalGroupingDeadLetters.find((item) => item.jobId === id && item.status === "pending-reconciliation");
  if (!deadLetter) throw new Error("正式分组死信记录不存在");
  const resolution = String(payload.resolution || "").trim();
  if (!resolution) throw new Error("死信对账必须填写处置结论");
  deadLetter.status = "resolved";
  deadLetter.resolution = resolution;
  deadLetter.resolvedAt = new Date().toISOString();
  deadLetter.resolvedBy = actor;
  job.status = "queued";
  job.attemptCount = 0;
  job.correlationId = `fg-${randomUUID()}`;
  job.requestDigest = GrouperContract.validateRequestEnvelope(formalGroupingEnvelope(job)).digest;
  job.reopenedAt = deadLetter.resolvedAt;
  addFormalJobEvent(job, "dead-letter-reconciled", actor, resolution);
  return { state, job, deadLetter, envelope: formalGroupingEnvelope(job) };
}

function buildFormalGroupingOperations(stateInput) {
  const state = ensureIntakeState(stateInput);
  const now = Date.now();
  const statuses = Object.fromEntries(["queued", "awaiting-receipt", "retry-scheduled", "receipt-rejected", "dead-letter", "completed"].map((status) => [status, state.formalGroupingJobs.filter((item) => item.status === status).length]));
  const overdue = state.formalGroupingJobs.filter((item) => item.status === "awaiting-receipt" && now - Date.parse(item.dispatchedAt || item.createdAt) > 30 * 60 * 1000).length;
  return {
    adapter: state.grouperAdapters.find((item) => item.id === "official-adapter-v1"),
    summary: { total: state.formalGroupingJobs.length, ...statuses, overdue, pendingDeadLetters: state.formalGroupingDeadLetters.filter((item) => item.status === "pending-reconciliation").length },
    jobs: state.formalGroupingJobs,
    deadLetters: state.formalGroupingDeadLetters,
    retryPolicy: { maxAttemptsDefault: 3, backoffSeconds: [60, 120, 240], receiptSlaMinutes: 30 },
    productionBoundary: "正式分组外部传输、证书和回执真实性仍由国家/地方分组器适配器提供"
  };
}

function verifyLedger(collection) {
  return collection.every((record, index) => {
    const { recordHash, ...base } = record;
    return recordHash === digest(base) && base.sequence === index + 1 && base.previousHash === (index ? collection[index - 1].recordHash : "GENESIS");
  });
}

function buildIntakeSummary(stateInput) {
  const state = ensureIntakeState(stateInput);
  return {
    imports: state.settlementListImports.length,
    acceptedLists: state.settlementLists.length,
    costItems: state.medicalCostItems.length,
    pendingRetries: state.importRetryQueue.filter((item) => item.status !== "resolved").length,
    formalGroupingJobs: state.formalGroupingJobs.length,
    formalGroupingPending: state.formalGroupingJobs.filter((item) => item.status !== "completed").length,
    formalGroupingDeadLetters: state.formalGroupingDeadLetters.filter((item) => item.status === "pending-reconciliation").length,
    groupingRuns: state.groupingRuns.length,
    formalRuns: state.groupingRuns.filter((item) => item.environment === "formal").length,
    simulationRuns: state.groupingRuns.filter((item) => item.environment === "simulation").length,
    ledgerRecords: state.paymentCalculationLedger.length,
    ledgerValid: verifyLedger(state.groupingRuns) && verifyLedger(state.paymentCalculationLedger)
  };
}

module.exports = { QUALITY_CATEGORIES, buildFormalGroupingOperations, buildIntakeSummary, createFormalGroupingJob, digest, dispatchFormalGroupingJob, ensureIntakeState, failFormalGroupingJob, formalGroupingEnvelope, importBatch, normalizeSettlementList, officialCaseDigest, receiveFormalGroupingReceipt, reconcileFormalGroupingDeadLetter, retryFormalGroupingJob, retryImport, runGrouping, stableStringify, validateOfficialReceipt, validateSettlementList, verifyLedger };
