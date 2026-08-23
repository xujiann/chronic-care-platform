#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REGISTRY = require("../config/api-idempotency-evidence.json");
const REVIEW_MISSING_PROOF_CODES = new Set([
  "resource-scope",
  "payload-conflict",
  "cas-or-concurrency",
  "stable-error-contract",
  "atomic-audit-or-outbox"
]);

function validateEvidenceAnchors(evidenceItems, subject, root, errors) {
  for (const evidence of evidenceItems || []) {
    const file = path.resolve(root, String(evidence.file || ""));
    if (!evidence.file || !file.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(file)) {
      errors.push(`missing evidence file for ${subject}: ${evidence.file || "unknown"}`);
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    for (const anchor of evidence.anchors || []) if (!source.includes(anchor)) errors.push(`missing evidence anchor for ${subject}: ${evidence.file}:${anchor}`);
    if (!Array.isArray(evidence.anchors) || evidence.anchors.length === 0) errors.push(`evidence anchors required for ${subject}: ${evidence.file}`);
  }
}

function validateEvidenceRegistry(registry = DEFAULT_REGISTRY, root = ROOT) {
  const errors = [];
  if (registry?.schemaVersion !== "api-idempotency-evidence-v1") errors.push("unsupported idempotency evidence schema");
  if (registry?.policy?.sourceMarkersAreBehaviorProof !== false) errors.push("source markers must not be behavior proof");
  if (registry?.policy?.unregisteredWriteStatus !== "behavior-proof-required") errors.push("unregistered writes must require behavior proof");
  if (registry?.policy?.productionPromotionAllowed !== false) errors.push("evidence registry must not allow production promotion");
  const keys = new Set();
  const contractIds = new Set();
  for (const contract of registry?.contracts || []) {
    if (!contract.contractId || contractIds.has(contract.contractId)) errors.push(`duplicate or missing contract id: ${contract.contractId || "unknown"}`);
    contractIds.add(contract.contractId);
    if (!contract.key || contract.key !== `${contract.method} ${contract.path}` || keys.has(contract.key)) errors.push(`duplicate or invalid evidence key: ${contract.key || "unknown"}`);
    keys.add(contract.key);
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(contract.method)) errors.push(`behavior evidence must describe a write method: ${contract.key || "unknown"}`);
    if (!/^T\d{2}$/.test(contract.owner || "") || !contract.domain || !contract.purpose) errors.push(`incomplete evidence ownership: ${contract.key || "unknown"}`);
    if (typeof contract.customAuthenticationEvidence !== "boolean") errors.push(`custom authentication evidence classification required: ${contract.key || "unknown"}`);
    if (contract.authentication?.required !== true || !contract.authentication?.mechanism || !contract.authentication?.principalType) errors.push(`incomplete custom authentication evidence: ${contract.key || "unknown"}`);
    if (!contract.authorization?.model || !contract.authorization?.dataScope || !Array.isArray(contract.authorization?.roles)) errors.push(`incomplete authorization evidence: ${contract.key || "unknown"}`);
    if (!contract.idempotency?.key || !Array.isArray(contract.idempotency?.payloadBinding) || contract.idempotency.payloadBinding.length === 0) errors.push(`incomplete idempotency behavior contract: ${contract.key || "unknown"}`);
    if (!contract.idempotency?.exactReplay || !contract.idempotency?.conflictingReuse) errors.push(`replay and conflict behavior required: ${contract.key || "unknown"}`);
    if (contract.idempotency?.distributedExactlyOnceClaimed !== false) errors.push(`distributed exactly-once must remain unclaimed: ${contract.key || "unknown"}`);
    if (!["endpoint", "action-slice"].includes(contract.coverage?.level)) errors.push(`invalid behavior coverage: ${contract.key || "unknown"}`);
    if (!contract.coverage?.selector || !Array.isArray(contract.coverage?.actions) || contract.coverage.actions.length === 0) errors.push(`route and action coverage required: ${contract.key || "unknown"}`);
    if (contract.coverage?.level === "endpoint" && contract.coverage?.unverifiedRemainder !== false) errors.push(`endpoint evidence cannot retain an unverified remainder: ${contract.key || "unknown"}`);
    if (contract.coverage?.level === "action-slice" && contract.coverage?.unverifiedRemainder !== true) errors.push(`action-slice evidence must retain the endpoint review blocker: ${contract.key || "unknown"}`);
    if (typeof contract.concurrency?.cas?.required !== "boolean") errors.push(`CAS classification required: ${contract.key || "unknown"}`);
    if (contract.concurrency?.cas?.required && (!contract.concurrency.cas.field || !Array.isArray(contract.concurrency.cas.conflictCodes) || contract.concurrency.cas.conflictCodes.length === 0)) errors.push(`CAS field and conflict codes required: ${contract.key || "unknown"}`);
    if (!Array.isArray(contract.errors) || contract.errors.length === 0 || contract.errors.some((item) => !item.code || !Number.isInteger(item.status))) errors.push(`stable error contract required: ${contract.key || "unknown"}`);
    if (!contract.audit?.accepted || !contract.audit?.replay || !contract.audit?.rejected) errors.push(`audit behavior contract required: ${contract.key || "unknown"}`);
    if (contract.productionReady !== false || contract.externalEvidenceRequired !== true) errors.push(`evidence contract must remain production fail closed: ${contract.key || "unknown"}`);
    validateEvidenceAnchors([...(contract.implementationEvidence || []), ...(contract.testEvidence || [])], contract.key, root, errors);
    if (!(contract.implementationEvidence || []).length || !(contract.testEvidence || []).length) errors.push(`implementation and test evidence required: ${contract.key || "unknown"}`);
  }
  const reviewIds = new Set();
  const reviewedKeys = new Set();
  for (const review of registry?.reviewedProofRequired || []) {
    if (!review.reviewId || reviewIds.has(review.reviewId)) errors.push(`duplicate or missing proof-required review id: ${review.reviewId || "unknown"}`);
    reviewIds.add(review.reviewId);
    if (!review.key || review.key !== `${review.method} ${review.path}` || reviewedKeys.has(review.key)) errors.push(`duplicate or invalid proof-required review key: ${review.key || "unknown"}`);
    reviewedKeys.add(review.key);
    if (keys.has(review.key)) errors.push(`proof-required review cannot coexist with behavior contract: ${review.key}`);
    if (!/^T\d{2}$/.test(review.owner || "") || !review.domain) errors.push(`incomplete proof-required review ownership: ${review.key || "unknown"}`);
    if (!Array.isArray(review.missingProof) || review.missingProof.length === 0 || review.missingProof.some((code) => !REVIEW_MISSING_PROOF_CODES.has(code))) {
      errors.push(`invalid proof-required review reasons: ${review.key || "unknown"}`);
    }
    if (review.productionReady !== false) errors.push(`proof-required review must remain production fail closed: ${review.key || "unknown"}`);
    if (!Array.isArray(review.evidence) || review.evidence.length === 0) errors.push(`proof-required review evidence required: ${review.key || "unknown"}`);
    validateEvidenceAnchors(review.evidence, review.key, root, errors);
  }
  return errors;
}

