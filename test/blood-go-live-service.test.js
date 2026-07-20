const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("../blood-go-live-service");

const businessOwner = { id: "business-owner", role: "commission", name: "业务负责人" };
const technicalOwner = { id: "technical-owner", role: "commission", name: "技术负责人" };

test("initial state is software ready but formally blocked", () => {
  const data = {};
  const center = service.center(data);
  assert.equal(center.functionalState, "software-release-ready");
  assert.equal(center.formalGoLiveState, "blocked-until-site-evidence-signed");
  assert.equal(center.productionReady, false);
  assert.equal(center.summary.endpoints, 6);
  assert.equal(center.summary.requirements, 8);
  assert.equal(center.summary.drills, 5);
  assert.equal(center.summary.migrations, 4);
});

test("site evidence requires independent verification and endpoint probe without partial mutation", () => {
  const data = {};
  service.ensure(data);
  const row = service.signRequirement(data, businessOwner, "BLOOD-SITE-01", {
    action: "submit",
    confirmation: "SUBMIT BLOOD SITE EVIDENCE",
    evidenceRef: "joint-test/1",
    evidenceDigest: `sha256:${"a".repeat(64)}`
  });
  assert.equal(row.status, "evidence-submitted");
  assert.throws(() => service.signRequirement(data, businessOwner, "BLOOD-SITE-01", {
    action: "verify",
    confirmation: "VERIFY BLOOD SITE EVIDENCE",
    evidenceDigest: row.evidenceDigest
  }), /independent/);
  assert.throws(() => service.signRequirement(data, technicalOwner, "BLOOD-SITE-01", {
    action: "verify",
    confirmation: "VERIFY BLOOD SITE EVIDENCE",
    evidenceDigest: row.evidenceDigest
  }), /probe/);
  assert.equal(row.status, "evidence-submitted");
  assert.equal(row.verifiedBy, "");
});

test("complete production evidence can open formal gate only after dual approval", () => {
  const data = {};
  service.ensure(data);
  data.bloodGoLiveEndpoints.forEach((item) => service.probe(data, businessOwner, item.id, {
    baseUrl: `https://prod/${item.id}`,
    credentialRef: `vault/${item.id}`
  }));
  data.bloodGoLiveRequirements.forEach((item, index) => {
    const evidenceDigest = `sha256:${String(index).padStart(64, "a")}`;
    service.signRequirement(data, businessOwner, item.id, {
      action: "submit",
      confirmation: "SUBMIT BLOOD SITE EVIDENCE",
      evidenceRef: `evidence/${item.id}`,
      evidenceDigest
    });
    service.signRequirement(data, technicalOwner, item.id, {
      action: "verify",
      confirmation: "VERIFY BLOOD SITE EVIDENCE",
      evidenceDigest
    });
  });
  data.bloodGoLiveDrills.forEach((item) => service.completeDrill(data, businessOwner, item.id, { result: "passed", evidenceRef: `drill/${item.id}` }));
  data.bloodMigrationBatches.forEach((item) => service.reconcileMigration(data, businessOwner, item.id, { sourceCount: 100, targetCount: 100, evidenceRef: `migration/${item.id}` }));
  assert.equal(service.center(data).productionReady, false);
  service.signApproval(data, businessOwner, "blood-approval-business", { confirmation: "CONFIRM BLOOD PRODUCTION CUTOVER", evidenceRef: "approval/business" });
  assert.throws(() => service.signApproval(data, businessOwner, "blood-approval-technical", { confirmation: "CONFIRM BLOOD PRODUCTION CUTOVER", evidenceRef: "approval/technical" }), /different signers/);
  service.signApproval(data, technicalOwner, "blood-approval-technical", { confirmation: "CONFIRM BLOOD PRODUCTION CUTOVER", evidenceRef: "approval/technical" });
  assert.equal(service.center(data).formalGoLiveState, "ready-for-production");
  assert.equal(service.center(data).productionReady, true);
});

test("migration count mismatch is blocked", () => {
  assert.throws(() => service.reconcileMigration({}, businessOwner, "blood-migration-1", { sourceCount: 10, targetCount: 9, evidenceRef: "x" }), /matching/);
});
