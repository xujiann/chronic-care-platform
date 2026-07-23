"use strict";

const { createHash, randomUUID } = require("node:crypto");

const SETTLEMENT_CONTRACT_ID = "insurance-disease-settlement-v1";
const ANNUAL_CLEARANCE_CONTRACT_ID = "insurance-annual-clearance-v1";
const ANNUAL_CLEARANCE_CONTRACT_VERSION = "2.0.0";
const SETTLEMENT_LABELS = Object.freeze({
  BATCH_FROZEN: "待申报",
  CORE_SUBMITTED: "医保核心已申报",
  CORE_ACCEPTED: "已受理",
  RETURNED: "退回补正",
  RECONCILING: "对账中",
  DIFFERENCE_PENDING: "差异待处理",
  RECONCILED: "已对账",
  PAYMENT_REQUESTED: "拨付申请",
  PAYMENT_FAILED: "拨付失败待处理",
  PAID: "已拨付",
  CLOSED: "已结案"
});
const ACTION_TARGETS = Object.freeze({
  "submit-core": Object.freeze({ from: ["BATCH_FROZEN"], to: "CORE_SUBMITTED" }),
  "core-accepted": Object.freeze({ from: ["CORE_SUBMITTED"], to: "CORE_ACCEPTED" }),
  "core-returned": Object.freeze({ from: ["CORE_SUBMITTED", "CORE_ACCEPTED"], to: "RETURNED" }),
  "resubmit-core": Object.freeze({ from: ["RETURNED"], to: "CORE_SUBMITTED" }),
  "start-reconciliation": Object.freeze({ from: ["CORE_ACCEPTED"], to: "RECONCILING" }),
  "record-difference": Object.freeze({ from: ["RECONCILING"], to: "DIFFERENCE_PENDING" }),
  "submit-difference-evidence": Object.freeze({ from: ["DIFFERENCE_PENDING"], to: "DIFFERENCE_PENDING" }),
  "review-difference": Object.freeze({ from: ["DIFFERENCE_PENDING"], to: "DIFFERENCE_PENDING" }),
  "confirm-matched": Object.freeze({ from: ["RECONCILING"], to: "RECONCILED" }),
  "resolve-difference": Object.freeze({ from: ["DIFFERENCE_PENDING"], to: "RECONCILED" }),
  "request-payment": Object.freeze({ from: ["RECONCILED"], to: "PAYMENT_REQUESTED" }),
  "payment-failed": Object.freeze({ from: ["PAYMENT_REQUESTED"], to: "PAYMENT_FAILED" }),
  "retry-payment": Object.freeze({ from: ["PAYMENT_FAILED"], to: "PAYMENT_REQUESTED" }),
  "confirm-payment": Object.freeze({ from: ["PAYMENT_REQUESTED"], to: "PAID" }),
  close: Object.freeze({ from: ["PAID"], to: "CLOSED" })
});
const DIFFERENCE_REVIEW_DOMAINS = Object.freeze(["hospital-finance", "insurance-settlement"]);
const CORE_CORRECTION_POLICY = Object.freeze({ correctionWorkingDays: 5, excessiveReturnCycles: 3 });
const PAYMENT_FAILURE_POLICY = Object.freeze({ resolutionWorkingDays: 2, maxRetryCycles: 3 });
const CLEARANCE_LABELS = Object.freeze({
  PREPARED: "清算准备",
  INSTITUTION_CONFIRMING: "医院确认中",
  DISPUTE_PENDING: "争议处理中",
  INSTITUTION_CONFIRMED: "医院已确认",
  CLEARANCE_APPROVED: "清算已批准",
  POSTED: "财务已入账",
  LOCKED: "已锁账"
});
const CLEARANCE_ACTION_TARGETS = Object.freeze({
  "start-confirmation": Object.freeze({ from: ["PREPARED"], to: "INSTITUTION_CONFIRMING" }),
  "record-dispute": Object.freeze({ from: ["INSTITUTION_CONFIRMING"], to: "DISPUTE_PENDING" }),
  "resolve-dispute": Object.freeze({ from: ["DISPUTE_PENDING"], to: "INSTITUTION_CONFIRMING" }),
  "confirm-institution": Object.freeze({ from: ["INSTITUTION_CONFIRMING"], to: "INSTITUTION_CONFIRMING" }),
  "confirm-institutions": Object.freeze({ from: ["INSTITUTION_CONFIRMING"], to: "INSTITUTION_CONFIRMED" }),
  approve: Object.freeze({ from: ["INSTITUTION_CONFIRMED"], to: "CLEARANCE_APPROVED" }),
  post: Object.freeze({ from: ["CLEARANCE_APPROVED"], to: "POSTED" }),
  lock: Object.freeze({ from: ["POSTED"], to: "LOCKED" })
});

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function yuanToFen(value, label = "金额") {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label}必须为非负金额`);
  const fen = Math.round(number * 100);
  if (!Number.isSafeInteger(fen)) throw new Error(`${label}超出安全金额范围`);
  return fen;
}

function requireText(payload, field, label = field) {
  const value = String(payload[field] || "").trim();
  if (!value) throw new Error(`${label}不能为空`);
  return value;
}

function requireDigest(payload, field, label = field) {
  const value = requireText(payload, field, label);
  if (!/^(sha256:)?[a-f0-9]{64}$/i.test(value)) throw new Error(`${label}必须为SHA-256摘要`);
  return value.replace(/^sha256:/i, "").toLowerCase();
}

function dateOnly(value, label = "日期") {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label}必须为YYYY-MM-DD`);
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error(`${label}无效`);
  return text;
}

function normalizeWorkingCalendar(input = {}) {
  const uniqueDates = (values, label) => [...new Set((Array.isArray(values) ? values : []).map((item) => dateOnly(item, label)))].sort();
  const nonWorkingDates = uniqueDates(input.nonWorkingDates, "非工作日");
  const workingWeekendDates = uniqueDates(input.workingWeekendDates, "调休工作日");
  if (nonWorkingDates.some((item) => workingWeekendDates.includes(item))) throw new Error("同一日期不能同时标记为非工作日和调休工作日");
  return { version: String(input.version || "weekday-only-demo-v1").trim(), nonWorkingDates, workingWeekendDates, productionEvidence: input.productionEvidence === true };
}

function isWorkingDay(value, calendar = {}) {
  const day = dateOnly(value);
  if ((calendar.workingWeekendDates || []).includes(day)) return true;
  if ((calendar.nonWorkingDates || []).includes(day)) return false;
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

function addWorkingDays(value, count, calendar = {}) {
  const days = Number(count);
  if (!Number.isInteger(days) || days < 0 || days > 366) throw new Error("工作日数量无效");
  const cursor = new Date(`${dateOnly(value)}T00:00:00.000Z`);
  let added = 0;
  while (added < days) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWorkingDay(cursor.toISOString().slice(0, 10), calendar)) added += 1;
  }
  return cursor.toISOString().slice(0, 10);
}

function workingDaysBetween(start, end, calendar = {}) {
  const startDate = new Date(`${dateOnly(start)}T00:00:00.000Z`);
  const endDate = new Date(`${dateOnly(end)}T00:00:00.000Z`);
  if (endDate < startDate) return 0;
  let count = 0;
  const cursor = new Date(startDate);
  while (cursor < endDate) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isWorkingDay(cursor.toISOString().slice(0, 10), calendar)) count += 1;
  }
  return count;
}

