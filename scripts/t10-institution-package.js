"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_TRACKS,
  buildSpecialtyCutoverPack
} = require("../emergency-specialty-cutover");

const ROOT = path.resolve(__dirname, "..");

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [name, inlineValue] = argument.split("=", 2);
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      return argv[index] || "";
    };
    if (name === "--institution-id") {
      options.institutionId = readValue().trim();
    } else if (name === "--tracks") {
      options.enabledTrackIds = readValue().split(",").map((item) => item.trim()).filter(Boolean);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!options.institutionId) throw new Error("--institution-id is required");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(options.institutionId)) {
    throw new Error("institution id may contain only letters, numbers, dots, underscores and hyphens");
  }
  if (!options.enabledTrackIds?.length) throw new Error("--tracks must contain at least one specialty module id");
  return options;
}

function buildInstitutionPackage(options = {}) {
  const institutionId = options.institutionId;
  const enabledTrackIds = options.enabledTrackIds;
  if (!institutionId) throw new Error("institutionId is required");
  const pack = buildSpecialtyCutoverPack({
    generatedAt: options.generatedAt,
    institutionId,
    enabledTrackIds
  });
  const payload = {
    packageVersion: "1.0.0",
    generatedAt: pack.generatedAt,
    institutionId,
    selectedModuleIds: pack.moduleCatalog.enabledModuleIds,
    disabledModuleIds: pack.moduleCatalog.disabledModuleIds,
    deploymentManifest: pack.institutionDeploymentManifest,
    deploymentGate: pack.institutionDeploymentGate,
    compatibilityMatrix: pack.specialtyCompatibilityMatrix,
    packagePlan: pack.institutionPackagePlan,
    productionBoundary: {
      formalGoLiveState: pack.summary.formalGoLiveState,
      productionTrafficState: pack.institutionDeploymentManifest.productionTrafficState,
      siteBlockers: pack.summary.siteBlockers,
      siteEvidenceRequired: true
    },
    moduleReadiness: pack.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      codeReady: track.codeReady,
      productionReady: track.productionReady,
      readinessDigest: track.readiness.digest,
      blockerCount: track.blockers.length
    }))
  };
  payload.integrity = {
    algorithm: "sha256",
    digest: `sha256:${sha256Text(JSON.stringify(payload))}`
  };
  return payload;
}

function renderPackageMarkdown(pkg) {
  const modules = pkg.deploymentManifest.enabledModules.map((item) => (
    `| ${item.name} | ${item.deploymentUnit} | ${item.page} | ${item.api} | ${item.dataNamespace} | ${item.rollbackUnit} |`
  ));
  const checks = pkg.deploymentGate.checks.map((item) => (
    `| ${item.passed ? "PASS" : "BLOCK"} | ${item.id} | ${item.detail} |`
  ));
  return [
    `# T10 institution package: ${pkg.institutionId}`,
    "",
    `- Generated at: ${pkg.generatedAt}`,
    `- Selected modules: ${pkg.selectedModuleIds.join(", ")}`,
    `- Disabled modules: ${pkg.disabledModuleIds.join(", ") || "none"}`,
    `- Deployment gate: ${pkg.deploymentGate.status}`,
    `- Compatibility: ${pkg.compatibilityMatrix.passedCombinations}/${pkg.compatibilityMatrix.totalCombinations}`,
    `- Formal Go-Live state: ${pkg.productionBoundary.formalGoLiveState}`,
    `- Integrity: ${pkg.integrity.digest}`,
    "",
    "## Enabled deployment units",
    "",
    "| Module | Deployment unit | Page | API | Data namespace | Rollback unit |",
    "|---|---|---|---|---|---|",
    ...modules,
    "",
    "## Deployment contract checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checks,
    "",
    "## Install order",
    "",
    ...pkg.packagePlan.installOrder.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Production boundary",
    "",
    "- Package generation and a green deployment contract do not authorize production traffic.",
    "- Site evidence, controlled rehearsal, T+1 observation and formal Go/No-Go approval remain mandatory.",
    ""
  ].join("\n");
}

function renderEnvironmentExample(pkg) {
  return [
    "# Generated fail-closed example. Replace placeholders through the approved secret/configuration system.",
    `T10_INSTITUTION_ID=${pkg.institutionId}`,
    `T10_ENABLED_TRACKS=${pkg.selectedModuleIds.join(",")}`,
    "T10_ACTIVATION_POLICY=deny-by-default",
    "T10_PRODUCTION_TRAFFIC=blocked-until-site-evidence-signed",
    `T10_ROUTE_ALLOWLIST=${pkg.deploymentManifest.routeAllowlist.join(",")}`,
    `T10_API_ALLOWLIST=${pkg.deploymentManifest.apiAllowlist.join(",")}`,
    `T10_DATA_NAMESPACES=${pkg.deploymentManifest.dataNamespaces.join(",")}`,
    ""
  ].join("\n");
}

function renderRollbackPlan(pkg) {
  const moduleSections = pkg.deploymentManifest.enabledModules.flatMap((item) => [
    `## ${item.name}`,
    "",
    `- Deployment unit: \`${item.deploymentUnit}\``,
    `- Remove page from allowlist: \`${item.page}\``,
    `- Remove API from allowlist: \`${item.api}\``,
    `- Preserve data namespace and evidence: \`${item.dataNamespace}\``,
    "- Stop new production traffic, drain in-flight work through the approved manual path, and retain append-only audit evidence.",
    "- Do not disable or mutate another specialty module.",
    ""
  ]);
  return [
    `# Independent rollback plan: ${pkg.institutionId}`,
    "",
    `Policy: ${pkg.packagePlan.rollbackPolicy}`,
    "",
    ...moduleSections,
    "## Rollback completion gate",
    "",
    "- Selected page and API are unreachable for new traffic.",
    "- In-flight clinical work has an acknowledged manual or local-system continuation path.",
    "- Evidence, receipts and audit records remain replayable.",
    "- Business command and platform operations record the rollback decision.",
    ""
  ].join("\n");
}

