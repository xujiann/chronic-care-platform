#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_REGISTRY: IDEMPOTENCY_REGISTRY, validateEvidenceRegistry: validateIdempotencyEvidence } = require("./api-idempotency-evidence");

const ROOT = path.resolve(__dirname, "..");
const AUTHENTICATION_REGISTRY = require("../config/api-authentication-evidence.json");
const VALID_MODES = new Set(["required", "optional", "none"]);

function smsAuthenticationContract(contract) {
  return {
    contractId: "identity-security.sms-delivery-callback-authentication.v1",
    key: contract.key,
    method: contract.method,
    path: contract.path,
    owner: contract.owner,
    domain: contract.domain,
    purpose: contract.purpose,
    authentication: {
      ...contract.authentication,
      mode: "required"
    },
    authorization: { ...contract.authorization, roles: [...contract.authorization.roles] },
    replayCsrf: { ...contract.authentication.replayCsrf },
    implementationEvidence: contract.implementationEvidence,
    negativeTestEvidence: contract.testEvidence,
    repositoryStatus: "control-flow-and-negative-test-verified",
    productionReady: false,
    externalEvidenceRequired: true,
    governanceSource: `config/api-idempotency-evidence.json#${contract.contractId}`
  };
}

function authenticationEvidenceContracts(registry = AUTHENTICATION_REGISTRY, idempotencyRegistry = IDEMPOTENCY_REGISTRY) {
  return [
    ...(registry.contracts || []).map((contract) => ({
      ...contract,
      governanceSource: `config/api-authentication-evidence.json#${contract.contractId}`
    })),
    ...(idempotencyRegistry.contracts || []).filter((contract) => contract.customAuthenticationEvidence === true).map(smsAuthenticationContract)
  ];
}

function evidenceFile(root, reference) {
  const base = path.resolve(root);
  const resolved = path.resolve(base, String(reference || ""));
  return resolved.startsWith(`${base}${path.sep}`) ? resolved : null;
}

function validateEvidenceAnchors(contract, evidence, type, root, errors) {
  const file = evidenceFile(root, evidence?.file);
  if (!file || !fs.existsSync(file)) {
    errors.push(`missing ${type} evidence file for ${contract.key}: ${evidence?.file || "unknown"}`);
    return;
  }
  if (!Array.isArray(evidence.anchors) || evidence.anchors.length === 0) {
    errors.push(`${type} evidence anchors required for ${contract.key}: ${evidence.file}`);
    return;
  }
  const source = fs.readFileSync(file, "utf8");
  for (const anchor of evidence.anchors) {
    if (!anchor || !source.includes(anchor)) errors.push(`missing ${type} evidence anchor for ${contract.key}: ${evidence.file}:${anchor || "empty"}`);
  }
}

