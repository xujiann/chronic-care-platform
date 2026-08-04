"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const REGISTRY_FILE = path.resolve(__dirname, "..", "..", "..", "config", "regional-integration-contracts.json");
const SYSTEMS = new Set(["HIS", "EMR", "LIS", "PACS"]);
const DIRECTIONS = new Set(["inbound", "outbound", "bidirectional"]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CONTROLLED_REFERENCE = /^(?:vault|evidence|artifact|cmdb|ticket):\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;

function integrationError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function clean(value, maximum = 240) {
  return String(value || "").trim().replace(/[\r\n\t]+/g, " ").slice(0, maximum);
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function loadRegionalIntegrationContracts(file = REGISTRY_FILE) {
  const registry = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  if (registry.schemaVersion !== "regional-integration-contract-registry-v1"
    || !Array.isArray(registry.contracts)
    || registry.contracts.length !== SYSTEMS.size) {
    throw integrationError("REGIONAL_INTEGRATION_REGISTRY_INVALID", "regional integration registry is invalid");
  }
  const seenIds = new Set();
  const seenSystems = new Set();
  const contracts = registry.contracts.map((contract) => {
    const id = clean(contract.id, 120);
    const system = clean(contract.system, 20);
    const operations = Array.isArray(contract.operations)
      ? contract.operations.map((item) => clean(item, 120)).filter(Boolean)
      : [];
    const correlationFields = Array.isArray(contract.correlationFields)
      ? contract.correlationFields.map((item) => clean(item, 120)).filter(Boolean)
      : [];
    if (!id || seenIds.has(id) || !SYSTEMS.has(system) || seenSystems.has(system)
      || !DIRECTIONS.has(contract.direction) || !clean(contract.protocol, 80)
      || !/^[A-Z][A-Z0-9_]+_ENDPOINT$/.test(contract.endpointEnv)
      || !/^[A-Z][A-Z0-9_]+_CREDENTIAL_REF$/.test(contract.credentialRefEnv)
      || operations.length === 0 || correlationFields.length < 2
      || contract.jointTestStatus !== "pending-external") {
      throw integrationError("REGIONAL_INTEGRATION_CONTRACT_INVALID", `regional integration contract ${id || "unknown"} is invalid`);
    }
    seenIds.add(id);
    seenSystems.add(system);
    return Object.freeze({
      id,
      system,
      direction: contract.direction,
      protocol: clean(contract.protocol, 80),
      endpointEnv: contract.endpointEnv,
      credentialRefEnv: contract.credentialRefEnv,
      operations: Object.freeze(operations),
      correlationFields: Object.freeze(correlationFields),
      jointTestStatus: "pending-external"
    });
  });
  if ([...SYSTEMS].some((system) => !seenSystems.has(system))) {
    throw integrationError("REGIONAL_INTEGRATION_SYSTEM_MISSING", "regional integration registry must cover HIS, EMR, LIS, and PACS");
  }
  return Object.freeze({
    schemaVersion: registry.schemaVersion,
    contracts: Object.freeze(contracts),
    registryDigest: digest(contracts)
  });
}

function endpointConfigured(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:"
      && !new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function buildRegionalJointTestPlan(options = {}) {
  const registry = options.registry || loadRegionalIntegrationContracts(options.file);
  const env = options.env || {};
  const contracts = registry.contracts.map((contract) => {
    const endpointReady = endpointConfigured(env[contract.endpointEnv]);
    const credentialRefReady = CONTROLLED_REFERENCE.test(clean(env[contract.credentialRefEnv], 240));
    return Object.freeze({
      id: contract.id,
      system: contract.system,
      protocol: contract.protocol,
      operations: contract.operations,
      correlationFields: contract.correlationFields,
      checks: Object.freeze({
        endpointConfigured: endpointReady,
        credentialReferenceConfigured: credentialRefReady,
        signedJointTestReceipt: false
      }),
      localConfigurationReady: endpointReady && credentialRefReady,
      jointTestStatus: "pending-external",
      endpointExposed: false,
      credentialsExposed: false
    });
  });
  return Object.freeze({
    schema: "regional-joint-test-plan-v1",
    registryDigest: registry.registryDigest,
    contracts: Object.freeze(contracts),
    localConfigurationReady: contracts.every((item) => item.localConfigurationReady),
    signedJointTestsReady: false,
    productionReady: false,
    boundary: "This plan validates contract metadata and configuration references only. It does not call a provider or fabricate a signed joint-test receipt."
  });
}

function evaluateRegionalJointTestEvidence(records = [], registry = loadRegionalIntegrationContracts()) {
  const byContract = new Map(records.map((record) => [clean(record?.contractId, 120), record]));
  const contracts = registry.contracts.map((contract) => {
    const record = byContract.get(contract.id);
    const signatures = Array.isArray(record?.signatures) ? record.signatures : [];
    const roles = new Set(signatures.filter((item) =>
      item?.status === "approved" && CONTROLLED_REFERENCE.test(clean(item?.evidenceRef, 240)))
      .map((item) => clean(item.role, 80)));
    const accounts = signatures.map((item) => clean(item.account, 160)).filter(Boolean);
    const checks = Object.freeze({
      receiptReference: CONTROLLED_REFERENCE.test(clean(record?.receiptRef, 240)),
      receiptDigest: SHA256.test(clean(record?.receiptDigest, 80)),
      executedAt: Number.isFinite(Date.parse(record?.executedAt || "")),
      result: record?.result === "passed",
      twoPartySignatures: roles.has("platform-owner")
        && roles.has("institution-owner")
        && accounts.length === 2
        && new Set(accounts).size === 2
    });
    return Object.freeze({
      contractId: contract.id,
      system: contract.system,
      verified: Object.values(checks).every(Boolean),
      checks
    });
  });
  return Object.freeze({
    schema: "regional-joint-test-evidence-v1",
    registryDigest: registry.registryDigest,
    contracts: Object.freeze(contracts),
    externalEvidenceVerified: contracts.every((item) => item.verified),
    evidenceInferred: false,
    productionReady: false
  });
}

module.exports = {
  CONTROLLED_REFERENCE,
  REGISTRY_FILE,
  buildRegionalJointTestPlan,
  endpointConfigured,
  evaluateRegionalJointTestEvidence,
  loadRegionalIntegrationContracts
};
