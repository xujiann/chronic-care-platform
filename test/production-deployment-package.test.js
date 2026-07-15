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
    assert.equal(manifest.artifact.files.some((item) => item.path === "session-store.js"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "scripts/postgres-sync-worker.js"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === "scripts/postgres-shadow-reconcile.js"), true);
    assert.equal(manifest.artifact.files.some((item) => item.path === ".env"), false);
    assert.equal(manifest.secretContract.variables.every((item) => item.persistedInArtifact === false && !("value" in item)), true);
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
