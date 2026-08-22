"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  RECEIPT_SCHEMA,
  buildProductionPromotionReceipt,
  writeReceipt
} = require("../scripts/production-promotion-receipt");

const SOURCE_SHA = "a".repeat(40);

function reportFixture(overrides = {}) {
  return {
    schemaVersion: "production-preflight-v2",
    decision: "GO",
    productionReady: true,
    releaseId: "release-20260823-001",
    sourceSha: SOURCE_SHA,
    artifactDigest: `sha256:${"b".repeat(64)}`,
    productionEvidence: { evidenceFingerprint: "c".repeat(64) },
    productionEvidenceTrustProvider: {
      verified: true,
      envelopeDigest: `sha256:${"d".repeat(64)}`
    },
    cutoverActionEvidence: {
      productionReady: true,
      releaseId: "release-20260823-001",
      artifactDigest: `sha256:${"b".repeat(64)}`,
      reportDigest: `sha256:${"e".repeat(64)}`
    },
    ...overrides
  };
}

function contextFixture(overrides = {}) {
  return {
    sourceSha: SOURCE_SHA,
    workflowRunId: "32588119048",
    workflowRunAttempt: "1",
    now: "2026-08-23T08:00:00.000Z",
    ...overrides
  };
}

test("promotion receipt binds the GO preflight, signed evidence and all cutover actions by digest", () => {
  const receipt = buildProductionPromotionReceipt(reportFixture(), contextFixture());
  assert.equal(receipt.schema, RECEIPT_SCHEMA);
  assert.equal(receipt.status, "verified-preflight");
  assert.equal(receipt.productionPromotionEligible, true);
  assert.equal(receipt.deploymentExecuted, false);
  assert.equal(receipt.externalAuthorizationRequired, true);
  assert.match(receipt.preflightReportDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(receipt.cutoverActionReportDigest, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(receipt), /signatures|publicKeyPem|password|token|private[_-]?key/i);
});

test("promotion receipt rejects NO-GO, source drift and incomplete trust chains", () => {
  const cases = [
    [reportFixture({ decision: "NO-GO", productionReady: false }), contextFixture()],
    [reportFixture(), contextFixture({ sourceSha: "f".repeat(40) })],
    [reportFixture({ productionEvidenceTrustProvider: { verified: false, envelopeDigest: `sha256:${"d".repeat(64)}` } }), contextFixture()],
    [reportFixture({ cutoverActionEvidence: { ...reportFixture().cutoverActionEvidence, productionReady: false } }), contextFixture()],
    [reportFixture({ cutoverActionEvidence: { ...reportFixture().cutoverActionEvidence, releaseId: "other-release" } }), contextFixture()]
  ];
  for (const [report, context] of cases) {
    assert.throws(() => buildProductionPromotionReceipt(report, context), /failed closed/);
  }
});

test("promotion receipt output is create-once and CLI errors are path-redacted", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "production-promotion-receipt-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, "receipt.json");
  const receipt = buildProductionPromotionReceipt(reportFixture(), contextFixture());
  writeReceipt(receipt, output);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), receipt);
  assert.throws(() => writeReceipt(receipt, output), /EEXIST/);

  const missing = path.join(directory, "sensitive-preflight-location.json");
  const run = spawnSync(process.execPath, [
    path.join(__dirname, "..", "scripts", "production-promotion-receipt.js"),
    `--report=${missing}`,
    `--output=${path.join(directory, "unused.json")}`
  ], { encoding: "utf8", env: { ...process.env, GITHUB_SHA: SOURCE_SHA, GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" } });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /PRODUCTION_PROMOTION_RECEIPT_FAILED_CLOSED/);
  assert.doesNotMatch(run.stderr, /sensitive-preflight-location|production-promotion-receipt-/);
});

test("production promotion workflow is manual, protected, pinned and uploads only the digest receipt", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "production-promotion.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /runs-on: \[self-hosted, production-promotion\]/);
  assert.match(workflow, /actions\/checkout@[a-f0-9]{40} # v7/);
  assert.match(workflow, /actions\/setup-node@[a-f0-9]{40} # v7/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40} # v7/);
  assert.match(workflow, /PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256: \$\{\{ secrets\./);
  assert.match(workflow, /production:preflight:strict/);
  assert.match(workflow, /production-promotion-receipt\.js/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/production-promotion-receipt\.json/);
  assert.doesNotMatch(workflow, /upload-artifact[\s\S]*production-preflight-report/);
});
