"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DirectReportControlError,
  evaluateDirectReportActivationControl,
  publicDirectReportControlStatus,
  validatePayloadAgainstDictionary
} = require("../public-health-direct-report-control-package");
const {
  buildControlFixture
} = require("./support/public-health-direct-report-control-fixture");

test("activation requires a dictionary-bound eight-scenario package with independent Ed25519 signers", () => {
  const fixture = buildControlFixture();
  const result = evaluateDirectReportActivationControl(fixture, { nowMs: fixture.nowMs });
  assert.equal(result.activationReady, true);
  assert.equal(result.scenariosPassed, 8);
  assert.deepEqual(result.signerRoles, [
    "disease-control-office",
    "hospital-information-center"
  ]);
  assert.equal(result.credentialsExposed, false);
  assert.equal(result.payloadsExposed, false);
});

test("dictionary rejects unmapped fields and unapproved codes", () => {
  const { activationControl } = buildControlFixture();
  const payload = {
    externalId: "synthetic-event-1",
    subjectReference: `hmac-sha256:v1:${"a".repeat(64)}`,
    institutionCode: "210200001",
    reportType: "infectious-disease-case",
    diseaseCode: "A15",
    testCode: "TB-PCR",
    resultFlag: "positive",
    occurredAt: "2026-08-05T07:30:00.000Z",
    reportedAt: "2026-08-05T08:00:00.000Z",
    sourceSystem: "LIS",
    reportCardNo: "SYNTHETIC-CARD-1",
    specimenReference: `hmac-sha256:v1:${"b".repeat(64)}`
  };
  assert.equal(validatePayloadAgainstDictionary(payload, activationControl).ok, true);
  assert.throws(
    () => validatePayloadAgainstDictionary({ ...payload, diseaseCode: "UNKNOWN" }, activationControl),
    (error) => error instanceof DirectReportControlError
      && error.code === "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_CODE_REJECTED"
  );
  assert.throws(
    () => validatePayloadAgainstDictionary({ ...payload, residentId: "forbidden" }, activationControl),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_FIELD_UNMAPPED"
  );
});

test("evidence drift and incomplete scenario coverage block activation", () => {
  const fixture = buildControlFixture();
  assert.throws(
    () => evaluateDirectReportActivationControl({
      ...fixture,
      evidence: { ...fixture.evidence, mappingFingerprint: "0".repeat(64) }
    }, { nowMs: fixture.nowMs }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_EVIDENCE_INVALID"
  );
  assert.throws(
    () => evaluateDirectReportActivationControl({
      ...fixture,
      evidence: { ...fixture.evidence, scenarios: fixture.evidence.scenarios.slice(0, 7) }
    }, { nowMs: fixture.nowMs }),
    (error) => /JOINT_TEST_(?:SCENARIOS_INCOMPLETE|ATTESTATION_INVALID)/.test(error.code)
  );
});

test("independent signer roles cannot reuse the same Ed25519 key material", () => {
  const fixture = buildControlFixture();
  const reusedTrustRegistry = structuredClone(fixture.trustRegistry);
  reusedTrustRegistry.keys[1].publicKeyPem = reusedTrustRegistry.keys[0].publicKeyPem;
  assert.throws(
    () => evaluateDirectReportActivationControl({
      ...fixture,
      trustRegistry: reusedTrustRegistry
    }, { nowMs: fixture.nowMs }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_TRUST_KEY_REUSED"
  );
});

test("site file status is fail-closed and exposes only safe metadata", () => {
  const missing = publicDirectReportControlStatus({});
  assert.equal(missing.activationReady, false);
  assert.equal(missing.blockerCode, "PUBLIC_HEALTH_DIRECT_REPORT_CONTROL_FILES_REQUIRED");

  const fixture = buildControlFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ph-direct-report-control-"));
  const files = {
    PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_FILE: path.join(directory, "dictionary.json"),
    PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_EVIDENCE_FILE: path.join(directory, "evidence.json"),
    PUBLIC_HEALTH_DIRECT_REPORT_TRUST_REGISTRY_FILE: path.join(directory, "trust.json")
  };
  fs.writeFileSync(files.PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_FILE, JSON.stringify(fixture.dictionary));
  fs.writeFileSync(files.PUBLIC_HEALTH_DIRECT_REPORT_JOINT_TEST_EVIDENCE_FILE, JSON.stringify(fixture.evidence));
  fs.writeFileSync(files.PUBLIC_HEALTH_DIRECT_REPORT_TRUST_REGISTRY_FILE, JSON.stringify(fixture.trustRegistry));
  const status = publicDirectReportControlStatus(files, { nowMs: fixture.nowMs });
  assert.equal(status.activationReady, true);
  assert.equal(status.dictionaryId, "synthetic-direct-report-dictionary");
  assert.doesNotMatch(JSON.stringify(status), /publicKeyPem|signature|codes|privateKey/i);
});
