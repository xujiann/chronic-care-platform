"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildSpecialtyCutoverPack } = require("../emergency-specialty-cutover");
const { buildInstitutionPackage } = require("../scripts/t10-institution-package");
const {
  createConfigurationVersion,
  transitionConfiguration,
  createUpgradeConfiguration,
  signDeploymentPackage,
  verifySignedDeploymentPackage,
  importSiteEvidence,
  runControlledRehearsal,
  evaluateObservationGate,
  buildPackageUpgradeDiff,
  verifyIndependentRollback,
  buildT00IntegrationContract,
  buildInstitutionOperationsPlan
} = require("../t10-institution-operations");
const {
  buildOperationsArtifacts,
  writeOperationsArtifacts,
  verifyOperationsArtifacts
} = require("../scripts/t10-institution-operations");

const GENERATED_AT = "2026-07-28T00:00:00.000Z";
const SIGNED_AT = "2026-07-28T01:00:00.000Z";
const VALID_UNTIL = "2026-07-29T01:00:00.000Z";
const NOW = "2026-07-28T02:00:00.000Z";

function fixture(enabledTrackIds = ["emergency-life-chain"]) {
  const institutionId = "hospital-a";
  const cutoverPack = buildSpecialtyCutoverPack({ generatedAt: GENERATED_AT, institutionId, enabledTrackIds });
  const institutionPackage = buildInstitutionPackage({ generatedAt: GENERATED_AT, institutionId, enabledTrackIds });
  const keys = crypto.generateKeyPairSync("ed25519");
  const envelope = signDeploymentPackage(institutionPackage, {
    privateKey: keys.privateKey,
    signerId: "release-signer-a",
    nonce: `nonce-${enabledTrackIds.join("-")}`,
    signedAt: SIGNED_AT,
    validUntil: VALID_UNTIL
  });
  const packageVerification = verifySignedDeploymentPackage(institutionPackage, envelope, {
    publicKey: keys.publicKey,
    now: NOW,
    seenNonces: [],
    allowedSignerIds: ["release-signer-a"]
  });
  return { cutoverPack, institutionPackage, keys, envelope, packageVerification };
}

function acceptedEvidenceEntries(fx) {
  return fx.cutoverPack.evidenceDossier.entries
    .filter((item) => item.requiredForFirstIncrement)
    .map((item, index) => ({
      evidenceId: item.evidenceId,
      institutionId: fx.institutionPackage.institutionId,
      packageDigest: fx.packageVerification.payloadDigest,
      environment: "production-site",
      submitterId: `site-operator-${index + 1}`,
      reviewerId: `commission-reviewer-${index + 1}`,
      status: "accepted",
      submittedAt: "2026-07-28T01:30:00.000Z",
      reviewedAt: "2026-07-28T02:30:00.000Z",
      interfaceVersion: "v1.0",
      artifacts: [{
        name: `receipt-${index + 1}.json`,
        digest: `sha256:${String(index + 1).repeat(64).slice(0, 64)}`,
        originalReference: `evidence://site/receipt-${index + 1}`
      }]
    }));
}

function acceptedEvidenceImport(fx) {
  return importSiteEvidence({
    ...fx,
    entries: acceptedEvidenceEntries(fx),
    importedAt: "2026-07-28T03:00:00.000Z"
  });
}

function passedScenarioResults(cutoverPack) {
  const matrix = new Map(cutoverPack.scenarioEvidenceMatrix.rows.map((item) => [item.scenarioId, item]));
  return cutoverPack.acceptanceScenarioSuite.scenarios.map((scenario) => ({
    scenarioId: scenario.id,
    status: "passed",
    auditEvents: matrix.get(scenario.id)?.requiredWorkflowEvents || [],
    duplicateMutations: 0,
    patientSafetyIncidents: 0,
    scopeViolations: 0,
    digestMatch: true,
    manualDowngradeReachable: true
  }));
}

