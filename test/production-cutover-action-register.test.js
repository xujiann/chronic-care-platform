"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EVIDENCE_SCHEMA,
  buildActionRegisterReport,
  buildEffectiveActionReport,
  containsSensitiveMaterial,
  loadRegister
} = require("../scripts/production-cutover-action-register");

const NOW = "2026-08-23T08:00:00.000Z";

function manifestFixture() {
  return { releaseId: "release-20260823", artifact: { digest: `sha256:${"a".repeat(64)}` } };
}

function decisionFixture(action, manifest, overrides = {}) {
  return {
    schemaVersion: EVIDENCE_SCHEMA,
    verified: true,
    actionId: action.id,
    releaseId: manifest.releaseId,
    artifactDigest: manifest.artifact.digest,
    previousState: "evidence-submitted",
    effectiveState: "verified",
    previousTransitionDigest: `sha256:${"b".repeat(64)}`,
    evidenceRef: `controlled://cutover/${action.id}`,
    evidenceDigest: `sha256:${"c".repeat(64)}`,
    evidenceFingerprint: `sha256:${"d".repeat(64)}`,
    commandReceiptDigest: `sha256:${"e".repeat(64)}`,
    verifiedAt: "2026-08-23T07:00:00.000Z",
    validUntil: "2026-09-23T07:00:00.000Z",
    evidenceProducerRole: "site-evidence-custodian",
    verifierRole: "independent-release-verifier",
    signerIds: [`signer:${action.id}:1`, `signer:${action.id}:2`],
    ...overrides
  };
}

test("committed production cutover register contains definitions only and is always NO-GO", () => {
  const register = loadRegister();
  const report = buildActionRegisterReport(register, { now: NOW });

  assert.equal(report.ok, true);
  assert.equal(report.status, "definitions-only-no-go");
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.actions, 14);
  assert.equal(report.summary.verified, 0);
  assert.equal(report.summary.issues, 5);
  assert.deepEqual(containsSensitiveMaterial(register), []);
});

test("editing committed definitions to claim verified never creates production readiness", () => {
  const register = structuredClone(loadRegister());
  [...register.cutoverActions, ...register.evidenceActions].forEach((item) => { item.status = "verified"; });
  const report = buildActionRegisterReport(register, { now: NOW });

  assert.equal(report.ok, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.checks.find((item) => item.id === "actionRegister:definitionOnly").passed, false);
  assert.equal(report.checks.find((item) => item.id === "actionRegister:cutoverShape").passed, false);
});

test("missing actions, stale definitions or embedded credentials fail structural validation", () => {
  const register = structuredClone(loadRegister());
  register.cutoverActions.pop();
  register.reviewAfter = "2026-08-22";
  register.credential = "must-not-exist";
  const report = buildActionRegisterReport(register, { now: NOW });

  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "actionRegister:cutoverCoverage").passed, false);
  assert.equal(report.checks.find((item) => item.id === "actionRegister:reviewWindow").passed, false);
  assert.equal(report.checks.find((item) => item.id === "actionRegister:secretBoundary").passed, false);
});

test("effective status stays blocked without an external verifier even when records are present", async () => {
  const register = loadRegister();
  const manifest = manifestFixture();
  const records = Object.fromEntries(
    [...register.cutoverActions, ...register.evidenceActions].map((action) => [action.id, { signedEnvelope: "opaque" }])
  );
  const report = await buildEffectiveActionReport(register, { manifest, evidenceRecords: records, now: NOW });

  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.summary.verified, 0);
  assert.equal(report.summary.blocked, 14);
  assert.equal(report.actions.every((item) => item.errorCode === "ACTION_EVIDENCE_VERIFIER_UNAVAILABLE"), true);
});

test("externally verified current release-bound decisions derive all effective statuses", async () => {
  const register = loadRegister();
  const manifest = manifestFixture();
  const records = Object.fromEntries(
    [...register.cutoverActions, ...register.evidenceActions].map((action) => [action.id, { actionId: action.id }])
  );
  const report = await buildEffectiveActionReport(register, {
    manifest,
    evidenceRecords: records,
    now: NOW,
    externalEvidenceVerifier: async ({ action }) => decisionFixture(action, manifest)
  });

  assert.equal(report.ok, true);
  assert.equal(report.productionReady, true);
  assert.equal(report.status, "verified-for-bound-release");
  assert.equal(report.summary.verified, 14);
  assert.match(report.reportDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes("signedEnvelope"), false);
});

test("release drift expiry future timestamps role overlap and duplicate signers fail closed", async (t) => {
  const cases = [
    ["release drift", { releaseId: "other-release" }],
    ["artifact drift", { artifactDigest: `sha256:${"f".repeat(64)}` }],
    ["expired", { validUntil: "2026-08-23T07:59:59.999Z" }],
    ["future", { verifiedAt: "2026-08-24T00:00:00.000Z" }],
    ["owner verifies own action", null],
    ["producer also verifies", { verifierRole: "site-evidence-custodian" }],
    ["duplicate signer", { signerIds: ["signer:duplicate", "signer:duplicate"] }],
    ["missing command receipt", { commandReceiptDigest: "" }],
    ["missing history", { previousTransitionDigest: "" }]
  ];
  for (const [name, override] of cases) {
    await t.test(name, async () => {
      const register = loadRegister();
      const manifest = manifestFixture();
      const action = register.cutoverActions[0];
      const actualOverride = override === null ? { verifierRole: action.owner } : override;
      const report = await buildEffectiveActionReport(register, {
        manifest,
        evidenceRecords: { [action.id]: { signedEnvelope: "opaque" } },
        now: NOW,
        externalEvidenceVerifier: async () => decisionFixture(action, manifest, actualOverride)
      });
      assert.equal(report.productionReady, false);
      assert.equal(report.actions[0].effectiveStatus, "blocked-external");
      assert.equal(report.actions[0].errorCode, "ACTION_EVIDENCE_DECISION_INVALID");
    });
  }
});

test("verifier failures are redacted to a stable code", async () => {
  const register = loadRegister();
  const manifest = manifestFixture();
  const action = register.cutoverActions[0];
  const report = await buildEffectiveActionReport(register, {
    manifest,
    evidenceRecords: { [action.id]: { signedEnvelope: "opaque" } },
    now: NOW,
    externalEvidenceVerifier: async () => { throw new Error("C:/secrets/private-key.pem provider raw response"); }
  });

  assert.equal(report.actions[0].errorCode, "ACTION_EVIDENCE_VERIFICATION_FAILED");
  assert.equal(JSON.stringify(report).includes("private-key.pem"), false);
});
