"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createPilotCutoverEvidenceBindings
} = require("../src/platform/cutover/pilot-cutover-orchestrator");
const {
  buildPilotCutoverPackage,
  evaluatePilotCutoverFile,
  loadPilotCutoverManifest,
  readPilotCutoverInput,
  writePilotCutoverPackage
} = require("../src/platform/cutover/pilot-cutover-package");
const {
  run: runPackageCli
} = require("../scripts/platform-cutover-package");

const NOW = "2030-08-04T12:00:00.000Z";

function evidenceSource() {
  const input = {
    reports: {
      adapterRuntime: {
        schema: "platform-production-adapter-runtime-v1",
        mode: "shadow",
        adapters: {},
        schemas: {},
        localChecks: {
          schemaVerified: false,
          adaptersConfigured: false,
          adapterWritesEvidenceGated: false
        },
        externalAuthorization: { ok: false },
        workersEligible: false
      },
      reconciliation: {
        schema: "shadow-relay-control-plane-v1",
        ok: false,
        domains: { referral: { ok: false }, emergency: { ok: false } },
        durableCheckpointVerified: false,
        faultRecoveryVerified: false,
        chainValid: false,
        technicalEvidenceFingerprint: `sha256:${"1".repeat(64)}`,
        payloadsExposed: false,
        externalEvidenceVerified: false,
        productionReady: false
      },
      jointTests: {
        schema: "regional-joint-test-evidence-v1",
        registryDigest: `sha256:${"2".repeat(64)}`,
        contracts: [],
        externalEvidenceVerified: false,
        evidenceInferred: false
      },
      businessLoop: {
        schema: "regional-business-loop-report-v1",
        ok: false,
        loopId: "loop-1",
        phase: "awaiting-consent",
        version: 0,
        checks: { closed: false },
        eventChainDigest: `sha256:${"3".repeat(64)}`
      },
      operations: {
        schema: "platform-operational-control-report-v1",
        domains: {},
        localReady: false,
        externalReady: false,
        operationalReady: false,
        externalEvidenceInferred: false,
        sensitiveDataExposed: false
      },
      externalReleaseEvidence: {
        ok: false,
        evidenceFingerprint: `sha256:${"4".repeat(64)}`
      }
    },
    rollback: {},
    disasterRecovery: {}
  };
  const bindings = createPilotCutoverEvidenceBindings(input);
  input.reports.adapterRuntime.technicalEvidenceFingerprint = bindings.adapterRuntime;
  input.reports.jointTests.technicalEvidenceFingerprint = bindings.jointTests;
  input.reports.businessLoop.technicalEvidenceFingerprint = bindings.businessLoop;
  input.reports.operations.technicalEvidenceFingerprint = bindings.operations;
  return input;
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-cutover-package-"));
  const source = evidenceSource();
  const reportFiles = {};
  for (const [id, report] of Object.entries(source.reports)) {
    const file = path.join(directory, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(report));
    reportFiles[id] = file;
  }
  const rollbackFile = path.join(directory, "rollback.json");
  const disasterRecoveryFile = path.join(directory, "disaster-recovery.json");
  fs.writeFileSync(rollbackFile, JSON.stringify(source.rollback));
  fs.writeFileSync(disasterRecoveryFile, JSON.stringify(source.disasterRecovery));
  const manifest = {
    schemaVersion: "pilot-cutover-package-manifest-v1",
    release: {
      releaseId: "release-20300804",
      sourceCommit: "a".repeat(40),
      artifactDigest: `sha256:${"b".repeat(64)}`
    },
    reportFiles,
    rollbackFile,
    disasterRecoveryFile
  };
  const manifestFile = path.join(directory, "manifest.json");
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  return { directory, manifest, manifestFile };
}

