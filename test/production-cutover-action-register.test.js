"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generateKeyPairSync, sign } = require("node:crypto");
const { stableStringify } = require("../src/platform/governance/technical-evidence");
const {
  SIGNED_ENVELOPE_SCHEMA,
  TRUST_ANCHORS_SCHEMA,
  sha256Bytes,
  signedEnvelopeSignaturePayload
} = require("../src/platform/governance/production-evidence-trust-provider");
const {
  ACTION_EVIDENCE_PURPOSE,
  ACTION_REQUIRED_ROLES,
  EVIDENCE_SCHEMA,
  buildActionRegisterReport,
  buildEffectiveActionReport,
  containsSensitiveMaterial,
  loadRegister,
  resolveCutoverActionEvidenceProvider
} = require("../scripts/production-cutover-action-register");

const NOW = "2026-08-23T08:00:00.000Z";

function manifestFixture() {
  return { releaseId: "release-20260823", artifact: { digest: `sha256:${"a".repeat(64)}` } };
}

function decisionFixture(action, manifest, overrides = {}) {
  return {
    schemaVersion: EVIDENCE_SCHEMA,
    verified: true,
    decisionId: `decision-${action.id}`,
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
    envelopeDigest: `sha256:${"f".repeat(64)}`,
    verifiedAt: "2026-08-23T07:00:00.000Z",
    validUntil: "2026-09-23T07:00:00.000Z",
    evidenceProducerRole: "site-evidence-custodian",
    verifierRole: "independent-release-verifier",
    signerIds: [`signer:${action.id}:1`, `signer:${action.id}:2`],
    ...overrides
  };
}

function createSignedActionFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-action-evidence-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifest = manifestFixture();
  const register = loadRegister();
  const actions = [...register.cutoverActions, ...register.evidenceActions];
  const keys = ACTION_REQUIRED_ROLES.map((role, index) => ({
    role,
    keyId: `action-key-${index + 1}`,
    signerId: `action-signer-${index + 1}`,
    pair: generateKeyPairSync("ed25519")
  }));
  const anchorsFile = path.join(directory, "anchors.json");
  const evidenceDirectory = path.join(directory, "actions");
  fs.mkdirSync(evidenceDirectory);

  function anchorsDocument(overrides = {}) {
    return {
      schema: TRUST_ANCHORS_SCHEMA,
      generatedAt: "2026-08-23T06:00:00.000Z",
      keys: keys.map((key, index) => ({
        keyId: key.keyId,
        signerId: overrides.duplicateSigner && index === 1 ? keys[0].signerId : key.signerId,
        roles: [key.role],
        algorithm: "Ed25519",
        status: overrides.revokedIndex === index ? "revoked" : "active",
        validFrom: "2026-08-22T00:00:00.000Z",
        validUntil: "2026-09-23T00:00:00.000Z",
        publicKeyPem: key.pair.publicKey.export({ type: "spki", format: "pem" }),
        publicKeyDigest: sha256Bytes(key.pair.publicKey.export({ type: "spki", format: "der" }))
      }))
    };
  }

  function writeAnchors(overrides = {}) {
    const bytes = Buffer.from(`${JSON.stringify(anchorsDocument(overrides), null, 2)}\n`);
    fs.writeFileSync(anchorsFile, bytes);
    return sha256Bytes(bytes);
  }

  function actionRecord(action, overrides = {}) {
    return {
      schema: EVIDENCE_SCHEMA,
      decisionId: `decision-${action.id}`,
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
      evidenceProducerRole: "site-evidence-custodian",
      issuedAt: "2026-08-23T07:00:00.000Z",
      validUntil: "2026-08-23T09:00:00.000Z",
      ...overrides
    };
  }

  function writeEnvelope(action, recordOverrides = {}, signatureOverrides = {}) {
    const envelope = {
      schema: SIGNED_ENVELOPE_SCHEMA,
      purpose: ACTION_EVIDENCE_PURPOSE,
      record: actionRecord(action, recordOverrides),
      signatures: []
    };
    envelope.signatures = keys.map((key, index) => {
      const descriptor = {
        keyId: key.keyId,
        signerId: signatureOverrides.duplicateSigner && index === 1 ? keys[0].signerId : key.signerId,
        role: key.role
      };
      const signature = sign(
        null,
        Buffer.from(stableStringify(signedEnvelopeSignaturePayload(envelope, descriptor))),
        key.pair.privateKey
      ).toString("base64url");
      const corrupted = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
      return { ...descriptor, signature: signatureOverrides.corrupt && index === 0 ? corrupted : signature };
    });
    const file = path.join(evidenceDirectory, `${action.id}.json`);
    fs.writeFileSync(file, `${JSON.stringify(envelope, null, 2)}\n`);
    return file;
  }

  const anchorsDigest = writeAnchors();
  actions.forEach((action) => writeEnvelope(action));
  const env = {
    PRODUCTION_CUTOVER_ACTION_EVIDENCE_DIR: evidenceDirectory,
    PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE: anchorsFile,
    PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256: anchorsDigest
  };
  return { actions, anchorsFile, env, evidenceDirectory, manifest, register, writeAnchors, writeEnvelope };
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
    ["missing decision id", { decisionId: "" }],
    ["missing envelope digest", { envelopeDigest: "" }],
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