test("institution configuration lifecycle enforces versioning, four-eyes approval and verified activation", () => {
  const fx = fixture();
  let configuration = createConfigurationVersion({
    institutionId: "hospital-a",
    version: "1.0.0",
    enabledTrackIds: ["emergency-life-chain"],
    packageDigest: fx.packageVerification.payloadDigest,
    createdBy: "config-owner",
    createdAt: GENERATED_AT
  });
  assert.equal(configuration.status, "draft");
  assert.throws(() => transitionConfiguration(configuration, {
    action: "approve",
    actor: "config-owner",
    role: "commission-reviewer"
  }), /not allowed/);

  configuration = transitionConfiguration(configuration, {
    action: "submit-review",
    actor: "config-owner",
    role: "institution-configurator",
    at: "2026-07-28T00:10:00.000Z"
  });
  assert.throws(() => transitionConfiguration(configuration, {
    action: "approve",
    actor: "config-owner",
    role: "commission-reviewer"
  }), /four-eyes/);
  configuration = transitionConfiguration(configuration, {
    action: "approve",
    actor: "reviewer-a",
    role: "commission-reviewer",
    at: "2026-07-28T00:20:00.000Z"
  });
  configuration = transitionConfiguration(configuration, {
    action: "activate",
    actor: "release-manager",
    role: "release-manager",
    packageVerification: fx.packageVerification,
    signatureEnvelope: fx.envelope,
    at: "2026-07-28T02:10:00.000Z"
  });
  assert.equal(configuration.status, "active");
  assert.equal(configuration.audit.length, 4);
  assert.ok(configuration.audit.every((item, index) => index === 0 || item.previousDigest === configuration.audit[index - 1].digest));

  const upgrade = createUpgradeConfiguration(configuration, {
    version: "1.1.0",
    enabledTrackIds: ["emergency-life-chain", "clinical-blood"],
    packageDigest: "sha256:next",
    createdBy: "config-owner-2",
    createdAt: "2026-07-28T04:00:00.000Z"
  });
  assert.equal(upgrade.supersedes, "1.0.0");
  assert.equal(upgrade.status, "draft");
});

test("Ed25519 package verification rejects tampering, expiry and nonce replay", () => {
  const fx = fixture();
  assert.equal(fx.packageVerification.ok, true);
  assert.equal(fx.packageVerification.status, "signed-package-verified");
  assert.equal(fx.packageVerification.summary.passed, 10);

  const tampered = {
    ...fx.institutionPackage,
    selectedModuleIds: ["clinical-blood"]
  };
  assert.equal(verifySignedDeploymentPackage(tampered, fx.envelope, {
    publicKey: fx.keys.publicKey,
    now: NOW,
    allowedSignerIds: ["release-signer-a"]
  }).ok, false);
  assert.ok(verifySignedDeploymentPackage(fx.institutionPackage, fx.envelope, {
    publicKey: fx.keys.publicKey,
    now: "2026-07-30T00:00:00.000Z",
    allowedSignerIds: ["release-signer-a"]
  }).hardStops.includes("validity-window"));
  assert.ok(verifySignedDeploymentPackage(fx.institutionPackage, fx.envelope, {
    publicKey: fx.keys.publicKey,
    now: NOW,
    seenNonces: [fx.envelope.metadata.nonce],
    allowedSignerIds: ["release-signer-a"]
  }).hardStops.includes("nonce-not-replayed"));
  assert.ok(verifySignedDeploymentPackage(fx.institutionPackage, fx.envelope, {
    publicKey: fx.keys.publicKey,
    now: NOW,
    allowedSignerIds: ["different-signer"]
  }).hardStops.includes("authorized-signer"));
});