function buildSettlementSla(batch = {}, at = new Date().toISOString()) {
  const submissionDeadline = dateOnly(batch.submissionDeadline, "申报截止日");
  const calendar = normalizeWorkingCalendar(batch.workingCalendar || {});
  const policyWorkingDays = Number(batch.policyWorkingDays || 30);
  if (!Number.isInteger(policyWorkingDays) || policyWorkingDays <= 0 || policyWorkingDays > 120) throw new Error("结算SLA工作日无效");
  const dueDate = addWorkingDays(submissionDeadline, policyWorkingDays, calendar);
  const completedDate = batch.paymentReceipt?.paidAt ? dateOnly(batch.paymentReceipt.paidAt, "拨付日期") : "";
  const evaluatedDate = completedDate || dateOnly(at, "SLA评估日期");
  const elapsedWorkingDays = workingDaysBetween(submissionDeadline, evaluatedDate, calendar);
  const overdueWorkingDays = Math.max(0, elapsedWorkingDays - policyWorkingDays);
  const status = completedDate ? (overdueWorkingDays ? "completed-overdue" : "completed-within-sla") : overdueWorkingDays ? "overdue" : "within-sla";
  return { policyWorkingDays, submissionDeadline, dueDate, completedDate, evaluatedDate, elapsedWorkingDays, remainingWorkingDays: Math.max(0, policyWorkingDays - elapsedWorkingDays), overdueWorkingDays, status, calendar };
}

function buildDifferenceCaseSla(differenceCase = {}, calendarInput = {}, at = new Date().toISOString()) {
  const calendar = normalizeWorkingCalendar(calendarInput);
  const reviewWorkingDays = Number(differenceCase.reviewWorkingDays || 5);
  if (!Number.isInteger(reviewWorkingDays) || reviewWorkingDays <= 0 || reviewWorkingDays > 30) throw new Error("差额处理工作日必须为1至30");
  const openedDate = dateOnly(differenceCase.currentReviewOpenedAt || differenceCase.createdAt, "差额处理开始日期");
  const dueDate = addWorkingDays(openedDate, reviewWorkingDays, calendar);
  const completedDate = differenceCase.resolvedAt ? dateOnly(differenceCase.resolvedAt, "差额解决日期") : "";
  const evaluatedDate = completedDate || dateOnly(at, "差额SLA评估日期");
  const elapsedWorkingDays = workingDaysBetween(openedDate, evaluatedDate, calendar);
  const overdueWorkingDays = Math.max(0, elapsedWorkingDays - reviewWorkingDays);
  const status = completedDate ? (overdueWorkingDays ? "completed-overdue" : "completed-within-sla") : overdueWorkingDays ? "overdue" : "within-sla";
  return { reviewWorkingDays, openedDate, dueDate, completedDate, evaluatedDate, elapsedWorkingDays, remainingWorkingDays: Math.max(0, reviewWorkingDays - elapsedWorkingDays), overdueWorkingDays, status, calendar };
}

function coreReturnDigestPayload(cycle = {}) {
  return {
    cycleId: String(cycle.id || ""),
    batchId: String(cycle.batchId || ""),
    revision: Number(cycle.revision || 0),
    receiptId: String(cycle.receiptId || ""),
    reasonCode: String(cycle.reasonCode || ""),
    reason: String(cycle.reason || ""),
    requirementDigest: String(cycle.requirementDigest || ""),
    returnedAt: String(cycle.returnedAt || ""),
    returnedBy: String(cycle.returnedBy || ""),
    correctionWorkingDays: Number(cycle.correctionWorkingDays || 0),
    dueDate: String(cycle.dueDate || "")
  };
}

function verifyCoreReturnCycle(cycle = {}) {
  return /^[a-f0-9]{64}$/.test(String(cycle.returnDigest || "")) && cycle.returnDigest === digest(coreReturnDigestPayload(cycle));
}

function verifyCoreReturnCycleEvidence(batch = {}, cycle = {}) {
  if (!verifyEventLedger(batch.events || []) || !verifyCoreReturnCycle(cycle)) return false;
  const events = batch.events || [];
  const returned = events.some((event) => event.action === "core-returned"
    && event.detail?.returnCycleId === cycle.id
    && event.detail?.returnDigest === cycle.returnDigest
    && event.detail?.requirementDigest === cycle.requirementDigest
    && event.detail?.receiptId === cycle.receiptId);
  if (!returned) return false;
  if (cycle.resubmission || cycle.status !== "OPEN") {
    const resubmitted = events.some((event) => event.action === "resubmit-core"
      && event.detail?.returnCycleId === cycle.id
      && event.detail?.externalRequestId === cycle.resubmission?.externalRequestId
      && event.detail?.requestDigest === cycle.resubmission?.requestDigest
      && event.detail?.correctionDigest === cycle.resubmission?.correctionDigest);
    if (!resubmitted) return false;
  }
  if (cycle.status === "ACCEPTED" && !events.some((event) => event.action === "core-accepted" && event.detail?.returnCycleId === cycle.id && event.detail?.receiptId === cycle.acceptanceReceiptId)) return false;
  if (cycle.status === "RETURNED_AGAIN" && !events.some((event) => event.action === "core-returned" && event.detail?.receiptId === cycle.nextReturnReceiptId)) return false;
  return true;
}

function buildCoreCorrectionSla(cycle = {}, calendarInput = {}, at = new Date().toISOString()) {
  const calendar = normalizeWorkingCalendar(calendarInput);
  const correctionWorkingDays = Number(cycle.correctionWorkingDays || CORE_CORRECTION_POLICY.correctionWorkingDays);
  if (!Number.isInteger(correctionWorkingDays) || correctionWorkingDays <= 0 || correctionWorkingDays > 30) throw new Error("医保核心补正工作日必须为1至30");
  const returnedDate = dateOnly(cycle.returnedAt, "医保核心退回日期");
  const dueDate = addWorkingDays(returnedDate, correctionWorkingDays, calendar);
  const completedDate = cycle.resubmittedAt ? dateOnly(cycle.resubmittedAt, "医保核心补正重报日期") : "";
  const evaluatedDate = completedDate || dateOnly(at, "医保核心补正SLA评估日期");
  const elapsedWorkingDays = workingDaysBetween(returnedDate, evaluatedDate, calendar);
  const overdueWorkingDays = Math.max(0, elapsedWorkingDays - correctionWorkingDays);
  const status = completedDate ? (overdueWorkingDays ? "completed-overdue" : "completed-within-sla") : overdueWorkingDays ? "overdue" : "within-sla";
  return { correctionWorkingDays, returnedDate, dueDate, completedDate, evaluatedDate, elapsedWorkingDays, remainingWorkingDays: Math.max(0, correctionWorkingDays - elapsedWorkingDays), overdueWorkingDays, status, calendar };
}

function buildSettlementCoreCorrectionOperations(batches = [], options = {}) {
  const at = String(options.at || new Date().toISOString());
  const rows = batches.flatMap((batch) => (batch.coreReturnCycles || []).map((cycle) => {
    const integrity = verifyCoreReturnCycleEvidence(batch, cycle);
    let sla;
    try {
      sla = buildCoreCorrectionSla(cycle, batch.workingCalendar || {}, at);
    } catch (error) {
      sla = { status: "invalid", error: error.message };
    }
    return {
      batchId: batch.id,
      period: batch.period,
      institution: batch.institution,
      cycleId: cycle.id,
      revision: cycle.revision,
      status: cycle.status,
      reasonCode: cycle.reasonCode,
      requirementDigest: cycle.requirementDigest,
      returnDigest: cycle.returnDigest,
      correctionDigest: cycle.resubmission?.correctionDigest || "",
      integrity: integrity ? "valid" : "invalid",
      sla
    };
  }));
  return {
    generatedAt: at,
    summary: {
      total: rows.length,
      open: rows.filter((item) => item.status === "OPEN").length,
      overdue: rows.filter((item) => item.status === "OPEN" && item.sla.status === "overdue").length,
      resubmitted: rows.filter((item) => item.status === "RESUBMITTED").length,
      accepted: rows.filter((item) => item.status === "ACCEPTED").length,
      returnedAgain: rows.filter((item) => item.status === "RETURNED_AGAIN").length,
      invalid: rows.filter((item) => item.integrity === "invalid").length,
      excessiveBatches: batches.filter((batch) => (batch.coreReturnCycles || []).length > CORE_CORRECTION_POLICY.excessiveReturnCycles).length
    },
    items: rows,
    privacyBoundary: "仅返回批次、机构、原因码、摘要和SLA，不返回病例、患者或退回原因原文。"
  };
}

