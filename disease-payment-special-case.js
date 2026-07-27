"use strict";

const { createHash, randomUUID } = require("node:crypto");

const SPECIAL_CASE_LABELS = Object.freeze({
  APPLIED: "待评审",
  UNDER_REVIEW: "复核中",
  APPROVED: "评审通过",
  REJECTED: "不予通过",
  APPEALED: "复议待评审",
  APPEAL_UNDER_REVIEW: "复议评审中",
  APPEAL_REJECTED: "复议不予通过",
  WITHDRAWN: "已撤回",
  INCLUDED: "已纳入结算"
});
const ACTIVE_STATES = new Set(["APPLIED", "UNDER_REVIEW", "APPROVED", "APPEALED", "APPEAL_UNDER_REVIEW", "INCLUDED"]);
const SPECIAL_CASE_APPEAL_POLICY = Object.freeze({ appealWindowDays: 10, reviewSlaDays: 15 });

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

function addCalendarDays(value, days, label = "日期") {
  const parsed = new Date(String(value || ""));
  if (Number.isNaN(parsed.getTime())) throw new SpecialCaseWorkflowError(`${label}无效`, "SPECIAL_CASE_DATE_INVALID", 400);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString();
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
    return base.sequence === index + 1
      && base.previousHash === (index ? events[index - 1].eventHash : "GENESIS")
      && (index === 0 || base.from === events[index - 1].to)
      && eventHash === digest(base);
  });
}

function specialCaseState(row = {}) {
  if (SPECIAL_CASE_LABELS[row.state]) return row.state;
  return Object.entries(SPECIAL_CASE_LABELS).find(([, label]) => label === row.status)?.[0] || "APPLIED";
}

function specialReviewProjection(review = {}) {
  return {
    id: review.id,
    reviewer: review.reviewer,
    expertId: review.expertId,
    role: review.role,
    approved: review.approved === true,
    adjustedPaymentFen: review.adjustedPaymentFen,
    opinion: review.opinion,
    reviewedAt: review.reviewedAt
  };
}

function specialReviewFromEvent(event = {}) {
  return {
    id: event.detail?.reviewId,
    reviewer: event.actor,
    expertId: event.detail?.expertId,
    role: event.detail?.role,
    approved: ["approve-review", "approve-appeal"].includes(event.action),
    adjustedPaymentFen: event.detail?.adjustedPaymentFen,
    opinion: event.detail?.opinion,
    reviewedAt: event.at
  };
}

function originalDecisionDigest(row, reviews, outcome) {
  if (outcome === "APPROVED") {
    const adjustedPaymentFen = reviews.find((item) => item.approved)?.adjustedPaymentFen;
    return digest({ caseId: row.caseId, requestedPaymentFen: row.requestedPaymentFen, adjustedPaymentFen, evidenceDigest: row.evidenceDigest, approvals: reviews.filter((item) => item.approved).map((item) => ({ reviewer: item.reviewer, role: item.role, reviewedAt: item.reviewedAt })) });
  }
  const rejection = [...reviews].reverse().find((item) => !item.approved);
  return rejection ? digest({ caseId: row.caseId, outcome: "REJECTED", requestedPaymentFen: row.requestedPaymentFen, evidenceDigest: row.evidenceDigest, rejection: { reviewer: rejection.reviewer, role: rejection.role, opinion: rejection.opinion, reviewedAt: rejection.reviewedAt } }) : "";
}

function appealDecisionDigest(appeal = {}, reviews = [], outcome = "") {
  return digest({ appealId: appeal.id, originalDecisionDigest: appeal.originalDecisionDigest, evidenceDigest: appeal.evidenceDigest, outcome, reviews: reviews.map((item) => ({ reviewer: item.reviewer, role: item.role, approved: item.approved, adjustedPaymentFen: item.adjustedPaymentFen, reviewedAt: item.reviewedAt })) });
}

