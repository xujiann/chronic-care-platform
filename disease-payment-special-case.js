"use strict";

const { createHash, randomUUID } = require("node:crypto");

const SPECIAL_CASE_LABELS = Object.freeze({
  APPLIED: "待评审",
  UNDER_REVIEW: "复核中",
  APPROVED: "评审通过",
  REJECTED: "不予通过",
  WITHDRAWN: "已撤回",
  INCLUDED: "已纳入结算"
});
const ACTIVE_STATES = new Set(["APPLIED", "UNDER_REVIEW", "APPROVED", "INCLUDED"]);

class SpecialCaseWorkflowError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = "SpecialCaseWorkflowError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function digest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function safeText(value, maximum = 240) {
  return String(value || "").replace(/[\r\n\0]/g, " ").trim().slice(0, maximum);
}

function toFen(value, label, allowZero = false) {
  const number = Number(value);
  const fen = Number.isSafeInteger(number) ? number : NaN;
  if (!Number.isSafeInteger(fen) || (allowZero ? fen < 0 : fen <= 0)) throw new SpecialCaseWorkflowError(`${label}必须为${allowZero ? "非负" : "正"}整数分`, "SPECIAL_CASE_AMOUNT_INVALID", 400);
  return fen;
}

function normalizeEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > 20) throw new SpecialCaseWorkflowError("特例单议必须提交1至20项摘要证据", "SPECIAL_CASE_EVIDENCE_REQUIRED", 400);
  return evidence.map((item, index) => {
    const type = safeText(item?.type, 80);
    const evidenceDigest = safeText(item?.digest, 80).toLowerCase();
    if (!type || !/^sha256:[a-f0-9]{64}$/.test(evidenceDigest)) throw new SpecialCaseWorkflowError(`第${index + 1}项证据类型或SHA-256摘要无效`, "SPECIAL_CASE_EVIDENCE_INVALID", 400);
    return { type, digest: evidenceDigest, issuedBy: safeText(item.issuedBy, 120), issuedAt: safeText(item.issuedAt, 40) };
  });
}

function appendEvent(row, event) {
  row.events ||= [];
  const previousHash = row.events.length ? row.events.at(-1).eventHash : "GENESIS";
  const base = { ...event, sequence: row.events.length + 1, previousHash };
  const sealed = Object.freeze({ ...base, eventHash: digest(base) });
  row.events.push(sealed);
  return sealed;
}

function verifySpecialCaseLedger(events = []) {
  return events.every((event, index) => {
    const { eventHash, ...base } = event;
    return base.sequence === index + 1 && base.previousHash === (index ? events[index - 1].eventHash : "GENESIS") && eventHash === digest(base);
  });
}

function specialCaseState(row = {}) {
  if (SPECIAL_CASE_LABELS[row.state]) return row.state;
  return Object.entries(SPECIAL_CASE_LABELS).find(([, label]) => label === row.status)?.[0] || "APPLIED";
}

function createSpecialCaseApplication(item, payload = {}, actor = "operator") {
  const submittedBy = safeText(actor, 120);
  if (!submittedBy) throw new SpecialCaseWorkflowError("特例单议申请人不能为空", "SPECIAL_CASE_APPLICANT_REQUIRED", 400);
  const reason = safeText(payload.reason);
  if (!reason) throw new SpecialCaseWorkflowError("特例单议原因不能为空", "SPECIAL_CASE_REASON_REQUIRED", 400);
  const evidence = normalizeEvidence(payload.evidence);
  const totalAmountFen = Math.round(Number(item.totalAmount || 0) * 100);
  const requestedPaymentFen = toFen(payload.requestedPaymentFen ?? totalAmountFen, "申请支付金额");
  if (requestedPaymentFen > totalAmountFen) throw new SpecialCaseWorkflowError("申请支付金额不得超过病例总费用", "SPECIAL_CASE_AMOUNT_EXCEEDS_COST", 400);
  const now = new Date().toISOString();
  const row = {
    id: safeText(payload.id || `special-${randomUUID()}`, 120),
    caseId: item.id,
    institution: item.institution,
    reason,
    reasonCode: safeText(payload.reasonCode || "COMPLEX_CRITICAL", 60),
    requestedMethod: safeText(payload.requestedMethod || "调整支付标准", 120),
    requestedPaymentFen,
    caseTotalAmountFen: totalAmountFen,
    evidence,
    evidenceDigest: digest(evidence),
    state: "APPLIED",
    status: SPECIAL_CASE_LABELS.APPLIED,
    submittedAt: now,
    submittedBy,
    reviews: [],
    events: []
  };
  appendEvent(row, { id: `special-event-${randomUUID()}`, action: "apply", from: "NONE", to: "APPLIED", actor: submittedBy, at: now, idempotencyKey: safeText(payload.idempotencyKey || row.id, 160), detail: { reasonCode: row.reasonCode, requestedPaymentFen, evidenceDigest: row.evidenceDigest } });
  return row;
}