function paymentFailureDigestPayload(cycle = {}) {
  return {
    cycleId: String(cycle.id || ""),
    batchId: String(cycle.batchId || ""),
    revision: Number(cycle.revision || 0),
    paymentRequestId: String(cycle.paymentRequestId || ""),
    receiptId: String(cycle.receiptId || ""),
    reasonCode: String(cycle.reasonCode || ""),
    reason: String(cycle.reason || ""),
    failureEvidenceDigest: String(cycle.failureEvidenceDigest || ""),
    failedAt: String(cycle.failedAt || ""),
    failedBy: String(cycle.failedBy || ""),
    resolutionWorkingDays: Number(cycle.resolutionWorkingDays || 0),
    dueDate: String(cycle.dueDate || "")
  };
}

function verifyPaymentFailureCycle(cycle = {}) {
  return /^[a-f0-9]{64}$/.test(String(cycle.failureDigest || "")) && cycle.failureDigest === digest(paymentFailureDigestPayload(cycle));
}

function verifyPaymentFailureCycleEvidence(batch = {}, cycle = {}) {
  if (!verifyEventLedger(batch.events || []) || !verifyPaymentFailureCycle(cycle)) return false;
  const events = batch.events || [];
  const failed = events.some((event) => event.action === "payment-failed"
    && event.detail?.failureCycleId === cycle.id
    && event.detail?.failureDigest === cycle.failureDigest
    && event.detail?.failureEvidenceDigest === cycle.failureEvidenceDigest
    && event.detail?.receiptId === cycle.receiptId);
  if (!failed) return false;
  if (cycle.retry || cycle.status !== "OPEN") {
    const retried = events.some((event) => event.action === "retry-payment"
      && event.detail?.failureCycleId === cycle.id
      && event.detail?.paymentRequestId === cycle.retry?.paymentRequestId
      && event.detail?.resolutionDigest === cycle.retry?.resolutionDigest);
    if (!retried) return false;
  }
  if (cycle.status === "SUCCEEDED" && !events.some((event) => event.action === "confirm-payment" && event.detail?.failureCycleId === cycle.id && event.detail?.receiptId === cycle.paymentReceiptId)) return false;
  if (cycle.status === "FAILED_AGAIN" && !events.some((event) => event.action === "payment-failed" && event.detail?.receiptId === cycle.nextFailureReceiptId)) return false;
  return true;
}

function buildPaymentFailureSla(cycle = {}, calendarInput = {}, at = new Date().toISOString()) {
  const calendar = normalizeWorkingCalendar(calendarInput);
  const resolutionWorkingDays = Number(cycle.resolutionWorkingDays || PAYMENT_FAILURE_POLICY.resolutionWorkingDays);
  if (!Number.isInteger(resolutionWorkingDays) || resolutionWorkingDays <= 0 || resolutionWorkingDays > 30) throw new Error("拨付失败处理工作日必须为1至30");
  const failedDate = dateOnly(cycle.failedAt, "拨付失败日期");
  const dueDate = addWorkingDays(failedDate, resolutionWorkingDays, calendar);
  const completedDate = cycle.retriedAt ? dateOnly(cycle.retriedAt, "拨付重试日期") : "";
  const evaluatedDate = completedDate || dateOnly(at, "拨付失败SLA评估日期");
  const elapsedWorkingDays = workingDaysBetween(failedDate, evaluatedDate, calendar);
  const overdueWorkingDays = Math.max(0, elapsedWorkingDays - resolutionWorkingDays);
  const status = completedDate ? (overdueWorkingDays ? "completed-overdue" : "completed-within-sla") : overdueWorkingDays ? "overdue" : "within-sla";
  return { resolutionWorkingDays, failedDate, dueDate, completedDate, evaluatedDate, elapsedWorkingDays, remainingWorkingDays: Math.max(0, resolutionWorkingDays - elapsedWorkingDays), overdueWorkingDays, status, calendar };
}

function buildSettlementPaymentFailureOperations(batches = [], options = {}) {
  const at = String(options.at || new Date().toISOString());
  const rows = batches.flatMap((batch) => (batch.paymentFailureCycles || []).map((cycle) => {
    const integrity = verifyPaymentFailureCycleEvidence(batch, cycle);
    let sla;
    try {
      sla = buildPaymentFailureSla(cycle, batch.workingCalendar || {}, at);
    } catch (error) {
      sla = { status: "invalid", error: error.message };
    }
    return {
      batchId: batch.id,
      period: batch.period,
      institution: batch.institution,
      cycleId: cycle.id,
      revision: cycle.revision,
      paymentRequestId: cycle.paymentRequestId,
      status: cycle.status,
      reasonCode: cycle.reasonCode,
      failureEvidenceDigest: cycle.failureEvidenceDigest,
      failureDigest: cycle.failureDigest,
      resolutionDigest: cycle.retry?.resolutionDigest || "",
      integrity: integrity ? "valid" : "invalid",
      sla
    };
  }));
  return {
    generatedAt: at,
    summary: {
      total: rows.length,
      open: rows.filter((item) => item.status === "OPEN").length,
      overdue: rows.filter((item) => item.status === "OPEN" && item.sla.status === "overdue").length,
      retried: rows.filter((item) => item.status === "RETRIED").length,
      succeeded: rows.filter((item) => item.status === "SUCCEEDED").length,
      failedAgain: rows.filter((item) => item.status === "FAILED_AGAIN").length,
      invalid: rows.filter((item) => item.integrity === "invalid").length,
      retryExhausted: batches.filter((batch) => (batch.paymentFailureCycles || []).length >= PAYMENT_FAILURE_POLICY.maxRetryCycles && batch.settlementState === "PAYMENT_FAILED").length
    },
    items: rows,
    privacyBoundary: "仅返回批次、机构、拨付申请号、原因码、摘要和SLA，不返回病例、患者或失败原因原文。"
  };
}

function eventIdentity(payload, action) {
  return String(payload.idempotencyKey || payload.receiptId || payload.externalRequestId || payload.paymentRequestId || `${action}:${payload.at || ""}`).trim();
}

function appendEvent(target, event) {
  target.events ||= [];
  const previousHash = target.events.length ? target.events[target.events.length - 1].eventHash : "GENESIS";
  const base = { ...event, sequence: target.events.length + 1, previousHash };
  const sealed = Object.freeze({ ...base, eventHash: digest(base) });
  target.events.push(sealed);
  return sealed;
}

function verifyEventLedger(events = []) {
  return events.every((event, index) => {
    const { eventHash, ...base } = event;
    return base.sequence === index + 1 && base.previousHash === (index ? events[index - 1].eventHash : "GENESIS") && eventHash === digest(base);
  });
}

function settlementState(batch = {}) {
  return batch.settlementState || Object.entries(SETTLEMENT_LABELS).find(([, label]) => label === batch.status)?.[0] || "BATCH_FROZEN";
}

function buildCoreSettlementCase(item = {}) {
  const basePaymentStandardFen = Number(item.basePaymentStandardFen ?? item.paymentStandardFen ?? yuanToFen(item.paymentStandard || 0, "病例基础支付标准"));
  const paymentStandardFen = Number(item.paymentStandardFen ?? yuanToFen(item.paymentStandard || 0, "病例支付标准"));
  if (!Number.isSafeInteger(basePaymentStandardFen) || basePaymentStandardFen < 0 || !Number.isSafeInteger(paymentStandardFen) || paymentStandardFen < 0) throw new Error("医保核心病例支付金额必须为非负整数分");
  const specialCaseId = String(item.specialCaseId || "").trim();
  const specialCaseDecisionDigest = String(item.specialCaseDecisionDigest || "").trim().toLowerCase();
  if (Boolean(specialCaseId) !== Boolean(specialCaseDecisionDigest) || (specialCaseDecisionDigest && !/^[a-f0-9]{64}$/.test(specialCaseDecisionDigest))) throw new Error("特例单议编号与有效决议摘要必须成对提供");
  return { caseId: item.caseId, settlementListNo: item.settlementListNo, formalReceiptId: item.formalReceiptId, formalReceiptDigest: item.formalReceiptDigest, schemeVersion: item.schemeVersion, groupCode: item.groupCode, parameterId: item.parameterId, basePaymentStandardFen, paymentStandardFen, specialCaseId, specialCaseDecisionDigest };
}

