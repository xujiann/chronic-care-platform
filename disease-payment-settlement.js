"use strict";

const { createHash, randomUUID } = require("node:crypto");

const SETTLEMENT_CONTRACT_ID = "insurance-disease-settlement-v1";
const ANNUAL_CLEARANCE_CONTRACT_ID = "insurance-annual-clearance-v1";
const SETTLEMENT_LABELS = Object.freeze({
  BATCH_FROZEN: "待申报",
  CORE_SUBMITTED: "医保核心已申报",
  CORE_ACCEPTED: "已受理",
  RETURNED: "退回补正",
  RECONCILING: "对账中",
  DIFFERENCE_PENDING: "差异待处理",
  RECONCILED: "已对账",
  PAYMENT_REQUESTED: "拨付申请",
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
  "confirm-matched": Object.freeze({ from: ["RECONCILING"], to: "RECONCILED" }),
  "resolve-difference": Object.freeze({ from: ["DIFFERENCE_PENDING"], to: "RECONCILED" }),
  "request-payment": Object.freeze({ from: ["RECONCILED"], to: "PAYMENT_REQUESTED" }),
  "confirm-payment": Object.freeze({ from: ["PAYMENT_REQUESTED"], to: "PAID" }),
  close: Object.freeze({ from: ["PAID"], to: "CLOSED" })
});
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
  if (["core-accepted", "core-returned", "confirm-payment"].includes(action) && options.trustedInsuranceCoreCallback !== true) throw new Error(`${action}只能由医保核心可信回调驱动`);
  const before = settlementState(batch);
  const identity = eventIdentity(payload, action);
  const duplicate = (batch.events || []).find((event) => event.idempotencyKey === identity && event.action === action);
  if (identity && duplicate) return { batch, event: duplicate, idempotent: true };
  if (!rule.from.includes(before)) throw new Error(`结算状态不允许从${SETTLEMENT_LABELS[before] || before}执行${action}`);
  const now = String(payload.at || new Date().toISOString());
  const detail = {};
  if (["submit-core", "resubmit-core"].includes(action)) {
    detail.externalRequestId = requireText(payload, "externalRequestId", "医保核心请求号");
    detail.idempotencyKey = requireText(payload, "idempotencyKey", "医保核心幂等键");
    detail.requestDigest = requireDigest({ requestDigest: payload.requestDigest || digest(buildCoreSettlementEnvelope(batch)) }, "requestDigest", "医保核心请求摘要");
    batch.coreSubmission = { ...detail, submittedAt: now, submittedBy: actor, revision: action === "resubmit-core" ? Number(batch.coreSubmission?.revision || 1) + 1 : 1 };
    if (action === "resubmit-core") batch.correctionDigest = requireDigest(payload, "correctionDigest", "补正摘要");
  }
  if (action === "core-accepted") {
    detail.receiptId = requireText(payload, "receiptId", "医保核心受理回执号");
    batch.coreAcceptance = { receiptId: detail.receiptId, acceptedAt: now, acceptedBy: actor };
  }
  if (action === "core-returned") {
    detail.receiptId = requireText(payload, "receiptId", "医保核心退回回执号");
    detail.reasonCode = requireText(payload, "reasonCode", "退回原因码");
    detail.reason = requireText(payload, "reason", "退回原因");
    batch.returned = { ...detail, returnedAt: now, returnedBy: actor };
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
    batch.reconciliation = { ...(batch.reconciliation || {}), differenceAmountFen, reasonCode: detail.reasonCode, differenceRecordedAt: now };
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
    batch.adjustedAmountFen = adjustedAmountFen;
    batch.adjustedAmount = adjustedAmountFen / 100;
    batch.reconciliation = { ...(batch.reconciliation || {}), resolution: detail.resolution, adjustedAmountFen, reconciledAt: now, reconciledBy: actor };
  }
  if (action === "request-payment") {
    detail.paymentRequestId = requireText(payload, "paymentRequestId", "拨付申请号");
    batch.paymentRequest = { paymentRequestId: detail.paymentRequestId, amountFen: Number(batch.adjustedAmountFen ?? batch.standardAmountFen), requestedAt: now, requestedBy: actor };
  }
  if (action === "confirm-payment") {
    detail.receiptId = requireText(payload, "receiptId", "拨付回执号");
    const paidAmountFen = Number(payload.paidAmountFen);
    const expected = Number(batch.adjustedAmountFen ?? batch.standardAmountFen);
    if (!Number.isSafeInteger(paidAmountFen) || paidAmountFen !== expected) throw new Error("拨付金额必须与已对账金额一致");
    batch.paymentReceipt = { receiptId: detail.receiptId, paidAmountFen, paidAt: now, confirmedBy: actor };
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
  const row = {
    id: String(payload.id || `annual-clearance-${year}-${Date.now()}`),
    year,
    state: "PREPARED",
    status: CLEARANCE_LABELS.PREPARED,
    batchIds: eligible.map((item) => item.id),
    batchCount: eligible.length,
    institutionCount: new Set(eligible.map((item) => item.institution)).size,
    standardAmountFen: eligible.reduce((sum, item) => sum + Number(item.standardAmountFen || 0), 0),
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
  return { year: Number(row.year), batchIds: row.batchIds || [], standardAmountFen: Number(row.standardAmountFen || 0), paidAmountFen: Number(row.paidAmountFen || 0), adjustmentFundFen: Number(row.adjustmentFundFen || 0), retainedBalanceFen: Number(row.retainedBalanceFen || 0), riskReserveFen: Number(row.riskReserveFen || 0), finalClearanceAmountFen: Number(row.finalClearanceAmountFen || 0), adjustmentReason: String(row.adjustmentReason || "") };
}

function buildAnnualClearanceEnvelope(row = {}) {
  const expectedDigest = digest(annualClearanceDigestPayload(row));
  if (!row.clearanceDigest || row.clearanceDigest !== expectedDigest) throw new Error("年度清算摘要校验失败");
  return { contractId: ANNUAL_CLEARANCE_CONTRACT_ID, contractVersion: "1.0.0", clearanceId: row.id, clearanceDigest: row.clearanceDigest, ...annualClearanceDigestPayload(row) };
}

function transitionAnnualClearance(row, payload = {}, actor = "system") {
  const action = String(payload.action || "").trim();
  const rule = CLEARANCE_ACTION_TARGETS[action];
  if (!rule) throw new Error(`不支持的年度清算动作：${action || "空动作"}`);
  const before = row.state || "PREPARED";
  if (!rule.from.includes(before)) throw new Error(`年度清算状态不允许从${CLEARANCE_LABELS[before] || before}执行${action}`);
  const now = String(payload.at || new Date().toISOString());
  const identity = eventIdentity(payload, action);
  const duplicate = (row.events || []).find((event) => event.idempotencyKey === identity && event.action === action);
  if (identity && duplicate) return { row, event: duplicate, idempotent: true };
  buildAnnualClearanceEnvelope(row);
  const detail = {};
  if (action === "record-dispute") {
    detail.institution = requireText(payload, "institution", "争议医院");
    detail.reason = requireText(payload, "reason", "争议原因");
    detail.amountFen = Number(payload.amountFen);
    if (!Number.isSafeInteger(detail.amountFen)) throw new Error("争议金额必须为整数分");
    row.disputes ||= [];
    row.disputes.push({ id: `clearance-dispute-${randomUUID()}`, ...detail, status: "open", createdAt: now, createdBy: actor });
  }
  if (action === "resolve-dispute") {
    detail.resolution = requireText(payload, "resolution", "争议处理结论");
    const open = (row.disputes || []).find((item) => item.status === "open");
    if (!open) throw new Error("没有待处理的年度清算争议");
    Object.assign(open, { status: "resolved", resolution: detail.resolution, resolvedAt: now, resolvedBy: actor });
  }
  if (action === "confirm-institutions") {
    if ((row.disputes || []).some((item) => item.status === "open")) throw new Error("仍有未解决的年度清算争议");
    detail.confirmationDigest = requireDigest(payload, "confirmationDigest", "医院确认摘要");
    row.institutionConfirmation = { digest: detail.confirmationDigest, confirmedAt: now, confirmedBy: actor };
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

module.exports = { ACTION_TARGETS, ANNUAL_CLEARANCE_CONTRACT_ID, CLEARANCE_ACTION_TARGETS, CLEARANCE_LABELS, SETTLEMENT_CONTRACT_ID, SETTLEMENT_LABELS, addWorkingDays, annualClearanceDigestPayload, appendEvent, buildAnnualClearanceEnvelope, buildCoreSettlementCase, buildCoreSettlementEnvelope, buildSettlementSla, createAnnualClearance, dateOnly, digest, isWorkingDay, normalizeWorkingCalendar, settlementState, stableStringify, transitionAnnualClearance, transitionSettlementBatch, verifyEventLedger, workingDaysBetween, yuanToFen };
