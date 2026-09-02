"use strict";

const fs = require("node:fs");
const path = require("node:path");
const defaultGovernance = require("../../../config/procurement-requirement-governance.json");
const defaultRegistry = require("../../../config/platform-capability-registry.json");

const PRODUCT_CLASSES = new Set(["CORE", "SHARED", "PACKAGE", "CONFIG", "DEPLOY"]);
const DECISIONS = new Set(["REUSE", "ENHANCE", "BUILD", "CONFIGURE", "DEPLOY"]);
const PRIORITIES = new Set(["P0", "P1", "P2"]);
const EVIDENCE_STATUSES = new Set(["provisional", "source-verified"]);
const COVERAGE = new Set(["repository-verified", "declared-only", "missing", "external-evidence-required"]);
const SECURITY_STATUSES = new Set(["unscanned-external-source", "scanner-attested-clean"]);
const DOCUMENT_KEYS = new Set(["id", "seriesId", "sourceAlias", "revision", "supersedesDocumentId", "sha256", "mediaType", "byteSize", "reviewedPageCount", "extractionMode", "textQuality", "securityStatus", "scanEvidenceDigest", "status", "candidates"]);
const CANDIDATE_KEYS = new Set(["id", "logicalRequirementId", "semanticDigest", "sourceAnchor", "targetCapabilityIds", "productClass", "decision", "priority", "ownerProcess", "evidenceStatus"]);
const ANCHOR_KEYS = new Set(["pageStart", "pageEnd", "sectionCode"]);
const CAPABILITY_KEYS = new Set(["id", "title", "ownerProcess", "productClass", "coverage", "evidence"]);