function validateAuthenticationEvidence(registry = AUTHENTICATION_REGISTRY, root = ROOT, idempotencyRegistry = IDEMPOTENCY_REGISTRY) {
  const errors = validateIdempotencyEvidence(idempotencyRegistry, root).map((error) => `idempotency evidence: ${error}`);
  if (registry?.schemaVersion !== "api-authentication-evidence-v1") errors.push("unsupported authentication evidence schema");
  if (registry?.policy?.sourceMarkersAreAuthenticationProof !== false) errors.push("source markers must not be authentication proof");
  if (registry?.policy?.unregisteredCustomAuthenticationStatus !== "review-required") errors.push("unregistered custom authentication must remain review-required");
  if (registry?.policy?.productionPromotionAllowed !== false) errors.push("authentication evidence must not allow production promotion");

  const keys = new Set();
  const contractIds = new Set();
  for (const contract of authenticationEvidenceContracts(registry, idempotencyRegistry)) {
    if (!contract.contractId || contractIds.has(contract.contractId)) errors.push(`duplicate or missing authentication contract id: ${contract.contractId || "unknown"}`);
    contractIds.add(contract.contractId);
    if (!contract.key || contract.key !== `${contract.method} ${contract.path}` || keys.has(contract.key)) errors.push(`duplicate or invalid authentication evidence key: ${contract.key || "unknown"}`);
    keys.add(contract.key);
    if (!/^T\d{2}$/.test(contract.owner || "") || !contract.domain || !contract.purpose) errors.push(`incomplete authentication evidence ownership: ${contract.key || "unknown"}`);

    const authentication = contract.authentication || {};
    if (typeof authentication.required !== "boolean" || !VALID_MODES.has(authentication.mode)) errors.push(`incomplete authentication requirement: ${contract.key || "unknown"}`);
    if ((authentication.mode === "required") !== authentication.required || (authentication.mode !== "required" && authentication.required !== false)) {
      errors.push(`authentication mode and required flag conflict: ${contract.key || "unknown"}`);
    }
    if (!authentication.mechanism || !authentication.principalType || !Array.isArray(authentication.credentialSource) || authentication.credentialSource.length === 0) {
      errors.push(`incomplete authentication mechanism or credential source: ${contract.key || "unknown"}`);
    }
    if (!contract.authorization?.model || !Array.isArray(contract.authorization?.roles) || !contract.authorization?.dataScope) {
      errors.push(`incomplete authentication authorization scope: ${contract.key || "unknown"}`);
    }
    if (!contract.replayCsrf?.replayProtection || !contract.replayCsrf?.csrf) errors.push(`replay and CSRF classification required: ${contract.key || "unknown"}`);
    if (contract.repositoryStatus !== "control-flow-and-negative-test-verified") errors.push(`authentication evidence must be behavior verified: ${contract.key || "unknown"}`);
    if (contract.productionReady !== false || contract.externalEvidenceRequired !== true) errors.push(`authentication evidence must remain production fail closed: ${contract.key || "unknown"}`);

    const implementationEvidence = contract.implementationEvidence || [];
    const negativeTestEvidence = contract.negativeTestEvidence || [];
    if (!implementationEvidence.length || !negativeTestEvidence.length) errors.push(`implementation and negative test evidence required: ${contract.key || "unknown"}`);
    for (const evidence of implementationEvidence) validateEvidenceAnchors(contract, evidence, "implementation", root, errors);
    for (const evidence of negativeTestEvidence) {
      if (!String(evidence.file || "").replaceAll("\\", "/").startsWith("test/")) errors.push(`negative evidence must reference an executable test: ${contract.key || "unknown"}`);
      validateEvidenceAnchors(contract, evidence, "negative test", root, errors);
    }
    const routeEvidence = implementationEvidence.filter((evidence) => String(evidence.file || "").replaceAll("\\", "/").startsWith("src/http/routes/"));
    if (routeEvidence.length !== 1) errors.push(`authentication evidence must bind exactly one route source: ${contract.key || "unknown"}`);
    else {
      const sourceFile = evidenceFile(root, routeEvidence[0].file);
      const source = sourceFile && fs.existsSync(sourceFile) ? fs.readFileSync(sourceFile, "utf8") : "";
      if (!source.includes(contract.path) || !new RegExp(`req\\.method\\s*(?:===|!==)\\s*[\"']${contract.method}[\"']`).test(source)) {
        errors.push(`authentication evidence route source drift: ${contract.key || "unknown"}`);
      }
    }
  }
  return errors;
}

function authenticationEvidenceByKey(registry = AUTHENTICATION_REGISTRY, idempotencyRegistry = IDEMPOTENCY_REGISTRY) {
  return new Map(authenticationEvidenceContracts(registry, idempotencyRegistry).map((contract) => [contract.key, contract]));
}

function runCli(argv = process.argv.slice(2)) {
  const contracts = authenticationEvidenceContracts();
  const errors = validateAuthenticationEvidence();
  const output = argv.includes("--check") ? {
    ok: errors.length === 0,
    errors,
    summary: {
      contracts: contracts.length,
      required: contracts.filter((contract) => contract.authentication.required).length,
      optional: contracts.filter((contract) => contract.authentication.mode === "optional").length,
      noAuthentication: contracts.filter((contract) => contract.authentication.mode === "none").length,
      productionReady: contracts.filter((contract) => contract.productionReady).length
    }
  } : {
    schemaVersion: registrySchemaVersion(),
    policy: AUTHENTICATION_REGISTRY.policy,
    contracts
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (errors.length) process.exitCode = 1;
}

function registrySchemaVersion() {
  return AUTHENTICATION_REGISTRY.schemaVersion;
}

if (require.main === module) runCli();

module.exports = {
  AUTHENTICATION_REGISTRY,
  authenticationEvidenceByKey,
  authenticationEvidenceContracts,
  validateAuthenticationEvidence
};
