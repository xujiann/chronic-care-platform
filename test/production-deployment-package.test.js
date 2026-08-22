const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  buildProductionDeploymentPackage,
  parseArgs,
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
    assert.equal(manifest.artifact.files.some((item) => item.path === "config/regions.json"), true);
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
    assert.equal(manifest.artifact.files.some((item) => item.path === "regions/template/manifest.json"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "regions/210200/manifest.json"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === ".env"), false);
    assert.equal(manifest.secretContract.variables.every((item) => item.persistedInArtifact === false && !("value" in item)), true);
    assert.equal(manifest.secretContract.variables.some((item) => item.name === "OBJECT_STORAGE_RECEIPT_SIGNING_SECRET" && item.purpose === "object storage gateway response verification"), true);
    assert.equal(manifest.secretContract.variables.some((item) => item.name === "SIEM_AUDIT_SIGNING_SECRET" && item.purpose === "continuous audit request signing"), true);
    assert.equal(manifest.processContract.backgroundJobs.some((item) => item.id === "continuous-audit-delivery" && item.productionReady === false && item.preflight === "npm run audit:delivery:preflight"), true);
    assert.equal(manifest.processContract.backgroundJobs.find((item) => item.id === "continuous-audit-delivery").sourceContract, "append-only-audit-source-v2");
    assert.equal(manifest.processContract.backgroundJobs.some((item) => item.id === "chronic-followup-durable-dispatch" && item.preflight === "npm run chronic:followup-dispatch-preflight" && item.sourceContract === "citizen-chronic.followup-dispatch-outbox.v1" && item.productionReady === false && ["DATA_DIR", "CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_SQLITE_FILE", "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_REGISTRY_FILE", "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_FILE", "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_SHA256"].every((name) => item.configurationVariables.includes(name))), true);
    assert.equal(manifest.processContract.productionPreflight.entrypoint, "node scripts/production-preflight.js --strict");
    assert.equal(manifest.processContract.productionPreflight.trustContract, "platform-governance.production-evidence-trust-decision.v1");
    assert.equal(manifest.processContract.productionPreflight.productionReady, false);
    assert.deepEqual(manifest.processContract.productionPreflight.configurationVariables, [
      "PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE",
      "PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256",
      "PRODUCTION_EVIDENCE_TRUST_ENVELOPE_FILE"
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
