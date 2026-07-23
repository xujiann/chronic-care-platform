const assert = require("node:assert/strict");
const test = require("node:test");

const { buildJointTestPackage } = require("../interface-joint-test-package");
const { ingestInterfaceEvent } = require("../interface-domain-integration");
const { validateDirectReportPayload } = require("../public-health-connectors");

test("joint-test package covers all seven P0 interfaces and responsible parties", () => {
  const pkg = buildJointTestPackage();
  assert.equal(pkg.productionReady, false);
  assert.equal(pkg.p0Interfaces.length, 7);
  assert.equal(pkg.fieldResponsibilityMatrix.length, 7);
  assert.equal(new Set(pkg.p0Interfaces.map((item) => item.contractId)).size, 7);
  assert.equal(pkg.p0Interfaces.every((item) => item.businessOwner && item.technicalOwner && item.externalParty), true);
  assert.equal(pkg.externalDependencies.length >= 7, true);
  assert.equal(pkg.testChecklist.length >= 10, true);
  assert.equal(pkg.acceptanceStandards.length >= 8, true);
});

test("joint-test samples validate and land without real resident data", async () => {
  const pkg = buildJointTestPackage();
  const data = { personalRecords: [], diagnosticReports: [], insuranceClaims: [], digitalCredentials: [], integrationGatewayEvents: [], interfaceReconciliationCases: [] };
  for (const key of ["his", "emr", "lis", "pacs", "insurance", "certificate"]) {
    const result = await ingestInterfaceEvent(data, pkg.sampleMessages[key], {
      signatureVerified: true,
      now: "2026-07-22T04:00:00.000Z",
      user: { username: "joint-test-runner" }
    });
    assert.ok(result.record || result.diagnosticReport, `${key} sample should land`);
  }
  const publicHealth = validateDirectReportPayload(pkg.sampleMessages.publicHealth.payload);
  assert.match(publicHealth.subjectReference, /^hmac-sha256:v1:[a-f0-9]{64}$/);
  assert.equal(data.personalRecords.length, 2);
  assert.equal(data.diagnosticReports.length, 2);
  assert.equal(data.insuranceClaims.length, 1);
  assert.equal(data.digitalCredentials.length, 1);
});
