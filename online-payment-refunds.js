"use strict";

const { createHash, randomUUID } = require("node:crypto");

const REFUND_STATES = Object.freeze({
  REQUESTED: "待复核",
  UNDER_REVIEW: "复核中",
  APPROVED: "已批准",
  REJECTED: "已驳回",
  DISPATCHED: "已派发",
  PROCESSING: "退费处理中",
  SUCCEEDED: "退费成功",
  FAILED: "退费失败",
  CANCELLED: "已取消",
  RECONCILED: "已对账",
  CLOSED: "已结案"
});
const RESERVED_STATES = new Set(["REQUESTED", "UNDER_REVIEW", "APPROVED", "DISPATCHED", "PROCESSING", "SUCCEEDED", "FAILED", "RECONCILED", "CLOSED"]);
const REQUIRED_REFUND_REVIEW_DOMAINS = Object.freeze(["business-review", "finance-review"]);
const REFUND_SLA_POLICY = Object.freeze({
  reviewMinutes: 120,
  dispatchMinutes: 30,
  callbackMinutes: 30,
  failureDecisionMinutes: 240,
  reconciliationMinutes: 2160,
  voucherCloseMinutes: 1440
});

class RefundWorkflowError extends Error {
  constructor(message, code, statusCode = 409) {
    super(message);
    this.name = "RefundWorkflowError";
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

function safeText(value, maximum = 200) {
  return String(value || "").replace(/[\r\n\0]/g, " ").trim().slice(0, maximum);
}

function positiveFen(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new RefundWorkflowError(`${label}必须为正整数分`, "REFUND_AMOUNT_INVALID", 400);
  return number;
}

function normalizeSha256Digest(value, label, code) {
  const normalized = safeText(value, 80).replace(/^sha256:/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new RefundWorkflowError(`${label}必须为 SHA-256 摘要`, code, 400);
  return normalized;
}

function appendEvent(row, event) {
  row.events ||= [];
  const previousHash = row.events.length ? row.events[row.events.length - 1].eventHash : "GENESIS";
  const base = { ...event, sequence: row.events.length + 1, previousHash };
  const sealed = Object.freeze({ ...base, eventHash: digest(base) });
  row.events.push(sealed);
  return sealed;
}

function verifyRefundLedger(events = []) {
  return events.every((event, index) => {
    const { eventHash, ...base } = event;
    return base.sequence === index + 1 && base.previousHash === (index ? events[index - 1].eventHash : "GENESIS") && eventHash === digest(base);
  });
}

function requireValidRefundLedger(row) {
  if (!Array.isArray(row.events) || row.events.length === 0 || !verifyRefundLedger(row.events)) throw new RefundWorkflowError("退款事件账本校验失败", "REFUND_LEDGER_INVALID");
  return row;
}

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function refundSlaPhase(row = {}) {
  const lastAttempt = (row.attempts || []).at(-1);
  const phases = {
    REQUESTED: { phase: "review", anchor: row.requestedAt, minutes: "reviewMinutes" },
    UNDER_REVIEW: { phase: "review", anchor: row.requestedAt, minutes: "reviewMinutes" },
    APPROVED: { phase: "dispatch", anchor: row.approvedAt || row.updatedAt || row.requestedAt, minutes: "dispatchMinutes" },
    DISPATCHED: { phase: "provider-callback", anchor: lastAttempt?.dispatchedAt, minutes: "callbackMinutes" },
    PROCESSING: { phase: "provider-callback", anchor: lastAttempt?.dispatchedAt, minutes: "callbackMinutes" },
    FAILED: { phase: "failure-decision", anchor: row.failedAt || row.updatedAt, minutes: "failureDecisionMinutes" },
    SUCCEEDED: { phase: "daily-reconciliation", anchor: row.succeededAt || row.updatedAt, minutes: "reconciliationMinutes" },
    RECONCILED: { phase: "voucher-close", anchor: row.reconciledAt || row.updatedAt, minutes: "voucherCloseMinutes" }
  };
  return phases[row.state] || null;
}

function normalizeRefundSlaPolicy(input = {}) {
  const policy = {};
  for (const [key, fallback] of Object.entries(REFUND_SLA_POLICY)) {
    const value = Number(input[key] ?? fallback);
    if (!Number.isInteger(value) || value <= 0 || value > 43_200) throw new RefundWorkflowError("退款SLA配置必须为有效正整数分钟", "REFUND_SLA_POLICY_INVALID", 400);
    policy[key] = value;
  }
  return policy;
}

function buildRefundSla(row = {}, at = new Date().toISOString(), policyInput = {}) {
  const policy = normalizeRefundSlaPolicy(policyInput);
  const evaluatedTimestamp = timestamp(at);
  if (!Number.isFinite(evaluatedTimestamp)) throw new RefundWorkflowError("退款SLA评估时间无效", "REFUND_SLA_EVALUATION_TIME_INVALID", 400);
  const evaluatedAt = new Date(evaluatedTimestamp).toISOString();
  if (["REJECTED", "CANCELLED", "CLOSED"].includes(row.state)) return { phase: "terminal", status: "completed", evaluatedAt, dueAt: "", overdueMinutes: 0, remainingMinutes: 0, policy };
  const phase = refundSlaPhase(row);
  if (!phase) return { phase: "unknown", status: "missing-milestone", evaluatedAt, dueAt: "", overdueMinutes: 0, remainingMinutes: 0, policy };
  const anchor = timestamp(phase.anchor);
  if (!Number.isFinite(anchor)) return { phase: phase.phase, status: "missing-milestone", evaluatedAt, dueAt: "", overdueMinutes: 0, remainingMinutes: 0, policy };
  const due = anchor + policy[phase.minutes] * 60_000;
  const evaluated = timestamp(evaluatedAt);
  const remainingMinutes = Math.max(0, Math.ceil((due - evaluated) / 60_000));
  const overdueMinutes = Math.max(0, Math.floor((evaluated - due) / 60_000));
  return { phase: phase.phase, status: evaluated > due ? "overdue" : "within-sla", evaluatedAt, anchorAt: new Date(anchor).toISOString(), dueAt: new Date(due).toISOString(), overdueMinutes, remainingMinutes, policy };
}

function buildRefundExceptionQueue(data = {}, options = {}) {
  const at = options.at || new Date().toISOString();
  const policy = options.policy || {};
  const priorityRank = { critical: 0, high: 1, medium: 2 };
  return refundCollection(data).flatMap((row) => {
    const sla = buildRefundSla(row, at, policy);
    const issueCodes = [];
    if (!verifyRefundLedger(row.events)) issueCodes.push("ledger-invalid");
    if (row.reversalPending) issueCodes.push("provider-reversal-pending");
    if (row.state === "FAILED") issueCodes.push("provider-failed");
    if (row.attempts?.length >= 3 && row.state === "FAILED") issueCodes.push("retry-exhausted");
    if (sla.status === "overdue") issueCodes.push(`${sla.phase}-overdue`);
    if (sla.status === "missing-milestone") issueCodes.push("milestone-missing");
    if (!issueCodes.length) return [];
    const priority = issueCodes.some((code) => ["ledger-invalid", "provider-reversal-pending", "retry-exhausted", "provider-callback-overdue"].includes(code)) ? "critical" : issueCodes.includes("provider-failed") || sla.status === "overdue" ? "high" : "medium";
    return [{ id: row.id, orderReference: row.orderReference, refundAmountFen: row.refundAmountFen, reasonCode: row.reasonCode, state: row.state, priority, issueCodes, sla: { phase: sla.phase, status: sla.status, dueAt: sla.dueAt, overdueMinutes: sla.overdueMinutes }, attemptCount: row.attempts?.length || 0, ledgerValid: !issueCodes.includes("ledger-invalid"), productionReady: false }];
  }).sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || right.sla.overdueMinutes - left.sla.overdueMinutes || left.id.localeCompare(right.id));
}

function paymentEventStatus(event = {}) {
  return String(event.providerStatus || event.adapterReceipt?.status || event.status || "").trim().toLowerCase();
}

function paymentEventAmountFen(event = {}) {
  const amount = Number(event.requestPayload?.payload?.amountFen ?? event.payload?.amountFen);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

function findOriginalPayment(data, input = {}) {
  const events = Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [];
  const eventId = safeText(input.paymentEventId);
  const tradeNo = safeText(input.paymentTradeNo);
  const event = events.find((item) => item.id === eventId && item.adapterType === "financial" && item.gatewayType === "PAYMENT" && item.operation === "create-payment");
  if (!event) throw new RefundWorkflowError("原支付交易不存在", "REFUND_ORIGINAL_PAYMENT_NOT_FOUND", 404);
  if (paymentEventStatus(event) !== "succeeded" || event.reconciliationStatus === "provider-exception") throw new RefundWorkflowError("原支付交易尚未成功或处于异常状态", "REFUND_ORIGINAL_PAYMENT_NOT_SETTLED");
  if (!tradeNo || ![event.adapterReceipt, ...(event.adapterReceiptHistory || [])].some((item) => item?.receiptId === tradeNo)) throw new RefundWorkflowError("支付交易号与原支付事件不匹配", "REFUND_PAYMENT_TRADE_MISMATCH");
  return event;
}

function refundCollection(data) {
  data.onlinePaymentRefunds = Array.isArray(data.onlinePaymentRefunds) ? data.onlinePaymentRefunds : [];
  return data.onlinePaymentRefunds;
}

function reservedRefundAmount(data, paymentEventId, excludeId = "") {
  return refundCollection(data).filter((item) => item.id !== excludeId && item.paymentEventId === paymentEventId && RESERVED_STATES.has(item.state)).reduce((sum, item) => sum + Number(item.refundAmountFen || 0), 0);
}

function createRefundRequest(data, input = {}, actor = {}) {
  if (!data || typeof data !== "object") throw new RefundWorkflowError("退款账本不可用", "REFUND_LEDGER_UNAVAILABLE", 503);
  const payment = findOriginalPayment(data, input);
  const idempotencyKey = safeText(input.idempotencyKey);
  if (!idempotencyKey) throw new RefundWorkflowError("退款申请幂等键不能为空", "REFUND_IDEMPOTENCY_REQUIRED", 400);
  const rows = refundCollection(data);
  const existing = rows.find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) {
    const same = existing.paymentEventId === payment.id && existing.refundAmountFen === Number(input.refundAmountFen) && existing.refundReason === safeText(input.refundReason, 240);
    if (!same) throw new RefundWorkflowError("退款幂等键与已存在申请内容冲突", "REFUND_IDEMPOTENCY_CONFLICT");
    return { row: existing, idempotent: true };
  }
  const refundAmountFen = positiveFen(input.refundAmountFen, "退款金额");
  const originalAmountFen = paymentEventAmountFen(payment);
  const reservedAmountFen = reservedRefundAmount(data, payment.id);
  if (refundAmountFen > originalAmountFen - reservedAmountFen) throw new RefundWorkflowError("退款金额超过原支付交易可退余额", "REFUND_AMOUNT_EXCEEDS_AVAILABLE");
  const refundReason = safeText(input.refundReason, 240);
  if (!refundReason) throw new RefundWorkflowError("退款原因不能为空", "REFUND_REASON_REQUIRED", 400);
  const requestedBy = safeText(actor.username || actor.name || actor.role || "operator", 120);
  const requestedAt = new Date().toISOString();
  const row = {
    id: safeText(input.id || `refund-${randomUUID()}`),
    paymentEventId: payment.id,
    paymentTradeNo: safeText(input.paymentTradeNo),
    orderReference: safeText(input.orderReference || payment.externalId || payment.requestPayload?.payload?.orderNo),
    idempotencyKey,
    originalAmountFen,
    refundAmountFen,
    availableBeforeFen: originalAmountFen - reservedAmountFen,
    refundReason,
    reasonCode: safeText(input.reasonCode || "OTHER", 40),
    state: "REQUESTED",
    status: REFUND_STATES.REQUESTED,
    requestedAt,
    requestedBy,
    reviewRevision: 1,
    reviews: [],
    reviewHistory: [],
    resubmissions: [],
    attempts: [],
    events: [],
    productionReady: false
  };
  appendEvent(row, { id: `refund-event-${randomUUID()}`, action: "request", from: "NONE", to: "REQUESTED", actor: requestedBy, at: requestedAt, idempotencyKey, detail: { refundAmountFen, reasonCode: row.reasonCode } });
  rows.unshift(row);
  return { row, idempotent: false };
}

function findRefund(data, id) {
  const row = refundCollection(data).find((item) => item.id === id);
  if (!row) throw new RefundWorkflowError("退款申请不存在", "REFUND_NOT_FOUND", 404);
  return row;
}

function reviewRefundRequest(data, id, input = {}, actor = {}) {
  const row = findRefund(data, id);
  requireValidRefundLedger(row);
  if (!["REQUESTED", "UNDER_REVIEW"].includes(row.state)) throw new RefundWorkflowError("当前状态不允许复核退款", "REFUND_REVIEW_STATE_INVALID");
  const reviewer = safeText(actor.username || actor.name || actor.role, 120);
  if (!reviewer || reviewer === row.requestedBy) throw new RefundWorkflowError("退款申请人与复核人必须分离", "REFUND_REVIEWER_SEPARATION_REQUIRED", 403);
  if (row.reviews.some((item) => item.reviewer === reviewer)) throw new RefundWorkflowError("同一复核人不得重复签署", "REFUND_DUPLICATE_REVIEWER");
  const reviewDomain = safeText(input.reviewDomain, 40);
  if (!REQUIRED_REFUND_REVIEW_DOMAINS.includes(reviewDomain)) throw new RefundWorkflowError("退款复核必须明确为业务复核或财务复核", "REFUND_REVIEW_DOMAIN_REQUIRED", 400);
  if (row.reviews.some((item) => item.approved && item.reviewDomain === reviewDomain)) throw new RefundWorkflowError("同一退款复核领域只能有一份有效意见", "REFUND_DUPLICATE_REVIEW_DOMAIN");
  const approved = input.approved === true;
  const reviewedAt = new Date().toISOString();
  const review = { id: `refund-review-${randomUUID()}`, reviewer, reviewDomain, role: safeText(input.role || actor.role || reviewDomain, 80), approved, opinion: safeText(input.opinion, 240), reviewedAt };
  row.reviews.push(review);
  const before = row.state;
  const approvedDomains = new Set(row.reviews.filter((item) => item.approved).map((item) => item.reviewDomain));
  row.state = !approved ? "REJECTED" : REQUIRED_REFUND_REVIEW_DOMAINS.every((item) => approvedDomains.has(item)) ? "APPROVED" : "UNDER_REVIEW";
  row.status = REFUND_STATES[row.state];
  row.updatedAt = reviewedAt;
  row.updatedBy = reviewer;
  if (row.state === "APPROVED") row.approvedAt = reviewedAt;
  if (row.state === "REJECTED") {
    row.rejectedAt = reviewedAt;
    row.rejectionDecisionDigest = digest({
      refundId: row.id,
      paymentEventId: row.paymentEventId,
      refundAmountFen: row.refundAmountFen,
      reviewRevision: row.reviewRevision || 1,
      review: { id: review.id, reviewer: review.reviewer, reviewDomain: review.reviewDomain, approved: review.approved, opinion: review.opinion },
      rejectedAt: reviewedAt
    });
  }
  appendEvent(row, { id: `refund-event-${randomUUID()}`, action: approved ? "approve-review" : "reject-review", from: before, to: row.state, actor: reviewer, at: reviewedAt, idempotencyKey: review.id, detail: { reviewDomain, role: review.role, opinion: review.opinion, rejectionDecisionDigest: row.state === "REJECTED" ? row.rejectionDecisionDigest : "" } });
  return { row, review };
}

function resubmitRejectedRefund(data, id, input = {}, actor = {}) {
  const row = findRefund(data, id);
  requireValidRefundLedger(row);
  const originalDecisionDigest = normalizeSha256Digest(input.originalDecisionDigest, "原驳回决定摘要", "REFUND_RESUBMISSION_DECISION_DIGEST_INVALID");
  const evidenceDigest = normalizeSha256Digest(input.evidenceDigest, "补证材料摘要", "REFUND_RESUBMISSION_EVIDENCE_DIGEST_INVALID");
  const correctionReason = safeText(input.correctionReason, 240);
  if (!correctionReason) throw new RefundWorkflowError("退款补证重提必须填写整改说明", "REFUND_RESUBMISSION_REASON_REQUIRED", 400);
  const idempotencyKey = safeText(input.idempotencyKey, 120);
  if (!idempotencyKey) throw new RefundWorkflowError("退款补证重提幂等键不能为空", "REFUND_RESUBMISSION_IDEMPOTENCY_REQUIRED", 400);
  const refundReason = safeText(input.refundReason ?? row.refundReason, 240);
  if (!refundReason) throw new RefundWorkflowError("退款原因不能为空", "REFUND_REASON_REQUIRED", 400);
  const reasonCode = safeText(input.reasonCode ?? row.reasonCode, 40) || "OTHER";
  const resubmissions = Array.isArray(row.resubmissions) ? row.resubmissions : [];
  const existing = resubmissions.find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) {
    const same = existing.originalDecisionDigest === originalDecisionDigest
      && existing.evidenceDigest === evidenceDigest
      && existing.correctionReason === correctionReason
      && existing.refundReason === refundReason
      && existing.reasonCode === reasonCode;
    if (!same) throw new RefundWorkflowError("退款补证重提幂等键与既有内容冲突", "REFUND_RESUBMISSION_IDEMPOTENCY_CONFLICT");
    return { row, resubmission: existing, idempotent: true };
  }
  if (row.state !== "REJECTED") throw new RefundWorkflowError("只有已驳回退款可以补证重提", "REFUND_RESUBMISSION_STATE_INVALID");
  if (originalDecisionDigest !== row.rejectionDecisionDigest) throw new RefundWorkflowError("原驳回决定摘要与当前有效决定不匹配", "REFUND_RESUBMISSION_DECISION_DIGEST_MISMATCH");
  if (resubmissions.some((item) => item.evidenceDigest === evidenceDigest)) throw new RefundWorkflowError("退款补证重提必须使用新的材料摘要", "REFUND_RESUBMISSION_NEW_EVIDENCE_REQUIRED");
  const payment = findOriginalPayment(data, row);
  const reservedAmountFen = reservedRefundAmount(data, payment.id, row.id);
  if (row.refundAmountFen > paymentEventAmountFen(payment) - reservedAmountFen) throw new RefundWorkflowError("补证重提时退款金额超过原支付交易当前可退余额", "REFUND_RESUBMISSION_AMOUNT_EXCEEDS_AVAILABLE");
  const resubmittedBy = safeText(actor.username || actor.name || actor.role || "operator", 120);
  const resubmittedAt = new Date().toISOString();
  const reviewRevision = row.reviewRevision || 1;
  const reviewSnapshot = Object.freeze({
    reviewRevision,
    rejectionDecisionDigest: row.rejectionDecisionDigest,
    rejectedAt: row.rejectedAt,
    reviews: Object.freeze(row.reviews.map((item) => Object.freeze({ ...item })))
  });
  const resubmission = Object.freeze({
    id: `refund-resubmission-${randomUUID()}`,
    fromReviewRevision: reviewRevision,
    toReviewRevision: reviewRevision + 1,
    originalDecisionDigest,
    evidenceDigest,
    correctionReason,
    refundReason,
    reasonCode,
    idempotencyKey,
    resubmittedAt,
    resubmittedBy
  });
  row.reviewHistory = Array.isArray(row.reviewHistory) ? row.reviewHistory : [];
  row.resubmissions = resubmissions;
  row.reviewHistory.push(reviewSnapshot);
  row.resubmissions.push(resubmission);
  row.reviewRevision = reviewRevision + 1;
  row.reviews = [];
  row.refundReason = refundReason;
  row.reasonCode = reasonCode;
  row.availableBeforeFen = paymentEventAmountFen(payment) - reservedAmountFen;
  row.state = "REQUESTED";
  row.status = REFUND_STATES.REQUESTED;
  row.requestedAt = resubmittedAt;
  row.requestedBy = resubmittedBy;
  row.updatedAt = resubmittedAt;
  row.updatedBy = resubmittedBy;
  delete row.approvedAt;
  delete row.rejectedAt;
  delete row.rejectionDecisionDigest;
  appendEvent(row, { id: `refund-event-${randomUUID()}`, action: "resubmit-after-rejection", from: "REJECTED", to: "REQUESTED", actor: resubmittedBy, at: resubmittedAt, idempotencyKey, detail: { fromReviewRevision: reviewRevision, toReviewRevision: reviewRevision + 1, originalDecisionDigest, evidenceDigest, correctionReason, reasonCode } });
  return { row, resubmission, idempotent: false };
}

function prepareRefundDispatch(data, id) {
  const row = findRefund(data, id);
  requireValidRefundLedger(row);
  if (row.state !== "APPROVED") throw new RefundWorkflowError("退款必须完成双人复核后才能派发", "REFUND_DISPATCH_STATE_INVALID");
  const attempt = row.attempts.length + 1;
  if (attempt > 3) throw new RefundWorkflowError("退款派发已达到最大尝试次数", "REFUND_MAX_ATTEMPTS_REACHED");
  return {
    type: "PAYMENT",
    operation: "refund",
    contractId: "payment-transaction-v1",
    idempotencyKey: `${row.idempotencyKey}:attempt:${attempt}`,
    payload: { externalId: row.id, paymentTradeNo: row.paymentTradeNo, refundAmountFen: row.refundAmountFen, refundReason: row.refundReason }
  };
}

function recordRefundDispatch(data, id, receipt = {}, gatewayEventId, actor = {}) {
  const row = findRefund(data, id);
  requireValidRefundLedger(row);
  if (row.state !== "APPROVED") throw new RefundWorkflowError("当前状态不允许登记退款派发", "REFUND_DISPATCH_STATE_INVALID");
  const receiptId = safeText(receipt.receiptId);
  if (receipt.type !== "PAYMENT" || receipt.operation !== "refund" || !receiptId) throw new RefundWorkflowError("退款网关回执无效", "REFUND_DISPATCH_RECEIPT_INVALID", 400);
  const gatewayEvent = (data.integrationGatewayEvents || []).find((item) => item.id === gatewayEventId && item.gatewayType === "PAYMENT" && item.operation === "refund" && item.adapterReceipt?.receiptId === receiptId);
  if (!gatewayEvent) throw new RefundWorkflowError("退款网关事件与回执不匹配", "REFUND_GATEWAY_EVENT_MISMATCH");
  const at = String(receipt.acceptedAt || new Date().toISOString());
  const before = row.state;
  row.state = receipt.status === "processing" ? "PROCESSING" : "DISPATCHED";
  row.status = REFUND_STATES[row.state];
  row.gatewayEventId = gatewayEvent.id;
  row.refundReceiptId = receiptId;
  row.attempts.push({ attempt: row.attempts.length + 1, requestId: safeText(receipt.requestId), receiptId, status: safeText(receipt.status), dispatchedAt: at, dispatchedBy: safeText(actor.username || actor.name || actor.role || "gateway-adapter", 120) });
  appendEvent(row, { id: `refund-event-${randomUUID()}`, action: "dispatch", from: before, to: row.state, actor: row.attempts.at(-1).dispatchedBy, at, idempotencyKey: receipt.requestId || receiptId, detail: { gatewayEventId: gatewayEvent.id, receiptId } });
  return { row };
}

function syncRefundFromFinancialCallback(data, appliedCallback = {}, actor = "financial-callback-adapter", options = {}) {
  if (options.trustedFinancialCallback !== true) throw new RefundWorkflowError("退款状态只能由已验签金融回调同步", "REFUND_TRUSTED_CALLBACK_REQUIRED", 401);
  const gatewayEvent = appliedCallback.gatewayEvent;
  const callbackEvent = appliedCallback.callbackEvent;
  if (!gatewayEvent || gatewayEvent.gatewayType !== "PAYMENT" || gatewayEvent.operation !== "refund" || callbackEvent?.signatureVerified !== true) throw new RefundWorkflowError("退款金融回调上下文无效", "REFUND_CALLBACK_CONTEXT_INVALID", 400);
  const row = refundCollection(data).find((item) => item.gatewayEventId === gatewayEvent.id && item.refundReceiptId === callbackEvent.receiptId);
  if (!row) throw new RefundWorkflowError("退款回调未匹配退款申请", "REFUND_CALLBACK_NOT_MATCHED", 404);
  requireValidRefundLedger(row);
  const duplicate = row.events.find((item) => item.idempotencyKey === callbackEvent.eventId && item.action === "provider-callback");
  if (duplicate) return { row, event: duplicate, idempotent: true };
  if (callbackEvent.stateApplied !== true) throw new RefundWorkflowError(`退款回调未生效：${callbackEvent.ignoredReason || "unknown"}`, "REFUND_CALLBACK_NOT_APPLIED");
  const stateByStatus = { accepted: "DISPATCHED", processing: "PROCESSING", succeeded: "SUCCEEDED", failed: "FAILED", cancelled: "FAILED", reversed: "FAILED" };
  const next = stateByStatus[callbackEvent.status];
  if (!next) throw new RefundWorkflowError("退款回调状态不受支持", "REFUND_CALLBACK_STATUS_INVALID", 400);
  const providerReversal = callbackEvent.status === "reversed" && row.state === "SUCCEEDED" && next === "FAILED";
  if (!["DISPATCHED", "PROCESSING"].includes(row.state) && row.state !== next && !providerReversal) throw new RefundWorkflowError("退款回调与当前退款状态冲突", "REFUND_CALLBACK_STATE_CONFLICT");
  const before = row.state;
  row.state = next;
  row.status = REFUND_STATES[next];
  row.providerStatus = callbackEvent.status;
  row.providerBusinessDate = callbackEvent.businessDate;
  row.providerCode = callbackEvent.providerCode;
  row.failureReason = callbackEvent.failureReason;
  row.updatedAt = callbackEvent.receivedAt;
  if (next === "SUCCEEDED") row.succeededAt = callbackEvent.occurredAt;
  if (next === "FAILED") {
    row.failedAt = callbackEvent.occurredAt;
    row.reversalPending = providerReversal;
  }
  const event = appendEvent(row, { id: `refund-event-${randomUUID()}`, action: "provider-callback", from: before, to: next, actor: safeText(actor, 120), at: callbackEvent.receivedAt, idempotencyKey: callbackEvent.eventId, detail: { providerStatus: callbackEvent.status, providerCode: callbackEvent.providerCode } });
  return { row, event, idempotent: false };
}

function retryRefund(data, id, input = {}, actor = {}) {
  const row = findRefund(data, id);
  requireValidRefundLedger(row);
  if (row.state !== "FAILED") throw new RefundWorkflowError("只有失败退款可以重试", "REFUND_RETRY_STATE_INVALID");
  if (row.attempts.length >= 3) throw new RefundWorkflowError("退款派发已达到最大尝试次数", "REFUND_MAX_ATTEMPTS_REACHED");
  const resolution = safeText(input.resolution, 240);
  if (!resolution) throw new RefundWorkflowError("退款重试必须填写失败处置结论", "REFUND_RETRY_RESOLUTION_REQUIRED", 400);
  const before = row.state;
  row.state = "APPROVED";
  row.status = REFUND_STATES.APPROVED;
  row.refundReceiptId = "";
  row.gatewayEventId = "";
  const at = new Date().toISOString();
  row.approvedAt = at;
  if (row.reversalPending) {
    row.reversalPending = false;
    row.reversalResolvedAt = at;
  }
  appendEvent(row, { id: `refund-event-${randomUUID()}`, action: "retry", from: before, to: "APPROVED", actor: safeText(actor.username || actor.name || actor.role || "operator", 120), at, idempotencyKey: safeText(input.idempotencyKey || `retry-${row.attempts.length + 1}`), detail: { resolution } });
  return { row };
}

function cancelRefund(data, id, input = {}, actor = {}) {
  const row = findRefund(data, id);
  requireValidRefundLedger(row);
  if (!new Set(["REQUESTED", "UNDER_REVIEW", "APPROVED", "FAILED"]).has(row.state)) throw new RefundWorkflowError("当前状态不允许取消退款", "REFUND_CANCEL_STATE_INVALID");
  const reason = safeText(input.reason, 240);
  if (!reason) throw new RefundWorkflowError("取消退款必须填写原因", "REFUND_CANCEL_REASON_REQUIRED", 400);
  const before = row.state;
  row.state = "CANCELLED";
  row.status = REFUND_STATES.CANCELLED;
  row.cancelledAt = new Date().toISOString();
  row.cancelledBy = safeText(actor.username || actor.name || actor.role || "operator", 120);
  appendEvent(row, { id: `refund-event-${randomUUID()}`, action: "cancel", from: before, to: "CANCELLED", actor: row.cancelledBy, at: row.cancelledAt, idempotencyKey: safeText(input.idempotencyKey || row.cancelledAt), detail: { reason } });
  return { row };
}

function reconcileRefund(data, id, input = {}, actor = {}) {
  const row = findRefund(data, id);
  requireValidRefundLedger(row);
  if (row.state !== "SUCCEEDED") throw new RefundWorkflowError("只有成功退款可以完成日终对账", "REFUND_RECONCILIATION_STATE_INVALID");
  const run = (data.financialReconciliationRuns || []).find((item) => item.id === input.reconciliationRunId && item.gatewayType === "PAYMENT" && item.businessDate === row.providerBusinessDate && item.status === "matched");
  if (!run) throw new RefundWorkflowError("未找到匹配的支付日终对账批次", "REFUND_RECONCILIATION_RUN_NOT_MATCHED");
  const statementDigest = safeText(run.providerSummary?.statementDigest, 80);
  if (!/^sha256:[a-f0-9]{64}$/i.test(statementDigest)) throw new RefundWorkflowError("支付日终对账摘要无效", "REFUND_RECONCILIATION_DIGEST_INVALID");
  const before = row.state;
  row.state = "RECONCILED";
  row.status = REFUND_STATES.RECONCILED;
  row.reconciliationRunId = run.id;
  row.reconciliationDigest = statementDigest;
  row.reconciledAt = new Date().toISOString();
  row.reconciledBy = safeText(actor.username || actor.name || actor.role || "finance", 120);
  appendEvent(row, { id: `refund-event-${randomUUID()}`, action: "reconcile", from: before, to: "RECONCILED", actor: row.reconciledBy, at: row.reconciledAt, idempotencyKey: run.id, detail: { statementDigest } });
  return { row };
}

function closeRefund(data, id, input = {}, actor = {}) {
  const row = findRefund(data, id);
  requireValidRefundLedger(row);
  if (row.state !== "RECONCILED") throw new RefundWorkflowError("退款必须完成日终对账后才能结案", "REFUND_CLOSE_STATE_INVALID");
  const voucherNo = safeText(input.voucherNo, 120);
  if (!voucherNo) throw new RefundWorkflowError("退款结案必须关联财务凭证号", "REFUND_VOUCHER_REQUIRED", 400);
  const before = row.state;
  row.state = "CLOSED";
  row.status = REFUND_STATES.CLOSED;
  row.voucherNo = voucherNo;
  row.closedAt = new Date().toISOString();
  row.closedBy = safeText(actor.username || actor.name || actor.role || "finance", 120);
  appendEvent(row, { id: `refund-event-${randomUUID()}`, action: "close", from: before, to: "CLOSED", actor: row.closedBy, at: row.closedAt, idempotencyKey: voucherNo, detail: { voucherNo } });
  return { row };
}

function buildRefundOperations(data = {}, options = {}) {
  const rows = refundCollection(data);
  const at = options.at || new Date().toISOString();
  const exceptionQueue = buildRefundExceptionQueue(data, { at, policy: options.policy });
  const slaRows = rows.map((item) => buildRefundSla(item, at, options.policy));
  return {
    productionReady: false,
    summary: {
      total: rows.length,
      pendingReview: rows.filter((item) => ["REQUESTED", "UNDER_REVIEW"].includes(item.state)).length,
      processing: rows.filter((item) => ["APPROVED", "DISPATCHED", "PROCESSING"].includes(item.state)).length,
      failed: rows.filter((item) => item.state === "FAILED").length,
      exceptions: exceptionQueue.length,
      overdue: slaRows.filter((item) => item.status === "overdue").length,
      critical: exceptionQueue.filter((item) => item.priority === "critical").length,
      succeeded: rows.filter((item) => ["SUCCEEDED", "RECONCILED", "CLOSED"].includes(item.state)).length,
      refundAmountFen: rows.filter((item) => ["SUCCEEDED", "RECONCILED", "CLOSED"].includes(item.state)).reduce((sum, item) => sum + Number(item.refundAmountFen || 0), 0)
    },
    exceptionQueue: exceptionQueue.slice(0, Number(options.limit || 100)),
    refunds: rows.slice(0, 100).map((item) => ({ id: item.id, orderReference: item.orderReference, refundAmountFen: item.refundAmountFen, reasonCode: item.reasonCode, state: item.state, status: item.status, reviewRevision: item.reviewRevision || 1, resubmissionCount: item.resubmissions?.length || 0, reviewCount: item.reviews.length, attemptCount: item.attempts.length, providerBusinessDate: item.providerBusinessDate || "", sla: buildRefundSla(item, at, options.policy), ledgerValid: verifyRefundLedger(item.events), productionReady: false })),
    boundary: "退款申请、复核、额度、可信回调和日终对账账本可运行；真实商户、支付机构回调、账单和财务凭证仍需现场验收。"
  };
}

module.exports = { REFUND_SLA_POLICY, REFUND_STATES, REQUIRED_REFUND_REVIEW_DOMAINS, RESERVED_STATES, RefundWorkflowError, buildRefundExceptionQueue, buildRefundOperations, buildRefundSla, cancelRefund, closeRefund, createRefundRequest, digest, normalizeRefundSlaPolicy, prepareRefundDispatch, reconcileRefund, recordRefundDispatch, requireValidRefundLedger, reservedRefundAmount, resubmitRejectedRefund, retryRefund, reviewRefundRequest, stableStringify, syncRefundFromFinancialCallback, verifyRefundLedger };
