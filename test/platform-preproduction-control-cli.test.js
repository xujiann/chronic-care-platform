"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { generateKeyPairSync, sign } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parseArgs, run, serializeControlError } = require("../scripts/platform-preproduction-control");
const {
  ALERT_GENESIS_DIGEST,
  MAX_ALERT_JOURNAL_BYTES
} = require("../src/platform/cutover/pilot-cutover-alert-lifecycle");
const {
  createPilotCutoverTrustSubject
} = require("../src/platform/cutover/pilot-cutover-trust-verifier");
const {
  sha256,
  stableStringify
} = require("../src/platform/governance/technical-evidence");
const {
  sha256Bytes
} = require("../src/platform/governance/production-evidence-trust-provider");
const {
  PACKAGE,
  createExternalJointTestFixture,
  createMonitoringAcceptance,
  createPreproductionEvidence,
  createRehearsalSession
} = require("./support/preproduction-six-iteration-fixtures");

const ROOT = path.resolve(__dirname, "..");
const NOW = "2026-08-25T12:00:00.000Z";
const CANDIDATE_EVALUATION_NOW = new Date().toISOString();
const CANDIDATE_ISSUED_AT = new Date(Date.parse(CANDIDATE_EVALUATION_NOW) - 60 * 60 * 1000).toISOString();
const CANDIDATE_EXPIRES_AT = new Date(Date.parse(CANDIDATE_EVALUATION_NOW) + 24 * 60 * 60 * 1000).toISOString();
let candidateTrustEnv = {};

function fixtureDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "platform-preproduction-cli-"));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function writeJson(directory, name, value) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

function environmentCommand(file, extra = {}) {
  return {
    command: "environment",
    options: {
      input: file,
      "release-id": "release-20260804",
      "package-fingerprint": PACKAGE,
      ...extra
    }
  };
}

function spawnControl(command, options) {
  const args = Object.entries(options).map(([name, value]) =>
    value === true ? `--${name}` : `--${name}=${value}`);
  return spawnSync(process.execPath, [
    "scripts/platform-preproduction-control.js",
    command,
    ...args
  ], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, ...candidateTrustEnv }
  });
}

function createAuthorizationControl() {
  const approvals = [
    "release-commander",
    "business-owner",
    "security-compliance",
    "independent-observer"
  ].map((role, index) => ({
    role,
    account: `approval-account-${index + 1}`,
    status: "approved"
  }));
  return {
    schema: "pilot-cutover-authorization-control-v1",
    decision: "GO-CANDIDATE",
    releaseId: "release-20260804",
    evidenceFingerprint: PACKAGE,
    checks: {
      authorizationLedger: true,
      externalEvidenceRegistry: true,
      trustedIdentitySignatures: true,
      preProductionRehearsal: true
    },
    ledger: {
      schema: "pilot-cutover-authorization-ledger-projection-v1",
      releaseId: "release-20260804",
      packageFingerprint: PACKAGE,
      chainValid: true,
      evidenceReady: true,
      approvalsReady: true,
      trustReady: true,
      rehearsalReady: true,
      productionReady: false,
      evidenceChecks: {
        securityAssessment: true,
        monitoringDrill: true,
        disasterRecoveryRehearsal: true,
        siteAcceptance: true
      },
      approvalChecks: {
        roles: true,
        independentAccounts: true,
        currentWindow: true,
        rollbackOwner: true,
        trusted: true
      },
      trustChecks: {
        verifierConfigured: true,
        allSelectedEventsTrusted: true,
        noncesUnique: true
      },
      trust: Array.from({ length: 9 }, (_, index) => ({
        eventId: `trusted-event-${index + 1}`,
        result: { trusted: true }
      })),
      authorization: { approvals },
      rehearsal: { ready: true }
    },
    cutoverExecutionAuthorized: false,
    productionPrimary: false,
    productionReady: false
  };
}

const CANDIDATE_SCOPES = {
  authorization: "preproduction-authorization-report",
  preproduction: "preproduction-environment-report",
  "joint-tests": "preproduction-joint-test-report",
  monitoring: "preproduction-monitoring-report",
  rehearsal: "preproduction-rehearsal-report"
};