function verifySpecialCaseStateProjection(row = {}) {
  const events = Array.isArray(row.events) ? row.events : [];
  if (!events.length || !verifySpecialCaseLedger(events) || events[0].action !== "apply" || events[0].from !== "NONE") return false;
  if (specialCaseState(row) !== events.at(-1).to || row.status !== SPECIAL_CASE_LABELS[events.at(-1).to]) return false;
  const applied = events[0];
  if (row.submittedAt !== applied.at || row.submittedBy !== applied.actor || row.reasonCode !== applied.detail?.reasonCode || row.requestedPaymentFen !== applied.detail?.requestedPaymentFen || row.evidenceDigest !== applied.detail?.evidenceDigest || row.evidenceDigest !== digest(row.evidence || [])) return false;

  const appealEventIndex = events.findIndex((event) => event.action === "appeal");
  const originalReviewEvents = events.slice(0, appealEventIndex < 0 ? events.length : appealEventIndex).filter((event) => ["approve-review", "reject-review"].includes(event.action));
  const expectedReviews = originalReviewEvents.map(specialReviewFromEvent);
  if (stableStringify((row.reviews || []).map(specialReviewProjection)) !== stableStringify(expectedReviews)) return false;
  const originalOutcome = originalReviewEvents.at(-1)?.action === "reject-review" ? "REJECTED" : originalReviewEvents.filter((event) => event.action === "approve-review").length >= 2 ? "APPROVED" : "";
  const expectedOriginalDecision = originalOutcome ? originalDecisionDigest(row, expectedReviews, originalOutcome) : "";
  if (originalOutcome && originalReviewEvents.at(-1).detail?.decisionDigest !== expectedOriginalDecision) return false;

  const appeals = Array.isArray(row.appeals) ? row.appeals : [];
  if (appealEventIndex < 0) {
    if (appeals.length) return false;
    if (expectedOriginalDecision && row.decisionDigest !== expectedOriginalDecision) return false;
  } else {
    if (appeals.length !== 1) return false;
    const appealEvent = events[appealEventIndex];
    const appeal = appeals[0];
    if (appeal.id !== appealEvent.detail?.appealId
      || appeal.originalDecisionDigest !== expectedOriginalDecision
      || appeal.originalDecisionDigest !== appealEvent.detail?.originalDecisionDigest
      || appeal.evidenceDigest !== digest(appeal.evidence || [])
      || appeal.evidenceDigest !== appealEvent.detail?.evidenceDigest
      || appeal.reason !== appealEvent.detail?.reason
      || appeal.reasonCode !== appealEvent.detail?.reasonCode
      || appeal.submittedAt !== appealEvent.at
      || appeal.submittedBy !== appealEvent.actor
      || appeal.appealDeadline !== appealEvent.detail?.appealDeadline
      || appeal.reviewDueAt !== appealEvent.detail?.reviewDueAt) return false;
    const appealReviewEvents = events.slice(appealEventIndex + 1).filter((event) => ["approve-appeal", "reject-appeal"].includes(event.action));
    const expectedAppealReviews = appealReviewEvents.map(specialReviewFromEvent);
    if (stableStringify((appeal.reviews || []).map(specialReviewProjection)) !== stableStringify(expectedAppealReviews)) return false;
    const appealOutcome = appealReviewEvents.at(-1)?.action === "reject-appeal" ? "APPEAL_REJECTED" : appealReviewEvents.filter((event) => event.action === "approve-appeal").length >= 2 ? "APPROVED" : "";
    const expectedAppealState = appealOutcome || (appealReviewEvents.length ? "APPEAL_UNDER_REVIEW" : "APPEALED");
    if (appeal.state !== expectedAppealState) return false;
    if (appealOutcome) {
      const expectedAppealDecision = appealDecisionDigest(appeal, expectedAppealReviews, appealOutcome);
      if (appeal.outcome !== appealOutcome || appeal.decisionDigest !== expectedAppealDecision || appealReviewEvents.at(-1).detail?.decisionDigest !== expectedAppealDecision || row.decisionDigest !== expectedAppealDecision || appeal.decidedAt !== appealReviewEvents.at(-1).at) return false;
    } else if (row.decisionDigest !== expectedOriginalDecision) return false;
  }
  const includeEvent = events.find((event) => event.action === "include-settlement");
  if (includeEvent && (row.settlementBatchId !== includeEvent.detail?.batchId || row.includedAt !== includeEvent.at || row.includedBy !== includeEvent.actor || row.decisionDigest !== includeEvent.detail?.decisionDigest)) return false;
  return true;
}

