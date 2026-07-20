"use strict";

const { createHash } = require("node:crypto");

const APPROVAL_ROLES = ["business", "information", "operations", "security"];
const REQUIRED_P0_BLOCKERS = Array.from({ length: 10 }, (_, index) => `P0-${String(index + 1).padStart(2, "0")}`);

function actorKey(user = {}) {
  return String(user.id || user.username || user.name || user.role || "unknown").trim();
}

function seedProductionGoNoGoApprovals() {
  return APPROVAL_ROLES.map((role, index) => ({
    id: `pgng-approval-${role}`,
    sequence: index + 1,
    role,
    status: "pending",
    approvedBy: "",
    approvedAt: "",
    note: ""
  }));
}

function normalizeApprovals(rows) {
  const current = new Map((Array.isArray(rows) ? rows : []).filter((item) => item?.id).map((item) => [item.id, item]));
  return seedProductionGoNoGoApprovals().map((seed) => ({ ...seed, ...(current.get(seed.id) || {}), id: seed.id, role: seed.role }));
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail: String(detail || "") };
}

function isProductionSmoke(launchSmoke = {}) {
  try {
    const target = new URL(String(launchSmoke.baseUrl || ""));
    return target.protocol === "https:" && !new Set(["localhost", "127.0.0.1", "::1"]).has(target.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function buildProductionGoNoGoCenter(data = {}, evidence = {}, securityCenter = {}) {
  const reviews = Array.isArray(data.platformProductionBlockerReviews) ? data.platformProductionBlockerReviews : [];
  const siteAccepted = reviews.filter((item) => item.workflowStatus === "site-accepted" && item.siteAcceptance?.status === "accepted");
  const siteAcceptanceIds = [...new Set(siteAccepted.map((item) => item.blockerId))].sort();
  const allP0Accepted = REQUIRED_P0_BLOCKERS.every((id) => siteAcceptanceIds.includes(id)) && siteAcceptanceIds.length === REQUIRED_P0_BLOCKERS.length;
  const launchSmoke = evidence.launchSmoke || {};
  const cutoverRows = Array.isArray(evidence.cutoverChecklist) ? evidence.cutoverChecklist : [];
  const cutoverIds = new Set(cutoverRows.map((item) => item.id).filter(Boolean));
  const productionSmoke = isProductionSmoke(launchSmoke);
  const checks = [
    check("goNoGo:siteAcceptances", allP0Accepted, `${siteAcceptanceIds.length}/10 unique P0 blockers site accepted`),
    check("goNoGo:securityOpinion", securityCenter.productionGate?.securityOpinionRecorded === true, `${securityCenter.summary?.approvedReleaseOpinions || 0}/${securityCenter.summary?.releaseApprovals || 0} security opinions`),
    check("goNoGo:launchSmoke", productionSmoke && launchSmoke.ok === true && Number(launchSmoke.summary?.failed || 0) === 0 && Number(launchSmoke.summary?.liveChecks || 0) >= 2, `${launchSmoke.summary?.passed || 0}/${launchSmoke.summary?.total || 0} smoke checks; ${launchSmoke.summary?.liveChecks || 0} live; production target ${productionSmoke ? "verified" : "missing"}`),
    check("goNoGo:cutoverChecklist", evidence.cutoverProfile === "production" && cutoverRows.length === 10 && cutoverIds.size === 10 && cutoverRows.every((item) => item.passed === true), `${cutoverRows.filter((item) => item.passed).length}/10 cutover checks; profile ${evidence.cutoverProfile || "missing"}`),
    check("goNoGo:drSignoff", evidence.drRehearsalSigned === true, evidence.drRehearsalSigned ? "signed DR rehearsal evidence present" : "CUTOVER_DR_REHEARSAL_SIGNOFF missing")
  ];
  const prerequisiteReady = checks.every((item) => item.passed);
  const evidenceFingerprint = createHash("sha256").update(JSON.stringify({
    checks,
    siteAcceptanceIds,
    securityApprovedAt: (securityCenter.approvals || []).map((item) => item.approvedAt || "").sort(),
    launchSmokeGeneratedAt: launchSmoke.generatedAt || ""
  })).digest("hex");
  const approvals = normalizeApprovals(data.productionGoNoGoApprovals);
  const approved = approvals.filter((item) => item.status === "approved" && item.approvedBy && item.evidenceFingerprint === evidenceFingerprint);
  const staleApprovals = approvals.filter((item) => item.status === "approved" && item.approvedBy && item.evidenceFingerprint && item.evidenceFingerprint !== evidenceFingerprint);
  const annotatedApprovals = approvals.map((item) => ({
    ...item,
    evidenceCurrent: item.status !== "approved" || item.evidenceFingerprint === evidenceFingerprint,
    currentEvidenceFingerprint: evidenceFingerprint
  }));
  const uniqueSigners = new Set(approved.map((item) => item.approvedBy));
  const approvalsReady = approved.length === APPROVAL_ROLES.length && uniqueSigners.size === APPROVAL_ROLES.length;
  const decision = data.productionGoNoGoDecision && typeof data.productionGoNoGoDecision === "object" ? data.productionGoNoGoDecision : null;
  const decisionEffective = decision?.decision === "GO" && decision.status === "recorded" && decision.evidenceFingerprint === evidenceFingerprint && prerequisiteReady && approvalsReady;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    status: decisionEffective
      ? "go-decision-recorded"
      : approvalsReady && prerequisiteReady
        ? "ready-for-command-decision"
        : prerequisiteReady
          ? "awaiting-four-party-approvals"
          : "blocked-by-cutover-prerequisites",
    summary: {
      prerequisites: checks.length,
      prerequisitesPassed: checks.filter((item) => item.passed).length,
      siteAcceptances: siteAcceptanceIds.length,
      approvals: approvals.length,
      approvalsRecorded: approved.length,
      staleApprovals: staleApprovals.length,
      uniqueSigners: uniqueSigners.size,
      prerequisiteReady,
      approvalsReady,
      decisionEffective
    },
    checks,
    approvals: annotatedApprovals,
    staleApprovals,
    decision,
    evidenceFingerprint,
    gate: {
      p0BlockerId: "P0-10",
      softwareControlReady: true,
      formalDecisionEligible: prerequisiteReady && approvalsReady,
      productionGoRecorded: decisionEffective
    },
    boundary: "The global command center aggregates signed evidence and records a four-party decision. It does not create site evidence, set signoff environment variables, execute deployment, certify disaster recovery, or replace the formal change-management authority."
  };
}

function requireNote(payload) {
  const note = String(payload.note || "").trim();
  if (note.length < 6) throw new Error("note must contain at least 6 characters");
  return note;
}

function normalizeProductionGoNoGoApprovalAction(approval, payload = {}, user = {}, center, options = {}) {
  const action = String(payload.action || "").trim();
  if (!new Set(["approve", "revoke"]).has(action)) throw new Error("unsupported go/no-go approval action");
  const actor = actorKey(user);
  const note = requireNote(payload);
  const now = (options.now instanceof Date ? options.now : new Date(options.now || Date.now())).toISOString();
  if (action === "approve") {
    if (!center?.summary?.prerequisiteReady) throw new Error("go/no-go approval is blocked until every prerequisite passes");
    if (approval.status === "approved") throw new Error("go/no-go approval has already been recorded");
    if (String(payload.responsibility || "").trim() !== approval.role) throw new Error("approval responsibility must match the controlled role");
    const evidenceRef = String(payload.evidenceRef || "").trim();
    if (!evidenceRef) throw new Error("approval evidenceRef is required");
    const duplicate = (center.approvals || []).some((item) => item.id !== approval.id && item.status === "approved" && item.approvedBy === actor);
    if (duplicate) throw new Error("four-party approvals require unique signers");
    return { ...approval, status: "approved", approvedBy: actor, approvedAt: now, evidenceFingerprint: center.evidenceFingerprint, evidenceRef, responsibility: approval.role, note };
  }
  if (approval.status !== "approved") throw new Error("only a recorded approval can be revoked");
  if (approval.approvedBy !== actor) throw new Error("only the original signer can revoke this approval");
  return { ...approval, status: "pending", approvedBy: "", approvedAt: "", evidenceFingerprint: "", evidenceRef: "", responsibility: "", revokedBy: actor, revokedAt: now, note };
}

function normalizeProductionGoNoGoDecision(payload = {}, user = {}, center, options = {}) {
  const decision = String(payload.decision || "").trim().toUpperCase();
  if (!new Set(["GO", "NO-GO"]).has(decision)) throw new Error("decision must be GO or NO-GO");
  const note = requireNote(payload);
  const confirmation = String(payload.confirmation || "").trim();
  if (decision === "GO" && confirmation !== "APPROVE PRODUCTION GO LIVE") throw new Error("GO decision confirmation text is invalid");
  if (decision === "GO" && !center?.gate?.formalDecisionEligible) throw new Error("GO decision is blocked until prerequisites and four-party approvals pass");
  const changeTicket = String(payload.changeTicket || "").trim();
  const cutoverWindow = String(payload.cutoverWindow || "").trim();
  const rollbackOwner = String(payload.rollbackOwner || "").trim();
  if (!changeTicket) throw new Error("changeTicket is required");
  if (decision === "GO" && (!cutoverWindow || !rollbackOwner)) throw new Error("cutoverWindow and rollbackOwner are required for GO");
  const decisionActor = actorKey(user);
  if (decision === "GO" && (center.approvals || []).some((item) => item.status === "approved" && item.approvedBy === decisionActor)) {
    throw new Error("command decision owner must be independent from four-party approvers");
  }
  const at = (options.now instanceof Date ? options.now : new Date(options.now || Date.now())).toISOString();
  return {
    id: `pgng-decision-${at.replace(/\D/g, "")}`,
    decision,
    status: "recorded",
    changeTicket,
    cutoverWindow,
    rollbackOwner,
    evidenceFingerprint: center.evidenceFingerprint,
    decidedBy: decisionActor,
    decidedAt: at,
    note
  };
}

module.exports = {
  APPROVAL_ROLES,
  REQUIRED_P0_BLOCKERS,
  buildProductionGoNoGoCenter,
  normalizeProductionGoNoGoApprovalAction,
  normalizeProductionGoNoGoDecision,
  seedProductionGoNoGoApprovals
};