function buildCoreSettlementEnvelope(batch = {}) {
  return {
    contractId: SETTLEMENT_CONTRACT_ID,
    contractVersion: "1.0.0",
    batchId: batch.id,
    batchDigest: batch.batchDigest,
    period: batch.period,
    settlementType: batch.type === "年度清算" ? "annual" : "monthly",
    institutionReference: batch.institution,
    caseCount: Number(batch.caseCount || 0),
    declaredAmountFen: Number(batch.declaredAmountFen ?? yuanToFen(batch.declaredAmount || 0, "申报金额")),
    standardAmountFen: Number(batch.standardAmountFen ?? yuanToFen(batch.standardAmount || 0, "标准金额")),
    cases: (batch.calculationSnapshots || []).map(buildCoreSettlementCase)
  };
}

function transitionSettlementBatch(batch, payload = {}, actor = "system", options = {}) {
  const action = String(payload.action || "").trim();
  const rule = ACTION_TARGETS[action];
  if (!rule) throw new Error(`不支持的结算动作：${action || "空动作"}`);
  if (["core-accepted", "core-returned", "payment-failed", "confirm-payment"].includes(action) && options.trustedInsuranceCoreCallback !== true) throw new Error(`${action}只能由医保核心可信回调驱动`);
  if (!verifyEventLedger(batch.events || [])) throw new Error("结算批次事件账本校验失败");
  const before = settlementState(batch);
  const identity = eventIdentity(payload, action);
  const duplicate = (batch.events || []).find((event) => event.idempotencyKey === identity && event.action === action);
  if (identity && duplicate) return { batch, event: duplicate, idempotent: true };
  if (!rule.from.includes(before)) throw new Error(`结算状态不允许从${SETTLEMENT_LABELS[before] || before}执行${action}`);
  const now = String(payload.at || new Date().toISOString());
  const detail = {};
  if (["submit-core", "resubmit-core"].includes(action)) {
    const previousSubmission = batch.coreSubmission;
    detail.externalRequestId = requireText(payload, "externalRequestId", "医保核心请求号");
    detail.idempotencyKey = requireText(payload, "idempotencyKey", "医保核心幂等键");
    detail.requestDigest = requireDigest({ requestDigest: payload.requestDigest || digest(buildCoreSettlementEnvelope(batch)) }, "requestDigest", "医保核心请求摘要");
    if (action === "resubmit-core") {
      const cycle = (batch.coreReturnCycles || []).at(-1);
      if (!cycle || cycle.status !== "OPEN") throw new Error("没有待补正的医保核心退回周期");
      if (!verifyCoreReturnCycleEvidence(batch, cycle)) throw new Error("医保核心退回周期摘要或账本证据校验失败");
      detail.returnCycleId = requireText(payload, "returnCycleId", "医保核心退回周期号");
      if (detail.returnCycleId !== cycle.id) throw new Error("医保核心退回周期号与当前待补正周期不一致");
      detail.correctionDigest = requireDigest(payload, "correctionDigest", "补正摘要");
      if (detail.externalRequestId === previousSubmission?.externalRequestId || detail.idempotencyKey === previousSubmission?.idempotencyKey) throw new Error("补正重报必须使用新的医保核心请求号和幂等键");
      cycle.status = "RESUBMITTED";
      cycle.resubmittedAt = now;
      cycle.resubmittedBy = actor;
      cycle.resubmission = { externalRequestId: detail.externalRequestId, idempotencyKey: detail.idempotencyKey, requestDigest: detail.requestDigest, correctionDigest: detail.correctionDigest };
      cycle.sla = buildCoreCorrectionSla(cycle, batch.workingCalendar || {}, now);
      detail.correctionSlaStatus = cycle.sla.status;
      batch.correctionDigest = detail.correctionDigest;
    }
    batch.coreSubmission = { externalRequestId: detail.externalRequestId, idempotencyKey: detail.idempotencyKey, requestDigest: detail.requestDigest, submittedAt: now, submittedBy: actor, revision: action === "resubmit-core" ? Number(previousSubmission?.revision || 1) + 1 : 1 };
  }
  if (action === "core-accepted") {
    detail.receiptId = requireText(payload, "receiptId", "医保核心受理回执号");
    batch.coreAcceptance = { receiptId: detail.receiptId, acceptedAt: now, acceptedBy: actor };
    const cycle = (batch.coreReturnCycles || []).at(-1);
    if (cycle?.status === "RESUBMITTED") {
      if (!verifyCoreReturnCycleEvidence(batch, cycle)) throw new Error("医保核心退回周期摘要或账本证据校验失败");
      cycle.status = "ACCEPTED";
      cycle.acceptedAt = now;
      cycle.acceptedBy = actor;
      cycle.acceptanceReceiptId = detail.receiptId;
      detail.returnCycleId = cycle.id;
    }
  }
  if (action === "core-returned") {
    detail.receiptId = requireText(payload, "receiptId", "医保核心退回回执号");
    detail.reasonCode = requireText(payload, "reasonCode", "退回原因码");
    detail.reason = requireText(payload, "reason", "退回原因");
    detail.requirementDigest = requireDigest(payload, "requirementDigest", "补正要求摘要");
    const correctionWorkingDays = Number(payload.correctionWorkingDays || CORE_CORRECTION_POLICY.correctionWorkingDays);
    if (!Number.isInteger(correctionWorkingDays) || correctionWorkingDays <= 0 || correctionWorkingDays > 30) throw new Error("医保核心补正工作日必须为1至30");
    batch.coreReturnCycles ||= [];
    const previousCycle = batch.coreReturnCycles.at(-1);
    if (previousCycle?.status === "RESUBMITTED") {
      if (!verifyCoreReturnCycleEvidence(batch, previousCycle)) throw new Error("医保核心退回周期摘要或账本证据校验失败");
      previousCycle.status = "RETURNED_AGAIN";
      previousCycle.nextReturnReceiptId = detail.receiptId;
    }
    const cycle = {
      id: String(payload.returnCycleId || `core-return-${randomUUID()}`),
      batchId: batch.id,
      revision: Number(batch.coreSubmission?.revision || 1),
      receiptId: detail.receiptId,
      reasonCode: detail.reasonCode,
      reason: detail.reason,
      requirementDigest: detail.requirementDigest,
      returnedAt: now,
      returnedBy: actor,
      correctionWorkingDays,
      dueDate: addWorkingDays(dateOnly(now), correctionWorkingDays, batch.workingCalendar || {}),
      status: "OPEN"
    };
    if (batch.coreReturnCycles.some((item) => item.id === cycle.id)) throw new Error("医保核心退回周期号已存在");
    cycle.returnDigest = digest(coreReturnDigestPayload(cycle));
    cycle.sla = buildCoreCorrectionSla(cycle, batch.workingCalendar || {}, now);
    batch.coreReturnCycles.push(cycle);
    detail.returnCycleId = cycle.id;
    detail.returnDigest = cycle.returnDigest;
    detail.correctionDueDate = cycle.dueDate;
    batch.returned = { receiptId: detail.receiptId, reasonCode: detail.reasonCode, reason: detail.reason, requirementDigest: detail.requirementDigest, returnCycleId: cycle.id, returnDigest: cycle.returnDigest, returnedAt: now, returnedBy: actor };
  }
  if (action === "start-reconciliation") {
    detail.providerSummaryDigest = requireDigest(payload, "providerSummaryDigest", "医保核心对账摘要");
    batch.reconciliation = { providerSummaryDigest: detail.providerSummaryDigest, startedAt: now, startedBy: actor };
  }
  if (action === "record-difference") {
    const differenceAmountFen = Number(payload.differenceAmountFen);
    if (!Number.isSafeInteger(differenceAmountFen) || differenceAmountFen === 0) throw new Error("对账差额必须为非零整数分");
    detail.differenceAmountFen = differenceAmountFen;
    detail.reasonCode = requireText(payload, "reasonCode", "差额原因码");
    detail.evidenceDigest = requireDigest(payload, "evidenceDigest", "差额证据摘要");
    const reviewWorkingDays = Number(payload.reviewWorkingDays || 5);
    if (!Number.isInteger(reviewWorkingDays) || reviewWorkingDays <= 0 || reviewWorkingDays > 30) throw new Error("差额处理工作日必须为1至30");
    const differenceCase = {
      id: String(payload.differenceCaseId || `settlement-difference-${randomUUID()}`),
      batchId: batch.id,
      state: "OPEN",
      differenceAmountFen,
      reasonCode: detail.reasonCode,
      evidence: { digest: detail.evidenceDigest, revision: 1, submittedAt: now, submittedBy: actor },
      reviewWorkingDays,
      currentReviewOpenedAt: now,
      createdAt: now,
      createdBy: actor,
      reviews: [],
      events: []
    };
    differenceCase.sla = buildDifferenceCaseSla(differenceCase, batch.workingCalendar || {}, now);
    appendEvent(differenceCase, { id: `difference-event-${randomUUID()}`, action: "record", from: "NONE", to: "OPEN", actor, at: now, idempotencyKey: identity, detail: { differenceAmountFen, reasonCode: detail.reasonCode, evidenceDigest: detail.evidenceDigest, dueDate: differenceCase.sla.dueDate } });
    detail.differenceCaseId = differenceCase.id;
    batch.reconciliation = { ...(batch.reconciliation || {}), differenceAmountFen, reasonCode: detail.reasonCode, differenceRecordedAt: now, differenceCaseId: differenceCase.id, differenceCase };
  }
  if (action === "submit-difference-evidence") {
    const differenceCase = batch.reconciliation?.differenceCase;
    if (!differenceCase || !["OPEN", "REJECTED"].includes(differenceCase.state)) throw new Error("当前差额状态不允许补充证据");
    if (!verifyEventLedger(differenceCase.events)) throw new Error("差额事件账本校验失败");
    if (differenceCase.state === "OPEN" && differenceCase.reviews.length) throw new Error("已有复核意见时只能在驳回后补充证据");
    detail.evidenceDigest = requireDigest(payload, "evidenceDigest", "差额补充证据摘要");
    detail.correctionReason = requireText(payload, "correctionReason", "差额补证原因");
    const beforeCase = differenceCase.state;
    differenceCase.evidence = { digest: detail.evidenceDigest, revision: Number(differenceCase.evidence?.revision || 0) + 1, submittedAt: now, submittedBy: actor, correctionReason: detail.correctionReason };
    differenceCase.state = "OPEN";
    differenceCase.reviews = [];
    differenceCase.currentReviewOpenedAt = now;
    differenceCase.sla = buildDifferenceCaseSla(differenceCase, batch.workingCalendar || {}, now);
    appendEvent(differenceCase, { id: `difference-event-${randomUUID()}`, action: "submit-evidence", from: beforeCase, to: "OPEN", actor, at: now, idempotencyKey: identity, detail: { evidenceDigest: detail.evidenceDigest, revision: differenceCase.evidence.revision, correctionReason: detail.correctionReason, dueDate: differenceCase.sla.dueDate } });
  }
  if (action === "review-difference") {
    const differenceCase = batch.reconciliation?.differenceCase;
    if (!differenceCase || !["OPEN", "UNDER_REVIEW"].includes(differenceCase.state)) throw new Error("当前差额状态不允许复核");
    if (!verifyEventLedger(differenceCase.events)) throw new Error("差额事件账本校验失败");
    const reviewDomain = requireText(payload, "reviewDomain", "差额复核领域");
    if (!DIFFERENCE_REVIEW_DOMAINS.includes(reviewDomain)) throw new Error("差额复核领域无效");
    if (differenceCase.reviews.some((item) => item.reviewDomain === reviewDomain)) throw new Error("同一差额复核领域不得重复签署");
    if (differenceCase.reviews.some((item) => item.reviewer === actor)) throw new Error("同一复核人不得跨领域重复签署");
    if (typeof payload.approved !== "boolean") throw new Error("差额复核结论不能为空");
    const review = { id: `difference-review-${randomUUID()}`, reviewDomain, approved: payload.approved, reviewer: actor, reviewedAt: now };
    if (payload.approved) {
      review.adjustedAmountFen = Number(payload.adjustedAmountFen);
      if (!Number.isSafeInteger(review.adjustedAmountFen) || review.adjustedAmountFen < 0) throw new Error("差额复核金额必须为非负整数分");
      review.resolutionDigest = requireDigest(payload, "resolutionDigest", "差额处置摘要");
      const priorApproval = differenceCase.reviews.find((item) => item.approved);
      if (priorApproval && (priorApproval.adjustedAmountFen !== review.adjustedAmountFen || priorApproval.resolutionDigest !== review.resolutionDigest)) throw new Error("医院与医保差额复核金额及处置摘要必须一致");
    } else {
      review.reasonCode = requireText(payload, "reasonCode", "差额驳回原因码");
      review.opinion = requireText(payload, "opinion", "差额驳回意见");
    }
    const beforeCase = differenceCase.state;
    differenceCase.reviews.push(review);
    if (!review.approved) differenceCase.state = "REJECTED";
    else if (DIFFERENCE_REVIEW_DOMAINS.every((domain) => differenceCase.reviews.some((item) => item.reviewDomain === domain && item.approved))) differenceCase.state = "RESOLUTION_READY";
    else differenceCase.state = "UNDER_REVIEW";
    differenceCase.sla = buildDifferenceCaseSla(differenceCase, batch.workingCalendar || {}, now);
    appendEvent(differenceCase, { id: `difference-event-${randomUUID()}`, action: review.approved ? "approve" : "reject", from: beforeCase, to: differenceCase.state, actor, at: now, idempotencyKey: identity, detail: { reviewDomain, approved: review.approved, adjustedAmountFen: review.adjustedAmountFen, resolutionDigest: review.resolutionDigest, reasonCode: review.reasonCode } });
    detail.differenceCaseId = differenceCase.id;
    detail.reviewDomain = reviewDomain;
    detail.approved = review.approved;
  }
  if (action === "confirm-matched") {
    const providerAmountFen = Number(payload.providerAmountFen);
    const expected = Number(batch.adjustedAmountFen ?? batch.standardAmountFen);
    if (!Number.isSafeInteger(providerAmountFen) || providerAmountFen !== expected) throw new Error("医保核心金额与冻结批次金额不一致");
    detail.providerAmountFen = providerAmountFen;
    batch.reconciliation = { ...(batch.reconciliation || {}), providerAmountFen, differenceAmountFen: 0, reconciledAt: now, reconciledBy: actor };
  }
  if (action === "resolve-difference") {
    detail.resolution = requireText(payload, "resolution", "差额处置结论");
    const adjustedAmountFen = Number(payload.adjustedAmountFen);
    if (!Number.isSafeInteger(adjustedAmountFen) || adjustedAmountFen < 0) throw new Error("调整后金额必须为非负整数分");
    const differenceCase = batch.reconciliation?.differenceCase;
    if (!differenceCase || differenceCase.state !== "RESOLUTION_READY") throw new Error("差额必须经医院财务与医保经办双域复核后才能解决");
    if (!verifyEventLedger(differenceCase.events)) throw new Error("差额事件账本校验失败");
    const approvals = differenceCase.reviews.filter((item) => item.approved);
    const resolutionDigest = requireDigest(payload, "resolutionDigest", "差额处置摘要");
    if (approvals.length !== DIFFERENCE_REVIEW_DOMAINS.length || approvals.some((item) => item.adjustedAmountFen !== adjustedAmountFen || item.resolutionDigest !== resolutionDigest)) throw new Error("差额解决金额或处置摘要与双域复核意见不一致");
    const beforeCase = differenceCase.state;
    differenceCase.state = "RESOLVED";
    differenceCase.resolvedAt = now;
    differenceCase.resolvedBy = actor;
    differenceCase.resolution = { text: detail.resolution, digest: resolutionDigest, adjustedAmountFen };
    differenceCase.sla = buildDifferenceCaseSla(differenceCase, batch.workingCalendar || {}, now);
    appendEvent(differenceCase, { id: `difference-event-${randomUUID()}`, action: "resolve", from: beforeCase, to: "RESOLVED", actor, at: now, idempotencyKey: identity, detail: { adjustedAmountFen, resolutionDigest } });
    batch.adjustedAmountFen = adjustedAmountFen;
    batch.adjustedAmount = adjustedAmountFen / 100;
    batch.reconciliation = { ...(batch.reconciliation || {}), resolution: detail.resolution, resolutionDigest, adjustedAmountFen, differenceAmountFen: 0, reconciledAt: now, reconciledBy: actor };
  }
  if (action === "request-payment") {
    detail.paymentRequestId = requireText(payload, "paymentRequestId", "拨付申请号");
    batch.paymentRequest = { paymentRequestId: detail.paymentRequestId, amountFen: Number(batch.adjustedAmountFen ?? batch.standardAmountFen), requestedAt: now, requestedBy: actor, revision: 1 };
  }
  if (action === "payment-failed") {
    detail.receiptId = requireText(payload, "receiptId", "拨付失败回执号");
    detail.reasonCode = requireText(payload, "reasonCode", "拨付失败原因码");
    detail.reason = requireText(payload, "reason", "拨付失败原因");
    detail.failureEvidenceDigest = requireDigest(payload, "failureEvidenceDigest", "拨付失败证据摘要");
    const resolutionWorkingDays = Number(payload.resolutionWorkingDays || PAYMENT_FAILURE_POLICY.resolutionWorkingDays);
    if (!Number.isInteger(resolutionWorkingDays) || resolutionWorkingDays <= 0 || resolutionWorkingDays > 30) throw new Error("拨付失败处理工作日必须为1至30");
    batch.paymentFailureCycles ||= [];
    const previousCycle = batch.paymentFailureCycles.at(-1);
    if (previousCycle?.status === "RETRIED") {
      if (!verifyPaymentFailureCycleEvidence(batch, previousCycle)) throw new Error("拨付失败周期摘要或账本证据校验失败");
      previousCycle.status = "FAILED_AGAIN";
      previousCycle.nextFailureReceiptId = detail.receiptId;
    }
    const cycle = {
      id: String(payload.failureCycleId || `payment-failure-${randomUUID()}`),
      batchId: batch.id,
      revision: Number(batch.paymentRequest?.revision || 1),
      paymentRequestId: String(batch.paymentRequest?.paymentRequestId || ""),
      receiptId: detail.receiptId,
      reasonCode: detail.reasonCode,
      reason: detail.reason,
      failureEvidenceDigest: detail.failureEvidenceDigest,
      failedAt: now,
      failedBy: actor,
      resolutionWorkingDays,
      dueDate: addWorkingDays(dateOnly(now), resolutionWorkingDays, batch.workingCalendar || {}),
      status: "OPEN"
    };
    if (!cycle.paymentRequestId) throw new Error("拨付失败回调缺少匹配的拨付申请");
    if (batch.paymentFailureCycles.some((item) => item.id === cycle.id)) throw new Error("拨付失败周期号已存在");
    cycle.failureDigest = digest(paymentFailureDigestPayload(cycle));
    cycle.sla = buildPaymentFailureSla(cycle, batch.workingCalendar || {}, now);
    batch.paymentFailureCycles.push(cycle);
    detail.failureCycleId = cycle.id;
    detail.failureDigest = cycle.failureDigest;
    detail.resolutionDueDate = cycle.dueDate;
    batch.paymentFailure = { receiptId: detail.receiptId, reasonCode: detail.reasonCode, reason: detail.reason, failureEvidenceDigest: detail.failureEvidenceDigest, failureCycleId: cycle.id, failureDigest: cycle.failureDigest, failedAt: now, failedBy: actor };
  }
  if (action === "retry-payment") {
    const cycle = (batch.paymentFailureCycles || []).at(-1);
    if (!cycle || cycle.status !== "OPEN") throw new Error("没有待处理的拨付失败周期");
    if (!verifyPaymentFailureCycleEvidence(batch, cycle)) throw new Error("拨付失败周期摘要或账本证据校验失败");
    if (batch.paymentFailureCycles.length >= PAYMENT_FAILURE_POLICY.maxRetryCycles) throw new Error("拨付失败已达到最大重试周期数，必须转人工处置");
    detail.failureCycleId = requireText(payload, "failureCycleId", "拨付失败周期号");
    if (detail.failureCycleId !== cycle.id) throw new Error("拨付失败周期号与当前待处理周期不一致");
    detail.paymentRequestId = requireText(payload, "paymentRequestId", "新拨付申请号");
    if (detail.paymentRequestId === batch.paymentRequest?.paymentRequestId) throw new Error("拨付重试必须使用新的拨付申请号");
    detail.resolutionDigest = requireDigest(payload, "resolutionDigest", "拨付失败处置摘要");
    detail.resolution = requireText(payload, "resolution", "拨付失败处置结论");
    cycle.status = "RETRIED";
    cycle.retriedAt = now;
    cycle.retriedBy = actor;
    cycle.retry = { paymentRequestId: detail.paymentRequestId, resolutionDigest: detail.resolutionDigest, resolution: detail.resolution };
    cycle.sla = buildPaymentFailureSla(cycle, batch.workingCalendar || {}, now);
    detail.failureSlaStatus = cycle.sla.status;
    batch.paymentRequest = { paymentRequestId: detail.paymentRequestId, amountFen: Number(batch.adjustedAmountFen ?? batch.standardAmountFen), requestedAt: now, requestedBy: actor, revision: Number(batch.paymentRequest?.revision || 1) + 1 };
  }
  if (action === "confirm-payment") {
    detail.receiptId = requireText(payload, "receiptId", "拨付回执号");
    const paidAmountFen = Number(payload.paidAmountFen);
    const expected = Number(batch.adjustedAmountFen ?? batch.standardAmountFen);
    if (!Number.isSafeInteger(paidAmountFen) || paidAmountFen !== expected) throw new Error("拨付金额必须与已对账金额一致");
    batch.paymentReceipt = { receiptId: detail.receiptId, paidAmountFen, paidAt: now, confirmedBy: actor };
    const cycle = (batch.paymentFailureCycles || []).at(-1);
    if (cycle?.status === "RETRIED") {
      if (!verifyPaymentFailureCycleEvidence(batch, cycle)) throw new Error("拨付失败周期摘要或账本证据校验失败");
      cycle.status = "SUCCEEDED";
      cycle.succeededAt = now;
      cycle.succeededBy = actor;
      cycle.paymentReceiptId = detail.receiptId;
      detail.failureCycleId = cycle.id;
    }
  }
  if (action === "close") {
    detail.closeReference = requireText(payload, "closeReference", "结案凭证号");
    batch.closedAt = now;
    batch.closedBy = actor;
    batch.closeReference = detail.closeReference;
  }
  batch.settlementState = rule.to;
  batch.status = SETTLEMENT_LABELS[rule.to];
  batch.updatedAt = now;
  batch.updatedBy = actor;
  if (batch.submissionDeadline) batch.sla = buildSettlementSla(batch, now);
  const event = appendEvent(batch, { id: `settlement-event-${randomUUID()}`, action, from: before, to: rule.to, actor, at: now, idempotencyKey: identity, detail });
  return { batch, event, idempotent: false };
}