test("site evidence import binds accepted original receipts to institution and signed package", () => {
  const fx = fixture();
  const imported = acceptedEvidenceImport(fx);
  assert.equal(imported.ok, true);
  assert.equal(imported.status, "site-evidence-import-accepted");
  assert.equal(imported.summary.accepted, imported.summary.required);
  assert.equal(imported.summary.rejected, 0);
  assert.match(imported.auditDigest, /^sha256:[a-f0-9]{64}$/);

  const invalid = acceptedEvidenceEntries(fx);
  invalid[0] = {
    ...invalid[0],
    environment: "demo",
    reviewerId: invalid[0].submitterId,
    submittedAt: "not-a-timestamp",
    artifacts: [{ name: "bad.json", digest: "sha256:bad", originalReference: "" }]
  };
  const blocked = importSiteEvidence({ ...fx, entries: invalid });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.rejected[0].reasons.includes("non-production-evidence"));
  assert.ok(blocked.rejected[0].reasons.includes("four-eyes-separation"));
  assert.ok(blocked.rejected[0].reasons.includes("evidence-timestamp-invalid"));
  assert.ok(blocked.rejected[0].reasons.includes("artifact-digest-or-original-missing"));

  const duplicate = acceptedEvidenceEntries(fx);
  duplicate.push({ ...duplicate[0], reviewerId: "another-reviewer" });
  const duplicateBlocked = importSiteEvidence({ ...fx, entries: duplicate });
  assert.equal(duplicateBlocked.ok, false);
  assert.ok(duplicateBlocked.rejected.some((item) => item.reasons.includes("duplicate-evidence-id")));
});

test("controlled rehearsal evaluates every scenario and keeps hard-stop failures at No-Go", () => {
  const fx = fixture();
  const evidenceImport = acceptedEvidenceImport(fx);
  const passed = runControlledRehearsal({
    cutoverPack: fx.cutoverPack,
    evidenceImport,
    scenarioResults: passedScenarioResults(fx.cutoverPack),
    executedAt: "2026-07-28T05:00:00.000Z"
  });
  assert.equal(passed.ok, true);
  assert.equal(passed.status, "rehearsal-passed-awaiting-t-plus-1");
  assert.equal(passed.scenarioRows.length, 5);
  assert.equal(passed.nextDecision, "open-t-plus-1-observation");

  const failedResults = passedScenarioResults(fx.cutoverPack);
  failedResults[0] = { ...failedResults[0], patientSafetyIncidents: 1 };
  const blocked = runControlledRehearsal({
    cutoverPack: fx.cutoverPack,
    evidenceImport,
    scenarioResults: failedResults
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, "rehearsal-hard-stop-failed");
  assert.equal(blocked.nextDecision, "stay-no-go");
});

test("T+1 observation opens watch-only expansion only when signals and artifacts are green", () => {
  const fx = fixture();
  const rehearsal = runControlledRehearsal({
    cutoverPack: fx.cutoverPack,
    evidenceImport: acceptedEvidenceImport(fx),
    scenarioResults: passedScenarioResults(fx.cutoverPack)
  });
  const measurements = {};
  const artifactStates = { "t-plus-1-observation-memo": "accepted" };
  for (const lane of fx.cutoverPack.observationSignalBoard.lanes) {
    artifactStates[lane.evidenceArtifact] = "accepted";
    for (const signal of lane.signals) {
      measurements[signal.id] = signal.id === "manual-downgrade-reachable" ? true : 0;
    }
  }
  const green = evaluateObservationGate({
    observationSignalBoard: fx.cutoverPack.observationSignalBoard,
    rehearsal,
    measurements,
    artifactStates
  });
  assert.equal(green.ok, true);
  assert.equal(green.decision, "open-watch-only-batch-2");

  const repeat = evaluateObservationGate({
    observationSignalBoard: fx.cutoverPack.observationSignalBoard,
    rehearsal,
    measurements: { ...measurements, "unmatched-handover-fields": 1 },
    artifactStates
  });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.decision, "repeat-batch-1");

  const noGo = evaluateObservationGate({
    observationSignalBoard: fx.cutoverPack.observationSignalBoard,
    rehearsal,
    measurements: { ...measurements, "duplicate-mutation": 1 },
    artifactStates
  });
  assert.equal(noGo.decision, "stay-no-go");
});

