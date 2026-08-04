"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { generateKeyPairSync, sign } = require("node:crypto");
const {
  APPROVAL_ROLES,
  EVIDENCE_DIGEST_IDS,
  createPilotCutoverEvidenceBindings,
  createPilotCutoverEvidenceFingerprint
} = require("../src/platform/cutover/pilot-cutover-orchestrator");
const {
  REQUIRED_EXTERNAL_GATES,
  appendAuthorizationEvent,
  buildAuthorizationLedgerProjection,
  evaluatePilotCutoverAuthorizationLedger,
  readAuthorizationLedger
} = require("../src/platform/cutover/pilot-cutover-authorization-ledger");
const {
  createPilotCutoverTrustSubject,
  createPilotCutoverTrustVerifier
} = require("../src/platform/cutover/pilot-cutover-trust-verifier");
const {
  sha256,
  stableStringify
} = require("../src/platform/governance/technical-evidence");
const { run: runAuthorizationCli } = require("../scripts/platform-cutover-authorization");

const NOW = "2030-08-04T12:00:00.000Z";
const RELEASE_ID = "release-20300804";

function candidatePackage() {
  const input = {
    schemaVersion: "pilot-cutover-input-v1",
    status: "pending-committee-authorization",
    release: {
      releaseId: RELEASE_ID,
      sourceCommit: "a".repeat(40),
      artifactDigest: `sha256:${"b".repeat(64)}`
    },
    reports: {
      adapterRuntime: {
        schema: "platform-production-adapter-runtime-v1",
        mode: "cutover-gated",
        adapters: {},
        schemas: {},
        localChecks: {
          schemaVerified: true,
          adaptersConfigured: true,
          adapterWritesEvidenceGated: true
        },
        externalAuthorization: { ok: true },
        workersEligible: true
      },
      reconciliation: {
        schema: "shadow-relay-control-plane-v1",
        ok: true,
        domains: { referral: { ok: true }, emergency: { ok: true } },
        durableCheckpointVerified: true,
        faultRecoveryVerified: true,
        chainValid: true,
        technicalEvidenceFingerprint: `sha256:${"2".repeat(64)}`,
        payloadsExposed: false,
        externalEvidenceVerified: false,
        productionReady: false
      },
      jointTests: {
        schema: "regional-joint-test-evidence-v1",
        registryDigest: `sha256:${"3".repeat(64)}`,
        contracts: [],
        externalEvidenceVerified: true,
        evidenceInferred: false
      },
      businessLoop: {
        schema: "regional-business-loop-report-v1",
        ok: true,
        loopId: "loop-1",
        phase: "closed",
        version: 6,
        checks: { closed: true },
        eventChainDigest: `sha256:${"4".repeat(64)}`
      },
      operations: {
        schema: "platform-operational-control-report-v1",
        domains: {},
        localReady: true,
        externalReady: true,
        operationalReady: true,
        externalEvidenceInferred: false,
        sensitiveDataExposed: false
      },
      externalReleaseEvidence: {
        ok: true,
        evidenceFingerprint: `sha256:${"c".repeat(64)}`
      }
    },
    rollback: {
      owner: "rollback-owner",
      maximumMinutes: 60,
      snapshotRef: "artifact://backup/snapshot-1",
      snapshotDigest: `sha256:${"d".repeat(64)}`,
      steps: ["freeze-writes", "restore-database", "restore-runtime", "verify-recovery"].map((id) => ({
        id,
        tested: true,
        procedureRef: `evidence://rollback/${id}`,
        testDigest: `sha256:${"e".repeat(64)}`
      }))
    },
    disasterRecovery: {
      rpoTargetMinutes: 15,
      rtoTargetMinutes: 60,
      rpoActualMinutes: 5,
      rtoActualMinutes: 30,
      passed: true,
      receiptRef: "evidence://dr/rehearsal-1",
      receiptDigest: `sha256:${"f".repeat(64)}`,
      executionAccount: "dr-operator",
      verifierAccount: "dr-verifier"
    },
    authorization: {
      decision: "NO-GO",
      confirmation: "",
      evidenceFingerprint: "",
      approvedAt: "",
      expiresAt: "",
      rollbackOwner: "",
      approvals: []
    },
    productionReady: false
  };
  let bindings = createPilotCutoverEvidenceBindings(input);
  input.reports.adapterRuntime.technicalEvidenceFingerprint = bindings.adapterRuntime;
  input.reports.jointTests.technicalEvidenceFingerprint = bindings.jointTests;
  input.reports.businessLoop.technicalEvidenceFingerprint = bindings.businessLoop;
  input.reports.operations.technicalEvidenceFingerprint = bindings.operations;
  bindings = createPilotCutoverEvidenceBindings(input);
  input.evidenceDigests = Object.fromEntries(
    EVIDENCE_DIGEST_IDS.map((id) => [id, bindings[id]])
  );
  input.candidateEvidenceFingerprint = createPilotCutoverEvidenceFingerprint(input);
  return input;
}