function requireSpecialCaseStateProjection(row) {
  if (!verifySpecialCaseLedger(row.events || [])) throw new SpecialCaseWorkflowError("特例单议事件账本校验失败", "SPECIAL_CASE_LEDGER_INVALID");
  if (!verifySpecialCaseStateProjection(row)) throw new SpecialCaseWorkflowError("特例单议状态投影与事件账本不一致", "SPECIAL_CASE_STATE_PROJECTION_INVALID");
  return row;
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

function eligibleExperts(experts = [], row = {}, role, excludedIds = new Set()) {
  return experts.filter((expert) => expert.active !== false && expert.role === role && !excludedIds.has(expert.id) && expert.institution !== row.institution && !(expert.conflictInstitutions || []).includes(row.institution) && safeText(expert.reviewerAccount || expert.name, 120));
}

function chooseExpert(candidates, seed) {
  return [...candidates].sort((left, right) => digest(`${seed}:${left.id}`).localeCompare(digest(`${seed}:${right.id}`)))[0];
}

function selectSpecialCaseExperts(row, experts = [], payload = {}, actor = "expert-panel-service") {
  requireSpecialCaseStateProjection(row);
  if (specialCaseState(row) !== "APPLIED" || (row.reviews || []).length) throw new SpecialCaseWorkflowError("特例单议已开始评审，不能重新抽取专家", "SPECIAL_CASE_PANEL_STATE_INVALID");
  const roles = Array.isArray(payload.roles) && payload.roles.length ? payload.roles.map((item) => safeText(item, 80)) : ["medical-insurance-review", "fund-finance-review"];
  const excludedIds = new Set((payload.excludedExpertIds || []).map(String));
  const selectedAccounts = new Set();
  const seed = digest({ caseId: row.caseId, evidenceDigest: row.evidenceDigest, selectionNonce: safeText(payload.selectionNonce || row.id, 120) });
  const members = roles.map((role) => {
    const selected = chooseExpert(eligibleExperts(experts, row, role, excludedIds).filter((item) => item.appealOnly !== true && !selectedAccounts.has(safeText(item.reviewerAccount || item.name, 120))), `${seed}:${role}`);
    if (!selected) throw new SpecialCaseWorkflowError(`没有可用的${role}评审专家`, "SPECIAL_CASE_EXPERT_UNAVAILABLE");
    excludedIds.add(selected.id);
    selectedAccounts.add(safeText(selected.reviewerAccount || selected.name, 120));
    return { expertId: selected.id, reviewerAccount: safeText(selected.reviewerAccount || selected.name, 120), displayName: safeText(selected.displayName || selected.name, 120), role, organization: safeText(selected.institution, 120), expertise: (selected.expertise || []).map((item) => safeText(item, 80)).filter(Boolean), status: "selected" };
  });
  const now = new Date().toISOString();
  row.expertPanel = { seedDigest: seed, members, selectedAt: now, selectedBy: safeText(actor, 120), selectionDigest: digest(members), avoidanceBasisDigest: digest({ institution: row.institution, excludedExpertIds: [...excludedIds].sort() }) };
  appendEvent(row, { id: `special-event-${randomUUID()}`, action: "select-experts", from: "APPLIED", to: "APPLIED", actor: row.expertPanel.selectedBy, at: now, idempotencyKey: row.expertPanel.selectionDigest, detail: { selectionDigest: row.expertPanel.selectionDigest, avoidanceBasisDigest: row.expertPanel.avoidanceBasisDigest, roles } });
  return row.expertPanel;
}

function verifySpecialCaseExpertPanel(row = {}) {
  const panel = row.expertPanel;
  if (!panel || !Array.isArray(panel.members) || !panel.members.length || panel.selectionDigest !== digest(panel.members)) return false;
  const selected = panel.members.filter((item) => item.status === "selected");
  if (selected.length < 2 || new Set(selected.map((item) => item.expertId)).size !== selected.length || new Set(selected.map((item) => item.reviewerAccount)).size !== selected.length) return false;
  const lastPanelEvent = [...(row.events || [])].reverse().find((item) => ["select-experts", "replace-expert"].includes(item.action));
  return lastPanelEvent?.detail?.selectionDigest === panel.selectionDigest;
}

function reselectSpecialCaseExpert(row, experts = [], payload = {}, actor = "expert-panel-service") {
  requireSpecialCaseStateProjection(row);
  if (specialCaseState(row) !== "APPLIED" || (row.reviews || []).length) throw new SpecialCaseWorkflowError("特例单议已开始评审，不能更换专家", "SPECIAL_CASE_PANEL_STATE_INVALID");
  const expertId = safeText(payload.expertId, 120);
  const reason = safeText(payload.reason);
  if (!expertId || !reason) throw new SpecialCaseWorkflowError("专家回避必须提供专家编号和原因", "SPECIAL_CASE_RECUSAL_REQUIRED", 400);
  const member = row.expertPanel?.members?.find((item) => item.expertId === expertId && item.status === "selected");
  if (!member) throw new SpecialCaseWorkflowError("待回避专家不在当前评审组", "SPECIAL_CASE_EXPERT_NOT_ASSIGNED", 404);
  const excludedIds = new Set(row.expertPanel.members.map((item) => item.expertId));
  const replacement = chooseExpert(eligibleExperts(experts, row, member.role, excludedIds).filter((item) => item.appealOnly !== true), `${row.expertPanel.seedDigest}:${member.role}:replacement:${expertId}`);
  if (!replacement) throw new SpecialCaseWorkflowError("没有可用的回避替补专家", "SPECIAL_CASE_REPLACEMENT_UNAVAILABLE");
  member.status = "recused";
  member.recusalReason = reason;
  member.recusedAt = new Date().toISOString();
  member.recusedBy = safeText(actor, 120);
  const next = { expertId: replacement.id, reviewerAccount: safeText(replacement.reviewerAccount || replacement.name, 120), displayName: safeText(replacement.displayName || replacement.name, 120), role: member.role, organization: safeText(replacement.institution, 120), expertise: (replacement.expertise || []).map((item) => safeText(item, 80)).filter(Boolean), status: "selected", replacesExpertId: expertId };
  row.expertPanel.members.push(next);
  row.expertPanel.selectionDigest = digest(row.expertPanel.members);
  appendEvent(row, { id: `special-event-${randomUUID()}`, action: "replace-expert", from: "APPLIED", to: "APPLIED", actor: member.recusedBy, at: member.recusedAt, idempotencyKey: `${expertId}:${replacement.id}`, detail: { expertId, replacementExpertId: replacement.id, role: member.role, reason, selectionDigest: row.expertPanel.selectionDigest } });
  return { recused: member, replacement: next };
}

function reviewSpecialCaseApplication(row, payload = {}, actor = "reviewer") {
  requireSpecialCaseStateProjection(row);
  const before = specialCaseState(row);
  if (!["APPLIED", "UNDER_REVIEW"].includes(before)) throw new SpecialCaseWorkflowError("当前状态不允许评审特例单议", "SPECIAL_CASE_REVIEW_STATE_INVALID");
  if (row.expertPanel && !verifySpecialCaseExpertPanel(row)) throw new SpecialCaseWorkflowError("特例单议专家抽取记录校验失败", "SPECIAL_CASE_PANEL_INVALID");
  const reviewer = safeText(actor, 120);
  if (!reviewer || reviewer === row.submittedBy) throw new SpecialCaseWorkflowError("特例单议申请人与评审人必须分离", "SPECIAL_CASE_REVIEWER_SEPARATION_REQUIRED", 403);
  row.reviews ||= [];
  if (row.reviews.some((item) => item.reviewer === reviewer)) throw new SpecialCaseWorkflowError("同一评审人不得重复签署", "SPECIAL_CASE_DUPLICATE_REVIEWER");
  const assigned = row.expertPanel?.members?.find((item) => item.status === "selected" && item.reviewerAccount === reviewer && (!payload.expertId || item.expertId === payload.expertId));
  if (row.expertPanel && !assigned) throw new SpecialCaseWorkflowError("评审人未被抽取进入当前特例评审组", "SPECIAL_CASE_REVIEWER_NOT_ASSIGNED", 403);
  const approved = payload.approved === true;
  const adjustedPaymentFen = approved ? toFen(payload.adjustedPaymentFen ?? Math.round(Number(payload.adjustedPayment ?? row.requestedPaymentFen / 100) * 100), "评审支付金额") : 0;
  const caseTotalAmountFen = Number(row.caseTotalAmountFen || row.requestedPaymentFen);
  if (approved && adjustedPaymentFen > caseTotalAmountFen) throw new SpecialCaseWorkflowError("评审支付金额不得超过病例总费用", "SPECIAL_CASE_AMOUNT_EXCEEDS_COST", 400);
  const priorApproved = row.reviews.find((item) => item.approved);
  if (approved && priorApproved && priorApproved.adjustedPaymentFen !== adjustedPaymentFen) throw new SpecialCaseWorkflowError("两名评审人的支付金额意见必须一致", "SPECIAL_CASE_REVIEW_AMOUNT_CONFLICT");
  const now = new Date().toISOString();
  const review = { id: `special-review-${randomUUID()}`, reviewer, expertId: assigned?.expertId || safeText(payload.expertId, 120), role: assigned?.role || safeText(payload.role || "医保评审", 80), approved, adjustedPaymentFen, opinion: safeText(payload.opinion || (approved ? "符合特例单议范围" : "仍按病种标准付费")), reviewedAt: now };
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
    row.decisionDigest = originalDecisionDigest(row, row.reviews, "APPROVED");
  } else if (row.state === "REJECTED") {
    row.rejectedAt = now;
    row.decisionDigest = originalDecisionDigest(row, row.reviews, "REJECTED");
  }
  appendEvent(row, { id: `special-event-${randomUUID()}`, action: approved ? "approve-review" : "reject-review", from: before, to: row.state, actor: reviewer, at: now, idempotencyKey: review.id, detail: { reviewId: review.id, expertId: review.expertId, role: review.role, adjustedPaymentFen, opinion: review.opinion, decisionDigest: row.decisionDigest || "" } });
  return { row, review };
}

