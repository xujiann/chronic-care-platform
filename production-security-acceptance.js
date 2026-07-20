"use strict";

const ALLOWED_SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const CLOSED_STATUSES = new Set(["closed", "waived"]);

function actorKey(user = {}) {
  return String(user.id || user.username || user.name || user.role || "unknown").trim();
}

function isoNow(now = new Date()) {
  return now.toISOString();
}

function dateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function seedProductionSecurityFindings() {
  return [
    {
      id: "psf-dependency-high-001",
      source: "software-composition-analysis",
      severity: "high",
      title: "Production dependency high-risk finding requires remediation evidence",
      asset: "platform-runtime",
      status: "assigned",
      owner: "platform-security",
      dueAt: "2026-07-25",
      evidenceRefs: ["controlled-scan/2026-07-baseline.json"],
      remediationEvidenceRefs: [],
      history: []
    },
    {
      id: "psf-penetration-critical-001",
      source: "penetration-test",
      severity: "critical",
      title: "Authentication replay finding from controlled penetration rehearsal",
      asset: "identity-gateway",
      status: "closed",
      owner: "identity-security",
      dueAt: "2026-07-12",
      evidenceRefs: ["controlled-pentest/PT-2026-001"],
      remediationEvidenceRefs: ["controlled-retest/RT-2026-001"],
      retestResult: "passed",
      reviewedBy: "independent-security-reviewer",
      reviewedAt: "2026-07-13T08:00:00.000Z",
      history: []
    },
    {
      id: "psf-crypto-medium-001",
      source: "commercial-crypto-gap-assessment",
      severity: "medium",
      title: "Production key-custody handoff evidence is pending",
      asset: "key-management-boundary",
      status: "open",
      owner: "security-compliance",
      dueAt: "2026-07-30",
      evidenceRefs: ["commercial-crypto-readiness-report.md"],
      remediationEvidenceRefs: [],
      history: []
    },
    {
      id: "psf-legacy-high-waiver-001",
      source: "configuration-review",
      severity: "high",
      title: "Legacy monitoring endpoint temporary compatibility risk",
      asset: "monitoring-adapter",
      status: "waived",
      owner: "platform-ops",
      dueAt: "2026-08-10",
      evidenceRefs: ["risk-waiver/RW-2026-001"],
      remediationEvidenceRefs: [],
      waiver: {
        reason: "Temporary compatibility window while the target SIEM endpoint is upgraded.",
        compensatingControl: "Source allowlist, HMAC delivery and daily receipt reconciliation.",
        expiresAt: "2026-08-10",
        requestedBy: "platform-ops",
        approvedBy: "independent-security-reviewer",
        approvedAt: "2026-07-15T08:00:00.000Z"
      },
      history: []
    }
  ];
}

function seedProductionSecurityReleaseApprovals() {
  return [
    { id: "psa-security-owner", role: "security-owner", title: "Security remediation release opinion", status: "pending" },
    { id: "psa-release-owner", role: "release-owner", title: "Production release security acceptance", status: "pending" }
  ];
}

function isWaiverActive(finding, today = new Date()) {
  if (finding.status !== "waived" || !dateOnly(finding.waiver?.expiresAt)) return false;
  const expiry = new Date(`${finding.waiver.expiresAt}T23:59:59.999Z`);
  return expiry.getTime() >= today.getTime();
}

function findingOpen(finding, now = new Date()) {
  if (finding.status === "waived") return !isWaiverActive(finding, now);
  return !CLOSED_STATUSES.has(finding.status);
}

function buildProductionSecurityAcceptanceCenter(findings = [], approvals = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const rows = findings.map((finding) => {
    const open = findingOpen(finding, now);
    const due = dateOnly(finding.dueAt) ? new Date(`${finding.dueAt}T23:59:59.999Z`) : null;
    return {
      ...finding,
      open,
      waiverActive: isWaiverActive(finding, now),
      overdue: open && due ? due.getTime() < now.getTime() : false
    };
  });
  const blocking = rows.filter((item) => item.open && ["critical", "high"].includes(item.severity));
  const unresolved = rows.filter((item) => item.open);
  const releaseEligible = blocking.length === 0 && unresolved.length === 0 && rows.length >= 4;
  const approved = approvals.filter((item) => item.status === "approved");
  const distinctSigners = new Set(approved.map((item) => item.approvedBy).filter(Boolean));
  const independentlyApproved = approvals.length >= 2 && approved.length === approvals.length && distinctSigners.size === approvals.length;
  return {
    ok: true,
    generatedAt: isoNow(now),
    status: independentlyApproved && releaseEligible
      ? "security-opinion-recorded"
      : releaseEligible
        ? "ready-for-independent-security-opinion"
        : "blocked-by-security-findings",
    summary: {
      findings: rows.length,
      openFindings: unresolved.length,
      criticalOpen: blocking.filter((item) => item.severity === "critical").length,
      highOpen: blocking.filter((item) => item.severity === "high").length,
      overdue: rows.filter((item) => item.overdue).length,
      activeWaivers: rows.filter((item) => item.waiverActive).length,
      releaseApprovals: approvals.length,
      approvedReleaseOpinions: approved.length,
      releaseEligible,
      independentlyApproved
    },
    findings: rows,
    approvals,
    productionGate: {
      p0BlockerId: "P0-07",
      softwareControlReady: true,
      releaseEligible,
      securityOpinionRecorded: independentlyApproved && releaseEligible,
      formalProductionReady: false
    },
    boundary: "This workbench records controlled findings, remediation, retest, time-bound waivers and independent release opinions. It does not replace classified-protection assessment, commercial-crypto assessment, penetration testing, key handoff or formal go/no-go approval."
  };
}

