"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  CONTRACT,
  evidenceSubject,
  normalizeJointTestEvidence
} = require("../public-health-direct-report-control-package");
const {
  DirectReportJointTestRunnerError,
  buildSyntheticPayload,
  runDirectReportSyntheticJointTest,
  runSyntheticScenario
} = require("../src/platform/integration/public-health-direct-report-joint-test-runner");
const {
  NOW_MS,
  buildControlFixture,
  buildDictionary
} = require("./support/public-health-direct-report-control-fixture");

const EXECUTED_AT = new Date(NOW_MS).toISOString();

test("offline runner deterministically covers the current eight-scenario contract", () => {
  const options = {
    dictionary: buildDictionary(),
    executedAt: EXECUTED_AT,
    packageId: "synthetic-offline-package-20260805"
  };
  const first = runDirectReportSyntheticJointTest(options);
  const second = runDirectReportSyntheticJointTest(options);
  assert.deepEqual(first, second);
  assert.equal(first.scenarioCount, 8);
  assert.equal(first.scenariosPassed, 8);
  assert.deepEqual(
    first.evidenceSubject.scenarios.map((item) => item.id),
    CONTRACT.requiredScenarios
  );
  assert.equal(first.dictionaryDigest, first.evidenceSubject.dictionaryDigest);
  assert.equal(first.mappingFingerprint, first.evidenceSubject.mappingFingerprint);
  assert.equal(first.evidenceSubjectDigest, evidenceSubject(first.evidenceSubject));
});

test("offline runner selects synthetic values from the active dictionary without exposing them", () => {
  const dictionary = buildDictionary();
  dictionary.codeSystems.find((item) => item.id === "disease").codes = ["SYN-DISEASE-X"];
  dictionary.codeSystems.find((item) => item.id === "laboratory-test").codes = ["SYN-TEST-X"];
  const report = runDirectReportSyntheticJointTest({
    dictionary,
    executedAt: EXECUTED_AT
  });
  assert.equal(report.scenariosPassed, 8);
  assert.doesNotMatch(JSON.stringify(report), /SYN-DISEASE-X|SYN-TEST-X/);
});

test("scenario records contain digests, controlled references and metadata summaries only", () => {
  const report = runDirectReportSyntheticJointTest({
    dictionary: buildDictionary(),
    executedAt: EXECUTED_AT
  });
  for (const scenario of report.evidenceSubject.scenarios) {
    assert.match(scenario.requestDigest, /^[a-f0-9]{64}$/);
    assert.match(scenario.responseDigest, /^[a-f0-9]{64}$/);
    assert.match(scenario.traceRef, /^evidence:\/\//);
    assert.match(scenario.receiptRef, /^evidence:\/\//);
    assert.equal(typeof scenario.requestSummary, "object");
    assert.equal(typeof scenario.responseSummary, "object");
  }
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /residentId|idCard|phone|address|privateKey|credentialRef|https?:\/\//i);
  assert.equal(report.externalCalls, 0);
  assert.equal(report.credentialsUsed, false);
  assert.equal(report.syntheticDataOnly, true);
});

test("each required scenario exercises its expected synthetic state transition", () => {
  const fixture = buildControlFixture();
  const payload = buildSyntheticPayload();
  const results = Object.fromEntries(CONTRACT.requiredScenarios.map((id) => [
    id,
    runSyntheticScenario(id, payload, fixture.activationControl)
  ]));
  assert.equal(results["schema-acceptance"].response.accepted, true);
  assert.equal(results["invalid-code-rejection"].response.rejected, true);
  assert.equal(results["payload-minimization"].response.requiredOnly, true);
  assert.equal(results["idempotent-replay"].response.sideEffectCount, 1);
  assert.equal(results["timeout-retry"].response.attempts, 2);
  assert.equal(results["rejection-dead-letter"].response.rejected, true);
  assert.equal(results["signed-callback"].response.officialSignatureGenerated, false);
  assert.equal(results.reconciliation.response.differenceCount, 0);
});

test("runner creates a pending evidence subject but never manufactures activation or signatures", () => {
  const report = runDirectReportSyntheticJointTest({
    dictionary: buildDictionary(),
    executedAt: EXECUTED_AT
  });
  assert.equal(report.pendingSignatures.length, 2);
  assert.deepEqual(
    report.pendingSignatures.map((item) => item.role),
    CONTRACT.requiredSignerRoles
  );
  assert.equal(report.officialSignaturesGenerated, false);
  assert.equal(report.activationReady, false);
  assert.equal(report.productionReady, false);
  assert.equal(Object.hasOwn(report.evidenceSubject, "attestations"), false);

  const signedFixture = buildControlFixture();
  assert.throws(
    () => normalizeJointTestEvidence(
      report.evidenceSubject,
      {
        dictionaryDigest: report.dictionaryDigest,
        mappingFingerprint: report.mappingFingerprint
      },
      signedFixture.trustRegistry,
      { nowMs: NOW_MS }
    ),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_SIGNOFF_INCOMPLETE"
  );
});

test("runner rejects missing dictionaries, unknown scenarios and unsafe integration options", () => {
  assert.throws(
    () => runDirectReportSyntheticJointTest({ executedAt: EXECUTED_AT }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_DICTIONARY_REQUIRED"
  );
  assert.throws(
    () => runDirectReportSyntheticJointTest({
      dictionary: buildDictionary(),
      executedAt: EXECUTED_AT,
      endpoint: "https://must-not-be-called.invalid"
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_OPTION_REJECTED"
  );
  assert.throws(
    () => runSyntheticScenario("unknown-scenario", buildSyntheticPayload(), {}),
    (error) => error instanceof DirectReportJointTestRunnerError
      && error.code === "PUBLIC_HEALTH_DIRECT_REPORT_SYNTHETIC_SCENARIO_UNKNOWN"
  );
});

test("CLI reads one absolute dictionary file and emits the unsigned synthetic report", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "direct-report-joint-test-"));
  const dictionaryFile = path.join(directory, "dictionary.json");
  fs.writeFileSync(dictionaryFile, JSON.stringify(buildDictionary()));
  const script = path.resolve(
    __dirname,
    "..",
    "scripts",
    "public-health-direct-report-joint-test-runner.js"
  );
  const result = spawnSync(
    process.execPath,
    [
      script,
      `--dictionary=${dictionaryFile}`,
      `--executed-at=${EXECUTED_AT}`,
      "--package-id=synthetic-cli-package-20260805"
    ],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.scenariosPassed, 8);
  assert.equal(report.externalCalls, 0);
  assert.equal(report.officialSignaturesGenerated, false);
  assert.equal(report.productionReady, false);
});

test("CLI fails closed for relative files and unsupported arguments", () => {
  const script = path.resolve(
    __dirname,
    "..",
    "scripts",
    "public-health-direct-report-joint-test-runner.js"
  );
  let result = spawnSync(process.execPath, [script, "--dictionary=relative.json"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SYNTHETIC_DICTIONARY_NOT_ABSOLUTE/);

  result = spawnSync(process.execPath, [script, "--endpoint=https://invalid.example"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SYNTHETIC_ARGUMENT_INVALID/);
});
