"use strict";

const crypto = require("node:crypto");

const ACTION_STATES = Object.freeze([
  "open",
  "assigned",
  "evidence-submitted",
  "under-review",
  "returned",
  "escalated",
  "accepted"
]);

const ACTION_TRANSITIONS = Object.freeze({
  open: { assign: "assigned", escalate: "escalated" },
  assigned: { "submit-evidence": "evidence-submitted", escalate: "escalated" },
  "evidence-submitted": { "start-review": "under-review", escalate: "escalated" },
  "under-review": { accept: "accepted", return: "returned", escalate: "escalated" },
  returned: { "resubmit-evidence": "evidence-submitted", escalate: "escalated" },
  escalated: { "resolve-escalation": "assigned" },
  accepted: { reopen: "open" }
});

const ACCEPT_CONFIRMATION = "ACCEPT T10 EXTERNAL ACTION EVIDENCE";
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function createExternalActionBoard(planReview, options = {}) {
  const generatedAt = options.generatedAt || planReview.generatedAt || new Date().toISOString();
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) throw new Error("generatedAt must be a valid timestamp");
  const actions = (planReview.externalActions || []).map((item) => ({
    ...item,
    status: "open",
    assigneeId: "",
    assignedBy: "",
    assignedAt: "",
    deadlineAt: addDays(generatedAtMs, dueDays(item.priority)),
    evidence: null,
    review: null,
    escalation: null,
    revision: 1,
    requiredEvidence: item.dependencyType === "t00"
      ? ["integration receipt", "route or persistence verification", "SHA-256 digest", "independent review"]
      : ["original site receipt", "interface or drill version", "SHA-256 digest", "independent review"]
  }));
  const board = {
    contractVersion: "1.0.0",
    generatedAt,
    formalBoundary: "Accepted external actions only open formal Go/No-Go review; they never set productionReady by themselves.",
    states: ACTION_STATES,
    transitions: ACTION_TRANSITIONS,
    actions,
    audit: []
  };
  board.summary = summarizeBoard(board, generatedAt);
  board.integrity = { algorithm: "sha256", digest: digest(boardPayload(board)) };
  return board;
}