function evidenceByKey(registry = DEFAULT_REGISTRY) {
  return new Map((registry.contracts || []).map((contract) => [contract.key, contract]));
}

function endpointEvidenceContracts(registry = DEFAULT_REGISTRY) {
  return (registry.contracts || []).filter((contract) => contract.coverage?.level === "endpoint");
}

function actionSliceEvidenceContracts(registry = DEFAULT_REGISTRY) {
  return (registry.contracts || []).filter((contract) => contract.coverage?.level === "action-slice");
}

function proofRequiredReviews(registry = DEFAULT_REGISTRY) {
  return registry.reviewedProofRequired || [];
}

function runCli(argv = process.argv.slice(2)) {
  const errors = validateEvidenceRegistry();
  const output = argv.includes("--check")
    ? { ok: errors.length === 0, errors, summary: {
      contracts: DEFAULT_REGISTRY.contracts.length,
      endpointContracts: endpointEvidenceContracts().length,
      actionSliceContracts: actionSliceEvidenceContracts().length,
      reviewedProofRequired: proofRequiredReviews().length,
      productionReady: DEFAULT_REGISTRY.contracts.filter((item) => item.productionReady).length
    } }
    : DEFAULT_REGISTRY;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (errors.length) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  DEFAULT_REGISTRY,
  actionSliceEvidenceContracts,
  endpointEvidenceContracts,
  evidenceByKey,
  proofRequiredReviews,
  validateEvidenceRegistry
};