function trustFixture() {
  const identities = [
    ...REQUIRED_EXTERNAL_GATES.map((scope, index) => ({
      account: `verifier-${index}`,
      scope
    })),
    ...APPROVAL_ROLES.map((scope, index) => ({
      account: `approver-${index}`,
      scope
    })),
    { account: "rehearsal-coordinator", scope: "rehearsal-coordinator" }
  ];
  const privateKeys = new Map();
  const keys = identities.map(({ account, scope }, index) => {
    const pair = generateKeyPairSync("ed25519");
    const keyId = `key-${index + 1}`;
    privateKeys.set(keyId, pair.privateKey);
    return {
      keyId,
      account,
      algorithm: "Ed25519",
      status: "active",
      scopes: [scope],
      validFrom: "2030-08-01T00:00:00.000Z",
      validUntil: "2030-08-10T00:00:00.000Z",
      publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" })
    };
  });
  const registry = {
    schemaVersion: "pilot-cutover-trust-registry-v1",
    generatedAt: "2030-08-04T08:00:00.000Z",
    keys
  };
  const verifier = createPilotCutoverTrustVerifier({ registry });
  function attest(type, actorAccount, body, nonce) {
    const key = keys.find((row) => row.account === actorAccount);
    const subject = createPilotCutoverTrustSubject({
      type,
      actorAccount,
      payload: body
    });
    return {
      schemaVersion: "pilot-cutover-attestation-v1",
      keyId: key.keyId,
      algorithm: "Ed25519",
      issuedAt: "2030-08-04T09:30:00.000Z",
      nonce,
      subjectDigest: sha256(subject),
      signature: sign(
        null,
        Buffer.from(stableStringify(subject)),
        privateKeys.get(key.keyId)
      ).toString("base64url")
    };
  }
  return { attest, registry, verifier };
}