function applyExternalActionCommand(boardInput, actionId, command = {}) {
  const verification = verifyExternalActionBoard(boardInput);
  if (!verification.ok) throw new Error("external action board integrity verification failed");
  const board = clone(boardInput);
  const action = board.actions.find((item) => item.id === actionId);
  if (!action) throw new Error(`external action not found: ${actionId}`);
  const actorId = String(command.actorId || "").trim();
  const actionName = String(command.action || "").trim();
  const occurredAt = command.occurredAt || new Date().toISOString();
  if (!actorId) throw new Error("actorId is required");
  if (!Number.isFinite(Date.parse(occurredAt))) throw new Error("occurredAt must be a valid timestamp");
  const nextStatus = ACTION_TRANSITIONS[action.status]?.[actionName];
  if (!nextStatus) throw new Error(`action ${actionName || "missing"} is not allowed from ${action.status}`);

  if (actionName === "assign" || actionName === "resolve-escalation") {
    const assigneeId = String(command.assigneeId || "").trim();
    if (!assigneeId) throw new Error("assigneeId is required");
    if (actionName === "resolve-escalation" && !String(command.resolution || "").trim()) throw new Error("resolution is required");
    action.assigneeId = assigneeId;
    action.assignedBy = actorId;
    action.assignedAt = occurredAt;
    if (actionName === "resolve-escalation") action.escalation = { ...action.escalation, resolvedAt: occurredAt, resolvedBy: actorId, resolution: String(command.resolution || "").trim() };
  } else if (actionName === "submit-evidence" || actionName === "resubmit-evidence") {
    if (actorId !== action.assigneeId) throw new Error("only the assigned owner may submit evidence");
    action.evidence = normalizeEvidence(command, actorId, occurredAt, action.revision);
    action.review = null;
  } else if (actionName === "start-review") {
    if (!action.evidence) throw new Error("evidence must be submitted before review");
    if (actorId === action.evidence.submittedBy) throw new Error("reviewer must differ from evidence submitter");
    if (Date.parse(occurredAt) < Date.parse(action.evidence.submittedAt)) throw new Error("review cannot start before evidence submission");
    action.review = { reviewerId: actorId, startedAt: occurredAt, status: "under-review", verificationRef: "", reviewedAt: "" };
  } else if (actionName === "accept") {
    if (!action.evidence || !action.review || action.review.reviewerId !== actorId) throw new Error("the assigned independent reviewer must accept the evidence");
    if (Date.parse(occurredAt) < Date.parse(action.review.startedAt)) throw new Error("acceptance cannot precede review");
    if (command.confirmation !== ACCEPT_CONFIRMATION) throw new Error("exact acceptance confirmation is required");
    if (command.evidenceDigest !== action.evidence.evidenceDigest) throw new Error("accepted digest must match submitted evidence");
    if (!String(command.verificationRef || "").trim()) throw new Error("verificationRef is required");
    action.review = {
      ...action.review,
      status: "accepted",
      verificationRef: String(command.verificationRef).trim(),
      reviewedAt: occurredAt
    };
  } else if (actionName === "return") {
    if (!action.review || action.review.reviewerId !== actorId) throw new Error("the assigned reviewer must return the evidence");
    const reason = String(command.reason || "").trim();
    if (!reason) throw new Error("return reason is required");
    action.review = { ...action.review, status: "returned", reason, reviewedAt: occurredAt };
    action.revision += 1;
  } else if (actionName === "escalate") {
    const reason = String(command.reason || "").trim();
    if (!reason) throw new Error("escalation reason is required");
    action.escalation = { reason, escalatedBy: actorId, escalatedAt: occurredAt, resolvedAt: "", resolvedBy: "", resolution: "" };
  } else if (actionName === "reopen") {
    const changeReason = String(command.changeReason || "").trim();
    const changedBoundary = String(command.changedBoundary || "").trim();
    if (!changeReason || !changedBoundary) throw new Error("changeReason and changedBoundary are required to reopen accepted evidence");
    action.revision += 1;
    action.assigneeId = "";
    action.assignedBy = "";
    action.assignedAt = "";
    action.evidence = null;
    action.review = null;
    action.escalation = { reason: changeReason, changedBoundary, reopenedBy: actorId, reopenedAt: occurredAt };
  }

  const previousStatus = action.status;
  action.status = nextStatus;
  appendAudit(board, {
    actionId,
    event: actionName,
    actorId,
    occurredAt,
    from: previousStatus,
    to: nextStatus,
    revision: action.revision,
    evidenceDigest: action.evidence?.evidenceDigest || ""
  });
  board.summary = summarizeBoard(board, occurredAt);
  board.integrity = { algorithm: "sha256", digest: digest(boardPayload(board)) };
  return board;
}

function evaluateExternalActionGate(board, trackId, options = {}) {
  const now = options.now || new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) throw new Error("now must be a valid timestamp");
  const rows = board.actions.filter((item) => !trackId || item.trackId === trackId);
  if (!rows.length) throw new Error(`no external actions for track: ${trackId || "all"}`);
  const accepted = rows.filter((item) => item.status === "accepted");
  const openP0 = rows.filter((item) => item.priority === "P0" && item.status !== "accepted");
  const overdue = rows.filter((item) => item.status !== "accepted" && Date.parse(item.deadlineAt) < Date.parse(now));
  const escalated = rows.filter((item) => item.status === "escalated");
  const allAccepted = accepted.length === rows.length;
  return {
    trackId: trackId || "all",
    status: allAccepted
      ? "external-actions-accepted-awaiting-formal-go-no-go"
      : (overdue.length || escalated.length) ? "external-actions-blocking" : "external-actions-open",
    ok: allAccepted,
    productionReady: false,
    formalDecisionRequired: true,
    summary: {
      total: rows.length,
      accepted: accepted.length,
      open: rows.length - accepted.length,
      openP0: openP0.length,
      overdue: overdue.length,
      escalated: escalated.length
    },
    hardStops: [
      ...openP0.map((item) => `${item.id}:p0-not-accepted`),
      ...overdue.map((item) => `${item.id}:overdue`),
      ...escalated.map((item) => `${item.id}:escalated`)
    ],
    nextDecision: allAccepted ? "convene-formal-go-no-go" : "keep-production-blocked"
  };
}

