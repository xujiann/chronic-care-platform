"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { buildSpecialtyCutoverPack } = require("../emergency-specialty-cutover");
const {
  parseArgs,
  buildInstitutionPackage
} = require("./t10-institution-package");
const {
  createConfigurationVersion,
  buildT00IntegrationContract,
  buildInstitutionOperationsPlan
} = require("../t10-institution-operations");

const ROOT = path.resolve(__dirname, "..");

function sha256Text(value) {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function buildOperationsArtifacts(options = {}) {
  const cutoverPack = buildSpecialtyCutoverPack({
    generatedAt: options.generatedAt,
    institutionId: options.institutionId,
    enabledTrackIds: options.enabledTrackIds
  });
  const institutionPackage = buildInstitutionPackage({
    generatedAt: options.generatedAt,
    institutionId: options.institutionId,
    enabledTrackIds: options.enabledTrackIds
  });
  const plan = buildInstitutionOperationsPlan({ cutoverPack, institutionPackage, generatedAt: options.generatedAt });
  const configurationTemplate = createConfigurationVersion({
    institutionId: institutionPackage.institutionId,
    version: "1.0.0",
    enabledTrackIds: institutionPackage.selectedModuleIds,
    packageDigest: institutionPackage.integrity.digest,
    createdBy: "replace-with-institution-configurator",
    createdAt: plan.generatedAt,
    reason: "institution configuration template; replace actor before submission"
  });
  const evidenceImportTemplate = {
    institutionId: institutionPackage.institutionId,
    packageDigest: "<verified-signed-package-payload-digest>",
    entries: cutoverPack.evidenceDossier.entries.map((item) => ({
      evidenceId: item.evidenceId,
      institutionId: institutionPackage.institutionId,
      packageDigest: "<verified-signed-package-payload-digest>",
      environment: "production-site",
      submitterId: "<site-operator>",
      reviewerId: "<independent-commission-reviewer>",
      status: "draft",
      interfaceVersion: "<real-interface-version>",
      artifacts: [{
        name: "<original-receipt-file>",
        digest: "<sha256:digest>",
        originalReference: "<evidence-storage-reference>"
      }]
    }))
  };
  const matrix = new Map(cutoverPack.scenarioEvidenceMatrix.rows.map((item) => [item.scenarioId, item]));
  const rehearsalResultsTemplate = {
    institutionId: institutionPackage.institutionId,
    packageDigest: "<verified-signed-package-payload-digest>",
    scenarioResults: cutoverPack.acceptanceScenarioSuite.scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      status: "not-run",
      auditEvents: matrix.get(scenario.id)?.requiredWorkflowEvents || [],
      duplicateMutations: null,
      patientSafetyIncidents: null,
      scopeViolations: null,
      digestMatch: null,
      manualDowngradeReachable: null,
      evidenceReferences: []
    }))
  };
  const observationTemplate = {
    institutionId: institutionPackage.institutionId,
    window: "T+1",
    measurements: Object.fromEntries(cutoverPack.observationSignalBoard.lanes.flatMap((lane) => (
      lane.signals.map((signal) => [signal.id, null])
    ))),
    artifactStates: Object.fromEntries([
      ["t-plus-1-observation-memo", "pending"],
      ...cutoverPack.observationSignalBoard.lanes.map((lane) => [lane.evidenceArtifact, "pending"])
    ])
  };
  const upgradeRollbackTemplate = {
    institutionId: institutionPackage.institutionId,
    currentPackageDigest: institutionPackage.integrity.digest,
    nextPackageDigest: "<next-package-digest>",
    rollbackTargetModuleId: "<selected-module-id>",
    observedAfterRollback: {
      routeAllowlist: [],
      apiAllowlist: [],
      preservedDataNamespaces: institutionPackage.deploymentManifest.dataNamespaces,
      evidencePreserved: false,
      auditRecorded: false,
      businessApproved: false
    }
  };
  return {
    plan,
    cutoverPack,
    institutionPackage,
    documents: {
      "operations-plan.json": `${JSON.stringify(plan, null, 2)}\n`,
      "operations-plan.md": renderOperationsMarkdown(plan),
      "configuration-template.json": `${JSON.stringify(configurationTemplate, null, 2)}\n`,
      "evidence-import-template.json": `${JSON.stringify(evidenceImportTemplate, null, 2)}\n`,
      "rehearsal-results-template.json": `${JSON.stringify(rehearsalResultsTemplate, null, 2)}\n`,
      "observation-template.json": `${JSON.stringify(observationTemplate, null, 2)}\n`,
      "upgrade-rollback-template.json": `${JSON.stringify(upgradeRollbackTemplate, null, 2)}\n`,
      "specialty-plan-review.json": `${JSON.stringify(cutoverPack.specialtyPlanReview, null, 2)}\n`,
      "external-action-board.json": `${JSON.stringify(cutoverPack.externalActionWorkflowPlan.board, null, 2)}\n`,
      "external-action-command-template.json": `${JSON.stringify({
        actionId: "<external-action-id>",
        action: "assign | submit-evidence | start-review | accept | return | escalate | resolve-escalation | reopen",
        actorId: "<real-account-id>",
        assigneeId: "<required-for-assign>",
        evidenceRef: "<required-for-submit>",
        originalReference: "<required-for-submit>",
        interfaceVersion: "<required-for-submit>",
        evidenceDigest: "<sha256:digest>",
        verificationRef: "<required-for-accept>",
        confirmation: "<exact-confirmation-for-accept>",
        occurredAt: "<ISO-8601 timestamp>"
      }, null, 2)}\n`,
      "external-action-audit-export.json": `${JSON.stringify({
        institutionId: institutionPackage.institutionId,
        generatedAt: plan.generatedAt,
        boardDigest: cutoverPack.externalActionWorkflowPlan.board.integrity.digest,
        audit: cutoverPack.externalActionWorkflowPlan.board.audit
      }, null, 2)}\n`,
      "t00-integration-contract.json": `${JSON.stringify(buildT00IntegrationContract(), null, 2)}\n`
    }
  };
}

