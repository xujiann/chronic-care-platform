"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildRegionalJointTestPlan,
  evaluateRegionalJointTestEvidence,
  loadRegionalIntegrationContracts
} = require("../src/platform/integration/regional-joint-test");

function configuredEnv(registry) {
  return Object.fromEntries(registry.contracts.flatMap((contract) => [
    [contract.endpointEnv, `https://${contract.system.toLowerCase()}.institution.example/joint-test`],
    [contract.credentialRefEnv, `vault://regional/${contract.system.toLowerCase()}`]
  ]));
}

test("registry covers HIS, EMR, LIS and PACS with no concrete endpoint or credential", () => {
  const registry = loadRegionalIntegrationContracts();
  assert.deepEqual(registry.contracts.map((item) => item.system).sort(), ["EMR", "HIS", "LIS", "PACS"]);
  assert.match(registry.registryDigest, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(registry), /https:\/\/|password|token|secret/i);
});

test("configuration readiness never implies a successful joint test", () => {
  const registry = loadRegionalIntegrationContracts();
  const plan = buildRegionalJointTestPlan({ registry, env: configuredEnv(registry) });
  assert.equal(plan.localConfigurationReady, true);
  assert.equal(plan.signedJointTestsReady, false);
  assert.equal(plan.productionReady, false);
  assert.equal(plan.contracts.every((item) => item.endpointExposed === false), true);
  assert.doesNotMatch(JSON.stringify(plan), /institution\.example|vault:\/\//);
});

test("joint-test evidence needs digests and independent platform/institution signatures", () => {
  const registry = loadRegionalIntegrationContracts();
  const records = registry.contracts.map((contract, index) => ({
    contractId: contract.id,
    receiptRef: `evidence://joint-test/${contract.id}`,
    receiptDigest: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
    executedAt: "2030-08-04T10:00:00.000Z",
    result: "passed",
    signatures: [
      { role: "platform-owner", account: `platform-${index}`, status: "approved", evidenceRef: `vault://approval/platform-${index}` },
      { role: "institution-owner", account: `institution-${index}`, status: "approved", evidenceRef: `vault://approval/institution-${index}` }
    ]
  }));
  const verified = evaluateRegionalJointTestEvidence(records, registry);
  assert.equal(verified.externalEvidenceVerified, true);
  assert.equal(verified.evidenceInferred, false);
  assert.equal(verified.productionReady, false);
  records[0].signatures[1].account = records[0].signatures[0].account;
  assert.equal(evaluateRegionalJointTestEvidence(records, registry).externalEvidenceVerified, false);
});