test("file-backed action evidence reuses the pinned Ed25519 trust port for all 14 actions", async (t) => {
  const fixture = createSignedActionFixture(t);
  const resolved = resolveCutoverActionEvidenceProvider(fixture.env, fixture.actions, { now: NOW });
  assert.equal(resolved.configured, true);
  assert.equal(resolved.source, "controlled-files");
  assert.deepEqual(resolved.errors, {});

  const report = await buildEffectiveActionReport(fixture.register, {
    manifest: fixture.manifest,
    evidenceRecords: resolved.records,
    evidenceErrors: resolved.errors,
    externalEvidenceVerifier: resolved.verifier,
    now: NOW
  });
  assert.equal(report.productionReady, true);
  assert.equal(report.summary.verified, 14);
  assert.equal(report.actions.every((action) => action.effectiveStatus === "verified"), true);
  assert.doesNotMatch(JSON.stringify(report), /signatures|publicKeyPem|PRIVATE KEY/);
});

test("action evidence fails closed for signature, anchor, context and time drift", async (t) => {
  const scenarios = [
    ["corrupt signature", {}, { signature: { corrupt: true } }],
    ["revoked key", { revokedIndex: 0 }, {}],
    ["duplicate signer", { duplicateSigner: true }, { signature: { duplicateSigner: true } }],
    ["release drift", {}, { record: { releaseId: "other-release" } }],
    ["artifact drift", {}, { record: { artifactDigest: `sha256:${"f".repeat(64)}` } }],
    ["expired", {}, { record: { validUntil: "2026-08-23T07:59:59.000Z" } }],
    ["future", {}, { record: { issuedAt: "2026-08-23T08:06:00.000Z", validUntil: "2026-08-23T09:00:00.000Z" } }]
  ];
  for (const [name, anchorOverrides, envelopeOverrides] of scenarios) {
    await t.test(name, async () => {
      const fixture = createSignedActionFixture(t);
      const digest = fixture.writeAnchors(anchorOverrides);
      const env = { ...fixture.env, PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256: digest };
      fixture.writeEnvelope(fixture.actions[0], envelopeOverrides.record, envelopeOverrides.signature);
      const resolved = resolveCutoverActionEvidenceProvider(env, fixture.actions, { now: NOW });
      const report = await buildEffectiveActionReport(fixture.register, {
        manifest: fixture.manifest,
        evidenceRecords: resolved.records,
        evidenceErrors: resolved.errors,
        externalEvidenceVerifier: resolved.verifier,
        now: NOW
      });
      assert.equal(report.productionReady, false);
      assert.equal(report.actions[0].effectiveStatus, "blocked-external");
      assert.equal(report.actions[0].errorCode, "ACTION_EVIDENCE_VERIFICATION_FAILED");
    });
  }
});

test("action evidence rejects symlinks and oversized files without exposing filesystem paths", async (t) => {
  const fixture = createSignedActionFixture(t);
  const action = fixture.actions[0];
  const file = path.join(fixture.evidenceDirectory, `${action.id}.json`);
  fs.writeFileSync(file, Buffer.alloc(1024 * 1024 + 1, 0x20));
  let resolved = resolveCutoverActionEvidenceProvider(fixture.env, fixture.actions, { now: NOW });
  assert.equal(resolved.errors[action.id], "ACTION_EVIDENCE_FILE_INVALID");

  fixture.writeEnvelope(action);
  const link = path.join(fixture.evidenceDirectory, "linked-envelope.json");
  try {
    fs.symlinkSync(file, link, "file");
    fs.rmSync(file);
    fs.renameSync(link, file);
    resolved = resolveCutoverActionEvidenceProvider(fixture.env, fixture.actions, { now: NOW });
    assert.equal(resolved.errors[action.id], "ACTION_EVIDENCE_FILE_INVALID");
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
  }
  assert.doesNotMatch(JSON.stringify(resolved.errors), /cutover-action-evidence-|[A-Z]:\\/i);
});

test("action evidence directory rejects ungoverned extra files and reports missing governed files", (t) => {
  const fixture = createSignedActionFixture(t);
  fs.writeFileSync(path.join(fixture.evidenceDirectory, "untracked.json"), "{}\n");
  let resolved = resolveCutoverActionEvidenceProvider(fixture.env, fixture.actions, { now: NOW });
  assert.equal(Object.values(resolved.errors).every((code) => code === "ACTION_EVIDENCE_DIRECTORY_CONTENT_INVALID"), true);
  fs.rmSync(path.join(fixture.evidenceDirectory, "untracked.json"));
  fs.rmSync(path.join(fixture.evidenceDirectory, `${fixture.actions[0].id}.json`));
  resolved = resolveCutoverActionEvidenceProvider(fixture.env, fixture.actions, { now: NOW });
  assert.equal(resolved.errors[fixture.actions[0].id], "ACTION_EVIDENCE_FILE_UNAVAILABLE");
});