function currentAppeal(row = {}) {
  return (row.appeals || []).at(-1);
}

function buildSpecialCaseAppealSla(row = {}, at = new Date().toISOString()) {
  const appeal = currentAppeal(row);
  if (!appeal) return { status: "not-applicable", dueAt: "", overdueDays: 0 };
  const evaluated = new Date(String(at));
  const due = new Date(String(appeal.reviewDueAt));
  if (Number.isNaN(evaluated.getTime()) || Number.isNaN(due.getTime())) throw new SpecialCaseWorkflowError("复议SLA时间无效", "SPECIAL_CASE_DATE_INVALID", 400);
  if (appeal.decidedAt) return { status: new Date(appeal.decidedAt) > due ? "completed-overdue" : "completed-within-sla", dueAt: due.toISOString(), decidedAt: appeal.decidedAt, overdueDays: Math.max(0, Math.ceil((new Date(appeal.decidedAt) - due) / 86_400_000)) };
  return { status: evaluated > due ? "overdue" : "within-sla", dueAt: due.toISOString(), evaluatedAt: evaluated.toISOString(), overdueDays: Math.max(0, Math.ceil((evaluated - due) / 86_400_000)) };
}

function createSpecialCaseAppeal(row, payload = {}, actor = "institution") {
  requireSpecialCaseStateProjection(row);
  if ((row.appeals || []).length) throw new SpecialCaseWorkflowError("同一特例单议只能申请一次复议", "SPECIAL_CASE_APPEAL_DUPLICATE");
  if (specialCaseState(row) !== "REJECTED") throw new SpecialCaseWorkflowError("只有原评审驳回的特例单议可以申请复议", "SPECIAL_CASE_APPEAL_STATE_INVALID");
  const appellant = safeText(actor, 120);
  if (!appellant) throw new SpecialCaseWorkflowError("复议申请人不能为空", "SPECIAL_CASE_APPELLANT_REQUIRED", 400);
  const originalDecisionDigest = safeText(payload.originalDecisionDigest, 80).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(originalDecisionDigest) || originalDecisionDigest !== row.decisionDigest) throw new SpecialCaseWorkflowError("复议绑定的原决定摘要无效", "SPECIAL_CASE_APPEAL_DECISION_DIGEST_INVALID", 400);
  const at = safeText(payload.at || new Date().toISOString(), 40);
  const rejectionEvent = [...row.events].reverse().find((item) => item.action === "reject-review" && item.to === "REJECTED" && item.detail?.decisionDigest === originalDecisionDigest);
  if (!rejectionEvent || rejectionEvent.at !== row.rejectedAt) throw new SpecialCaseWorkflowError("原驳回时间与事件账本不一致", "SPECIAL_CASE_LEDGER_INVALID");
  const submittedAt = new Date(at);
  const rejectedAt = new Date(rejectionEvent.at);
  if (Number.isNaN(submittedAt.getTime()) || submittedAt < rejectedAt) throw new SpecialCaseWorkflowError("复议申请时间不得早于原驳回时间", "SPECIAL_CASE_APPEAL_TIME_INVALID", 400);
  const appealDeadline = addCalendarDays(rejectionEvent.at, SPECIAL_CASE_APPEAL_POLICY.appealWindowDays, "原驳回时间");
  if (submittedAt > new Date(appealDeadline)) throw new SpecialCaseWorkflowError("特例单议复议已超过申请期限", "SPECIAL_CASE_APPEAL_WINDOW_EXPIRED");
  const reason = safeText(payload.reason);
  if (!reason) throw new SpecialCaseWorkflowError("复议原因不能为空", "SPECIAL_CASE_APPEAL_REASON_REQUIRED", 400);
  const evidence = normalizeEvidence(payload.evidence);
  const originalEvidenceDigests = new Set((row.evidence || []).map((item) => item.digest));
  if (!evidence.some((item) => !originalEvidenceDigests.has(item.digest))) throw new SpecialCaseWorkflowError("复议必须提交至少一项新的摘要证据", "SPECIAL_CASE_APPEAL_NEW_EVIDENCE_REQUIRED", 400);
  const appeal = {
    id: safeText(payload.id || `special-appeal-${randomUUID()}`, 120),
    originalDecisionDigest,
    reason,
    reasonCode: safeText(payload.reasonCode || "NEW_EVIDENCE", 60),
    evidence,
    evidenceDigest: digest(evidence),
    state: "APPEALED",
    submittedAt: at,
    submittedBy: appellant,
    appealDeadline,
    reviewDueAt: addCalendarDays(at, SPECIAL_CASE_APPEAL_POLICY.reviewSlaDays, "复议申请时间"),
    reviews: []
  };
  row.appeals = [appeal];
  row.state = "APPEALED";
  row.status = SPECIAL_CASE_LABELS.APPEALED;
  row.updatedAt = at;
  row.updatedBy = appellant;
  appendEvent(row, { id: `special-event-${randomUUID()}`, action: "appeal", from: "REJECTED", to: "APPEALED", actor: appellant, at, idempotencyKey: safeText(payload.idempotencyKey || appeal.id, 160), detail: { appealId: appeal.id, originalDecisionDigest, reason: appeal.reason, reasonCode: appeal.reasonCode, evidenceDigest: appeal.evidenceDigest, appealDeadline: appeal.appealDeadline, reviewDueAt: appeal.reviewDueAt } });
  return appeal;
}