function reviewSpecialCaseApplication(row, payload = {}, actor = "reviewer") {
  const before = specialCaseState(row);
  if (!["APPLIED", "UNDER_REVIEW"].includes(before)) throw new SpecialCaseWorkflowError("当前状态不允许评审特例单议", "SPECIAL_CASE_REVIEW_STATE_INVALID");
  const reviewer = safeText(actor, 120);
  if (!reviewer || reviewer === row.submittedBy) throw new SpecialCaseWorkflowError("特例单议申请人与评审人必须分离", "SPECIAL_CASE_REVIEWER_SEPARATION_REQUIRED", 403);
  row.reviews ||= [];
  if (row.reviews.some((item) => item.reviewer === reviewer)) throw new SpecialCaseWorkflowError("同一评审人不得重复签署", "SPECIAL_CASE_DUPLICATE_REVIEWER");
  const approved = payload.approved === true;
  const adjustedPaymentFen = approved ? toFen(payload.adjustedPaymentFen ?? Math.round(Number(payload.adjustedPayment ?? row.requestedPaymentFen / 100) * 100), "评审支付金额") : 0;
  const caseTotalAmountFen = Number(row.caseTotalAmountFen || row.requestedPaymentFen);
  if (approved && adjustedPaymentFen > caseTotalAmountFen) throw new SpecialCaseWorkflowError("评审支付金额不得超过病例总费用", "SPECIAL_CASE_AMOUNT_EXCEEDS_COST", 400);
  const priorApproved = row.reviews.find((item) => item.approved);
  if (approved && priorApproved && priorApproved.adjustedPaymentFen !== adjustedPaymentFen) throw new SpecialCaseWorkflowError("两名评审人的支付金额意见必须一致", "SPECIAL_CASE_REVIEW_AMOUNT_CONFLICT");
  const now = new Date().toISOString();
  const review = { id: `special-review-${randomUUID()}`, reviewer, role: safeText(payload.role || "医保评审", 80), approved, adjustedPaymentFen, opinion: safeText(payload.opinion || (approved ? "符合特例单议范围" : "仍按病种标准付费")), reviewedAt: now };
  row.reviews.push(review);
  row.state = !approved ? "REJECTED" : row.reviews.filter((item) => item.approved).length >= 2 ? "APPROVED" : "UNDER_REVIEW";
  row.status = SPECIAL_CASE_LABELS[row.state];
  row.updatedAt = now;
  row.updatedBy = reviewer;
  if (row.state === "APPROVED") {
    row.adjustedPaymentFen = adjustedPaymentFen;
    row.adjustedPayment = adjustedPaymentFen / 100;
    row.reviewedAt = now;
    row.reviewedBy = row.reviews.map((item) => item.reviewer);
    row.decisionDigest = digest({ caseId: row.caseId, requestedPaymentFen: row.requestedPaymentFen, adjustedPaymentFen, evidenceDigest: row.evidenceDigest, approvals: row.reviews.filter((item) => item.approved).map((item) => ({ reviewer: item.reviewer, role: item.role, reviewedAt: item.reviewedAt })) });
  }
  appendEvent(row, { id: `special-event-${randomUUID()}`, action: approved ? "approve-review" : "reject-review", from: before, to: row.state, actor: reviewer, at: now, idempotencyKey: review.id, detail: { role: review.role, adjustedPaymentFen, opinion: review.opinion, decisionDigest: row.decisionDigest || "" } });
  return { row, review };
}

function settlementAdjustment(specialCases = [], item = {}) {
  const row = specialCases.find((candidate) => candidate.caseId === item.id && specialCaseState(candidate) === "APPROVED");
  if (!row) return null;
  if (!verifySpecialCaseLedger(row.events) || !/^[a-f0-9]{64}$/.test(String(row.decisionDigest || ""))) throw new SpecialCaseWorkflowError("特例单议决议或事件账本校验失败", "SPECIAL_CASE_LEDGER_INVALID");
  return { row, adjustedPaymentFen: toFen(row.adjustedPaymentFen, "特例单议支付金额"), decisionDigest: row.decisionDigest };
}

function includeSpecialCaseInSettlement(row, batchId, actor = "settlement-service") {
  if (specialCaseState(row) !== "APPROVED") throw new SpecialCaseWorkflowError("只有已批准特例单议可纳入结算", "SPECIAL_CASE_INCLUDE_STATE_INVALID");
  const now = new Date().toISOString();
  row.state = "INCLUDED";
  row.status = SPECIAL_CASE_LABELS.INCLUDED;
  row.settlementBatchId = batchId;
  row.includedAt = now;
  row.includedBy = safeText(actor, 120);
  appendEvent(row, { id: `special-event-${randomUUID()}`, action: "include-settlement", from: "APPROVED", to: "INCLUDED", actor: row.includedBy, at: now, idempotencyKey: batchId, detail: { batchId, decisionDigest: row.decisionDigest } });
  return row;
}

module.exports = { ACTIVE_STATES, SPECIAL_CASE_LABELS, SpecialCaseWorkflowError, appendEvent, createSpecialCaseApplication, digest, includeSpecialCaseInSettlement, reviewSpecialCaseApplication, settlementAdjustment, specialCaseState, stableStringify, verifySpecialCaseLedger };