function exactKeys(label, value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !keys.has(key));
  if (unknown.length) throw new TypeError(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function boundedText(label, value, minimum = 1, maximum = 160) {
  const text = String(value || "").trim();
  if (text.length < minimum || text.length > maximum || /[\u0000-\u001f]/.test(text)) throw new TypeError(`${label} must be bounded text`);
  return text;
}

function opaqueId(label, value, minimum = 4, maximum = 96) {
  const text = boundedText(label, value, minimum, maximum);
  if (!/^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/.test(text)) throw new TypeError(`${label} must be an opaque identifier`);
  return text;
}

function boundedUnique(label, value, minimum, maximum, normalize) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new TypeError(`${label} must be a bounded array`);
  const normalized = value.map(normalize);
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} must contain unique values`);
  return normalized;
}

function validateCapabilityRegistry(registry = defaultRegistry, options = {}) {
  exactKeys("capability registry", registry, new Set(["schemaVersion", "registryId", "capabilities"]));
  if (registry.schemaVersion !== "platform-capability-registry-v1") throw new TypeError("capability registry schema is invalid");
  opaqueId("registryId", registry.registryId);
  if (!Array.isArray(registry.capabilities) || registry.capabilities.length < 1 || registry.capabilities.length > 1000) throw new TypeError("capability registry is empty or too large");
  const root = options.rootDir || path.resolve(__dirname, "../../..");
  for (const [index, capability] of registry.capabilities.entries()) {
    const label = `capabilities[${index}]`;
    exactKeys(label, capability, CAPABILITY_KEYS);
    opaqueId(`${label}.id`, capability.id);
    boundedText(`${label}.title`, capability.title, 2, 80);
    if (!/^T(?:0\d)$/.test(String(capability.ownerProcess || ""))) throw new TypeError(`${label}.ownerProcess is invalid`);
    if (!PRODUCT_CLASSES.has(capability.productClass)) throw new TypeError(`${label}.productClass is invalid`);
    if (!COVERAGE.has(capability.coverage)) throw new TypeError(`${label}.coverage is invalid`);
    const evidence = boundedUnique(`${label}.evidence`, capability.evidence, 0, 12, (entry) => {
      const normalized = boundedText(`${label}.evidence[]`, entry, 4, 180).replaceAll("\\", "/");
      if (path.isAbsolute(normalized) || normalized.includes("..") || normalized.includes("OneDrive") || !/^(?:src|test|config|docs)\//.test(normalized)) throw new TypeError(`${label}.evidence must be a repository-relative reference`);
      return normalized;
    });
    if (capability.coverage === "repository-verified" && (evidence.length < 2 || evidence.some((entry) => !fs.existsSync(path.resolve(root, entry))))) {
      throw new TypeError(`${label} repository evidence is incomplete`);
    }
    if (capability.coverage !== "repository-verified" && evidence.length) throw new TypeError(`${label} unverified coverage must not claim repository evidence`);
  }
  if (new Set(registry.capabilities.map((item) => item.id)).size !== registry.capabilities.length) throw new TypeError("capability ids must be unique");
  return true;
}

function validateCandidate(candidate, index, capabilityIds, pageCount) {
  const label = `candidates[${index}]`;
  exactKeys(label, candidate, CANDIDATE_KEYS);
  opaqueId(`${label}.id`, candidate.id);
  if (!/^REQ-[A-F0-9]{12}$/.test(String(candidate.logicalRequirementId || ""))) throw new TypeError(`${label}.logicalRequirementId is invalid`);
  if (!/^sha256:[a-f0-9]{64}$/.test(String(candidate.semanticDigest || ""))) throw new TypeError(`${label}.semanticDigest is invalid`);
  exactKeys(`${label}.sourceAnchor`, candidate.sourceAnchor, ANCHOR_KEYS);
  const start = candidate.sourceAnchor.pageStart;
  const end = candidate.sourceAnchor.pageEnd;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > pageCount) throw new TypeError(`${label}.sourceAnchor pages are invalid`);
  if (!/^SEC-[A-Z0-9.-]{1,32}$/.test(String(candidate.sourceAnchor.sectionCode || ""))) throw new TypeError(`${label}.sourceAnchor.sectionCode is invalid`);
  const mapped = boundedUnique(`${label}.targetCapabilityIds`, candidate.targetCapabilityIds, 1, 8, (id) => opaqueId(`${label}.targetCapabilityIds[]`, id));
  if (mapped.some((id) => !capabilityIds.has(id))) throw new TypeError(`${label} contains an unregistered capability`);
  if (!PRODUCT_CLASSES.has(candidate.productClass)) throw new TypeError(`${label}.productClass is invalid`);
  if (!DECISIONS.has(candidate.decision)) throw new TypeError(`${label}.decision is invalid`);
  if (!PRIORITIES.has(candidate.priority)) throw new TypeError(`${label}.priority is invalid`);
  if (!/^T(?:0\d)$/.test(String(candidate.ownerProcess || ""))) throw new TypeError(`${label}.ownerProcess is invalid`);
  if (!EVIDENCE_STATUSES.has(candidate.evidenceStatus)) throw new TypeError(`${label}.evidenceStatus is invalid`);
  return true;
}

function validateGovernanceCatalog(catalog = defaultGovernance, options = {}) {
  const registry = options.registry || defaultRegistry;
  validateCapabilityRegistry(registry, options);
  exactKeys("governance catalog", catalog, new Set(["schemaVersion", "catalogId", "limits", "review", "documents"]));
  if (catalog.schemaVersion !== "procurement-requirement-governance-v2") throw new TypeError("procurement requirement governance schema is invalid");
  opaqueId("catalogId", catalog.catalogId);
  exactKeys("limits", catalog.limits, new Set(["maximumPdfBytes", "maximumPages", "maximumDocuments", "maximumBatchDocuments", "maximumBatchBytes", "maximumBatchCandidates", "maximumBatchReviewedPages", "maximumCandidatesPerDocument", "maximumReviewEvents", "maximumCommandReceipts"]));
  for (const [key, value] of Object.entries(catalog.limits)) if (!Number.isInteger(value) || value < 1) throw new TypeError(`limits.${key} must be a positive integer`);
  exactKeys("review", catalog.review, new Set(["actions", "statuses", "requiredRole", "productionReady"]));
  if (JSON.stringify(catalog.review.actions) !== JSON.stringify(["accept", "request-revision", "reject"])) throw new TypeError("review actions are invalid");
  if (JSON.stringify(catalog.review.statuses) !== JSON.stringify(["pending-review", "accepted", "revision-required", "rejected"])) throw new TypeError("review statuses are invalid");
  if (catalog.review.requiredRole !== "commission" || catalog.review.productionReady !== false) throw new TypeError("review boundary must remain fail closed");
  if (!Array.isArray(catalog.documents) || catalog.documents.length < 1 || catalog.documents.length > catalog.limits.maximumDocuments) throw new TypeError("documents are empty or exceed the limit");
  const capabilityIds = new Set(registry.capabilities.map((item) => item.id));
  const documentIds = new Set();
  const documentDigests = new Set();
  const candidateIds = new Set();
  const series = new Map();
  for (const [index, document] of catalog.documents.entries()) {
    const label = `documents[${index}]`;
    exactKeys(label, document, DOCUMENT_KEYS);
    documentIds.add(opaqueId(`${label}.id`, document.id));
    const seriesId = String(document.seriesId || "");
    if (!/^SRC-[A-F0-9]{12}$/.test(seriesId)) throw new TypeError(`${label}.seriesId is invalid`);
    const alias = boundedText(`${label}.sourceAlias`, document.sourceAlias, 4, 80);
    if (alias !== `需求来源 ${seriesId.slice(4)}`) throw new TypeError(`${label}.sourceAlias must be generated from the neutral series id`);
    if (!Number.isInteger(document.revision) || document.revision < 1 || document.revision > 1000) throw new TypeError(`${label}.revision is invalid`);
    if (document.supersedesDocumentId !== null) opaqueId(`${label}.supersedesDocumentId`, document.supersedesDocumentId);
    if (!/^sha256:[a-f0-9]{64}$/.test(String(document.sha256 || ""))) throw new TypeError(`${label}.sha256 is invalid`);
    documentDigests.add(document.sha256);
    if (document.mediaType !== "application/pdf") throw new TypeError(`${label}.mediaType must be application/pdf`);
    if (!Number.isInteger(document.byteSize) || document.byteSize < 5 || document.byteSize > catalog.limits.maximumPdfBytes) throw new TypeError(`${label}.byteSize is invalid`);
    if (!Number.isInteger(document.reviewedPageCount) || document.reviewedPageCount < 1 || document.reviewedPageCount > catalog.limits.maximumPages) throw new TypeError(`${label}.reviewedPageCount is invalid`);
    if (!["human-verified-pages", "native-text-reviewed", "controlled-extractor"].includes(document.extractionMode)) throw new TypeError(`${label}.extractionMode is invalid`);
    if (!["reviewable", "needs-ocr"].includes(document.textQuality) || !SECURITY_STATUSES.has(document.securityStatus) || document.status !== "candidate-review") throw new TypeError(`${label} extraction or security status is invalid`);
    if (document.securityStatus === "unscanned-external-source" && document.scanEvidenceDigest !== null) throw new TypeError(`${label}.scanEvidenceDigest must be null for an unscanned source`);
    if (document.securityStatus === "scanner-attested-clean" && !/^sha256:[a-f0-9]{64}$/.test(String(document.scanEvidenceDigest || ""))) throw new TypeError(`${label}.scanEvidenceDigest is invalid`);
    if (!Array.isArray(document.candidates) || document.candidates.length < 1 || document.candidates.length > catalog.limits.maximumCandidatesPerDocument) throw new TypeError(`${label}.candidates are empty or exceed the limit`);
    document.candidates.forEach((candidate, candidateIndex) => {
      validateCandidate(candidate, candidateIndex, capabilityIds, document.reviewedPageCount);
      candidateIds.add(candidate.id);
    });
    if (!series.has(seriesId)) series.set(seriesId, []);
    series.get(seriesId).push(document);
  }
  if (documentIds.size !== catalog.documents.length) throw new TypeError("document ids must be unique");
  if (documentDigests.size !== catalog.documents.length) throw new TypeError("document digests must be unique");
  const candidateCount = catalog.documents.reduce((count, document) => count + document.candidates.length, 0);
  if (candidateIds.size !== candidateCount) throw new TypeError("candidate ids must be unique across documents");
  for (const [seriesId, documents] of series) {
    const ordered = [...documents].sort((left, right) => left.revision - right.revision);
    const revisions = new Set(ordered.map((document) => document.revision));
    if (revisions.size !== ordered.length) throw new TypeError(`${seriesId} revisions must be unique`);
    ordered.forEach((document, index) => {
      const previous = ordered[index - 1];
      if (index === 0 && (document.revision !== 1 || document.supersedesDocumentId !== null)) throw new TypeError(`${seriesId} must start at revision 1 without a predecessor`);
      if (index > 0 && (document.revision !== previous.revision + 1 || document.supersedesDocumentId !== previous.id)) throw new TypeError(`${seriesId} must form a contiguous linear revision chain`);
      const logicalIds = document.candidates.map((candidate) => candidate.logicalRequirementId);
      if (new Set(logicalIds).size !== logicalIds.length) throw new TypeError(`${document.id} logical requirement ids must be unique`);
    });
  }
  return true;
}

module.exports = {
  COVERAGE,
  DECISIONS,
  EVIDENCE_STATUSES,
  PRIORITIES,
  PRODUCT_CLASSES,
  SECURITY_STATUSES,
  boundedText,
  opaqueId,
  validateCandidate,
  validateCapabilityRegistry,
  validateGovernanceCatalog
};