function requireNote(payload) {
  const note = String(payload.note || payload.comment || "").trim();
  if (note.length < 6) throw new Error("note must contain at least 6 characters");
  return note;
}

function normalizeProductionSecurityFindingAction(finding, payload = {}, user = {}, options = {}) {
  const action = String(payload.action || "").trim();
  const allowed = new Set(["assign", "record-remediation", "submit-retest", "verify-retest", "request-waiver", "approve-waiver", "reject-waiver", "reopen"]);
  if (!allowed.has(action)) throw new Error("unsupported production security finding action");
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const actor = actorKey(user);
  const note = requireNote(payload);
  const next = { ...finding, history: Array.isArray(finding.history) ? [...finding.history] : [] };
  if (!ALLOWED_SEVERITIES.has(next.severity)) throw new Error("unsupported security finding severity");

  if (action === "assign") {
    const owner = String(payload.owner || "").trim();
    const dueAt = String(payload.dueAt || "").trim();
    if (!owner || !dateOnly(dueAt)) throw new Error("owner and dueAt (YYYY-MM-DD) are required");
    next.owner = owner;
    next.dueAt = dueAt;
    next.status = "assigned";
  }
  if (action === "record-remediation") {
    if (next.status === "closed") throw new Error("closed finding must be reopened before remediation changes");
    const evidenceRef = String(payload.evidenceRef || "").trim();
    if (!evidenceRef) throw new Error("evidenceRef is required for remediation");
    next.remediationEvidenceRefs = Array.from(new Set([...(next.remediationEvidenceRefs || []), evidenceRef]));
    next.status = "remediation-recorded";
    next.remediatedBy = actor;
    next.remediatedAt = isoNow(now);
  }
  if (action === "submit-retest") {
    if (!(next.remediationEvidenceRefs || []).length) throw new Error("remediation evidence is required before retest submission");
    next.status = "pending-retest";
    next.retestSubmittedBy = actor;
    next.retestSubmittedAt = isoNow(now);
  }
  if (action === "verify-retest") {
    if (next.status !== "pending-retest") throw new Error("finding is not pending retest");
    if (next.retestSubmittedBy === actor) throw new Error("independent reviewer is required for retest");
    const result = String(payload.result || "").trim();
    const evidenceRef = String(payload.evidenceRef || "").trim();
    if (!new Set(["passed", "failed"]).has(result) || !evidenceRef) throw new Error("result and retest evidenceRef are required");
    next.evidenceRefs = Array.from(new Set([...(next.evidenceRefs || []), evidenceRef]));
    next.retestResult = result;
    next.reviewedBy = actor;
    next.reviewedAt = isoNow(now);
    next.status = result === "passed" ? "closed" : "reopened";
  }
  if (action === "request-waiver") {
    if (next.severity === "critical") throw new Error("critical findings cannot be waived");
    const expiresAt = String(payload.expiresAt || "").trim();
    const reason = String(payload.reason || "").trim();
    const compensatingControl = String(payload.compensatingControl || "").trim();
    if (!dateOnly(expiresAt) || !reason || !compensatingControl) throw new Error("expiresAt, reason and compensatingControl are required");
    const expiry = new Date(`${expiresAt}T23:59:59.999Z`);
    const maxDays = next.severity === "high" ? 30 : 90;
    if (expiry <= now || expiry.getTime() - now.getTime() > maxDays * 86400000) throw new Error(`waiver expiry must be within ${maxDays} days`);
    next.status = "pending-waiver";
    next.waiver = { expiresAt, reason, compensatingControl, requestedBy: actor, requestedAt: isoNow(now) };
  }
  if (action === "approve-waiver" || action === "reject-waiver") {
    if (next.status !== "pending-waiver") throw new Error("finding is not pending waiver review");
    if (next.waiver?.requestedBy === actor) throw new Error("independent reviewer is required for waiver approval");
    next.waiver = { ...next.waiver, reviewedBy: actor, reviewedAt: isoNow(now), reviewNote: note };
    if (action === "approve-waiver") {
      next.waiver.approvedBy = actor;
      next.waiver.approvedAt = isoNow(now);
      next.status = "waived";
    } else {
      next.status = "reopened";
    }
  }
  if (action === "reopen") {
    next.status = "reopened";
    next.waiver = next.waiver ? { ...next.waiver, revokedAt: isoNow(now), revokedBy: actor } : next.waiver;
  }

  next.updatedAt = isoNow(now);
  next.updatedBy = actor;
  next.history = [{ action, note, at: next.updatedAt, actor }, ...next.history].slice(0, 50);
  return next;
}

function normalizeProductionSecurityReleaseApprovalAction(approval, payload = {}, user = {}, center, options = {}) {
  const action = String(payload.action || "").trim();
  if (!new Set(["approve-release", "revoke-release"]).has(action)) throw new Error("unsupported security release approval action");
  const note = requireNote(payload);
  const actor = actorKey(user);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  if (action === "approve-release") {
    if (!center?.summary?.releaseEligible) throw new Error("security release is blocked until every finding is closed or actively waived");
    const duplicate = (center.approvals || []).some((item) => item.id !== approval.id && item.status === "approved" && item.approvedBy === actor);
    if (duplicate) throw new Error("independent release opinions require unique signers");
    return { ...approval, status: "approved", approvedBy: actor, approvedAt: isoNow(now), note };
  }
  return { ...approval, status: "pending", revokedBy: actor, revokedAt: isoNow(now), note };
}

module.exports = {
  buildProductionSecurityAcceptanceCenter,
  normalizeProductionSecurityFindingAction,
  normalizeProductionSecurityReleaseApprovalAction,
  seedProductionSecurityFindings,
  seedProductionSecurityReleaseApprovals
};
