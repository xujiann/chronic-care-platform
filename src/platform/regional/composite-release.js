"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { deepFreeze, loadRegionManifest, resolveWithin, sha256, stableJson } = require("./region-manifest");

function parseVersion(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new TypeError(`invalid semantic version: ${value}`);
  return match.slice(1).map(Number);
}

function compareVersion(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function collectRegionFiles(loadedManifest) {
  const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return visit(absolutePath);
    if (!entry.isFile() || ![".json", ".js"].includes(path.extname(entry.name).toLowerCase())) return [];
    const relativePath = path.relative(loadedManifest.projectRoot, absolutePath).replaceAll("\\", "/");
    const bytes = fs.readFileSync(absolutePath);
    return [{ path: relativePath, size: bytes.length, sha256: sha256(bytes) }];
  });
  return visit(loadedManifest.regionRoot).sort((left, right) => left.path.localeCompare(right.path));
}

function buildCompositeRegionalRelease(options = {}) {
  const loadedManifest = loadRegionManifest(options);
  const packagePath = resolveWithin(loadedManifest.projectRoot, "package.json", "platform package");
  const platformPackage = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const platformVersion = String(options.platformVersion || platformPackage.version);
  const range = loadedManifest.manifest.release.platformCompatibility;
  const compatible = compareVersion(platformVersion, range.minimum) >= 0
    && compareVersion(platformVersion, range.maximumExclusive) < 0;
  const files = collectRegionFiles(loadedManifest);
  const contentDigest = sha256(stableJson({
    platformVersion,
    regionCode: loadedManifest.manifest.regionCode,
    regionVersion: loadedManifest.manifest.release.version,
    files
  }));
  const checks = deepFreeze([
    {
      id: "regionalRelease:platformCompatibility",
      passed: compatible,
      detail: `${range.minimum} <= ${platformVersion} < ${range.maximumExclusive}`
    },
    {
      id: "regionalRelease:immutableContent",
      passed: files.length >= 3 && files.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)),
      detail: `${files.length} files / sha256:${contentDigest}`
    },
    {
      id: "regionalRelease:productionEvidence",
      passed: false,
      detail: "real environment, security, joint-test, disaster-recovery and site approvals remain external"
    }
  ]);
  return deepFreeze({
    schemaVersion: "regional-composite-release-v1",
    releaseId: `core-${platformVersion}-region-${loadedManifest.manifest.regionCode}-${loadedManifest.manifest.release.version}-${contentDigest.slice(0, 12)}`,
    generatedAt: options.generatedAt || new Date().toISOString(),
    technicalReady: checks.filter((item) => item.id !== "regionalRelease:productionEvidence").every((item) => item.passed),
    productionReady: false,
    platform: {
      name: platformPackage.name,
      version: platformVersion
    },
    region: {
      code: loadedManifest.manifest.regionCode,
      name: loadedManifest.manifest.name,
      version: loadedManifest.manifest.release.version,
      manifestDigest: loadedManifest.digest
    },
    artifact: {
      algorithm: "sha256",
      digest: `sha256:${contentDigest}`,
      immutable: true,
      files
    },
    checks,
    blockers: [
      "real regional interface joint-test evidence",
      "regional security and commercial-cryptography assessment",
      "monitoring and disaster-recovery evidence",
      "signed site acceptance and production approval"
    ]
  });
}

function verifyCompositeRegionalRelease(release, options = {}) {
  const rebuilt = buildCompositeRegionalRelease({
    ...options,
    regionCode: release?.region?.code,
    platformVersion: release?.platform?.version,
    generatedAt: release?.generatedAt
  });
  const errors = [];
  if (release?.schemaVersion !== rebuilt.schemaVersion) errors.push("schemaVersion");
  if (release?.releaseId !== rebuilt.releaseId) errors.push("releaseId");
  if (stableJson(release?.platform) !== stableJson(rebuilt.platform)) errors.push("platform");
  if (stableJson(release?.region) !== stableJson(rebuilt.region)) errors.push("region");
  if (release?.artifact?.digest !== rebuilt.artifact.digest) errors.push("artifact.digest");
  if (stableJson(release?.artifact?.files) !== stableJson(rebuilt.artifact.files)) errors.push("artifact.files");
  if (stableJson(release?.checks) !== stableJson(rebuilt.checks)) errors.push("checks");
  if (release?.technicalReady !== rebuilt.technicalReady) errors.push("technicalReady");
  if (release?.productionReady !== false) errors.push("productionReady");
  return deepFreeze({
    ok: errors.length === 0,
    errors,
    expectedDigest: rebuilt.artifact.digest,
    actualDigest: release?.artifact?.digest || null
  });
}

module.exports = {
  buildCompositeRegionalRelease,
  collectRegionFiles,
  compareVersion,
  verifyCompositeRegionalRelease
};