function signCandidateReports(reports, options = {}) {
  const keys = [];
  const envelopes = {};
  const sharedPair = options.reusePublicKey === true
    ? generateKeyPairSync("ed25519")
    : null;
  const issuedAt = options.issuedAt || CANDIDATE_ISSUED_AT;
  const expiresAt = options.expiresAt || CANDIDATE_EXPIRES_AT;
  Object.entries(CANDIDATE_SCOPES).forEach(([name, scope], index) => {
    const pair = sharedPair || generateKeyPairSync("ed25519");
    const keyId = `candidate-report-key-${index + 1}`;
    const account = options.reuseAccount === true
      ? "candidate-report-verifier-shared"
      : `candidate-report-verifier-${index + 1}`;
    keys.push({
      keyId,
      signerId: account,
      roles: [scope],
      algorithm: "Ed25519",
      status: "active",
      validFrom: "2026-08-01T00:00:00.000Z",
      validUntil: "2099-08-01T00:00:00.000Z",
      publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }),
      publicKeyDigest: sha256Bytes(pair.publicKey.export({ type: "spki", format: "der" }))
    });
    const payload = {
      gateId: scope,
      releaseId: "release-20260804",
      packageFingerprint: PACKAGE,
      evidenceRef: `evidence://preproduction/report/${name}`,
      evidenceDigest: sha256(reports[name]),
      issuedAt,
      expiresAt,
      issuerAccount: `candidate-report-issuer-${index + 1}`,
      verifierAccount: account,
      report: reports[name]
    };
    const event = {
      type: "evidence-registered",
      actorAccount: account,
      recordedAt: "2026-08-24T12:00:00.000Z",
      payload
    };
    const subject = createPilotCutoverTrustSubject(event);
    payload.attestation = {
      schemaVersion: "pilot-cutover-attestation-v1",
      keyId,
      algorithm: "Ed25519",
      issuedAt,
      nonce: `candidate-report-nonce-${index + 1}`,
      subjectDigest: sha256(subject),
      signature: sign(
        null,
        Buffer.from(stableStringify(subject)),
        pair.privateKey
      ).toString("base64url")
    };
    envelopes[name] = event;
  });
  return {
    anchors: {
      schema: "platform-governance.evidence-trust-anchors.v1",
      generatedAt: "2026-08-24T12:00:00.000Z",
      keys
    },
    envelopes
  };
}

function writeSignedCandidateInputs(directory, reports, options = {}) {
  const signed = signCandidateReports(reports, options);
  const prefix = options.prefix || "candidate";
  const trustAnchors = writeJson(directory, `${prefix}-trust-anchors.json`,
    signed.anchors);
  candidateTrustEnv = {
    PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE: trustAnchors,
    PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256: sha256(fs.readFileSync(trustAnchors, "utf8"))
  };
  return {
    authorization: writeJson(directory, `${prefix}-authorization-envelope.json`,
      signed.envelopes.authorization),
    preproduction: writeJson(directory, `${prefix}-preproduction-envelope.json`,
      signed.envelopes.preproduction),
    "joint-tests": writeJson(directory, `${prefix}-joint-tests-envelope.json`,
      signed.envelopes["joint-tests"]),
    monitoring: writeJson(directory, `${prefix}-monitoring-envelope.json`,
      signed.envelopes.monitoring),
    rehearsal: writeJson(directory, `${prefix}-rehearsal-envelope.json`,
      signed.envelopes.rehearsal),
    "release-id": "release-20260804",
    "package-fingerprint": PACKAGE,
    "require-go-candidate": true
  };
}

function candidateRuntime() {
  return {
    now: CANDIDATE_EVALUATION_NOW,
    env: candidateTrustEnv
  };
}

test("CLI accepts only the closed command-specific argument contract", () => {
  assert.deepEqual(parseArgs([
    "environment", "--input=C:\\evidence.json", "--require-ready"
  ]), {
    command: "environment",
    options: { input: "C:\\evidence.json", "require-ready": true }
  });
  for (const args of [
    ["environment", "positional"],
    ["environment", "--unknown=value"],
    ["environment", "--input=one", "--input=two"],
    ["environment", "--input="],
    ["environment", "--input"],
    ["environment", "--require-ready=true"],
    ["environment", `--now=${NOW}`],
    ["candidate", "--report-trust-registry=C:\\forged.json"],
    ["candidate", "--require-ready"],
    ["unknown"]
  ]) {
    assert.throws(() => parseArgs(args), (error) => /^PLATFORM_PREPRODUCTION_/.test(error.code));
  }
});