test("builder binds every source and writes one immutable unauthorized package", () => {
  const current = fixture();
  try {
    const manifest = loadPilotCutoverManifest(current.manifestFile);
    const input = buildPilotCutoverPackage(manifest);
    assert.equal(input.status, "pending-committee-authorization");
    assert.equal(input.authorization.decision, "NO-GO");
    assert.equal(input.authorization.approvals.length, 0);
    assert.equal(input.productionReady, false);
    assert.match(input.candidateEvidenceFingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.equal(Object.keys(input.evidenceDigests).length, 8);

    const output = path.join(current.directory, "cutover-package.json");
    const artifact = writePilotCutoverPackage(output, input);
    assert.match(artifact.packageDigest, /^sha256:[a-f0-9]{64}$/);
    const loaded = readPilotCutoverInput(output);
    assert.equal(loaded.candidateEvidenceFingerprint, input.candidateEvidenceFingerprint);
    const decision = evaluatePilotCutoverFile({ file: output, now: NOW });
    assert.equal(decision.decision, "NO-GO");
    assert.equal(decision.cutoverExecutionAuthorized, false);
    assert.equal(decision.productionReady, false);
    assert.throws(
      () => writePilotCutoverPackage(output, input),
      (error) => error.code === "PILOT_CUTOVER_OUTPUT_EXISTS"
    );
  } finally {
    fs.rmSync(current.directory, { recursive: true, force: true });
  }
});

test("package CLI builds and verifies without converting missing approval into readiness", () => {
  const current = fixture();
  try {
    const output = path.join(current.directory, "cli-package.json");
    const built = runPackageCli({
      command: "build",
      options: { manifest: current.manifestFile, output }
    });
    assert.equal(built.exitCode, 0);
    assert.equal(built.report.authorizationIncluded, false);
    const verified = runPackageCli({
      command: "verify",
      options: { input: output, now: NOW, "require-go-candidate": true }
    });
    assert.equal(verified.exitCode, 2);
    assert.equal(verified.report.decision, "NO-GO");
  } finally {
    fs.rmSync(current.directory, { recursive: true, force: true });
  }
});

test("relative paths, report drift, sensitive fields and package tampering fail closed", () => {
  const current = fixture();
  try {
    assert.throws(
      () => loadPilotCutoverManifest("relative-manifest.json"),
      (error) => error.code === "PILOT_CUTOVER_PATH_INVALID"
    );
    const drifted = JSON.parse(fs.readFileSync(current.manifest.reportFiles.operations, "utf8"));
    drifted.localReady = true;
    fs.writeFileSync(current.manifest.reportFiles.operations, JSON.stringify(drifted));
    assert.throws(
      () => buildPilotCutoverPackage(loadPilotCutoverManifest(current.manifestFile)),
      (error) => error.code === "PILOT_CUTOVER_REPORT_FINGERPRINT_INVALID"
    );

    const clean = fixture();
    try {
      const input = buildPilotCutoverPackage(loadPilotCutoverManifest(clean.manifestFile));
      const output = path.join(clean.directory, "tampered-package.json");
      writePilotCutoverPackage(output, input);
      const changed = JSON.parse(fs.readFileSync(output, "utf8"));
      changed.release.releaseId = "changed-release";
      fs.writeFileSync(output, JSON.stringify(changed));
      assert.throws(
        () => readPilotCutoverInput(output),
        (error) => error.code === "PILOT_CUTOVER_CANDIDATE_FINGERPRINT_INVALID"
      );
      const incomplete = structuredClone(input);
      delete incomplete.evidenceDigests.rollback;
      fs.writeFileSync(output, JSON.stringify(incomplete));
      assert.throws(
        () => readPilotCutoverInput(output),
        (error) => error.code === "PILOT_CUTOVER_INPUT_INVALID"
      );
      changed.reports.operations.patient = { id: "forbidden" };
      fs.writeFileSync(output, JSON.stringify(changed));
      assert.throws(
        () => readPilotCutoverInput(output),
        (error) => error.code === "TECHNICAL_EVIDENCE_SENSITIVE_FIELD"
      );
    } finally {
      fs.rmSync(clean.directory, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(current.directory, { recursive: true, force: true });
  }
});
