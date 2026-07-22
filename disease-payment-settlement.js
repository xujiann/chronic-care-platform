"use strict";

const { createHash, randomUUID } = require("node:crypto");

const SETTLEMENT_CONTRACT_ID = "insurance-disease-settlement-v1";
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
    cases: (batch.calculationSnapshots || []).map((item) => ({ caseId: item.caseId, settlementListNo: item.settlementListNo, formalReceiptId: item.formalReceiptId, formalReceiptDigest: item.formalReceiptDigest, schemeVersion: item.schemeVersion, groupCode: item.groupCode, parameterId: item.parameterId, paymentStandardFen: Number(item.paymentStandardFen ?? yuanToFen(item.paymentStandard || 0, "病例支付标准")) }))
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
  const event = appendEvent(batch, { id: `settlement-event-${randomUUID()}`, action, from: before, to: rule.to, actor, at: now, idempotencyKey: identity, detail });
  return { batch, event, idempotent: false };
}

function createAnnualClearance(batches = [], payload = {}, actor = "system") {
  const year = Number(payload.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("年度清算年份无效");
  const eligible = batches.filter((batch) => batch.type === "月度结算" && String(batch.period || "").startsWith(`${year}-`) && ["PAID", "CLOSED"].includes(settlementState(batch)));
  if (!eligible.length) throw new Error("该年度没有已拨付或已结案的月度结算批次");
  const row = {
    id: String(payload.id || `annual-clearance-${year}-${Date.now()}`),
    year,
    state: "PREPARED",
    status: CLEARANCE_LABELS.PREPARED,
    batchIds: eligible.map((item) => item.id),
    batchCount: eligible.length,
    institutionCount: new Set(eligible.map((item) => item.institution)).size,
    standardAmountFen: eligible.reduce((sum, item) => sum + Number(item.standardAmountFen || 0), 0),
    paidAmountFen: eligible.reduce((sum, item) => sum + Number(item.paymentReceipt?.paidAmountFen || item.adjustedAmountFen || item.standardAmountFen || 0), 0),
    createdAt: new Date().toISOString(),
    createdBy: actor,
    events: []
  };
  row.clearanceDigest = digest({ year, batchIds: row.batchIds, standardAmountFen: row.standardAmountFen, paidAmountFen: row.paidAmountFen });
  appendEvent(row, { id: `clearance-event-${randomUUID()}`, action: "prepare", from: "NONE", to: "PREPARED", actor, at: row.createdAt, idempotencyKey: row.id, detail: { clearanceDigest: row.clearanceDigest } });
  return row;
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
  if (action === "approve") row.approval = { approvalNo: requireText(payload, "approvalNo", "清算批准文号"), approvedAt: now, approvedBy: actor };
  if (action === "post") row.posting = { voucherNo: requireText(payload, "voucherNo", "财务凭证号"), postedAt: now, postedBy: actor };
  if (action === "lock") {
    detail.lockReference = requireText(payload, "lockReference", "锁账凭证号");
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

module.exports = { ACTION_TARGETS, CLEARANCE_ACTION_TARGETS, CLEARANCE_LABELS, SETTLEMENT_CONTRACT_ID, SETTLEMENT_LABELS, appendEvent, buildCoreSettlementEnvelope, createAnnualClearance, digest, settlementState, stableStringify, transitionAnnualClearance, transitionSettlementBatch, verifyEventLedger, yuanToFen };