test("environment and rehearsal distinguish success and require-ready NO-GO", (t) => {
  const directory = fixtureDirectory(t);
  const environmentFile = writeJson(directory, "environment.json", createPreproductionEvidence());
  const environment = run(environmentCommand(environmentFile, { "require-ready": true }), { now: NOW });
  assert.equal(environment.exitCode, 0);
  assert.equal(environment.report.decision, "LOCAL-READY");
  assert.equal(environment.report.productionReady, false);
  assert.equal(spawnControl("environment", environmentCommand(
    environmentFile,
    { "require-ready": true }
  ).options).status, 0);

  for (const bindingDrift of [{
    "release-id": "release-forged"
  }, {
    "package-fingerprint": `sha256:${"0".repeat(64)}`
  }]) {
    const drifted = run(environmentCommand(environmentFile, {
      ...bindingDrift,
      "require-ready": true
    }), { now: NOW });
    assert.equal(drifted.exitCode, 2);
    assert.equal(drifted.report.decision, "NO-GO");
  }

  const blockedEnvironment = createPreproductionEvidence();
  blockedEnvironment.components.pop();
  const blocked = run(environmentCommand(
    writeJson(directory, "environment-blocked.json", blockedEnvironment),
    { "require-ready": true }
  ), { now: NOW });
  assert.equal(blocked.exitCode, 2);
  assert.equal(blocked.report.decision, "NO-GO");
  assert.equal(spawnControl("environment", environmentCommand(
    writeJson(directory, "environment-spawn-blocked.json", blockedEnvironment),
    { "require-ready": true }
  ).options).status, 2);

  const rehearsalFile = writeJson(directory, "rehearsal.json", createRehearsalSession());
  const rehearsal = run({
    command: "rehearsal",
    options: {
      input: rehearsalFile,
      "release-id": "release-20260804",
      "package-fingerprint": PACKAGE,
      "ledger-payload": true
    }
  }, { now: NOW });
  assert.equal(rehearsal.exitCode, 0);
  assert.equal(rehearsal.report.schemaVersion, "pilot-cutover-rehearsal-v1");
  assert.match(rehearsal.report.sessionEvidenceFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(spawnControl("rehearsal", {
    input: rehearsalFile,
    "release-id": "release-20260804",
    "package-fingerprint": PACKAGE,
    "require-ready": true
  }).status, 0);

  const failedRehearsal = createRehearsalSession();
  failedRehearsal.checkpoints.pop();
  const failed = run({
    command: "rehearsal",
    options: {
      input: writeJson(directory, "rehearsal-blocked.json", failedRehearsal),
      "release-id": "release-20260804",
      "package-fingerprint": PACKAGE,
      "require-ready": true
    }
  }, { now: NOW });
  assert.equal(failed.exitCode, 2);
  assert.equal(failed.report.decision, "NO-GO");
  assert.equal(spawnControl("rehearsal", {
    input: writeJson(directory, "rehearsal-spawn-blocked.json", failedRehearsal),
    "release-id": "release-20260804",
    "package-fingerprint": PACKAGE,
    "require-ready": true
  }).status, 2);
});

test("every control requires caller-supplied immutable release bindings", (t) => {
  const directory = fixtureDirectory(t);
  const joint = createExternalJointTestFixture();
  const journal = path.join(directory, "journal.jsonl");
  fs.writeFileSync(journal, "");
  const report = writeJson(directory, "report.json", { ready: true });
  const commands = [{
    command: "environment",
    options: { input: writeJson(directory, "environment.json", createPreproductionEvidence()) }
  }, {
    command: "joint-test",
    options: {
      campaign: writeJson(directory, "campaign.json", joint.campaign),
      "trust-registry": writeJson(directory, "trust.json", joint.trustRegistry),
      evidence: writeJson(directory, "evidence.json", joint.evidenceBundle)
    }
  }, {
    command: "monitoring",
    options: { journal, input: writeJson(directory, "monitoring.json",
      createMonitoringAcceptance(ALERT_GENESIS_DIGEST)) }
  }, {
    command: "rehearsal",
    options: { input: writeJson(directory, "rehearsal.json", createRehearsalSession()) }
  }, {
    command: "candidate",
    options: {
      authorization: report,
      preproduction: report,
      "joint-tests": report,
      monitoring: report,
      rehearsal: report
    }
  }];
  for (const item of commands) {
    assert.throws(() => run(item, { now: NOW }),
      (error) => error.code === "PLATFORM_PREPRODUCTION_OPTION_REQUIRED",
      item.command);
    assert.equal(spawnControl(item.command, item.options).status, 1, item.command);
  }
});

test("joint-test evaluates 96 signed receipts including timeout retry and reconciliation", (t) => {
  const directory = fixtureDirectory(t);
  const fixture = createExternalJointTestFixture();
  const options = {
    campaign: writeJson(directory, "campaign.json", fixture.campaign),
    "trust-registry": writeJson(directory, "trust.json", fixture.trustRegistry),
    evidence: writeJson(directory, "evidence.json", fixture.evidenceBundle),
    "release-id": "release-20260804",
    "package-fingerprint": PACKAGE,
    "require-ready": true
  };
  const ready = run({ command: "joint-test", options }, { now: NOW });
  assert.equal(ready.exitCode, 0);
  assert.equal(ready.report.summary.required, 96);
  assert.equal(ready.report.summary.verified, 96);
  assert.equal(ready.report.productionReady, false);
  assert.equal(ready.report.interfaces.every((item) =>
    ["timeout-retry", "reconciliation"].every((id) =>
      item.scenarios.some((scenario) => scenario.id === id && scenario.verified))), true);
  assert.equal(spawnControl("joint-test", options).status, 0);

  fixture.evidenceBundle.receipts.pop();
  options.evidence = writeJson(directory, "evidence-blocked.json", fixture.evidenceBundle);
  const blocked = run({ command: "joint-test", options }, { now: NOW });
  assert.equal(blocked.exitCode, 2);
  assert.equal(blocked.report.externalEvidenceVerified, false);
  assert.equal(spawnControl("joint-test", options).status, 2);
});

test("monitoring requires dead-letter redrive evidence and a closed journal", (t) => {
  const directory = fixtureDirectory(t);
  const journal = path.join(directory, "journal.jsonl");
  fs.writeFileSync(journal, "");
  const acceptance = createMonitoringAcceptance(ALERT_GENESIS_DIGEST);
  assert.equal(acceptance.checks.some((item) =>
    item.id === "receiver-outage-dead-letter-redrive"), true);
  const options = {
    journal,
    input: writeJson(directory, "monitoring.json", acceptance),
    "release-id": "release-20260804",
    "package-fingerprint": PACKAGE,
    "require-ready": true
  };
  const ready = run({ command: "monitoring", options }, { now: NOW });
  assert.equal(ready.exitCode, 0);
  assert.equal(ready.report.decision, "MONITORING-ACCEPTED");
  assert.equal(ready.report.productionReady, false);
  assert.equal(spawnControl("monitoring", options).status, 0);

  acceptance.checks = acceptance.checks.filter((item) =>
    item.id !== "receiver-outage-dead-letter-redrive");
  options.input = writeJson(directory, "monitoring-blocked.json", acceptance);
  const blocked = run({ command: "monitoring", options }, { now: NOW });
  assert.equal(blocked.exitCode, 2);
  assert.equal(blocked.report.decision, "NO-GO");
  assert.equal(spawnControl("monitoring", options).status, 2);
});

test("candidate never exceeds GO-CANDIDATE and fails closed on package drift", (t) => {
  const directory = fixtureDirectory(t);
  const preproduction = run(environmentCommand(
    writeJson(directory, "environment.json", createPreproductionEvidence())
  ), { now: NOW }).report;
  const jointFixture = createExternalJointTestFixture();
  const jointTests = run({
    command: "joint-test",
    options: {
      campaign: writeJson(directory, "campaign.json", jointFixture.campaign),
      "trust-registry": writeJson(directory, "trust.json", jointFixture.trustRegistry),
      evidence: writeJson(directory, "joint-evidence.json", jointFixture.evidenceBundle),
      "release-id": "release-20260804",
      "package-fingerprint": PACKAGE
    }
  }, { now: NOW }).report;
  const journal = path.join(directory, "journal.jsonl");
  fs.writeFileSync(journal, "");
  const monitoring = run({
    command: "monitoring",
    options: {
      journal,
      input: writeJson(directory, "monitoring.json",
        createMonitoringAcceptance(ALERT_GENESIS_DIGEST)),
      "release-id": "release-20260804",
      "package-fingerprint": PACKAGE
    }
  }, { now: NOW }).report;
  const rehearsal = run({
    command: "rehearsal",
    options: {
      input: writeJson(directory, "rehearsal.json", createRehearsalSession()),
      "release-id": "release-20260804",
      "package-fingerprint": PACKAGE
    }
  }, { now: NOW }).report;
  const authorization = createAuthorizationControl();
  const reports = {
    authorization,
    preproduction,
    "joint-tests": jointTests,
    monitoring,
    rehearsal
  };
  const reportFiles = writeSignedCandidateInputs(directory, reports);
  const untrustedCli = run({ command: "candidate", options: reportFiles }, candidateRuntime());
  assert.equal(untrustedCli.exitCode, 2);
  assert.equal(untrustedCli.report.decision, "NO-GO");
  assert.equal(untrustedCli.report.cutoverExecutionAuthorized, false);
  assert.equal(untrustedCli.report.productionPrimary, false);
  assert.equal(untrustedCli.report.productionReady, false);
  assert.equal(untrustedCli.report.blockers.includes(
    "trusted report roots require an external deployment host integration"), true);
  const spawnedCandidate = spawnControl("candidate", reportFiles);
  assert.equal(spawnedCandidate.status, 2);
  assert.equal(JSON.parse(spawnedCandidate.stdout).decision, "NO-GO");
  const candidateWithoutGateFlag = { ...reportFiles };
  delete candidateWithoutGateFlag["require-go-candidate"];
  const spawnedWithoutGateFlag = spawnControl("candidate", candidateWithoutGateFlag);
  assert.equal(spawnedWithoutGateFlag.status, 2);
  assert.equal(JSON.parse(spawnedWithoutGateFlag.stdout).decision, "NO-GO");

  const unsignedFullShape = {
    ...reportFiles,
    authorization: writeJson(directory, "unsigned-authorization.json", authorization),
    preproduction: writeJson(directory, "unsigned-preproduction.json", preproduction),
    "joint-tests": writeJson(directory, "unsigned-joint-tests.json", jointTests),
    monitoring: writeJson(directory, "unsigned-monitoring.json", monitoring),
    rehearsal: writeJson(directory, "unsigned-rehearsal.json", rehearsal)
  };
  assert.throws(() => run({ command: "candidate", options: unsignedFullShape },
    candidateRuntime()), (error) => error.code === "PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  assert.equal(spawnControl("candidate", unsignedFullShape).status, 1);

  const trustedEnvironment = candidateTrustEnv;
  candidateTrustEnv = {
    ...candidateTrustEnv,
    PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256: `sha256:${"0".repeat(64)}`
  };
  assert.throws(() => run({ command: "candidate", options: reportFiles },
    candidateRuntime()), (error) => error.code === "PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  assert.equal(spawnControl("candidate", reportFiles).status, 1);
  candidateTrustEnv = trustedEnvironment;

  const reusedAccountFiles = writeSignedCandidateInputs(directory, reports, {
    prefix: "reused-account",
    reuseAccount: true
  });
  assert.throws(() => run({ command: "candidate", options: reusedAccountFiles },
    candidateRuntime()), (error) => error.code === "PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  assert.equal(spawnControl("candidate", reusedAccountFiles).status, 1);

  const reusedPublicKeyFiles = writeSignedCandidateInputs(directory, reports, {
    prefix: "reused-public-key",
    reusePublicKey: true
  });
  assert.throws(() => run({ command: "candidate", options: reusedPublicKeyFiles },
    candidateRuntime()), (error) => error.code === "PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  assert.equal(spawnControl("candidate", reusedPublicKeyFiles).status, 1);

  const staleFiles = writeSignedCandidateInputs(directory, reports, {
    prefix: "stale",
    issuedAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z"
  });
  assert.throws(() => run({ command: "candidate", options: staleFiles },
    candidateRuntime()), (error) => error.code === "PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  assert.equal(spawnControl("candidate", staleFiles).status, 1);
  candidateTrustEnv = trustedEnvironment;

  const forgedEnvelope = JSON.parse(fs.readFileSync(reportFiles.monitoring, "utf8"));
  forgedEnvelope.payload.report.packageFingerprint = `sha256:${"c".repeat(64)}`;
  reportFiles.monitoring = writeJson(directory, "monitoring-drifted.json", forgedEnvelope);
  assert.throws(() => run({ command: "candidate", options: reportFiles }, candidateRuntime()),
    (error) => error.code === "PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  assert.equal(spawnControl("candidate", reportFiles).status, 1);

  const blockedEvidence = createPreproductionEvidence();
  blockedEvidence.components.pop();
  const blockedPreproduction = run(environmentCommand(
    writeJson(directory, "candidate-environment-blocked.json", blockedEvidence)
  ), { now: NOW }).report;
  const blockedFiles = writeSignedCandidateInputs(directory, {
    ...reports,
    preproduction: blockedPreproduction
  });
  const blocked = run({ command: "candidate", options: blockedFiles }, candidateRuntime());
  assert.equal(blocked.exitCode, 2);
  assert.equal(blocked.report.decision, "NO-GO");
  assert.equal(spawnControl("candidate", blockedFiles).status, 2);
});

test("candidate rejects self-reported ready JSON without trusted report contracts", (t) => {
  const directory = fixtureDirectory(t);
  const fake = writeJson(directory, "fake-ready.json", {
    ready: true,
    decision: "GO-CANDIDATE",
    releaseId: "release-20260804",
    packageFingerprint: PACKAGE,
    productionReady: false
  });
  const trustedInputs = writeSignedCandidateInputs(directory, Object.fromEntries(
    Object.keys(CANDIDATE_SCOPES).map((name) => [name, {}])
  ));
  const options = {
    ...trustedInputs,
    authorization: fake,
    preproduction: fake,
    "joint-tests": fake,
    monitoring: fake,
    rehearsal: fake,
    "release-id": "release-20260804",
    "package-fingerprint": PACKAGE,
    "require-go-candidate": true
  };
  assert.throws(() => run({ command: "candidate", options }, candidateRuntime()),
    (error) => error.code === "PLATFORM_PREPRODUCTION_EVIDENCE_INVALID");
  assert.equal(spawnControl("candidate", options).status, 1);
});

test("input boundaries reject relative, symlink, oversized, sensitive and path swaps", (t) => {
  const directory = fixtureDirectory(t);
  assert.throws(() => run(environmentCommand("relative.json"), { now: NOW }),
    (error) => error.code === "PILOT_CUTOVER_PATH_INVALID");

  const oversized = path.join(directory, "oversized.json");
  fs.writeFileSync(oversized, Buffer.alloc(1024 * 1024 + 1, 0x20));
  assert.throws(() => run(environmentCommand(oversized), { now: NOW }),
    (error) => error.code === "PILOT_CUTOVER_FILE_BOUNDARY_INVALID");

  const sensitive = createPreproductionEvidence();
  sensitive.patientId = "forbidden";
  assert.throws(() => run(environmentCommand(
    writeJson(directory, "sensitive.json", sensitive)
  ), { now: NOW }), (error) => error.code === "TECHNICAL_EVIDENCE_SENSITIVE_FIELD");

  const target = writeJson(directory, "swap.json", createPreproductionEvidence());
  const replacement = path.join(directory, "replacement.json");
  const changed = Buffer.from(fs.readFileSync(target));
  changed[0] = 0x5b;
  fs.writeFileSync(replacement, changed);
  let swapped = false;
  const fileSystem = new Proxy(fs, {
    get(object, property) {
      if (property === "openSync") {
        return (...args) => {
          if (!swapped && path.resolve(args[0]) === path.resolve(target)) {
            swapped = true;
            fs.rmSync(target);
            fs.renameSync(replacement, target);
          }
          return fs.openSync(...args);
        };
      }
      return Reflect.get(object, property);
    }
  });
  assert.throws(() => run(environmentCommand(target), { now: NOW, fileSystem }),
    (error) => error.code === "PILOT_CUTOVER_FILE_BOUNDARY_INVALID");

  const symlinkTarget = writeJson(directory, "symlink-target.json", createPreproductionEvidence());
  const symlink = path.join(directory, "symlink.json");
  try {
    fs.symlinkSync(symlinkTarget, symlink, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) return;
    throw error;
  }
  assert.throws(() => run(environmentCommand(symlink), { now: NOW }),
    (error) => error.code === "PILOT_CUTOVER_FILE_BOUNDARY_INVALID");
});

test("monitoring journal rejects oversized, symlinked and path-swapped inputs", (t) => {
  const directory = fixtureDirectory(t);
  const acceptanceFile = writeJson(directory, "monitoring.json",
    createMonitoringAcceptance(ALERT_GENESIS_DIGEST));
  const monitoringCommand = (journal) => ({
    command: "monitoring",
    options: {
      journal,
      input: acceptanceFile,
      "release-id": "release-20260804",
      "package-fingerprint": PACKAGE
    }
  });

  const oversized = path.join(directory, "journal-oversized.jsonl");
  fs.writeFileSync(oversized, Buffer.alloc(MAX_ALERT_JOURNAL_BYTES + 1, 0x20));
  assert.throws(() => run(monitoringCommand(oversized), { now: NOW }),
    (error) => error.code === "PILOT_CUTOVER_ALERT_JOURNAL_BOUNDARY_INVALID");

  const target = path.join(directory, "journal-swap.jsonl");
  const replacement = path.join(directory, "journal-replacement.jsonl");
  fs.writeFileSync(target, "");
  fs.writeFileSync(replacement, "");
  let swapped = false;
  const fileSystem = new Proxy(fs, {
    get(object, property) {
      if (property === "openSync") {
        return (...args) => {
          if (!swapped && path.resolve(args[0]) === path.resolve(target)) {
            swapped = true;
            fs.rmSync(target);
            fs.renameSync(replacement, target);
          }
          return fs.openSync(...args);
        };
      }
      return Reflect.get(object, property);
    }
  });
  assert.throws(() => run(monitoringCommand(target), { now: NOW, fileSystem }),
    (error) => error.code === "PILOT_CUTOVER_ALERT_JOURNAL_BOUNDARY_INVALID");

  const symlinkTarget = path.join(directory, "journal-symlink-target.jsonl");
  const symlink = path.join(directory, "journal-symlink.jsonl");
  fs.writeFileSync(symlinkTarget, "");
  try {
    fs.symlinkSync(symlinkTarget, symlink, "file");
    assert.throws(() => run(monitoringCommand(symlink), { now: NOW }),
      (error) => error.code === "PILOT_CUTOVER_ALERT_JOURNAL_BOUNDARY_INVALID");
  } catch (error) {
    if (!["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) throw error;
  }
});

test("argument and runtime errors use a stable redacted exit-1 projection", () => {
  const secret = "C:\\sensitive\\patient-token.json";
  const argumentResult = spawnSync(process.execPath, [
    "scripts/platform-preproduction-control.js",
    "environment",
    `--input=${secret}`,
    "--require-ready=true"
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(argumentResult.status, 1);
  assert.deepEqual(JSON.parse(argumentResult.stderr), serializeControlError({
    code: "PLATFORM_PREPRODUCTION_OPTION_VALUE_INVALID"
  }));
  assert.doesNotMatch(argumentResult.stderr, /sensitive|patient-token|require-ready=true/i);

  const runtimeResult = spawnSync(process.execPath, [
    "scripts/platform-preproduction-control.js",
    "environment",
    `--input=${secret}`,
    "--release-id=release-20260804",
    `--package-fingerprint=${PACKAGE}`,
    "--require-ready"
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(runtimeResult.status, 1);
  assert.deepEqual(JSON.parse(runtimeResult.stderr), serializeControlError({
    code: "PILOT_CUTOVER_FILE_UNAVAILABLE"
  }));
  assert.doesNotMatch(runtimeResult.stderr, /sensitive|patient-token/i);
});
