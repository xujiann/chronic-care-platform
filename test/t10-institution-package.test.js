"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_TRACKS,
  buildModuleCatalog,
  buildInstitutionDeploymentManifest,
  validateInstitutionDeploymentManifest,
  enumerateSpecialtySelections,
  buildSpecialtyCompatibilityMatrix,
  buildInstitutionPackagePlan
} = require("../emergency-specialty-cutover");
const {
  parseArgs,
  buildInstitutionPackage,
  renderPackageMarkdown,
  renderEnvironmentExample,
  renderRollbackPlan,
  writeInstitutionPackage,
  verifyInstitutionPackage
} = require("../scripts/t10-institution-package");

function sha256Text(value) {
  return `sha256:${crypto.createHash("sha256").update(value, "utf8").digest("hex")}`;
}

test("all fifteen non-empty specialty selections have isolated deployment contracts", () => {
  const selections = enumerateSpecialtySelections(DEFAULT_TRACKS);
  const matrix = buildSpecialtyCompatibilityMatrix(DEFAULT_TRACKS);

  assert.equal(selections.length, 15);
  assert.equal(matrix.status, "all-combinations-compatible");
  assert.equal(matrix.totalCombinations, 15);
  assert.equal(matrix.passedCombinations, 15);
  assert.equal(matrix.failedCombinations, 0);
  assert.ok(matrix.combinations.every((item) => item.peerModuleDependencyCount === 0));
  assert.ok(matrix.combinations.every((item) => item.routeCount === item.moduleIds.length));
  assert.ok(matrix.combinations.every((item) => item.apiCount === item.moduleIds.length));
  assert.ok(matrix.combinations.every((item) => item.dataNamespaceCount === item.moduleIds.length));
  assert.ok(matrix.combinations.every((item) => item.rollbackUnitCount === item.moduleIds.length));
});

test("institution package plan includes deploy, environment, rollback and integrity artifacts", () => {
  const selected = [DEFAULT_TRACKS[2], DEFAULT_TRACKS[3]];
  const catalog = buildModuleCatalog(DEFAULT_TRACKS, selected);
  const manifest = buildInstitutionDeploymentManifest(catalog, { institutionId: "institution-a" });
  const gate = validateInstitutionDeploymentManifest(manifest, catalog);
  const matrix = buildSpecialtyCompatibilityMatrix(DEFAULT_TRACKS);
  const plan = buildInstitutionPackagePlan(manifest, gate, matrix);

  assert.equal(plan.status, "ready-to-build-institution-package");
  assert.equal(plan.artifacts.length, 5);
  assert.ok(plan.artifacts.some((item) => item.file === "activation.env.example"));
  assert.ok(plan.artifacts.some((item) => item.file === "rollback-plan.md"));
  assert.ok(plan.artifacts.some((item) => item.file === "artifact-index.json"));
  assert.deepEqual(plan.hardStops, []);
  assert.match(plan.buildCommand, /regional-imaging-cloud,physical-examination/);
});

test("standalone institution package remains fail-closed and excludes peer modules", () => {
  const pkg = buildInstitutionPackage({
    generatedAt: "2026-07-28T00:00:00.000Z",
    institutionId: "hospital-blood",
    enabledTrackIds: ["clinical-blood"]
  });

  assert.deepEqual(pkg.selectedModuleIds, ["clinical-blood"]);
  assert.deepEqual(pkg.disabledModuleIds, ["emergency-life-chain", "regional-imaging-cloud", "physical-examination"]);
  assert.deepEqual(pkg.deploymentManifest.routeAllowlist, ["blood.html"]);
  assert.deepEqual(pkg.deploymentManifest.apiAllowlist, ["/api/blood-system/go-live"]);
  assert.equal(pkg.deploymentGate.ok, true);
  assert.equal(pkg.compatibilityMatrix.passedCombinations, 15);
  assert.equal(pkg.productionBoundary.productionTrafficState, "blocked-until-site-evidence-signed");
  assert.equal(pkg.productionBoundary.siteEvidenceRequired, true);
  assert.match(pkg.integrity.digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(renderPackageMarkdown(pkg), /clinical-blood/);
  assert.doesNotMatch(renderPackageMarkdown(pkg), /\| 120急救生命链 \|/);
  assert.match(renderEnvironmentExample(pkg), /T10_ENABLED_TRACKS=clinical-blood/);
  assert.match(renderRollbackPlan(pkg), /Do not disable or mutate another specialty module/);
});

test("institution package writer produces a verifiable SHA-256 payload index", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "t10-institution-package-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const pkg = buildInstitutionPackage({
    generatedAt: "2026-07-28T00:00:00.000Z",
    institutionId: "hospital-imaging-exam",
    enabledTrackIds: ["regional-imaging-cloud", "physical-examination"]
  });
  const output = writeInstitutionPackage(pkg, { outputDir });

  assert.equal(output.files.length, 5);
  assert.ok(output.files.every((file) => fs.existsSync(file)));
  const index = JSON.parse(fs.readFileSync(path.join(outputDir, "artifact-index.json"), "utf8"));
  assert.equal(index.payloadArtifacts.length, 4);
  for (const item of index.payloadArtifacts) {
    const content = fs.readFileSync(path.join(outputDir, item.file), "utf8");
    assert.equal(item.digest, sha256Text(content));
    assert.equal(item.bytes, Buffer.byteLength(content, "utf8"));
  }
  const verification = verifyInstitutionPackage(outputDir);
  assert.equal(verification.ok, true);
  assert.equal(verification.status, "institution-package-verified");
  assert.equal(verification.summary.failed, 0);

  fs.appendFileSync(path.join(outputDir, "activation.env.example"), "TAMPERED=true\n", "utf8");
  const tampered = verifyInstitutionPackage(outputDir);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.checks.some((item) => item.id === "artifact:activation.env.example" && !item.passed));
});

test("institution package CLI parser requires safe institution and non-empty tracks", () => {
  assert.deepEqual(parseArgs([
    "--institution-id=hospital-a",
    "--tracks=emergency-life-chain,regional-imaging-cloud"
  ]), {
    institutionId: "hospital-a",
    enabledTrackIds: ["emergency-life-chain", "regional-imaging-cloud"]
  });
  assert.throws(() => parseArgs(["--tracks=clinical-blood"]), /institution-id is required/);
  assert.throws(() => parseArgs(["--institution-id=../escape", "--tracks=clinical-blood"]), /institution id/);
  assert.throws(() => parseArgs(["--institution-id=hospital-a", "--tracks="]), /at least one/);
});
