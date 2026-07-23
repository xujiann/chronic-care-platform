const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { assessCitizenRecordsReadiness, evidenceValue } = require("../scripts/citizen-records-readiness");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("T04 software candidate passes while unresolved production dependencies stay blocked", () => {
  const report = assessCitizenRecordsReadiness({ root: ROOT, env: {} });
  assert.equal(report.summary.softwareReady, true);
  assert.equal(report.summary.productionReady, false);
  assert.ok(report.blockers.some((item) => item.id === "t00-policy-wiring"));
  assert.ok(report.blockers.some((item) => item.id === "identity-provider"));
  assert.ok(report.blockers.some((item) => item.id === "release-signoff"));
});

test("production gate opens only with public integration and non-placeholder evidence", () => {
  const files = {
    "citizen-records-v1.js": read("citizen-records-v1.js"),
    "citizen-records-v2.js": read("citizen-records-v2.js"),
    "citizen-records-policy.js": read("citizen-records-policy.js"),
    "citizen.html": read("citizen.html"),
    "citizen.js": read("citizen.js"),
    "docs/citizen-records-first-increment.md": read("docs/citizen-records-first-increment.md"),
    "test/citizen-records-v2.test.js": read("test/citizen-records-v2.test.js"),
    "test/citizen-records-policy.test.js": read("test/citizen-records-policy.test.js"),
    "test/e2e/citizen-records-v1.spec.js": read("test/e2e/citizen-records-v1.spec.js"),
    "server.js": "require('./citizen-records-policy'); evaluateCitizenRecordAccess(); record-care-workspace record-corrections record-share-packages",
    "service-worker.js": "citizen-records-v2.js?v=20260723care10 citizen.js?v=20260723care10"
  };
  const env = {
    OIDC_ISSUER_URL: "https://identity.health.gov.cn/issuer",
    OIDC_CLIENT_ID: "citizen-production",
    OIDC_CLIENT_SECRET: "secret-from-vault",
    HIS_ADAPTER_URL: "https://his.health.gov.cn/events",
    EMR_ADAPTER_URL: "https://emr.health.gov.cn/events",
    LIS_ADAPTER_URL: "https://lis.health.gov.cn/events",
    PACS_ADAPTER_URL: "https://pacs.health.gov.cn/events",
    OBJECT_STORAGE_GATEWAY_URL: "https://storage.health.gov.cn/api",
    OBJECT_STORAGE_BUCKET: "citizen-health-records",
    OBJECT_STORAGE_SIGNING_SECRET: "secret-from-kms",
    SIEM_ENDPOINT: "https://siem.health.gov.cn/ingest",
    CITIZEN_RELATIONSHIP_PROVIDER_URL: "https://identity.health.gov.cn/relationships",
    CITIZEN_AUTHORIZATION_LEGAL_APPROVAL: "LEGAL-2026-071",
    CITIZEN_RECORDS_RELEASE_SIGNOFF: "SIGNOFF-2026-0723",
    PUBLIC_BASE_URL: "https://resident.health.gov.cn"
  };
  const report = assessCitizenRecordsReadiness({ root: ROOT, files, env, profile: "production" });
  assert.deepEqual(report.summary, {
    softwareReady: true,
    integrationReady: true,
    externalReady: true,
    productionReady: true
  });
  assert.deepEqual(report.blockers, []);
});

test("placeholder evidence never satisfies a production gate", () => {
  assert.equal(evidenceValue("https://identity.example.gov.cn"), "");
  assert.equal(evidenceValue("replace-with-secret"), "");
  assert.equal(evidenceValue("https://identity.health.gov.cn"), "https://identity.health.gov.cn");
});