function renderOperationsMarkdown(plan) {
  return [
    `# T10 institution operations plan: ${plan.institutionId}`,
    "",
    `- Generated at: ${plan.generatedAt}`,
    `- Selected modules: ${plan.selectedModuleIds.join(", ")}`,
    `- Production traffic: ${plan.productionTrafficState}`,
    `- Configuration states: ${plan.configurationLifecycle.states.join(" -> ")}`,
    `- Signed package algorithm: ${plan.signedPackagePolicy.algorithm}`,
    `- Evidence IDs: ${plan.evidenceImportTemplate.evidenceIds.length}`,
    `- Rehearsal scenarios: ${plan.rehearsalScenarioIds.length}`,
    `- Observation signals: ${plan.observationSignalIds.length}`,
    "",
    "## Operational sequence",
    "",
    "1. Create an immutable configuration version and submit it for four-eyes review.",
    "2. Build and sign the institution package with an approved Ed25519 key.",
    "3. Verify signature, certificate fingerprint, validity window and nonce before activation.",
    "4. Import real site evidence bound to the verified package digest.",
    "5. Run the controlled rehearsal and retain the append-only audit chain.",
    "6. Evaluate T+1 signals and accepted observation artifacts.",
    "7. Review package upgrades or execute one-module rollback without changing peers.",
    "",
    "## Formal boundary",
    "",
    plan.formalGoLiveBoundary,
    ""
  ].join("\n");
}

function writeOperationsArtifacts(artifacts, options = {}) {
  const outputDir = path.resolve(options.outputDir || path.join(
    ROOT,
    "release",
    "t10-institution-operations",
    artifacts.plan.institutionId
  ));
  fs.mkdirSync(outputDir, { recursive: true });
  const indexed = Object.entries(artifacts.documents).map(([file, content]) => {
    fs.writeFileSync(path.join(outputDir, file), content, "utf8");
    return {
      file,
      bytes: Buffer.byteLength(content, "utf8"),
      digest: sha256Text(content)
    };
  });
  const index = {
    contractVersion: "1.0.0",
    institutionId: artifacts.plan.institutionId,
    generatedAt: artifacts.plan.generatedAt,
    payloadArtifacts: indexed
  };
  fs.writeFileSync(path.join(outputDir, "artifact-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return { outputDir, index };
}

function verifyOperationsArtifacts(outputDir) {
  const indexPath = path.resolve(outputDir, "artifact-index.json");
  if (!fs.existsSync(indexPath)) {
    return { ok: false, status: "operations-artifacts-invalid", checks: [{ id: "artifact-index", passed: false }] };
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const checks = (index.payloadArtifacts || []).map((item) => {
    const target = path.resolve(outputDir, item.file);
    const exists = fs.existsSync(target);
    const content = exists ? fs.readFileSync(target, "utf8") : "";
    return {
      id: `artifact:${item.file}`,
      passed: exists && item.bytes === Buffer.byteLength(content, "utf8") && item.digest === sha256Text(content),
      detail: exists ? item.digest : "missing"
    };
  });
  const failed = checks.filter((item) => !item.passed);
  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "operations-artifacts-verified" : "operations-artifacts-invalid",
    institutionId: index.institutionId,
    checks,
    summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length }
  };
}

function runCli() {
  const options = parseArgs();
  const artifacts = buildOperationsArtifacts(options);
  const output = writeOperationsArtifacts(artifacts);
  const verification = verifyOperationsArtifacts(output.outputDir);
  console.log(JSON.stringify({
    institutionId: artifacts.plan.institutionId,
    selectedModuleIds: artifacts.plan.selectedModuleIds,
    productionTrafficState: artifacts.plan.productionTrafficState,
    scenarios: artifacts.plan.rehearsalScenarioIds.length,
    observationSignals: artifacts.plan.observationSignalIds.length,
    outputDir: output.outputDir,
    verification
  }, null, 2));
  if (!verification.ok) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  buildOperationsArtifacts,
  renderOperationsMarkdown,
  writeOperationsArtifacts,
  verifyOperationsArtifacts
};