function selectSpecialCaseAppealExperts(row, experts = [], payload = {}, actor = "appeal-panel-service") {
  requireSpecialCaseStateProjection(row);
  if (specialCaseState(row) !== "APPEALED") throw new SpecialCaseWorkflowError("当前状态不允许抽取复议专家", "SPECIAL_CASE_APPEAL_PANEL_STATE_INVALID");
  const appeal = currentAppeal(row);
  if (!appeal || appeal.expertPanel) throw new SpecialCaseWorkflowError("复议专家组不存在或已完成抽取", "SPECIAL_CASE_APPEAL_PANEL_STATE_INVALID");
  if (!verifySpecialCaseLedger(row.events)) throw new SpecialCaseWorkflowError("特例单议事件账本校验失败", "SPECIAL_CASE_LEDGER_INVALID");
  const roles = ["medical-insurance-review", "fund-finance-review"];
  const excludedIds = new Set([...(row.expertPanel?.members || []).map((item) => item.expertId), ...(payload.excludedExpertIds || []).map(String)]);
  const originalReviewerAccounts = new Set((row.expertPanel?.members || []).map((item) => item.reviewerAccount));
  const selectedAccounts = new Set(originalReviewerAccounts);
  const seed = digest({ appealId: appeal.id, originalDecisionDigest: appeal.originalDecisionDigest, evidenceDigest: appeal.evidenceDigest, selectionNonce: safeText(payload.selectionNonce || appeal.id, 120) });
  const members = roles.map((role) => {
    const selected = chooseExpert(eligibleExperts(experts, row, role, excludedIds).filter((item) => !selectedAccounts.has(safeText(item.reviewerAccount || item.name, 120))), `${seed}:${role}`);
    if (!selected) throw new SpecialCaseWorkflowError(`没有可用的${role}复议专家`, "SPECIAL_CASE_APPEAL_EXPERT_UNAVAILABLE");
    excludedIds.add(selected.id);
    selectedAccounts.add(safeText(selected.reviewerAccount || selected.name, 120));
    return { expertId: selected.id, reviewerAccount: safeText(selected.reviewerAccount || selected.name, 120), role, organization: safeText(selected.institution, 120), status: "selected" };
  });
  const at = safeText(payload.at || new Date().toISOString(), 40);
  const selectedAt = new Date(at);
  if (Number.isNaN(selectedAt.getTime()) || selectedAt < new Date(appeal.submittedAt)) throw new SpecialCaseWorkflowError("复议专家抽取时间不得早于复议申请时间", "SPECIAL_CASE_APPEAL_TIME_INVALID", 400);
  appeal.expertPanel = { seedDigest: seed, members, selectionDigest: digest(members), selectedAt: at, selectedBy: safeText(actor, 120) };
  appendEvent(row, { id: `special-event-${randomUUID()}`, action: "select-appeal-experts", from: "APPEALED", to: "APPEALED", actor: appeal.expertPanel.selectedBy, at, idempotencyKey: appeal.expertPanel.selectionDigest, detail: { appealId: appeal.id, selectionDigest: appeal.expertPanel.selectionDigest, roles } });
  return appeal.expertPanel;
}