function writeInstitutionPackage(pkg, options = {}) {
  const outputDir = path.resolve(options.outputDir || path.join(
    ROOT,
    "release",
    "t10-institution-packages",
    pkg.institutionId
  ));
  fs.mkdirSync(outputDir, { recursive: true });
  const payloads = {
    "deployment-package.json": `${JSON.stringify(pkg, null, 2)}\n`,
    "deployment-package.md": renderPackageMarkdown(pkg),
    "activation.env.example": renderEnvironmentExample(pkg),
    "rollback-plan.md": renderRollbackPlan(pkg)
  };
  const files = Object.entries(payloads).map(([file, content]) => {
    const target = path.join(outputDir, file);
    fs.writeFileSync(target, content, "utf8");
    return {
      file,
      bytes: Buffer.byteLength(content, "utf8"),
      digest: `sha256:${sha256Text(content)}`
    };
  });
  const artifactIndex = {
    packageVersion: pkg.packageVersion,
    institutionId: pkg.institutionId,
    generatedAt: pkg.generatedAt,
    payloadArtifacts: files,
    packageDigest: pkg.integrity.digest
  };
  const indexPath = path.join(outputDir, "artifact-index.json");
  fs.writeFileSync(indexPath, `${JSON.stringify(artifactIndex, null, 2)}\n`, "utf8");
  return {
    outputDir,
    files: [...files.map((item) => path.join(outputDir, item.file)), indexPath],
    artifactIndex
  };
}

function verifyInstitutionPackage(outputDir) {
  const resolvedOutput = path.resolve(outputDir);
  const indexPath = path.join(resolvedOutput, "artifact-index.json");
  const checks = [];
  if (!fs.existsSync(indexPath)) {
    return {
      ok: false,
      status: "institution-package-verification-failed",
      checks: [{ id: "artifact-index", passed: false, detail: "artifact-index.json is missing" }],
      summary: { total: 1, passed: 0, failed: 1 }
    };
  }
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  for (const artifact of index.payloadArtifacts || []) {
    const target = path.join(resolvedOutput, artifact.file);
    const exists = fs.existsSync(target);
    const content = exists ? fs.readFileSync(target, "utf8") : "";
    checks.push({
      id: `artifact:${artifact.file}`,
      passed: exists
        && artifact.bytes === Buffer.byteLength(content, "utf8")
        && artifact.digest === `sha256:${sha256Text(content)}`,
      detail: exists ? artifact.digest : "missing"
    });
  }
  const packagePath = path.join(resolvedOutput, "deployment-package.json");
  if (fs.existsSync(packagePath)) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const { integrity, ...unsignedPayload } = pkg;
    checks.push({
      id: "package-integrity",
      passed: integrity?.digest === `sha256:${sha256Text(JSON.stringify(unsignedPayload))}`,
      detail: integrity?.digest || "missing"
    });
    checks.push({
      id: "deployment-gate",
      passed: pkg.deploymentGate?.ok === true
        && pkg.deploymentGate?.summary?.failed === 0
        && pkg.compatibilityMatrix?.failedCombinations === 0,
      detail: `${pkg.deploymentGate?.summary?.passed || 0}/${pkg.deploymentGate?.summary?.total || 0} gate checks; ${pkg.compatibilityMatrix?.passedCombinations || 0}/${pkg.compatibilityMatrix?.totalCombinations || 0} combinations`
    });
    checks.push({
      id: "production-boundary",
      passed: pkg.productionBoundary?.productionTrafficState === "blocked-until-site-evidence-signed"
        && pkg.productionBoundary?.siteEvidenceRequired === true,
      detail: pkg.productionBoundary?.productionTrafficState || "missing"
    });
  } else {
    checks.push({ id: "package-integrity", passed: false, detail: "deployment-package.json is missing" });
  }
  const failed = checks.filter((item) => !item.passed);
  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "institution-package-verified" : "institution-package-verification-failed",
    institutionId: index.institutionId,
    checks,
    summary: {
      total: checks.length,
      passed: checks.length - failed.length,
      failed: failed.length
    }
  };
}

function runCli() {
  const options = parseArgs();
  const pkg = buildInstitutionPackage(options);
  const output = writeInstitutionPackage(pkg);
  const verification = verifyInstitutionPackage(output.outputDir);
  console.log(JSON.stringify({
    institutionId: pkg.institutionId,
    selectedModuleIds: pkg.selectedModuleIds,
    deploymentGate: pkg.deploymentGate.status,
    compatibility: `${pkg.compatibilityMatrix.passedCombinations}/${pkg.compatibilityMatrix.totalCombinations}`,
    formalGoLiveState: pkg.productionBoundary.formalGoLiveState,
    output,
    verification
  }, null, 2));
  if (!pkg.deploymentGate.ok || pkg.compatibilityMatrix.failedCombinations > 0 || !verification.ok) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  DEFAULT_TRACKS,
  parseArgs,
  buildInstitutionPackage,
  renderPackageMarkdown,
  renderEnvironmentExample,
  renderRollbackPlan,
  writeInstitutionPackage,
  verifyInstitutionPackage
};