function createAnnualClearance(batches = [], payload = {}, actor = "system") {
  const year = Number(payload.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("年度清算年份无效");
  const eligible = batches.filter((batch) => batch.type === "月度结算" && String(batch.period || "").startsWith(`${year}-`) && ["PAID", "CLOSED"].includes(settlementState(batch)));
  if (!eligible.length) throw new Error("该年度没有已拨付或已结案的月度结算批次");
  const adjustmentFundFen = Number(payload.adjustmentFundFen || 0);
  const retainedBalanceFen = Number(payload.retainedBalanceFen || 0);
  const riskReserveFen = Number(payload.riskReserveFen || 0);
  if (![adjustmentFundFen, retainedBalanceFen, riskReserveFen].every(Number.isSafeInteger) || retainedBalanceFen < 0 || riskReserveFen < 0) throw new Error("调节金、结余留用和风险准备金必须为有效整数分");
  const paidAmountFen = eligible.reduce((sum, item) => sum + Number(item.paymentReceipt?.paidAmountFen || item.adjustedAmountFen || item.standardAmountFen || 0), 0);
  const finalClearanceAmountFen = paidAmountFen + adjustmentFundFen - retainedBalanceFen - riskReserveFen;
  if (!Number.isSafeInteger(finalClearanceAmountFen) || finalClearanceAmountFen < 0) throw new Error("年度最终清算金额无效");
  const institutionMap = new Map();
  for (const batch of eligible) {
    const snapshots = Array.isArray(batch.calculationSnapshots) && batch.calculationSnapshots.length ? batch.calculationSnapshots : [{ institution: batch.institution || "全部机构", institutionCode: batch.institutionCode || "ALL_INSTITUTIONS", paymentStandardFen: batch.standardAmountFen, caseId: "" }];
    for (const snapshot of snapshots) {
      const institutionId = String(snapshot.institutionCode || snapshot.institution || batch.institutionCode || batch.institution || "ALL_INSTITUTIONS").trim();
      const institutionName = String(snapshot.institution || batch.institution || institutionId).trim();
      const current = institutionMap.get(institutionId) || { institutionId, institutionName, batchIds: new Set(), caseCount: 0, standardAmountFen: 0 };
      current.batchIds.add(batch.id);
      current.caseCount += snapshot.caseId ? 1 : Number(batch.caseCount || 0);
      current.standardAmountFen += Number(snapshot.paymentStandardFen || 0);
      institutionMap.set(institutionId, current);
    }
  }
  const institutionConfirmations = [...institutionMap.values()].map((item) => ({ institutionId: item.institutionId, institutionName: item.institutionName, batchIds: [...item.batchIds].sort(), caseCount: item.caseCount, standardAmountFen: item.standardAmountFen, state: "PENDING", confirmation: null }));
  const institutionStandardAmountFen = institutionConfirmations.reduce((sum, item) => sum + item.standardAmountFen, 0);
  const standardAmountFen = eligible.reduce((sum, item) => sum + Number(item.standardAmountFen || 0), 0);
  if (institutionStandardAmountFen !== standardAmountFen) throw new Error("逐机构清算金额与年度标准金额不一致");
  const row = {
    id: String(payload.id || `annual-clearance-${year}-${Date.now()}`),
    contractVersion: ANNUAL_CLEARANCE_CONTRACT_VERSION,
    year,
    state: "PREPARED",
    status: CLEARANCE_LABELS.PREPARED,
    batchIds: eligible.map((item) => item.id),
    batchCount: eligible.length,
    institutionCount: institutionConfirmations.length,
    institutionConfirmations,
    standardAmountFen,
    paidAmountFen,
    adjustmentFundFen,
    retainedBalanceFen,
    riskReserveFen,
    finalClearanceAmountFen,
    adjustmentReason: String(payload.adjustmentReason || "").trim(),
    createdAt: new Date().toISOString(),
    createdBy: actor,
    events: []
  };
  row.clearanceDigest = digest(annualClearanceDigestPayload(row));
  appendEvent(row, { id: `clearance-event-${randomUUID()}`, action: "prepare", from: "NONE", to: "PREPARED", actor, at: row.createdAt, idempotencyKey: row.id, detail: { clearanceDigest: row.clearanceDigest } });
  return row;
}

function annualClearanceDigestPayload(row = {}) {
  if (row.contractVersion !== ANNUAL_CLEARANCE_CONTRACT_VERSION) {
    return { year: Number(row.year), batchIds: row.batchIds || [], standardAmountFen: Number(row.standardAmountFen || 0), paidAmountFen: Number(row.paidAmountFen || 0), adjustmentFundFen: Number(row.adjustmentFundFen || 0), retainedBalanceFen: Number(row.retainedBalanceFen || 0), riskReserveFen: Number(row.riskReserveFen || 0), finalClearanceAmountFen: Number(row.finalClearanceAmountFen || 0), adjustmentReason: String(row.adjustmentReason || "") };
  }
  const institutions = (row.institutionConfirmations || []).map((item) => ({ institutionId: item.institutionId, institutionName: item.institutionName, batchIds: item.batchIds || [], caseCount: Number(item.caseCount || 0), standardAmountFen: Number(item.standardAmountFen || 0) })).sort((left, right) => left.institutionId.localeCompare(right.institutionId));
  return { contractVersion: row.contractVersion, year: Number(row.year), batchIds: row.batchIds || [], institutionCount: Number(row.institutionCount || institutions.length), institutions, standardAmountFen: Number(row.standardAmountFen || 0), paidAmountFen: Number(row.paidAmountFen || 0), adjustmentFundFen: Number(row.adjustmentFundFen || 0), retainedBalanceFen: Number(row.retainedBalanceFen || 0), riskReserveFen: Number(row.riskReserveFen || 0), finalClearanceAmountFen: Number(row.finalClearanceAmountFen || 0), adjustmentReason: String(row.adjustmentReason || "") };
}

function institutionConfirmationDigest(row = {}) {
  const confirmations = (row.institutionConfirmations || []).map((item) => ({ institutionId: item.institutionId, confirmationDigest: item.confirmation?.digest || "" })).sort((left, right) => left.institutionId.localeCompare(right.institutionId));
  if (!confirmations.length || confirmations.some((item) => !/^[a-f0-9]{64}$/.test(item.confirmationDigest))) throw new Error("机构确认尚未完整");
  if (!verifyEventLedger(row.events)) throw new Error("年度清算事件账本校验失败");
  if (confirmations.some((item) => !(row.events || []).some((event) => event.action === "confirm-institution" && event.detail?.institutionId === item.institutionId && event.detail?.confirmationDigest === item.confirmationDigest))) throw new Error("机构确认缺少匹配的账本事件");
  return digest({ clearanceId: row.id, clearanceDigest: row.clearanceDigest, confirmations });
}

function buildAnnualClearanceEnvelope(row = {}) {
  const expectedDigest = digest(annualClearanceDigestPayload(row));
  if (!row.clearanceDigest || row.clearanceDigest !== expectedDigest) throw new Error("年度清算摘要校验失败");
  return { contractId: ANNUAL_CLEARANCE_CONTRACT_ID, contractVersion: row.contractVersion || "1.0.0", clearanceId: row.id, clearanceDigest: row.clearanceDigest, ...annualClearanceDigestPayload(row) };
}

function transitionAnnualClearance(row, payload = {}, actor = "system") {
  const action = String(payload.action || "").trim();
  const rule = CLEARANCE_ACTION_TARGETS[action];
  if (!rule) throw new Error(`不支持的年度清算动作：${action || "空动作"}`);
  const before = row.state || "PREPARED";
  if (!rule.from.includes(before)) throw new Error(`年度清算状态不允许从${CLEARANCE_LABELS[before] || before}执行${action}`);
  const now = String(payload.at || new Date().toISOString());
  const identity = eventIdentity(payload, action);
  if (!verifyEventLedger(row.events)) throw new Error("年度清算事件账本校验失败");
  const duplicate = (row.events || []).find((event) => event.idempotencyKey === identity && event.action === action);
  if (identity && duplicate) return { row, event: duplicate, idempotent: true };
  buildAnnualClearanceEnvelope(row);
  const detail = {};
  if (action === "record-dispute") {
    detail.institutionId = String(payload.institutionId || payload.institution || "").trim();
    if (!detail.institutionId) throw new Error("争议医院标识不能为空");
    const institution = (row.institutionConfirmations || []).find((item) => item.institutionId === detail.institutionId || item.institutionName === detail.institutionId);
    if (!institution) throw new Error("争议医院不在年度清算确认清单");
    detail.reason = requireText(payload, "reason", "争议原因");
    detail.reasonCode = requireText(payload, "reasonCode", "争议原因码");
    detail.evidenceDigest = requireDigest(payload, "evidenceDigest", "争议证据摘要");
    detail.amountFen = Number(payload.amountFen);
    if (!Number.isSafeInteger(detail.amountFen) || detail.amountFen === 0) throw new Error("争议金额必须为非零整数分");
    row.disputes ||= [];
    const disputeId = String(payload.disputeId || `clearance-dispute-${randomUUID()}`);
    if (row.disputes.some((item) => item.id === disputeId)) throw new Error("年度清算争议编号已存在");
    institution.state = "DISPUTED";
    institution.confirmation = null;
    row.disputes.push({ id: disputeId, ...detail, institutionId: institution.institutionId, status: "open", createdAt: now, createdBy: actor });
    detail.disputeId = disputeId;
  }
  if (action === "resolve-dispute") {
    detail.disputeId = requireText(payload, "disputeId", "争议编号");
    detail.resolution = requireText(payload, "resolution", "争议处理结论");
    detail.resolutionDigest = requireDigest(payload, "resolutionDigest", "争议处理摘要");
    detail.resolvedAmountFen = Number(payload.resolvedAmountFen);
    if (!Number.isSafeInteger(detail.resolvedAmountFen)) throw new Error("争议解决金额必须为整数分");
    const open = (row.disputes || []).find((item) => item.id === detail.disputeId && item.status === "open");
    if (!open) throw new Error("没有待处理的年度清算争议");
    const institution = (row.institutionConfirmations || []).find((item) => item.institutionId === open.institutionId);
    if (!institution) throw new Error("争议医院不在年度清算确认清单");
    Object.assign(open, { status: "resolved", resolution: detail.resolution, resolutionDigest: detail.resolutionDigest, resolvedAmountFen: detail.resolvedAmountFen, resolvedAt: now, resolvedBy: actor });
    institution.state = "PENDING";
    institution.confirmation = null;
  }
  if (action === "confirm-institution") {
    detail.institutionId = requireText(payload, "institutionId", "确认医院标识");
    const institution = (row.institutionConfirmations || []).find((item) => item.institutionId === detail.institutionId);
    if (!institution) throw new Error("确认医院不在年度清算确认清单");
    if ((row.disputes || []).some((item) => item.institutionId === institution.institutionId && item.status === "open")) throw new Error("该医院仍有未解决的年度清算争议");
    if (institution.state === "CONFIRMED") throw new Error("该医院已完成年度清算确认");
    detail.confirmationDigest = requireDigest(payload, "confirmationDigest", "医院确认摘要");
    institution.state = "CONFIRMED";
    institution.confirmation = { digest: detail.confirmationDigest, confirmedAt: now, confirmedBy: actor };
  }
  if (action === "confirm-institutions") {
    if ((row.disputes || []).some((item) => item.status === "open")) throw new Error("仍有未解决的年度清算争议");
    if (!(row.institutionConfirmations || []).length || row.institutionConfirmations.some((item) => item.state !== "CONFIRMED")) throw new Error("仍有医院未完成年度清算确认");
    const expectedDigest = institutionConfirmationDigest(row);
    detail.confirmationDigest = requireDigest(payload, "confirmationDigest", "医院汇总确认摘要");
    if (detail.confirmationDigest !== expectedDigest) throw new Error("医院汇总确认摘要与逐机构确认不一致");
    row.institutionConfirmation = { digest: detail.confirmationDigest, institutionCount: row.institutionConfirmations.length, confirmedAt: now, confirmedBy: actor };
  }
  if (action === "approve") {
    if ((row.adjustmentFundFen || row.retainedBalanceFen || row.riskReserveFen) && !row.adjustmentReason) throw new Error("存在年度资金调整时必须填写调整原因");
    detail.adjustmentApprovalDigest = (row.adjustmentFundFen || row.retainedBalanceFen || row.riskReserveFen) ? requireDigest(payload, "adjustmentApprovalDigest", "资金调整批准摘要") : "";
    row.approval = { approvalNo: requireText(payload, "approvalNo", "清算批准文号"), adjustmentApprovalDigest: detail.adjustmentApprovalDigest, approvedAt: now, approvedBy: actor };
  }
  if (action === "post") {
    const postedAmountFen = Number(payload.postedAmountFen ?? row.finalClearanceAmountFen);
    if (!Number.isSafeInteger(postedAmountFen) || postedAmountFen !== row.finalClearanceAmountFen) throw new Error("财务入账金额必须与最终清算金额一致");
    detail.postedAmountFen = postedAmountFen;
    row.posting = { voucherNo: requireText(payload, "voucherNo", "财务凭证号"), postedAmountFen, postedAt: now, postedBy: actor };
  }
  if (action === "lock") {
    detail.lockReference = requireText(payload, "lockReference", "锁账凭证号");
    if (!row.posting || row.posting.postedAmountFen !== row.finalClearanceAmountFen) throw new Error("年度清算财务入账金额未核准，禁止锁账");
    if (!verifyEventLedger(row.events)) throw new Error("年度清算事件账本校验失败，禁止锁账");
    row.lockedAt = now;
    row.lockedBy = actor;
    row.lockReference = detail.lockReference;
  }
  row.state = rule.to;
  row.status = CLEARANCE_LABELS[rule.to];
  row.updatedAt = now;
  row.updatedBy = actor;
  const event = appendEvent(row, { id: `clearance-event-${randomUUID()}`, action, from: before, to: rule.to, actor, at: now, idempotencyKey: identity, detail });
  return { row, event, idempotent: false };
}

module.exports = { ACTION_TARGETS, ANNUAL_CLEARANCE_CONTRACT_ID, ANNUAL_CLEARANCE_CONTRACT_VERSION, CLEARANCE_ACTION_TARGETS, CLEARANCE_LABELS, CORE_CORRECTION_POLICY, DIFFERENCE_REVIEW_DOMAINS, PAYMENT_FAILURE_POLICY, SETTLEMENT_CONTRACT_ID, SETTLEMENT_LABELS, addWorkingDays, annualClearanceDigestPayload, appendEvent, buildAnnualClearanceEnvelope, buildCoreCorrectionSla, buildCoreSettlementCase, buildCoreSettlementEnvelope, buildDifferenceCaseSla, buildPaymentFailureSla, buildSettlementCoreCorrectionOperations, buildSettlementPaymentFailureOperations, buildSettlementSla, coreReturnDigestPayload, createAnnualClearance, dateOnly, digest, institutionConfirmationDigest, isWorkingDay, normalizeWorkingCalendar, paymentFailureDigestPayload, settlementState, stableStringify, transitionAnnualClearance, transitionSettlementBatch, verifyCoreReturnCycle, verifyCoreReturnCycleEvidence, verifyEventLedger, verifyPaymentFailureCycle, verifyPaymentFailureCycleEvidence, workingDaysBetween, yuanToFen };