function verifySpecialCaseAppealPanel(row = {}) {
  const appeal = currentAppeal(row);
  const panel = appeal?.expertPanel;
  if (!panel || panel.selectionDigest !== digest(panel.members || []) || panel.members?.length !== 2) return false;
  if (new Set(panel.members.map((item) => item.expertId)).size !== 2 || new Set(panel.members.map((item) => item.reviewerAccount)).size !== 2) return false;
  const originalExpertIds = new Set((row.expertPanel?.members || []).map((item) => item.expertId));
  const originalReviewerAccounts = new Set((row.expertPanel?.members || []).map((item) => item.reviewerAccount));
  if (panel.members.some((item) => originalExpertIds.has(item.expertId) || originalReviewerAccounts.has(item.reviewerAccount))) return false;
  const event = [...(row.events || [])].reverse().find((item) => item.action === "select-appeal-experts" && item.detail?.appealId === appeal.id);
  return event?.detail?.selectionDigest === panel.selectionDigest;
}

function reviewSpecialCaseAppeal(row, payload = {}, actor = "appeal-reviewer") {
  const before = specialCaseState(row);
  if (!["APPEALED", "APPEAL_UNDER_REVIEW"].includes(before)) throw new SpecialCaseWorkflowError("当前状态不允许评审复议", "SPECIAL_CASE_APPEAL_REVIEW_STATE_INVALID");
  if (!verifySpecialCaseStateProjection(row) || !verifySpecialCaseAppealPanel(row)) throw new SpecialCaseWorkflowError("复议专家组、状态投影或事件账本校验失败", "SPECIAL_CASE_APPEAL_PANEL_INVALID");
  const appeal = currentAppeal(row);
  const reviewer = safeText(actor, 120);
  const assigned = appeal.expertPanel.members.find((item) => item.reviewerAccount === reviewer);
  if (!assigned) throw new SpecialCaseWorkflowError("评审人未进入复议专家组", "SPECIAL_CASE_APPEAL_REVIEWER_NOT_ASSIGNED", 403);
  if ((row.reviews || []).some((item) => item.reviewer === reviewer)) throw new SpecialCaseWorkflowError("原评审人不得参与同案复议", "SPECIAL_CASE_APPEAL_REVIEWER_CONFLICT", 403);
  if (appeal.reviews.some((item) => item.reviewer === reviewer)) throw new SpecialCaseWorkflowError("同一复议专家不得重复签署", "SPECIAL_CASE_APPEAL_DUPLICATE_REVIEWER");
  const approved = payload.approved === true;
  const adjustedPaymentFen = approved ? toFen(payload.adjustedPaymentFen, "复议支付金额") : 0;
  if (approved && adjustedPaymentFen > row.caseTotalAmountFen) throw new SpecialCaseWorkflowError("复议支付金额不得超过病例总费用", "SPECIAL_CASE_AMOUNT_EXCEEDS_COST", 400);
  const prior = appeal.reviews.find((item) => item.approved);
  if (approved && prior && prior.adjustedPaymentFen !== adjustedPaymentFen) throw new SpecialCaseWorkflowError("两名复议专家的支付金额意见必须一致", "SPECIAL_CASE_APPEAL_AMOUNT_CONFLICT");
  const at = safeText(payload.at || new Date().toISOString(), 40);
  const reviewedAt = new Date(at);
  const previousReviewAt = appeal.reviews.at(-1)?.reviewedAt || appeal.expertPanel.selectedAt;
  if (Number.isNaN(reviewedAt.getTime()) || reviewedAt < new Date(previousReviewAt)) throw new SpecialCaseWorkflowError("复议评审时间不得早于专家抽取或上一评审时间", "SPECIAL_CASE_APPEAL_TIME_INVALID", 400);
  const review = { id: `special-appeal-review-${randomUUID()}`, reviewer, expertId: assigned.expertId, role: assigned.role, approved, adjustedPaymentFen, opinion: safeText(payload.opinion || (approved ? "复议通过" : "维持原决定")), reviewedAt: at };
  appeal.reviews.push(review);
  if (!approved) {
    appeal.state = "APPEAL_REJECTED";
    row.state = "APPEAL_REJECTED";
  } else if (appeal.reviews.filter((item) => item.approved).length === 2) {
    appeal.state = "APPROVED";
    row.state = "APPROVED";
    row.adjustedPaymentFen = adjustedPaymentFen;
    row.adjustedPayment = adjustedPaymentFen / 100;
  } else {
    appeal.state = "APPEAL_UNDER_REVIEW";
    row.state = "APPEAL_UNDER_REVIEW";
  }
  row.status = SPECIAL_CASE_LABELS[row.state];
  row.updatedAt = at;
  row.updatedBy = reviewer;
  if (["APPROVED", "APPEAL_REJECTED"].includes(row.state)) {
    appeal.decidedAt = at;
    appeal.outcome = row.state;
    appeal.decisionDigest = appealDecisionDigest(appeal, appeal.reviews, appeal.outcome);
    row.decisionDigest = appeal.decisionDigest;
    row.reviewedAt = at;
    row.reviewedBy = appeal.reviews.map((item) => item.reviewer);
  }
  appendEvent(row, { id: `special-event-${randomUUID()}`, action: approved ? "approve-appeal" : "reject-appeal", from: before, to: row.state, actor: reviewer, at, idempotencyKey: review.id, detail: { appealId: appeal.id, reviewId: review.id, expertId: review.expertId, role: review.role, adjustedPaymentFen, opinion: review.opinion, decisionDigest: appeal.decisionDigest || "" } });
  return { row, appeal, review };
}