function appendCompleteLedger(file, fingerprint, trust = trustFixture()) {
  const evidenceEvents = REQUIRED_EXTERNAL_GATES.map((gateId, index) =>
    {
      const actorAccount = `verifier-${index}`;
      const payload = {
        gateId,
        releaseId: RELEASE_ID,
        packageFingerprint: fingerprint,
        evidenceRef: `evidence://pilot/${gateId}`,
        evidenceDigest: `sha256:${String(index + 1).repeat(64)}`,
        issuedAt: "2030-08-04T09:00:00.000Z",
        expiresAt: "2030-08-05T09:00:00.000Z",
        issuerAccount: `issuer-${index}`,
        verifierAccount: actorAccount
      };
      payload.attestation = trust.attest(
        "evidence-registered",
        actorAccount,
        payload,
        `evidence-nonce-${index}`
      );
      return appendAuthorizationEvent({
      file,
      type: "evidence-registered",
      actorAccount,
      recordedAt: `2030-08-04T10:0${index}:00.000Z`,
      payload
      });
    });
  const approvalEvents = APPROVAL_ROLES.map((role, index) =>
    {
      const actorAccount = `approver-${index}`;
      const payload = {
        role,
        account: actorAccount,
        packageFingerprint: fingerprint,
        evidenceRef: `evidence://pilot/approval/${role}`,
        evidenceDigest: `sha256:${String(index + 5).repeat(64)}`,
        approvedAt: "2030-08-04T11:00:00.000Z",
        expiresAt: "2030-08-04T14:00:00.000Z",
        confirmation: "APPROVE PILOT CUTOVER",
        rollbackOwner: "rollback-owner"
      };
      payload.attestation = trust.attest(
        "approval-recorded",
        actorAccount,
        payload,
        `approval-nonce-${index}`
      );
      return appendAuthorizationEvent({
      file,
      type: "approval-recorded",
      actorAccount,
      recordedAt: `2030-08-04T11:0${index}:00.000Z`,
      payload
      });
    });
  const rehearsalPayload = {
    schemaVersion: "pilot-cutover-rehearsal-v1",
    rehearsalId: "rehearsal-20300804",
    environment: "pre-production",
    releaseId: RELEASE_ID,
    packageFingerprint: fingerprint,
    coordinatorAccount: "rehearsal-coordinator",
    rollbackOwner: "rollback-owner",
    startedAt: "2030-08-04T08:00:00.000Z",
    completedAt: "2030-08-04T09:00:00.000Z",
    maximumRollbackMinutes: 60,
    actualRollbackMinutes: 18,
    result: "passed",
    checkpoints: [
      "freeze-writes",
      "snapshot",
      "switch-read",
      "verify-business-loop",
      "rollback",
      "post-rollback-verify"
    ].map((id, index) => ({
      id,
      passed: true,
      evidenceRef: `evidence://pilot/rehearsal/${id}`,
      evidenceDigest: `sha256:${String(index + 1).repeat(64)}`
    }))
  };
  rehearsalPayload.attestation = trust.attest(
    "rehearsal-recorded",
    "rehearsal-coordinator",
    rehearsalPayload,
    "rehearsal-nonce-1"
  );
  const rehearsalEvent = appendAuthorizationEvent({
    file,
    type: "rehearsal-recorded",
    actorAccount: "rehearsal-coordinator",
    recordedAt: "2030-08-04T09:05:00.000Z",
    payload: rehearsalPayload
  });
  return { evidenceEvents, approvalEvents, rehearsalEvent, trust };
}

