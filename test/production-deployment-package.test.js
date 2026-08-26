const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PREPRODUCTION_CONTROL_CONFIGURATION_VARIABLES,
  PREPRODUCTION_CONTROL_DEFINITIONS,
  PREPRODUCTION_CONTROL_RUNTIME_FILES,
  buildProductionDeploymentPackage,
  parseArgs,
  postgresDeploymentTemplatesValid,
  renderMarkdown,
  verifyProductionDeploymentPackage,
  writeOutput
} = require("../scripts/production-deployment-package");

const ROOT = path.resolve(__dirname, "..");

test("production deployment package hashes runtime files without persisting secrets", () => {
  const sentinel = "must-never-enter-deployment-package";
  const previous = process.env.SESSION_SECRETS;
  process.env.SESSION_SECRETS = sentinel;
  try {
    const manifest = buildProductionDeploymentPackage({ source: { commit: "a".repeat(40), dirty: false } });
    assert.equal(manifest.ok, true);
    assert.equal(manifest.productionReady, false);
    assert.match(manifest.artifact.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(manifest.artifact.files.some((item) => item.path === "server.js"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "browser-security-policy.json"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "src/http/api-router.js"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "src/http/routes/index.js"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "src/http/routes/public-health.js"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "session-store.js"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "scripts/postgres-sync-worker.js"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "scripts/postgres-shadow-reconcile.js"), true);
    [
      "postgres-runtime-sync.js",
      "postgres-production-adapter.js",
      "src/platform/storage/postgres-primary-storage-contract.js",
      "src/platform/storage/postgres-primary-driver.js",
      "scripts/postgres-primary-transition-readiness.js",
      "scripts/postgres-migration-package.js",
      "scripts/postgres-primary-read-rehearsal.js",
      "scripts/postgres-production-adapter.js",
      "scripts/storage-admin.js",
      "src/platform/data/public-demo-snapshot.js",
      "deploy/postgres-primary-storage-schema.sql",
      "deploy/postgres-sync-worker.service.template",
      "deploy/postgres-sync-worker.timer.template",
      "deploy/postgres-shadow-reconcile.service.template",
      "deploy/postgres-shadow-reconcile.timer.template",
      "deploy/platform-production-adapters.env.template"
    ].forEach((runtimeFile) => assert.equal(manifest.artifact.files.some((item) => item.path === runtimeFile), true, runtimeFile));
    PREPRODUCTION_CONTROL_RUNTIME_FILES.forEach((runtimeFile) =>
      assert.equal(manifest.artifact.files.some((item) => item.path === runtimeFile), true, runtimeFile));
    assert.equal(manifest.artifact.files.some((item) => item.path === "config/regions.json"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "config/production-release-scope.json"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "scripts/production-release-scope.js"), false);
    assert.equal(manifest.artifact.files.some((item) => item.path === "src/platform/governance/production-release-scope.js"), false);
    assert.equal(manifest.artifact.files.some((item) => item.path === "src/platform/regional/regional-runtime.js"), true);
    [
      "scripts/audit-delivery-worker.js",
      "scripts/audit-delivery-preflight.js",
      "src/platform/operations/audit-delivery.js",
      "src/identity-security/audit-chain.js",
      "src/identity-security/audit-delivery-source.js",
      "src/platform/cutover/pilot-cutover-alert-lifecycle.js",
      "src/platform/governance/technical-evidence.js",
      "deploy/audit-delivery-worker.service.template",
      "deploy/audit-delivery-worker.timer.template",
      "deploy/platform-production-adapters.env.template"
    ].forEach((runtimeFile) => assert.equal(manifest.artifact.files.some((item) => item.path === runtimeFile), true, runtimeFile));
    [
      "scripts/chronic-followup-dispatch-worker.js",
      "src/citizen-chronic/followup-dispatch-outbox.js",
      "src/citizen-chronic/followup-dispatch-worker.js",
      "src/citizen-chronic/followup-dispatch-activation-provider.js",
      "deploy/chronic-followup-dispatch-worker.service.template",
      "deploy/chronic-followup-dispatch-worker.timer.template",
      "deploy/chronic-followup-dispatch-worker.env.template"
    ].forEach((runtimeFile) => assert.equal(manifest.artifact.files.some((item) => item.path === runtimeFile), true, runtimeFile));
    [
      "scripts/production-preflight.js",
      "scripts/production-release-evidence-readiness.js",
      "src/platform/governance/production-evidence-trust-provider.js"
    ].forEach((runtimeFile) => assert.equal(manifest.artifact.files.some((item) => item.path === runtimeFile), true, runtimeFile));
    [
      "config/worker-observability-contract.json",
      "src/platform/operations/worker-observability-contract.js"
    ].forEach((runtimeFile) => assert.equal(manifest.artifact.files.some((item) => item.path === runtimeFile), true, runtimeFile));
    assert.equal(manifest.artifact.files.some((item) => item.path === "regions/template/manifest.json"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "regions/210200/manifest.json"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === ".env"), false);
    assert.equal(manifest.secretContract.variables.every((item) => item.persistedInArtifact === false && !("value" in item)), true);
    assert.equal(manifest.secretContract.variables.some((item) => item.name === "OBJECT_STORAGE_RECEIPT_SIGNING_SECRET" && item.purpose === "object storage gateway response verification"), true);
    assert.equal(manifest.secretContract.variables.some((item) => item.name === "SIEM_AUDIT_SIGNING_SECRET" && item.purpose === "continuous audit request signing"), true);
    assert.equal(manifest.secretContract.variables.some((item) => item.name === "DATABASE_URL" && !Object.hasOwn(item, "value")), true);
    assert.equal(manifest.processContract.backgroundJobs.some((item) => item.id === "continuous-audit-delivery" && item.productionReady === false && item.preflight === "npm run audit:delivery:preflight"), true);
    assert.equal(manifest.processContract.backgroundJobs.find((item) => item.id === "continuous-audit-delivery").sourceContract, "append-only-audit-source-v2");
    assert.equal(manifest.processContract.backgroundJobs.some((item) => item.id === "chronic-followup-durable-dispatch" && item.preflight === "npm run chronic:followup-dispatch-preflight" && item.sourceContract === "citizen-chronic.followup-dispatch-outbox.v1" && item.productionReady === false && ["DATA_DIR", "CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_SQLITE_FILE", "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_REGISTRY_FILE", "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_FILE", "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_SHA256"].every((name) => item.configurationVariables.includes(name))), true);
    assert.equal(manifest.processContract.backgroundJobs.some((item) => item.id === "postgres-shadow-sync" && item.sourceContract === "postgres-shadow-sync" && item.productionReady === false && item.productionPrimary === false && item.runtimeCutoverEnabled === false), true);
    assert.equal(manifest.processContract.backgroundJobs.some((item) => item.id === "postgres-shadow-reconciliation" && item.sourceContract === "postgres-shadow-reconciliation" && item.productionReady === false && item.productionPrimary === false && item.runtimeCutoverEnabled === false), true);
    assert.deepEqual(manifest.processContract.databaseTransition.commands, {
      readiness: "npm run postgres:transition-readiness",
      migrationPackage: "npm run postgres:migration-package",
      migrationVerify: "npm run postgres:migration-verify",
      primaryReadRehearsal: "npm run postgres:primary-read-rehearsal",
      adapterVerify: "npm run postgres:adapter-verify",
      storageBackup: "npm run storage:backup",
      storageInspect: "npm run storage:inspect",
      storageAssess: "npm run storage:assess -- <backup-dir>",
      shadowSync: "npm run postgres:sync-worker",
      shadowReconciliation: "npm run postgres:shadow-reconcile"
    });
    assert.equal(manifest.processContract.databaseTransition.readyForControlledRehearsal, false);
    assert.equal(manifest.processContract.databaseTransition.activationAuthorized, false);
    assert.equal(manifest.processContract.databaseTransition.productionPrimary, false);
    assert.equal(manifest.processContract.databaseTransition.runtimeCutoverEnabled, false);
    assert.equal(manifest.processContract.databaseTransition.productionReady, false);
    assert.equal(manifest.processContract.databaseTransition.configurationVariables.includes("POSTGRES_PRIMARY_TRANSITION_INPUT_FILE"), true);
    assert.equal(manifest.processContract.databaseTransition.configurationVariables.includes("POSTGRES_PRIMARY_TRANSITION_INPUT_SHA256"), true);
    assert.deepEqual(
      manifest.processContract.preproductionControls.map((item) => item.id),
      ["environment", "joint-test", "monitoring", "rehearsal", "candidate"]
    );
    assert.deepEqual(
      manifest.processContract.preproductionControls.map(({ id, command, configurationVariables }) => ({
        id,
        command,
        configurationVariables
      })),
      PREPRODUCTION_CONTROL_DEFINITIONS
    );
    assert.equal(manifest.processContract.preproductionControls.every((item) =>
      item.readOnly === true
      && item.externalEvidenceRequired === true
      && item.executionAuthorized === false
      && item.productionPrimary === false
      && item.productionReady === false), true);
    assert.equal(PREPRODUCTION_CONTROL_CONFIGURATION_VARIABLES.every((name) =>
      manifest.processContract.preproductionControls.some((item) =>
        item.configurationVariables.includes(name))), true);
    assert.equal(JSON.stringify(manifest.processContract).includes("DATABASE_URL"), false);
    const reconciliationService = fs.readFileSync(path.join(ROOT, "deploy", "postgres-shadow-reconcile.service.template"), "utf8");
    ["__SERVICE_USER__", "__SERVICE_GROUP__", "__APP_DIR__", "__SECRET_ENV_FILE__", "__NODE_BINARY__", "__DATA_DIR__", "__LOG_DIR__"].forEach((placeholder) => assert.match(reconciliationService, new RegExp(placeholder)));
    assert.doesNotMatch(reconciliationService, /DEPLOYMENT_(?:APP|DATA|LOG|SECRET)|User=health-platform|\/usr\/bin\/node/);
    assert.equal(manifest.processContract.productionPreflight.entrypoint, "node scripts/production-preflight.js --strict");
    assert.equal(manifest.processContract.productionPreflight.trustContract, "platform-governance.production-evidence-trust-decision.v1");
    assert.equal(manifest.processContract.productionPreflight.productionReady, false);
    assert.deepEqual(manifest.processContract.productionReleaseScope, {
      contract: "production-release-scope.v1",
      scopeId: "priority-eight-applications-v1",
      scopeFingerprint: "sha256:ec33706d5806e5bcf3c210a289ca124e188ff236dafc60ac2f4f1d538f5acca3",
      verificationBoundary: "build-time-source-derived",
      runtimeVerificationAvailable: false,
      summary: {
        applications: 8,
        pages: 9,
        apis: 32,
        collections: 38,
        workers: 7,
        externalDependencies: 14,
        applicationEvidence: 16,
        cutoverActions: 14
      },
      externalEvidenceRequired: true,
      productionReady: false
    });
    assert.deepEqual(manifest.processContract.productionPreflight.configurationVariables, [
      "PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE",
      "PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256",
      "PRODUCTION_EVIDENCE_TRUST_ENVELOPE_FILE",
      "PRODUCTION_CUTOVER_ACTION_EVIDENCE_DIR"
    ]);
    assert.equal(manifest.secretContract.variables.some((item) => item.name === "CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET" && !("value" in item)), true);
    assert.match(
      fs.readFileSync(path.join(ROOT, "deploy", "platform-production-adapters.env.template"), "utf8"),
      /^AUDIT_DELIVERY_SOURCE_CONTRACT=append-only-audit-source-v2$/m
    );
    assert.equal(manifest.processContract.backgroundJobs.some((item) => item.id === "continuous-audit-delivery" && item.configurationTemplate === "deploy/platform-production-adapters.env.template" && item.configurationVariables.includes("AUDIT_DELIVERY_SOURCE_CONTRACT") && item.configurationVariables.includes("AUDIT_DELIVERY_SERVICE_UID") && item.configurationVariables.includes("AUDIT_DELIVERY_SERVICE_GID") && item.configurationVariables.includes("PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE")), true);
    assert.equal(manifest.processContract.healthChecks.some((item) => item.route === "/api/live" && item.purpose === "process-liveness" && item.authentication === "none"), true);
    assert.equal(manifest.processContract.healthChecks.some((item) => item.route === "/api/health" && item.purpose === "dependency-readiness" && item.authentication === "none"), true);
    assert.equal(manifest.processContract.healthChecks.filter((item) => item.authentication === "commission").length, 2);
    assert.equal(JSON.stringify(manifest).includes(sentinel), false);
    assert.equal(manifest.blockers.length >= 6, true);
  } finally {
    if (previous === undefined) delete process.env.SESSION_SECRETS;
    else process.env.SESSION_SECRETS = previous;
  }
});

test("deployment package strict mode rejects a dirty source tree", () => {
  const manifest = buildProductionDeploymentPackage({ strict: true, source: { commit: "b".repeat(40), dirty: true } });
  assert.equal(manifest.ok, false);
  assert.equal(manifest.checks.some((item) => item.id === "deploymentPackage:provenance" && !item.passed), true);
});

test("deployment package verification detects file digest tampering", () => {
  const manifest = buildProductionDeploymentPackage({ source: { commit: "c".repeat(40), dirty: false } });
  const verified = verifyProductionDeploymentPackage(manifest);
  assert.equal(verified.ok, true);

  const tampered = structuredClone(manifest);
  tampered.artifact.files[0].sha256 = "0".repeat(64);
  const failed = verifyProductionDeploymentPackage(tampered);
  assert.equal(failed.ok, false);
  assert.equal(failed.mismatched.includes(tampered.artifact.files[0].path), true);

  const forgedTopLevelReady = structuredClone(manifest);
  forgedTopLevelReady.productionReady = true;
  const forgedTopLevelReadyFailed = verifyProductionDeploymentPackage(forgedTopLevelReady);
  assert.equal(forgedTopLevelReadyFailed.ok, false);
  assert.equal(forgedTopLevelReadyFailed.checks.some((item) =>
    item.id === "deploymentVerify:schema" && !item.passed), true);

  const missingWorkerContract = structuredClone(manifest);
  missingWorkerContract.processContract.backgroundJobs = [];
  const workerFailed = verifyProductionDeploymentPackage(missingWorkerContract);
  assert.equal(workerFailed.ok, false);
  assert.equal(workerFailed.checks.some((item) => item.id === "deploymentVerify:auditWorker" && !item.passed), true);
  assert.equal(workerFailed.checks.some((item) => item.id === "deploymentVerify:chronicFollowupWorker" && !item.passed), true);

  const missingTrustProvider = structuredClone(manifest);
  missingTrustProvider.processContract.productionPreflight.configurationVariables = [];
  const trustProviderFailed = verifyProductionDeploymentPackage(missingTrustProvider);
  assert.equal(trustProviderFailed.ok, false);
  assert.equal(trustProviderFailed.checks.some((item) => item.id === "deploymentVerify:productionEvidenceTrust" && !item.passed), true);

  const forgedReleaseScope = structuredClone(manifest);
  forgedReleaseScope.processContract.productionReleaseScope.scopeFingerprint = "sha256:forged";
  forgedReleaseScope.processContract.productionReleaseScope.productionReady = true;
  const forgedReleaseScopeFailed = verifyProductionDeploymentPackage(forgedReleaseScope);
  assert.equal(forgedReleaseScopeFailed.ok, false);
  assert.equal(forgedReleaseScopeFailed.checks.some((item) => item.id === "deploymentVerify:releaseScope" && !item.passed), true);

  const missingReleaseScopeContract = structuredClone(manifest);
  missingReleaseScopeContract.artifact.files = missingReleaseScopeContract.artifact.files.filter((item) =>
    item.path !== "config/production-release-scope.json");
  const missingReleaseScopeContractFailed = verifyProductionDeploymentPackage(missingReleaseScopeContract);
  assert.equal(missingReleaseScopeContractFailed.ok, false);
  assert.equal(missingReleaseScopeContractFailed.checks.some((item) =>
    item.id === "deploymentVerify:releaseScope" && !item.passed), true);

  const missingReleaseScopeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-scope-missing-"));
  try {
    const missingReleaseScopeFileFailed = verifyProductionDeploymentPackage(manifest, {
      root: missingReleaseScopeRoot
    });
    assert.equal(missingReleaseScopeFileFailed.ok, false);
    assert.equal(missingReleaseScopeFileFailed.checks.some((item) =>
      item.id === "deploymentVerify:releaseScope" && !item.passed), true);
  } finally {
    fs.rmSync(missingReleaseScopeRoot, { recursive: true, force: true });
  }

  const missingPreproductionRuntime = structuredClone(manifest);
  missingPreproductionRuntime.artifact.files = missingPreproductionRuntime.artifact.files.filter((item) =>
    item.path !== "scripts/platform-preproduction-control.js");
  const missingPreproductionRuntimeFailed = verifyProductionDeploymentPackage(
    missingPreproductionRuntime
  );
  assert.equal(missingPreproductionRuntimeFailed.ok, false);
  assert.equal(missingPreproductionRuntimeFailed.checks.some((item) =>
    item.id === "deploymentVerify:preproductionControls" && !item.passed), true);

  for (const requiredTrustRuntime of [
    "src/platform/cutover/pilot-cutover-trust-verifier.js",
    "src/platform/governance/production-evidence-trust-provider.js"
  ]) {
    const missingTrustRuntime = structuredClone(manifest);
    missingTrustRuntime.artifact.files = missingTrustRuntime.artifact.files.filter((item) =>
      item.path !== requiredTrustRuntime);
    const result = verifyProductionDeploymentPackage(missingTrustRuntime);
    assert.equal(result.ok, false, requiredTrustRuntime);
    assert.equal(result.checks.some((item) =>
      item.id === "deploymentVerify:preproductionControls" && !item.passed), true,
    requiredTrustRuntime);
  }

  for (const property of [
    "readOnly",
    "externalEvidenceRequired",
    "cutoverExecutionAuthorized",
    "executionAuthorized",
    "runtimeCutoverEnabled",
    "productionPrimary",
    "productionReady"
  ]) {
    const forgedPreproductionControl = structuredClone(manifest);
    const control = forgedPreproductionControl.processContract.preproductionControls[0];
    control[property] = !control[property];
    const forgedPreproductionControlFailed = verifyProductionDeploymentPackage(
      forgedPreproductionControl
    );
    assert.equal(forgedPreproductionControlFailed.ok, false, property);
    assert.equal(forgedPreproductionControlFailed.checks.some((item) =>
      item.id === "deploymentVerify:preproductionControls" && !item.passed), true, property);
  }

  for (const property of ["command", "configurationVariables"]) {
    const forgedPreproductionContract = structuredClone(manifest);
    forgedPreproductionContract.processContract.preproductionControls[0][property] = property === "command"
      ? "npm run platform:preproduction:environment -- --input=<unbounded-file>"
      : [];
    const forgedPreproductionContractFailed = verifyProductionDeploymentPackage(
      forgedPreproductionContract
    );
    assert.equal(forgedPreproductionContractFailed.ok, false, property);
    assert.equal(forgedPreproductionContractFailed.checks.some((item) =>
      item.id === "deploymentVerify:preproductionControls" && !item.passed), true, property);
  }

  const missingTransitionFile = structuredClone(manifest);
  missingTransitionFile.artifact.files = missingTransitionFile.artifact.files.filter((item) => item.path !== "scripts/postgres-primary-transition-readiness.js");
  const missingTransitionFileFailed = verifyProductionDeploymentPackage(missingTransitionFile);
  assert.equal(missingTransitionFileFailed.ok, false);
  assert.equal(missingTransitionFileFailed.checks.some((item) => item.id === "deploymentVerify:postgresTransition" && !item.passed), true);

  const missingTransitionVariable = structuredClone(manifest);
  missingTransitionVariable.processContract.databaseTransition.configurationVariables = [];
  const missingTransitionVariableFailed = verifyProductionDeploymentPackage(missingTransitionVariable);
  assert.equal(missingTransitionVariableFailed.ok, false);
  assert.equal(missingTransitionVariableFailed.checks.some((item) => item.id === "deploymentVerify:postgresTransition" && !item.passed), true);

  const missingJobVariable = structuredClone(manifest);
  missingJobVariable.processContract.backgroundJobs.find((item) => item.id === "postgres-shadow-reconciliation").configurationVariables = [];
  const missingJobVariableFailed = verifyProductionDeploymentPackage(missingJobVariable);
  assert.equal(missingJobVariableFailed.ok, false);
  assert.equal(missingJobVariableFailed.checks.some((item) => item.id === "deploymentVerify:postgresTransition" && !item.passed), true);

  for (const property of ["readyForControlledRehearsal", "activationAuthorized", "productionPrimary", "runtimeCutoverEnabled", "productionReady"]) {
    const forgedReady = structuredClone(manifest);
    forgedReady.processContract.databaseTransition[property] = true;
    const forgedReadyFailed = verifyProductionDeploymentPackage(forgedReady);
    assert.equal(forgedReadyFailed.ok, false, property);
    assert.equal(forgedReadyFailed.checks.some((item) => item.id === "deploymentVerify:postgresTransition" && !item.passed), true, property);
  }
});

test("PostgreSQL deployment templates keep disabled defaults, placeholders and hardening", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "postgres-deployment-templates-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const temporaryDeploy = path.join(temporaryRoot, "deploy");
  fs.mkdirSync(temporaryDeploy, { recursive: true });
  for (const name of [
    "platform-production-adapters.env.template",
    "postgres-sync-worker.service.template",
    "postgres-sync-worker.timer.template",
    "postgres-shadow-reconcile.service.template",
    "postgres-shadow-reconcile.timer.template"
  ]) {
    fs.copyFileSync(path.join(ROOT, "deploy", name), path.join(temporaryDeploy, name));
  }
  assert.equal(postgresDeploymentTemplatesValid(temporaryRoot), true);

  const envFile = path.join(temporaryDeploy, "platform-production-adapters.env.template");
  const originalEnv = fs.readFileSync(envFile, "utf8");
  fs.writeFileSync(envFile, originalEnv.replace("POSTGRES_PRIMARY_STORAGE_MODE=disabled", "POSTGRES_PRIMARY_STORAGE_MODE=primary-read"));
  assert.equal(postgresDeploymentTemplatesValid(temporaryRoot), false);
  fs.writeFileSync(envFile, originalEnv);

  const serviceFile = path.join(temporaryDeploy, "postgres-shadow-reconcile.service.template");
  const originalService = fs.readFileSync(serviceFile, "utf8");
  fs.writeFileSync(serviceFile, originalService.replace("ProtectSystem=strict", "ProtectSystem=full"));
  assert.equal(postgresDeploymentTemplatesValid(temporaryRoot), false);
  fs.writeFileSync(serviceFile, `${originalService}\nProtectSystem=false\nUser=root\n`);
  assert.equal(postgresDeploymentTemplatesValid(temporaryRoot), false);
  fs.writeFileSync(serviceFile, originalService);

  const timerFile = path.join(temporaryDeploy, "postgres-shadow-reconcile.timer.template");
  const originalTimer = fs.readFileSync(timerFile, "utf8");
  fs.writeFileSync(timerFile, `${originalTimer}\nOnUnitActiveSec=1s\n`);
  assert.equal(postgresDeploymentTemplatesValid(temporaryRoot), false);
});

test("deployment package renders writes and parses CLI flags", (t) => {
  const outputDir = path.join(ROOT, "tmp", "production-deployment-package-test");
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const manifest = buildProductionDeploymentPackage({ source: { commit: "d".repeat(40), dirty: false } });
  const markdown = renderMarkdown(manifest);
  assert.match(markdown, /Production deployment package/);
  assert.match(markdown, /Integrity verification/);
  assert.match(markdown, /server\.js/);

  const written = writeOutput(manifest, {
    output: "tmp/production-deployment-package-test/package.json",
    markdown: "tmp/production-deployment-package-test/package.md"
  });
  assert.equal(written.verification.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputDir, "package.json"), "utf8")).verification.ok, true);
  assert.match(fs.readFileSync(path.join(outputDir, "package.md"), "utf8"), /SHA-256/);

  assert.deepEqual(parseArgs(["build", "--strict", "--release-id=release-001"]), {
    command: "build",
    flags: { strict: true, "release-id": "release-001" }
  });
});