function buildExternalActionWorkflowPlan(planReview) {
  const board = createExternalActionBoard(planReview, { generatedAt: planReview.generatedAt });
  return {
    status: "external-action-workflow-code-ready",
    states: ACTION_STATES,
    transitions: ACTION_TRANSITIONS,
    acceptanceConfirmation: ACCEPT_CONFIRMATION,
    board,
    trackGates: (planReview.trackReviews || []).map((track) => evaluateExternalActionGate(board, track.trackId, { now: board.generatedAt })),
    generatedArtifacts: [
      "external-action-board.json",
      "external-action-command-template.json",
      "external-action-audit-export.json",
      "t10-external-action-workflow.js",
      "scripts/t10-external-action.js"
    ],
    summary: {
      actions: board.actions.length,
      p0: board.actions.filter((item) => item.priority === "P0").length,
      site: board.actions.filter((item) => item.dependencyType === "site").length,
      t00: board.actions.filter((item) => item.dependencyType === "t00").length,
      accepted: 0
    },
    formalBoundary: board.formalBoundary
  };
}

function verifyExternalActionBoard(board) {
  const checks = [];
  const ids = (board.actions || []).map((item) => item.id);
  checks.push(workflowCheck("action-identifiers", ids.length > 0 && new Set(ids).size === ids.length, `${ids.length} unique actions`));
  checks.push(workflowCheck("action-states", (board.actions || []).every((item) => ACTION_STATES.includes(item.status)), "all action states are recognized"));
  checks.push(workflowCheck("deadlines", (board.actions || []).every((item) => Number.isFinite(Date.parse(item.deadlineAt))), "all actions have valid deadlines"));
  let previousDigest = "GENESIS";
  let auditValid = true;
  for (const row of board.audit || []) {
    const { digest: rowDigest, ...payload } = row;
    if (row.previousDigest !== previousDigest || rowDigest !== digest(payload)) {
      auditValid = false;
      break;
    }
    previousDigest = rowDigest;
  }
  checks.push(workflowCheck("audit-chain", auditValid, `${(board.audit || []).length} audit events`));
  checks.push(workflowCheck("board-integrity", board.integrity?.digest === digest(boardPayload(board)), board.integrity?.digest || "missing"));
  const failed = checks.filter((item) => !item.passed);
  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "external-action-board-verified" : "external-action-board-invalid",
    checks,
    summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length }
  };
}

function normalizeEvidence(command, submittedBy, submittedAt, revision) {
  const evidenceRef = String(command.evidenceRef || "").trim();
  const originalReference = String(command.originalReference || "").trim();
  const interfaceVersion = String(command.interfaceVersion || "").trim();
  const evidenceDigest = String(command.evidenceDigest || "").trim();
  if (!evidenceRef || !originalReference || !interfaceVersion) throw new Error("evidenceRef, originalReference and interfaceVersion are required");
  if (!SHA256.test(evidenceDigest)) throw new Error("valid SHA-256 evidenceDigest is required");
  return { evidenceRef, originalReference, interfaceVersion, evidenceDigest, submittedBy, submittedAt, revision };
}

function appendAudit(board, event) {
  const previousDigest = board.audit.at(-1)?.digest || "GENESIS";
  const row = { ...event, previousDigest };
  row.digest = digest(row);
  board.audit.push(row);
}

function summarizeBoard(board, now) {
  const accepted = board.actions.filter((item) => item.status === "accepted").length;
  const overdue = board.actions.filter((item) => item.status !== "accepted" && Date.parse(item.deadlineAt) < Date.parse(now)).length;
  return {
    total: board.actions.length,
    accepted,
    open: board.actions.length - accepted,
    p0Open: board.actions.filter((item) => item.priority === "P0" && item.status !== "accepted").length,
    overdue,
    escalated: board.actions.filter((item) => item.status === "escalated").length,
    auditEvents: board.audit.length
  };
}

function boardPayload(board) {
  return {
    contractVersion: board.contractVersion,
    generatedAt: board.generatedAt,
    formalBoundary: board.formalBoundary,
    states: board.states,
    transitions: board.transitions,
    actions: board.actions,
    audit: board.audit,
    summary: board.summary
  };
}

function dueDays(priority) {
  return priority === "P0" ? 7 : priority === "P1" ? 21 : 45;
}

function addDays(timestampMs, days) {
  return new Date(timestampMs + days * 86400000).toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function workflowCheck(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

module.exports = {
  ACTION_STATES,
  ACTION_TRANSITIONS,
  ACCEPT_CONFIRMATION,
  createExternalActionBoard,
  applyExternalActionCommand,
  evaluateExternalActionGate,
  buildExternalActionWorkflowPlan,
  verifyExternalActionBoard
};
