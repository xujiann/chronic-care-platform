const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  CAPABILITY_DOMAINS,
  MVP_REQUIRED_MODULES,
  PRODUCTION_BLOCKERS
} = require("./scripts/platform-production-audit");

const ROOT = __dirname;
const ALLOWED_ACTIONS = ["assign", "record-evidence", "review", "request-improvement", "comment"];
const BLOCKER_ALLOWED_ACTIONS = ["assign", "start-remediation", "record-evidence", "submit-evidence", "review-evidence", "record-site-acceptance", "revoke-site-acceptance", "reopen", "comment"];
const BLOCKER_WORKFLOW_STATUSES = ["open", "in-progress", "evidence-submitted", "evidence-reviewed-site-pending", "site-accepted"];
const SITE_ACCEPTANCE_SIGNER_ROLES = ["business", "information", "operations", "security"];
const DEFAULT_OWNERS = {
  "standards-governance": "standards-office",
  "data-governance": "data-platform",
  "integration-exchange": "integration-center",
  "identity-security-audit": "security-administration",
  "clinical-quality-operations": "medical-administration",
  "public-health-chronic": "public-health-office",
  "citizen-services": "citizen-services-office",
  "specialized-applications": "application-delivery",
  "research-sharing-dashboard": "research-and-statistics",
  "operations-release": "platform-operations"
};