function settlementAdjustment(specialCases = [], item = {}) {
  const row = specialCases.find((candidate) => candidate.caseId === item.id && specialCaseState(candidate) === "APPROVED");
  if (!row) return null;
  const appeal = currentAppeal(row);
  if (!verifySpecialCaseStateProjection(row) || !verifySpecialCaseExpertPanel(row) || (appeal?.outcome === "APPROVED" && !verifySpecialCaseAppealPanel(row)) || !/^[a-f0-9]{64}$/.test(String(row.decisionDigest || ""))) throw new SpecialCaseWorkflowError("特例单议决议、专家抽取、状态投影或事件账本校验失败", "SPECIAL_CASE_LEDGER_INVALID");
  return { row, adjustedPaymentFen: toFen(row.adjustedPaymentFen, "特例单议支付金额"), decisionDigest: row.decisionDigest };
}

function includeSpecialCaseInSettlement(row, batchId, actor = "settlement-service") {
  requireSpecialCaseStateProjection(row);
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

function buildSpecialCaseDisclosure(specialCases = [], caseCountByInstitution = {}) {
  const institutions = [...new Set(specialCases.map((item) => item.institution).filter(Boolean))];
  const rows = institutions.map((institution) => {
    const items = specialCases.filter((item) => item.institution === institution);
    const approved = items.filter((item) => ["APPROVED", "INCLUDED"].includes(specialCaseState(item)));
    const dischargedCases = Math.max(0, Number(caseCountByInstitution[institution] || 0));
    return { institution, applications: items.length, appeals: items.filter((item) => (item.appeals || []).length).length, approved: approved.length, included: items.filter((item) => specialCaseState(item) === "INCLUDED").length, applicationRate: dischargedCases ? Number((items.length / dischargedCases).toFixed(4)) : 0, adjustedPaymentFen: approved.reduce((sum, item) => sum + Number(item.adjustedPaymentFen || 0), 0) };
  });
  return { generatedAt: new Date().toISOString(), institutions: rows, totals: { applications: rows.reduce((sum, item) => sum + item.applications, 0), approved: rows.reduce((sum, item) => sum + item.approved, 0), included: rows.reduce((sum, item) => sum + item.included, 0), adjustedPaymentFen: rows.reduce((sum, item) => sum + item.adjustedPaymentFen, 0) }, privacyBoundary: "仅公开机构汇总，不返回病例、患者、证据或专家身份。" };
}

module.exports = { ACTIVE_STATES, SPECIAL_CASE_APPEAL_POLICY, SPECIAL_CASE_LABELS, SpecialCaseWorkflowError, addCalendarDays, appendEvent, buildSpecialCaseAppealSla, buildSpecialCaseDisclosure, createSpecialCaseAppeal, createSpecialCaseApplication, currentAppeal, digest, eligibleExperts, includeSpecialCaseInSettlement, reselectSpecialCaseExpert, reviewSpecialCaseAppeal, reviewSpecialCaseApplication, selectSpecialCaseAppealExperts, selectSpecialCaseExperts, settlementAdjustment, specialCaseState, stableStringify, verifySpecialCaseAppealPanel, verifySpecialCaseExpertPanel, verifySpecialCaseLedger, verifySpecialCaseStateProjection };
