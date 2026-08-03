"use strict";

const CONTRACT_ID = "research-sandbox-read-model.v1";
const CONTRACT_VERSION = "1.0.0";
const MINIMUM_CELL_SIZE = 10;
const READ_MODEL_DEPENDENCIES = Object.freeze(["researchDatasets"]);

class ResearchReadModelError extends Error {
  constructor(message, code = "RESEARCH_READ_MODEL_INVALID") {
    super(message);
    this.name = "ResearchReadModelError";
    this.code = code;
  }
}

function normalizeResearchPurpose(value) {
  const purpose = String(value || "").replace(/[\r\n\t]+/g, " ").trim();
  if (purpose.length < 8) {
    throw new ResearchReadModelError(
      "purpose must contain at least 8 characters",
      "RESEARCH_PURPOSE_REQUIRED"
    );
  }
  if (purpose.length > 200) {
    throw new ResearchReadModelError(
      "purpose must not exceed 200 characters",
      "RESEARCH_PURPOSE_TOO_LONG"
    );
  }
  return purpose;
}

function canReadResearchDataset(user, dataset) {
  if (!user || !dataset) return false;
  if (user.role === "commission") return true;
  if (user.role !== "institution") return false;
  const actor = String(user.username || user.id || "").trim();
  if (!actor) return false;
  if (String(dataset.createdBy || "").trim() === actor) return true;
  return (Array.isArray(dataset.accessRequests) ? dataset.accessRequests : [])
    .some((request) => (
      String(request.by || "").trim() === actor
      && ["approved", "active"].includes(String(request.status || "").trim().toLowerCase())
    ));
}

function buildSuppressedCount(value) {
  const count = Number(value || 0);
  if (!Number.isFinite(count) || count < MINIMUM_CELL_SIZE) {
    return Object.freeze({
      value: null,
      suppressed: true,
      reason: `minimum-cell-size-${MINIMUM_CELL_SIZE}`
    });
  }
  return Object.freeze({
    value: Math.floor(count),
    suppressed: false,
    reason: ""
  });
}

function buildResearchSandboxReadModel(dataset) {
  if (!dataset || typeof dataset !== "object") {
    throw new ResearchReadModelError("dataset is required");
  }
  return Object.freeze({
    contract: Object.freeze({
      id: CONTRACT_ID,
      version: CONTRACT_VERSION,
      mode: "read-only",
      classification: "de-identified-aggregate",
      minimumCellSize: MINIMUM_CELL_SIZE
    }),
    dataset: Object.freeze({
      id: String(dataset.id || "").trim(),
      version: String(dataset.version || "").trim(),
      diseaseType: String(dataset.diseaseType || "").trim(),
      lifecycleStatus: String(dataset.status || "").trim()
    }),
    cohort: Object.freeze({
      recordCount: buildSuppressedCount(dataset.records)
    }),
    controls: Object.freeze({
      deidentified: true,
      minimumNecessary: dataset.governance?.minimumNecessary === true,
      reidentificationProhibited: dataset.governance?.reidentificationProhibited === true,
      retentionDays: Number(dataset.governance?.retentionDays || 0),
      exportReviewRequired: dataset.governance?.exportReviewRequired !== false
    }),
    provenance: Object.freeze({
      readModelDependencies: READ_MODEL_DEPENDENCIES,
      rawRecordAccess: false,
      crossDomainReads: Object.freeze([])
    })
  });
}

module.exports = {
  CONTRACT_ID,
  CONTRACT_VERSION,
  MINIMUM_CELL_SIZE,
  READ_MODEL_DEPENDENCIES,
  ResearchReadModelError,
  buildResearchSandboxReadModel,
  canReadResearchDataset,
  normalizeResearchPurpose
};
