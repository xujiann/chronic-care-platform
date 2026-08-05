"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  createDictionaryLifecycleLedger,
  projectDictionaryLifecycle
} = require("../public-health-direct-report-dictionary-lifecycle");
const {
  buildDirectReportObservabilityReport
} = require("../public-health-direct-report-observability");
const {
  buildDirectReportProductionCandidateReadiness
} = require("../public-health-direct-report-readiness");
const {
  runDirectReportSyntheticJointTest
} = require("../src/platform/integration/public-health-direct-report-joint-test-runner");
const {
  NOW_MS,
  buildControlFixture
} = require("./support/public-health-direct-report-control-fixture");

const NOW = new Date(NOW_MS).toISOString();

function readinessInput() {
  const fixture = buildControlFixture();
  const ledger = createDictionaryLifecycleLedger(fixture.dictionary, {
    ledgerId: "direct-report-readiness-ledger",
    actor: {
      id: "platform-operations-readiness",
      role: "platform-operations"
    },
    now: NOW
  });
  const dictionaryLifecycle = projectDictionaryLifecycle(ledger, { now: NOW });
  const syntheticJointTest = runDirectReportSyntheticJointTest({
    dictionary: fixture.dictionary,
    executedAt: NOW,
    packageId: "direct-report-readiness-synthetic"
  });
  const observability = buildDirectReportObservabilityReport({
    generatedAt: NOW,
    deliveries: [],
    signatureFailureCount: 0,
    controlStatus: fixture.activationControl,
    expectedControl: {
      dictionaryDigest: fixture.activationControl.dictionaryDigest,
      mappingFingerprint: fixture.activationControl.mappingFingerprint
    }
  }, { now: NOW });
  return {
    evaluatedAt: NOW,
    dictionaryLifecycle,
    activationControl: {
      contractId: "public-health-direct-report-v1",
      ...fixture.activationControl
    },
    syntheticJointTest,
    reconciliation: {
      total: 0,
      open: 0,
      closed: 0,
      criticalOpen: 0,
      productionReady: false
    },
    observability
  };
}

test("all technical projections form one candidate without approving production", () => {
  const report = buildDirectReportProductionCandidateReadiness(readinessInput(), {
    now: NOW
  });
  assert.equal(report.technicalCandidateReady, true);
  assert.equal(report.summary.checks, 8);
  assert.equal(report.summary.passed, 8);
  assert.deepEqual(report.technicalBlockers, []);
  assert.deepEqual(report.productionBlockers, [
    "GLOBAL_SITE_PRODUCTION_GO_NO_GO_REQUIRED"
  ]);
  assert.equal(report.productionReady, false);
  assert.deepEqual(report.safety, {
    rawPayloadsIncluded: false,
    residentIdentityIncluded: false,
    credentialsIncluded: false,
    signaturesIncluded: false
  });
});

test("dictionary drift and expired official evidence fail closed", () => {
  const input = readinessInput();
  input.activationControl.dictionaryDigest = "f".repeat(64);
  input.activationControl.evidenceExpiresAt = "2026-08-05T08:29:59.000Z";
  const report = buildDirectReportProductionCandidateReadiness(input, { now: NOW });
  assert.equal(report.technicalCandidateReady, false);
  assert.deepEqual(report.technicalBlockers, [
    "DIRECT_REPORT_DICTIONARY_BINDING_DRIFT",
    "DIRECT_REPORT_OFFICIAL_EVIDENCE_EXPIRED_OR_MISSING"
  ]);
  assert.equal(report.productionReady, false);
});

test("open reconciliation cases and active alerts block the candidate", () => {
  const input = readinessInput();
  input.reconciliation = {
    total: 3,
    open: 2,
    closed: 1,
    criticalOpen: 1,
    productionReady: false
  };
  input.observability = {
    ...input.observability,
    status: "critical",
    monitoringReady: false,
    alerts: [{ code: "PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_TIMEOUT" }]
  };
  const report = buildDirectReportProductionCandidateReadiness(input, { now: NOW });
  assert.equal(report.technicalCandidateReady, false);
  assert.deepEqual(report.technicalBlockers, [
    "DIRECT_REPORT_RECONCILIATION_OPEN",
    "DIRECT_REPORT_OBSERVABILITY_NOT_HEALTHY"
  ]);
});

test("unknown or unsafe projection shapes are rejected", () => {
  const input = readinessInput();
  input.syntheticJointTest = {
    ...input.syntheticJointTest,
    schemaVersion: "unknown"
  };
  assert.throws(
    () => buildDirectReportProductionCandidateReadiness(input, { now: NOW }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_PROJECTION_INVALID"
  );
  assert.throws(
    () => buildDirectReportProductionCandidateReadiness(
      { ...readinessInput(), reconciliation: { total: -1, open: 0, criticalOpen: 0 } },
      { now: NOW }
    ),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_READINESS_PROJECTION_INVALID"
  );
});

test("CLI consumes one bounded absolute projection bundle and supports a technical gate", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "direct-report-readiness-"));
  const inputFile = path.join(directory, "input.json");
  fs.writeFileSync(inputFile, JSON.stringify(readinessInput()));
  const script = path.resolve(__dirname, "..", "scripts", "public-health-direct-report-readiness.js");
  let result = spawnSync(process.execPath, [
    script,
    `--input=${inputFile}`,
    `--evaluated-at=${NOW}`,
    "--require-technical-ready=true"
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.technicalCandidateReady, true);
  assert.equal(report.productionReady, false);

  const blocked = readinessInput();
  blocked.reconciliation.open = 1;
  fs.writeFileSync(inputFile, JSON.stringify(blocked));
  result = spawnSync(process.execPath, [
    script,
    `--input=${inputFile}`,
    `--evaluated-at=${NOW}`,
    "--require-technical-ready=true"
  ], { encoding: "utf8" });
  assert.equal(result.status, 2, result.stderr);
  assert.equal(JSON.parse(result.stdout).technicalCandidateReady, false);
});

test("CLI rejects relative paths and unsupported controls", () => {
  const script = path.resolve(__dirname, "..", "scripts", "public-health-direct-report-readiness.js");
  let result = spawnSync(process.execPath, [script, "--input=relative.json"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /READINESS_INPUT_NOT_ABSOLUTE/);

  result = spawnSync(process.execPath, [
    script,
    "--input=C:\\safe.json",
    "--endpoint=https://must-not-be-used.invalid"
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /READINESS_ARGUMENT_INVALID/);
});
