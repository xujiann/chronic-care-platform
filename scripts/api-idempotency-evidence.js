#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REGISTRY = require("../config/api-idempotency-evidence.json");

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
    for (const evidence of [...(contract.implementationEvidence || []), ...(contract.testEvidence || [])]) {
      const file = path.resolve(root, String(evidence.file || ""));
      if (!evidence.file || !file.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(file)) {
        errors.push(`missing evidence file for ${contract.key}: ${evidence.file || "unknown"}`);
        continue;
      }
      const source = fs.readFileSync(file, "utf8");
      for (const anchor of evidence.anchors || []) if (!source.includes(anchor)) errors.push(`missing evidence anchor for ${contract.key}: ${evidence.file}:${anchor}`);
      if (!Array.isArray(evidence.anchors) || evidence.anchors.length === 0) errors.push(`evidence anchors required for ${contract.key}: ${evidence.file}`);
    }
    if (!(contract.implementationEvidence || []).length || !(contract.testEvidence || []).length) errors.push(`implementation and test evidence required: ${contract.key || "unknown"}`);
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

function runCli(argv = process.argv.slice(2)) {
  const errors = validateEvidenceRegistry();
  const output = argv.includes("--check")
    ? { ok: errors.length === 0, errors, summary: {
      contracts: DEFAULT_REGISTRY.contracts.length,
      endpointContracts: endpointEvidenceContracts().length,
      actionSliceContracts: actionSliceEvidenceContracts().length,
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
  validateEvidenceRegistry
};
