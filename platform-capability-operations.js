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

function repositoryEvidenceReady(capability, evidenceExists) {
  return capability.evidence
    .filter((item) => !item.startsWith("release/"))
    .every((item) => evidenceExists(item));
}

function buildPlatformCapabilityOperationsCenter(data = {}, options = {}) {
  const evidenceExists = options.evidenceExists || ((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));
  const reviews = normalizePlatformCapabilityReviews(data.platformCapabilityReviews);
  const reviewByCapability = new Map(reviews.map((item) => [item.capabilityId, item]));
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
    productionBlockers: PRODUCTION_BLOCKERS.length
  };
  return {
    ok: capabilities.every((item) => item.repositoryEvidenceReady),
    generatedAt: new Date().toISOString(),
    productionReady: false,
    boundary: "本中心用于仓库能力的责任分派、生产前复核、证据补录和整改闭环。正式生产就绪仍以真实环境联调、安全测评、灾备演练、现场验收和 go/no-go 签字为准。",
    summary,
    capabilities,
    mvpRequiredModules: MVP_REQUIRED_MODULES,
    productionBlockers: PRODUCTION_BLOCKERS
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

module.exports = {
  ALLOWED_ACTIONS,
  PlatformCapabilityOperationsError,
  applyPlatformCapabilityReviewAction,
  buildPlatformCapabilityOperationsCenter,
  normalizePlatformCapabilityReviews,
  seedPlatformCapabilityReviews
};