class PlatformCapabilityOperationsError extends Error {
  constructor(message, code = "PLATFORM_CAPABILITY_ACTION_INVALID", statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function seedPlatformCapabilityReviews() {
  return CAPABILITY_DOMAINS.map((capability) => ({
    id: `pcor-${capability.id}`,
    capabilityId: capability.id,
    owner: DEFAULT_OWNERS[capability.id] || "platform-governance",
    reviewStatus: "pending-review",
    evidenceRefs: [],
    actionHistory: [],
    updatedAt: "",
    updatedBy: "",
    productionReady: false
  }));
}

function normalizePlatformCapabilityReviews(currentRows) {
  const current = new Map(
    (Array.isArray(currentRows) ? currentRows : [])
      .filter((item) => item && item.capabilityId)
      .map((item) => [item.capabilityId, item])
  );
  return seedPlatformCapabilityReviews().map((seed) => {
    const item = current.get(seed.capabilityId) || {};
    return {
      ...seed,
      ...item,
      id: seed.id,
      capabilityId: seed.capabilityId,
      owner: String(item.owner || seed.owner).trim(),
      reviewStatus: ["pending-review", "in-review", "reviewed-preproduction", "improvement-required"].includes(item.reviewStatus)
        ? item.reviewStatus
        : seed.reviewStatus,
      evidenceRefs: [...new Set(Array.isArray(item.evidenceRefs) ? item.evidenceRefs.map(String).filter(Boolean) : [])].slice(0, 20),
      actionHistory: Array.isArray(item.actionHistory) ? item.actionHistory.slice(0, 20) : [],
      productionReady: false
    };
  });
}

function seedPlatformProductionBlockerReviews() {
  return PRODUCTION_BLOCKERS.map((blocker) => ({
    id: `ppbr-${blocker.id.toLowerCase()}`,
    blockerId: blocker.id,
    owner: blocker.owner,
    workflowStatus: "open",
    evidenceRefs: [],
    actionHistory: [],
    updatedAt: "",
    updatedBy: "",
    siteAcceptance: null,
    siteAcceptanceRequired: true,
    productionReady: false
  }));
}

function normalizeSiteAcceptance(value) {
  if (!value || typeof value !== "object" || value.status !== "accepted") return null;
  const acceptanceId = String(value.acceptanceId || "").trim();
  const signers = Array.isArray(value.signers) ? value.signers
    .map((item) => ({ role: String(item?.role || "").trim(), name: String(item?.name || "").trim() }))
    .filter((item) => SITE_ACCEPTANCE_SIGNER_ROLES.includes(item.role) && item.name.length >= 2 && item.name.length <= 120)
    : [];
  const signerRoles = new Set(signers.map((item) => item.role));
  if (!acceptanceId || !SITE_ACCEPTANCE_SIGNER_ROLES.every((role) => signerRoles.has(role))) return null;
  return {
    status: "accepted",
    acceptanceId,
    signers: SITE_ACCEPTANCE_SIGNER_ROLES.map((role) => signers.find((item) => item.role === role)),
    acceptedAt: String(value.acceptedAt || "").trim(),
    acceptedBy: String(value.acceptedBy || "").trim(),
    note: String(value.note || "").trim()
  };
}

function requireSiteAcceptanceSigners(value) {
  if (!Array.isArray(value)) {
    throw new PlatformCapabilityOperationsError("site acceptance requires four signer records", "PLATFORM_SITE_ACCEPTANCE_SIGNERS_REQUIRED", 409);
  }
  const signers = value.map((item) => ({
    role: cleanText(item?.role, "signer role", 2, 40),
    name: cleanText(item?.name, "signer name", 2, 120)
  }));
  const signerRoles = new Set(signers.map((item) => item.role));
  if (signers.length !== SITE_ACCEPTANCE_SIGNER_ROLES.length || !SITE_ACCEPTANCE_SIGNER_ROLES.every((role) => signerRoles.has(role))) {
    throw new PlatformCapabilityOperationsError("site acceptance requires business, information, operations and security signers", "PLATFORM_SITE_ACCEPTANCE_SIGNERS_INCOMPLETE", 409);
  }
  return SITE_ACCEPTANCE_SIGNER_ROLES.map((role) => signers.find((item) => item.role === role));
}

function normalizePlatformProductionBlockerReviews(currentRows) {
  const current = new Map(
    (Array.isArray(currentRows) ? currentRows : [])
      .filter((item) => item && item.blockerId)
      .map((item) => [item.blockerId, item])
  );
  return seedPlatformProductionBlockerReviews().map((seed) => {
    const item = current.get(seed.blockerId) || {};
    const siteAcceptance = normalizeSiteAcceptance(item.siteAcceptance);
    const workflowStatus = siteAcceptance?.status === "accepted"
      ? "site-accepted"
      : (BLOCKER_WORKFLOW_STATUSES.includes(item.workflowStatus) && item.workflowStatus !== "site-accepted" ? item.workflowStatus : seed.workflowStatus);
    return {
      ...seed,
      ...item,
      id: seed.id,
      blockerId: seed.blockerId,
      owner: String(item.owner || seed.owner).trim(),
      workflowStatus,
      evidenceRefs: [...new Set(Array.isArray(item.evidenceRefs) ? item.evidenceRefs.map(String).filter(Boolean) : [])].slice(0, 30),
      actionHistory: Array.isArray(item.actionHistory) ? item.actionHistory.slice(0, 30) : [],
      siteAcceptance,
      siteAcceptanceRequired: workflowStatus !== "site-accepted",
      productionReady: false
    };
  });
}

function repositoryEvidenceReady(capability, evidenceExists) {
  return capability.evidence
    .filter((item) => !item.startsWith("release/"))
    .every((item) => evidenceExists(item));
}

function buildPlatformCapabilityOperationsCenter(data = {}, options = {}) {
  const evidenceExists = options.evidenceExists || ((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));
  const reviews = normalizePlatformCapabilityReviews(data.platformCapabilityReviews);
  const reviewByCapability = new Map(reviews.map((item) => [item.capabilityId, item]));
  const blockerReviews = normalizePlatformProductionBlockerReviews(data.platformProductionBlockerReviews);
  const reviewByBlocker = new Map(blockerReviews.map((item) => [item.blockerId, item]));
  const capabilities = CAPABILITY_DOMAINS.map((capability) => {
    const review = reviewByCapability.get(capability.id);
    const sourceEvidence = capability.evidence.filter((item) => !item.startsWith("release/"));
    return {
      ...capability,
      sourceEvidence,
      repositoryEvidenceReady: repositoryEvidenceReady(capability, evidenceExists),
      review,
      allowedActions: ALLOWED_ACTIONS,
      productionReady: false
    };
  });
  const productionBlockers = PRODUCTION_BLOCKERS.map((blocker) => ({
    ...blocker,
    review: reviewByBlocker.get(blocker.id),
    allowedActions: BLOCKER_ALLOWED_ACTIONS,
    siteAcceptanceRequired: true,
    productionReady: false
  }));
  const summary = {
    capabilityDomains: capabilities.length,
    repositoryEvidenceReady: capabilities.filter((item) => item.repositoryEvidenceReady).length,
    reviewedPreproduction: capabilities.filter((item) => item.review.reviewStatus === "reviewed-preproduction").length,
    improvementRequired: capabilities.filter((item) => item.review.reviewStatus === "improvement-required").length,
    inReview: capabilities.filter((item) => item.review.reviewStatus === "in-review").length,
    pendingReview: capabilities.filter((item) => item.review.reviewStatus === "pending-review").length,
    evidenceRecorded: capabilities.filter((item) => item.review.evidenceRefs.length > 0).length,
    productionReady: 0,
    mvpRequiredModules: MVP_REQUIRED_MODULES.length,
    productionBlockers: productionBlockers.length,
    blockersOpen: productionBlockers.filter((item) => item.review.workflowStatus === "open").length,
    blockersInProgress: productionBlockers.filter((item) => item.review.workflowStatus === "in-progress").length,
    blockerEvidenceSubmitted: productionBlockers.filter((item) => item.review.workflowStatus === "evidence-submitted").length,
    blockerEvidenceReviewed: productionBlockers.filter((item) => item.review.workflowStatus === "evidence-reviewed-site-pending").length,
    blockerEvidenceRecorded: productionBlockers.filter((item) => item.review.evidenceRefs.length > 0).length,
    blockersSiteAccepted: productionBlockers.filter((item) => item.review.workflowStatus === "site-accepted").length
  };
  const allBlockersSiteAccepted = productionBlockers.every((item) => item.review.workflowStatus === "site-accepted");
  return {
    ok: capabilities.every((item) => item.repositoryEvidenceReady),
    generatedAt: new Date().toISOString(),
    productionReady: false,
    formalGoLiveState: allBlockersSiteAccepted ? "blocked-until-global-go-no-go" : "blocked-until-site-acceptance",
    boundary: "本中心用于仓库能力的责任分派、生产前复核、证据补录和整改闭环。正式生产就绪仍以真实环境联调、安全测评、灾备演练、现场验收和 go/no-go 签字为准。",
    summary,
    capabilities,
    mvpRequiredModules: MVP_REQUIRED_MODULES,
    productionBlockers
  };
}

function cleanText(value, field, minimum = 1, maximum = 1000) {
  const normalized = String(value || "").trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new PlatformCapabilityOperationsError(`${field} must contain ${minimum}-${maximum} characters`, "PLATFORM_CAPABILITY_FIELD_INVALID");
  }
  return normalized;
}

function applyPlatformCapabilityReviewAction(data, capabilityId, payload = {}, actor = {}) {
  const capability = CAPABILITY_DOMAINS.find((item) => item.id === capabilityId);
  if (!capability) {
    throw new PlatformCapabilityOperationsError("platform capability not found", "PLATFORM_CAPABILITY_NOT_FOUND", 404);
  }
  const action = String(payload.action || "").trim();
  if (!ALLOWED_ACTIONS.includes(action)) {
    throw new PlatformCapabilityOperationsError("unsupported platform capability action", "PLATFORM_CAPABILITY_ACTION_UNSUPPORTED");
  }
  const note = cleanText(payload.note, "note", 4, 1000);
  const reviews = normalizePlatformCapabilityReviews(data.platformCapabilityReviews);
  const index = reviews.findIndex((item) => item.capabilityId === capabilityId);
  const previous = reviews[index];
  const now = new Date().toISOString();
  let owner = previous.owner;
  let reviewStatus = previous.reviewStatus;
  let evidenceRefs = previous.evidenceRefs;
  const submittedEvidence = [
    ...(Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : []),
    ...(payload.evidenceRef ? [payload.evidenceRef] : [])
  ].map((item) => String(item || "").trim()).filter(Boolean);

  if (action === "assign") {
    owner = cleanText(payload.owner, "owner", 2, 120);
    if (reviewStatus === "pending-review") reviewStatus = "in-review";
  }
  if (action === "record-evidence") {
    if (!submittedEvidence.length) {
      throw new PlatformCapabilityOperationsError("evidenceRef is required", "PLATFORM_CAPABILITY_EVIDENCE_REQUIRED");
    }
    if (reviewStatus === "pending-review") reviewStatus = "in-review";
  }
  evidenceRefs = [...new Set([...evidenceRefs, ...submittedEvidence])].slice(0, 20);
  if (action === "review") {
    if (!owner || !evidenceRefs.length) {
      throw new PlatformCapabilityOperationsError("review requires an owner and at least one evidence reference", "PLATFORM_CAPABILITY_REVIEW_EVIDENCE_REQUIRED", 409);
    }
    reviewStatus = "reviewed-preproduction";
  }
  if (action === "request-improvement") reviewStatus = "improvement-required";

  const history = {
    id: randomUUID(),
    at: now,
    action,
    actor: String(actor.name || actor.username || "commission-operator"),
    role: String(actor.role || "commission"),
    note,
    fromStatus: previous.reviewStatus,
    toStatus: reviewStatus,
    owner,
    evidenceRefs: submittedEvidence
  };
  const item = {
    ...previous,
    owner,
    reviewStatus,
    evidenceRefs,
    actionHistory: [history, ...previous.actionHistory].slice(0, 20),
    reviewedAt: action === "review" ? now : previous.reviewedAt || "",
    reviewedBy: action === "review" ? history.actor : previous.reviewedBy || "",
    updatedAt: now,
    updatedBy: history.actor,
    productionReady: false
  };
  reviews[index] = item;
  return { reviews, item, history };
}

function applyPlatformProductionBlockerAction(data, blockerId, payload = {}, actor = {}) {
  const blocker = PRODUCTION_BLOCKERS.find((item) => item.id === blockerId);
  if (!blocker) {
    throw new PlatformCapabilityOperationsError("platform production blocker not found", "PLATFORM_PRODUCTION_BLOCKER_NOT_FOUND", 404);
  }
  const action = String(payload.action || "").trim();
  if (!BLOCKER_ALLOWED_ACTIONS.includes(action)) {
    throw new PlatformCapabilityOperationsError("unsupported platform production blocker action", "PLATFORM_PRODUCTION_BLOCKER_ACTION_UNSUPPORTED");
  }
  const note = cleanText(payload.note, "note", 4, 1000);
  const reviews = normalizePlatformProductionBlockerReviews(data.platformProductionBlockerReviews);
  const index = reviews.findIndex((item) => item.blockerId === blockerId);
  const previous = reviews[index];
  const now = new Date().toISOString();
  let owner = previous.owner;
  let workflowStatus = previous.workflowStatus;
  const submittedEvidence = [
    ...(Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : []),
    ...(payload.evidenceRef ? [payload.evidenceRef] : [])
  ].map((item) => String(item || "").trim()).filter(Boolean);
  let evidenceRefs = [...new Set([...previous.evidenceRefs, ...submittedEvidence])].slice(0, 30);

  if (action === "assign") owner = cleanText(payload.owner, "owner", 2, 120);
  if (action === "start-remediation") {
    if (workflowStatus === "evidence-reviewed-site-pending") {
      throw new PlatformCapabilityOperationsError("reviewed evidence must be reopened before remediation resumes", "PLATFORM_PRODUCTION_BLOCKER_REOPEN_REQUIRED", 409);
    }
    workflowStatus = "in-progress";
  }
  if (action === "record-evidence" && !submittedEvidence.length) {
    throw new PlatformCapabilityOperationsError("evidenceRef is required", "PLATFORM_PRODUCTION_BLOCKER_EVIDENCE_REQUIRED");
  }
  if (action === "submit-evidence") {
    if (workflowStatus !== "in-progress") {
      throw new PlatformCapabilityOperationsError("remediation must be in progress before evidence submission", "PLATFORM_PRODUCTION_BLOCKER_REMEDIATION_REQUIRED", 409);
    }
    if (!evidenceRefs.length) {
      throw new PlatformCapabilityOperationsError("at least one evidence reference is required", "PLATFORM_PRODUCTION_BLOCKER_EVIDENCE_REQUIRED", 409);
    }
    workflowStatus = "evidence-submitted";
  }
  if (action === "review-evidence") {
    if (workflowStatus !== "evidence-submitted") {
      throw new PlatformCapabilityOperationsError("submitted evidence is required before review", "PLATFORM_PRODUCTION_BLOCKER_SUBMISSION_REQUIRED", 409);
    }
    if (!owner || !evidenceRefs.length) {
      throw new PlatformCapabilityOperationsError("evidence review requires an owner and evidence", "PLATFORM_PRODUCTION_BLOCKER_REVIEW_REQUIREMENTS_MISSING", 409);
    }
    workflowStatus = "evidence-reviewed-site-pending";
  }
  let siteAcceptance = previous.siteAcceptance || null;
  if (action === "record-site-acceptance") {
    if (workflowStatus !== "evidence-reviewed-site-pending") {
      throw new PlatformCapabilityOperationsError("reviewed evidence is required before site acceptance", "PLATFORM_SITE_ACCEPTANCE_REVIEW_REQUIRED", 409);
    }
    siteAcceptance = {
      status: "accepted",
      acceptanceId: cleanText(payload.acceptanceId, "acceptanceId", 4, 160),
      signers: requireSiteAcceptanceSigners(payload.signers),
      acceptedAt: now,
      acceptedBy: String(actor.name || actor.username || "commission-operator"),
      note
    };
    workflowStatus = "site-accepted";
  }
  if (action === "revoke-site-acceptance") {
    if (workflowStatus !== "site-accepted" || !siteAcceptance) {
      throw new PlatformCapabilityOperationsError("only recorded site acceptance can be revoked", "PLATFORM_SITE_ACCEPTANCE_REVOKE_INVALID", 409);
    }
    siteAcceptance = {
      ...siteAcceptance,
      status: "revoked",
      revokedAt: now,
      revokedBy: String(actor.name || actor.username || "commission-operator"),
      revokeNote: note
    };
    workflowStatus = "in-progress";
  }
  if (action === "reopen") {
    if (workflowStatus !== "evidence-reviewed-site-pending") {
      throw new PlatformCapabilityOperationsError("only reviewed evidence can be reopened", "PLATFORM_PRODUCTION_BLOCKER_REOPEN_INVALID", 409);
    }
    workflowStatus = "in-progress";
  }

  const history = {
    id: randomUUID(),
    at: now,
    action,
    actor: String(actor.name || actor.username || "commission-operator"),
    role: String(actor.role || "commission"),
    note,
    fromStatus: previous.workflowStatus,
    toStatus: workflowStatus,
    owner,
    evidenceRefs: submittedEvidence
  };
  const item = {
    ...previous,
    owner,
    workflowStatus,
    evidenceRefs,
    actionHistory: [history, ...previous.actionHistory].slice(0, 30),
    evidenceReviewedAt: action === "review-evidence" ? now : previous.evidenceReviewedAt || "",
    evidenceReviewedBy: action === "review-evidence" ? history.actor : previous.evidenceReviewedBy || "",
    updatedAt: now,
    updatedBy: history.actor,
    siteAcceptance,
    siteAcceptanceRequired: workflowStatus !== "site-accepted",
    productionReady: false
  };
  reviews[index] = item;
  return { reviews, item, history };
}

module.exports = {
  ALLOWED_ACTIONS,
  BLOCKER_ALLOWED_ACTIONS,
  SITE_ACCEPTANCE_SIGNER_ROLES,
  PlatformCapabilityOperationsError,
  applyPlatformCapabilityReviewAction,
  applyPlatformProductionBlockerAction,
  buildPlatformCapabilityOperationsCenter,
  normalizePlatformCapabilityReviews,
  normalizePlatformProductionBlockerReviews,
  seedPlatformCapabilityReviews,
  seedPlatformProductionBlockerReviews
};