test("package upgrade and independent rollback preserve peer module boundaries", () => {
  const current = buildInstitutionPackage({
    generatedAt: GENERATED_AT,
    institutionId: "hospital-a",
    enabledTrackIds: ["emergency-life-chain"]
  });
  const next = buildInstitutionPackage({
    generatedAt: GENERATED_AT,
    institutionId: "hospital-a",
    enabledTrackIds: ["emergency-life-chain", "clinical-blood"]
  });
  const diff = buildPackageUpgradeDiff(current, next);
  assert.equal(diff.ok, true);
  assert.deepEqual(diff.added, ["clinical-blood"]);
  assert.deepEqual(diff.unchanged, ["emergency-life-chain"]);

  const emergency = next.deploymentManifest.enabledModules.find((item) => item.id === "emergency-life-chain");
  const blood = next.deploymentManifest.enabledModules.find((item) => item.id === "clinical-blood");
  const rollback = verifyIndependentRollback(next, "clinical-blood", {
    routeAllowlist: [emergency.page],
    apiAllowlist: [emergency.api],
    preservedDataNamespaces: [emergency.dataNamespace, blood.dataNamespace],
    evidencePreserved: true,
    auditRecorded: true,
    businessApproved: true
  });
  assert.equal(rollback.ok, true);
  assert.equal(rollback.status, "independent-rollback-verified");

  const brokenPeer = verifyIndependentRollback(next, "clinical-blood", {
    routeAllowlist: [],
    apiAllowlist: [emergency.api],
    preservedDataNamespaces: [blood.dataNamespace],
    evidencePreserved: true,
    auditRecorded: true,
    businessApproved: true
  });
  assert.equal(brokenPeer.ok, false);
  assert.ok(brokenPeer.hardStops.includes("peer-pages-unchanged"));
  assert.ok(brokenPeer.hardStops.includes("peer-data-unchanged"));
});

test("T00 integration contract and operations plan preserve ownership and production boundary", () => {
  const fx = fixture();
  const contract = buildT00IntegrationContract();
  const plan = buildInstitutionOperationsPlan(fx);
  assert.ok(contract.sharedFilesOwnedByT00.includes("server.js"));
  assert.ok(contract.requestedRoutes.some((item) => item.path.includes("institution-packages")));
  assert.match(contract.integrationRule, /must not infer site acceptance/);
  assert.equal(plan.configurationLifecycle.fourEyesRequired, true);
  assert.equal(plan.signedPackagePolicy.algorithm, "Ed25519");
  assert.equal(plan.rehearsalScenarioIds.length, 5);
  assert.equal(plan.observationSignalIds.length, 8);
  assert.equal(plan.productionTrafficState, "blocked-until-site-evidence-signed");
});

test("operations artifact pack contains executable templates and detects post-write tampering", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "t10-operations-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const artifacts = buildOperationsArtifacts({
    generatedAt: GENERATED_AT,
    institutionId: "hospital-a",
    enabledTrackIds: ["emergency-life-chain", "clinical-blood"]
  });
  const output = writeOperationsArtifacts(artifacts, { outputDir });
  const verification = verifyOperationsArtifacts(output.outputDir);

  assert.equal(Object.keys(artifacts.documents).length, 9);
  assert.equal(verification.ok, true);
  assert.equal(verification.summary.passed, 9);
  assert.ok(fs.existsSync(path.join(outputDir, "configuration-template.json")));
  assert.ok(fs.existsSync(path.join(outputDir, "evidence-import-template.json")));
  assert.ok(fs.existsSync(path.join(outputDir, "rehearsal-results-template.json")));
  assert.ok(fs.existsSync(path.join(outputDir, "observation-template.json")));
  assert.ok(fs.existsSync(path.join(outputDir, "upgrade-rollback-template.json")));
  assert.ok(fs.existsSync(path.join(outputDir, "specialty-plan-review.json")));
  assert.ok(fs.existsSync(path.join(outputDir, "t00-integration-contract.json")));

  fs.appendFileSync(path.join(outputDir, "observation-template.json"), "\n", "utf8");
  const tampered = verifyOperationsArtifacts(outputDir);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.checks.some((item) => item.id === "artifact:observation-template.json" && !item.passed));
});