test("append-only ledger validates its chain and projects current independent evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-auth-ledger-"));
  try {
    const file = path.join(directory, "ledger.ndjson");
    const fingerprint = `sha256:${"a".repeat(64)}`;
    const appended = appendCompleteLedger(file, fingerprint);
    const events = readAuthorizationLedger(file);
    assert.equal(events.length, 9);
    assert.equal(events[0].sequence, 1);
    assert.equal(events[8].previousEventDigest, events[7].eventDigest);
    const projection = buildAuthorizationLedgerProjection({
      events,
      releaseId: RELEASE_ID,
      packageFingerprint: fingerprint,
      now: NOW,
      trustVerifier: appended.trust.verifier
    });
    assert.equal(projection.evidenceReady, true);
    assert.equal(projection.approvalsReady, true);
    assert.equal(projection.trustReady, true);
    assert.equal(projection.rehearsalReady, true);
    assert.equal(projection.authorization.approvals.length, 4);

    appendAuthorizationEvent({
      file,
      type: "evidence-revoked",
      actorAccount: "revocation-controller",
      recordedAt: "2030-08-04T11:30:00.000Z",
      payload: {
        targetEventId: appended.approvalEvents[0].eventId,
        reasonRef: "evidence://pilot/revocations/approval-1",
        reasonDigest: `sha256:${"9".repeat(64)}`
      }
    });
    const revoked = buildAuthorizationLedgerProjection({
      file,
      releaseId: RELEASE_ID,
      packageFingerprint: fingerprint,
      now: NOW,
      trustVerifier: appended.trust.verifier
    });
    assert.equal(revoked.approvalsReady, false);
    assert.equal(revoked.authorization.decision, "NO-GO");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("complete ledger can produce only a non-executing GO candidate bound to one package", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-auth-candidate-"));
  try {
    const ledgerFile = path.join(directory, "ledger.ndjson");
    const packageFile = path.join(directory, "package.json");
    const input = candidatePackage();
    fs.writeFileSync(packageFile, JSON.stringify(input));
    const appended = appendCompleteLedger(ledgerFile, input.candidateEvidenceFingerprint);
    const report = evaluatePilotCutoverAuthorizationLedger({
      packageFile,
      ledgerFile,
      now: NOW,
      trustVerifier: appended.trust.verifier
    });
    assert.equal(report.decision, "GO-CANDIDATE");
    assert.equal(report.checks.authorizationLedger, true);
    assert.equal(report.checks.externalEvidenceRegistry, true);
    assert.equal(report.checks.trustedIdentitySignatures, true);
    assert.equal(report.checks.preProductionRehearsal, true);
    assert.equal(report.cutoverExecutionAuthorized, false);
    assert.equal(report.productionPrimary, false);
    assert.equal(report.productionReady, false);

    const expired = evaluatePilotCutoverAuthorizationLedger({
      packageFile,
      ledgerFile,
      now: "2030-08-06T12:00:00.000Z",
      trustVerifier: appended.trust.verifier
    });
    assert.equal(expired.decision, "NO-GO");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("tampering, relative paths, signer reuse and CLI input drift fail closed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-auth-tamper-"));
  try {
    const file = path.join(directory, "ledger.ndjson");
    const fingerprint = `sha256:${"a".repeat(64)}`;
    appendAuthorizationEvent({
      file,
      type: "approval-recorded",
      actorAccount: "ledger-writer",
      recordedAt: "2030-08-04T11:00:00.000Z",
      payload: {
        role: APPROVAL_ROLES[0],
        account: "same-approver",
        packageFingerprint: fingerprint,
        evidenceRef: "evidence://pilot/approval/one",
        evidenceDigest: `sha256:${"1".repeat(64)}`,
        approvedAt: "2030-08-04T11:00:00.000Z",
        expiresAt: "2030-08-04T14:00:00.000Z",
        confirmation: "APPROVE PILOT CUTOVER",
        rollbackOwner: "rollback-owner"
      }
    });
    for (let index = 1; index < APPROVAL_ROLES.length; index += 1) {
      appendAuthorizationEvent({
        file,
        type: "approval-recorded",
        actorAccount: "ledger-writer",
        recordedAt: `2030-08-04T11:0${index}:00.000Z`,
        payload: {
          role: APPROVAL_ROLES[index],
          account: "same-approver",
          packageFingerprint: fingerprint,
          evidenceRef: `evidence://pilot/approval/${index}`,
          evidenceDigest: `sha256:${String(index + 1).repeat(64)}`,
          approvedAt: "2030-08-04T11:00:00.000Z",
          expiresAt: "2030-08-04T14:00:00.000Z",
          confirmation: "APPROVE PILOT CUTOVER",
          rollbackOwner: "rollback-owner"
        }
      });
    }
    const projection = buildAuthorizationLedgerProjection({
      file,
      releaseId: RELEASE_ID,
      packageFingerprint: fingerprint,
      now: NOW
    });
    assert.equal(projection.approvalChecks.independentAccounts, false);
    assert.throws(
      () => readAuthorizationLedger("relative-ledger.ndjson"),
      (error) => error.code === "PILOT_CUTOVER_PATH_INVALID"
    );

    const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
    const changed = JSON.parse(lines[0]);
    changed.payload.account = "tampered";
    lines[0] = JSON.stringify(changed);
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
    assert.throws(
      () => readAuthorizationLedger(file),
      (error) => error.code === "PILOT_CUTOVER_LEDGER_DIGEST_INVALID"
    );

    const invalidInput = path.join(directory, "invalid-command.json");
    fs.writeFileSync(invalidInput, JSON.stringify({
      schemaVersion: "wrong-schema",
      actorAccount: "writer",
      payload: {}
    }));
    assert.throws(
      () => runAuthorizationCli({
        command: "register-evidence",
        options: { ledger: path.join(directory, "new.ndjson"), input: invalidInput }
      }),
      (error) => error.code === "PILOT_CUTOVER_AUTHORIZATION_INPUT_INVALID"
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
