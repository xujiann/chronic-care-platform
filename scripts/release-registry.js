#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const { verifyProductionDeploymentPackage } = require("./production-deployment-package");
const { verifyBackup } = require("./storage-admin");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PACKAGE = path.join(ROOT, "release", "production-deployment-package.json");
const DEFAULT_REGISTRY = path.join(ROOT, "release", "local-artifact-registry.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "local-artifact-registry.md");
const REGISTRY_SCHEMA = "local-artifact-registry-v2";
const SHA_PATTERN = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeRelative(root, target) {
  const relative = path.relative(root, target).replaceAll("\\", "/");
  return relative.startsWith("../") ? path.resolve(target).replaceAll("\\", "/") : relative;
}

function gitResolve(root, reference) {
  const result = spawnSync("git", ["rev-parse", "--verify", `${reference}^{commit}`], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(`Release baseline cannot be resolved: ${reference}`);
  return result.stdout.trim().toLowerCase();
}

function resolveIntegrationBaseline(root = ROOT) {
  const manifestPath = path.join(root, "config", "process-workstreams.json");
  if (!fs.existsSync(manifestPath)) throw new Error("Process workstream manifest is required for release baseline binding");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const integrationBranch = String(manifest.integrationBranch || "").trim();
  const tag = String(manifest.baselineTag || "").trim();
  if (integrationBranch !== "main" || !tag) {
    throw new Error("Release registry requires main as the unique integration branch and one baseline tag");
  }
  const commit = gitResolve(root, tag);
  if (!SHA_PATTERN.test(commit)) throw new Error("Release baseline must resolve to a full Git SHA");
  return Object.freeze({ integrationBranch, tag, commit });
}

function emptyRegistry(project = "chronic-care-platform", options = {}) {
  return {
    schemaVersion: REGISTRY_SCHEMA,
    project,
    externalImmutableRegistryRequired: true,
    integrationBaseline: structuredClone(options.integrationBaseline || resolveIntegrationBaseline(options.root || ROOT)),
    entries: []
  };
}

function readRegistry(file = DEFAULT_REGISTRY, project, options = {}) {
  if (!fs.existsSync(file)) return emptyRegistry(project, options);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function findLatestBackup(backupRoot = path.join(ROOT, "data", "backups")) {
  if (!fs.existsSync(backupRoot)) return "";
  return fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(backupRoot, entry.name, "manifest.json")))
    .map((entry) => {
      const directory = path.join(backupRoot, entry.name);
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
        return { directory, createdAt: Date.parse(manifest.createdAt || "") || 0 };
      } catch {
        return { directory, createdAt: 0 };
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.directory.localeCompare(a.directory))[0]?.directory || "";
}

function buildBackupEvidence(backupDir, root = ROOT) {
  const directory = path.resolve(backupDir);
  const verified = verifyBackup(directory);
  const manifestPath = path.join(directory, "manifest.json");
  return {
    directory: normalizeRelative(root, directory),
    manifestSha256: sha256(fs.readFileSync(manifestPath)),
    createdAt: verified.createdAt,
    files: verified.files.map((item) => ({
      name: item.name,
      bytes: item.bytes,
      sha256: item.sha256
    })),
    dataQualityPassed: verified.dataQuality?.passed === true
  };
}

function releaseIdentityPayload({ releaseId, sourceSha, artifactDigest, baseline }) {
  return {
    releaseId: String(releaseId || ""),
    sourceSha: String(sourceSha || "").toLowerCase(),
    artifactDigest: String(artifactDigest || "").toLowerCase(),
    baseline: {
      integrationBranch: String(baseline?.integrationBranch || ""),
      tag: String(baseline?.tag || ""),
      commit: String(baseline?.commit || "").toLowerCase()
    }
  };
}

function releaseIdentityDigest(value) {
  return `sha256:${sha256(stableStringify(releaseIdentityPayload(value)))}`;
}

function entryPayload(entry) {
  const { entryDigest, ...payload } = entry;
  return payload;
}

function validExternalAttestation(attestation) {
  if (attestation?.recorded !== true) return false;
  return /^controlled:\/\/[A-Za-z0-9._/-]+$/.test(String(attestation.evidenceRef || ""))
    && DIGEST_PATTERN.test(String(attestation.evidenceDigest || "").toLowerCase())
    && Boolean(Date.parse(attestation.recordedAt || ""))
    && Boolean(String(attestation.recordedBy || "").trim());
}

function baselineEqual(left, right) {
  return stableStringify(left || {}) === stableStringify(right || {});
}

function verifyRegistry(registry, options = {}) {
  const root = options.root || ROOT;
  const verifyBackups = options.verifyBackups !== false;
  const expectedBaseline = options.integrationBaseline || resolveIntegrationBaseline(root);
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const checks = [];
  const seenReleaseIds = new Set();
  const releaseByArtifact = new Map();
  let previousEntryDigest = "";

  checks.push({
    id: "registry:schema",
    passed: registry?.schemaVersion === REGISTRY_SCHEMA,
    detail: registry?.schemaVersion || "missing"
  });
  checks.push({
    id: "registry:external-boundary",
    passed: registry?.externalImmutableRegistryRequired === true,
    detail: registry?.externalImmutableRegistryRequired === true
      ? "local chain does not replace an external immutable registry"
      : "external registry boundary missing"
  });
  checks.push({
    id: "registry:unique-baseline",
    passed: baselineEqual(registry?.integrationBaseline, expectedBaseline),
    detail: `${registry?.integrationBaseline?.integrationBranch || "missing"}:${registry?.integrationBaseline?.tag || "missing"}@${registry?.integrationBaseline?.commit || "missing"}`
  });

  entries.forEach((entry, index) => {
    const expectedEntryDigest = sha256(stableStringify(entryPayload(entry)));
    const releaseId = String(entry.releaseId || "");
    const sourceSha = String(entry.sourceSha || "").toLowerCase();
    const artifactDigest = String(entry.artifactDigest || "").toLowerCase();
    const uniqueReleaseId = Boolean(releaseId) && !seenReleaseIds.has(releaseId);
    seenReleaseIds.add(releaseId);
    const existingArtifactRelease = releaseByArtifact.get(artifactDigest);
    const artifactIdentityUnique = !existingArtifactRelease || existingArtifactRelease === releaseId;
    if (artifactDigest) releaseByArtifact.set(artifactDigest, releaseId);
    const expectedIdentityDigest = releaseIdentityDigest({
      releaseId,
      sourceSha,
      artifactDigest,
      baseline: entry.baseline
    });
    const chainReady = entry.sequence === index + 1
      && String(entry.previousEntryDigest || "") === previousEntryDigest
      && entry.entryDigest === expectedEntryDigest;
    const sourceReady = SHA_PATTERN.test(sourceSha)
      && entry.sourceDirty === false
      && entry.source?.commit === sourceSha
      && entry.source?.dirty === false;
    const artifactReady = DIGEST_PATTERN.test(artifactDigest);
    const identityReady = entry.identityDigest === expectedIdentityDigest
      && baselineEqual(entry.baseline, registry.integrationBaseline);
    let backupReady = Boolean(entry.backup?.manifestSha256 && entry.backup?.dataQualityPassed);
    let backupDetail = entry.backup?.directory || "missing";
    if (verifyBackups && backupReady) {
      try {
        const backupPath = path.isAbsolute(entry.backup.directory)
          ? entry.backup.directory
          : path.join(root, entry.backup.directory);
        const current = buildBackupEvidence(backupPath, root);
        backupReady = current.manifestSha256 === entry.backup.manifestSha256
          && current.dataQualityPassed
          && stableStringify(current.files) === stableStringify(entry.backup.files);
      } catch (error) {
        backupReady = false;
        backupDetail = error.message;
      }
    }
    const attestationReady = entry.externalAttestation?.recorded !== true
      || validExternalAttestation(entry.externalAttestation);
    checks.push({ id: `registry:entry-${index + 1}:chain`, passed: chainReady, detail: releaseId || "missing release id" });
    checks.push({ id: `registry:entry-${index + 1}:release-id`, passed: uniqueReleaseId, detail: releaseId || "missing release id" });
    checks.push({ id: `registry:entry-${index + 1}:source`, passed: sourceReady, detail: `${sourceSha || "missing"} / dirty=${entry.sourceDirty}` });
    checks.push({ id: `registry:entry-${index + 1}:artifact`, passed: artifactReady, detail: artifactDigest || "missing" });
    checks.push({ id: `registry:entry-${index + 1}:artifact-identity`, passed: artifactIdentityUnique, detail: existingArtifactRelease ? `${artifactDigest} already bound to ${existingArtifactRelease}` : artifactDigest });
    checks.push({ id: `registry:entry-${index + 1}:immutable-identity`, passed: identityReady, detail: entry.identityDigest || "missing" });
    checks.push({ id: `registry:entry-${index + 1}:backup`, passed: backupReady, detail: backupDetail });
    checks.push({ id: `registry:entry-${index + 1}:attestation-shape`, passed: attestationReady, detail: entry.externalAttestation?.recorded ? entry.externalAttestation.evidenceRef || "invalid" : "not recorded" });
    previousEntryDigest = String(entry.entryDigest || "");
  });

  if (options.manifest) {
    const manifest = options.manifest;
    const matching = entries.find((entry) => entry.releaseId === manifest.releaseId);
    const exact = Boolean(matching)
      && matching.sourceSha === String(manifest.source?.commit || "").toLowerCase()
      && matching.sourceDirty === false
      && matching.source?.commit === String(manifest.source?.commit || "").toLowerCase()
      && matching.source?.dirty === false
      && manifest.source?.dirty === false
      && matching.artifactDigest === String(manifest.artifact?.digest || "").toLowerCase()
      && matching.identityDigest === releaseIdentityDigest({
        releaseId: manifest.releaseId,
        sourceSha: manifest.source?.commit,
        artifactDigest: manifest.artifact?.digest,
        baseline: registry.integrationBaseline
      });
    checks.push({
      id: "registry:deployment-package-binding",
      passed: exact,
      detail: matching ? `${matching.releaseId}@${matching.sourceSha}/${matching.artifactDigest}` : "current deployment package is not registered"
    });
  }

  checks.push({
    id: "registry:entries",
    passed: entries.length > 0,
    detail: `${entries.length} registered release${entries.length === 1 ? "" : "s"}`
  });
  return {
    ok: checks.every((item) => item.passed),
    verifiedAt: new Date().toISOString(),
    entries: entries.length,
    latestReleaseId: entries.at(-1)?.releaseId || "",
    latestEntryDigest: entries.at(-1)?.entryDigest || "",
    integrationBaseline: registry?.integrationBaseline || null,
    externalImmutableRegistryRequired: registry?.externalImmutableRegistryRequired === true,
    checks
  };
}

function validateManifestIdentity(manifest) {
  const sourceSha = String(manifest?.source?.commit || "").toLowerCase();
  if (!SHA_PATTERN.test(sourceSha)) throw new Error("Deployment package source.commit must be a full 40 or 64 character Git SHA");
  if (manifest?.source?.dirty !== false) throw new Error("Deployment package source must be clean before release registration");
  if (!DIGEST_PATTERN.test(String(manifest?.artifact?.digest || "").toLowerCase())) {
    throw new Error("Deployment package artifact digest must be sha256:<64-hex>");
  }
  if (!String(manifest?.releaseId || "").trim()) throw new Error("Deployment package releaseId is required");
  return sourceSha;
}

function registerRelease(options = {}) {
  const root = options.root || ROOT;
  const packagePath = path.resolve(options.packagePath || DEFAULT_PACKAGE);
  const registryPath = path.resolve(options.registryPath || DEFAULT_REGISTRY);
  const markdownPath = path.resolve(options.markdownPath || DEFAULT_MARKDOWN);
  const manifest = options.manifest || JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const packageVerification = verifyProductionDeploymentPackage(manifest, { root });
  if (!manifest.ok || !packageVerification.ok) throw new Error("Deployment package integrity verification failed");
  const sourceSha = validateManifestIdentity(manifest);
  const baseline = options.integrationBaseline || resolveIntegrationBaseline(root);

  const backupDir = path.resolve(options.backupDir || findLatestBackup(path.join(root, "data", "backups")));
  if (!backupDir || !fs.existsSync(backupDir)) throw new Error("A verified storage backup is required before release registration");
  const backup = buildBackupEvidence(backupDir, root);
  const registry = options.registry || readRegistry(registryPath, options.project || "chronic-care-platform", { root, integrationBaseline: baseline });
  if (!baselineEqual(registry.integrationBaseline, baseline)) {
    throw new Error("Existing registry is bound to a different integration baseline");
  }
  if (registry.entries.length) {
    const currentVerification = verifyRegistry(registry, { root, verifyBackups: options.verifyBackups, integrationBaseline: baseline });
    if (!currentVerification.ok) throw new Error("Existing release registry chain verification failed");
  }

  const artifactCollision = registry.entries.find((item) => (
    item.artifactDigest === manifest.artifact.digest && item.releaseId !== manifest.releaseId
  ));
  if (artifactCollision) {
    throw new Error(`Artifact digest is already bound to release ID ${artifactCollision.releaseId}`);
  }
  const identityDigest = releaseIdentityDigest({
    releaseId: manifest.releaseId,
    sourceSha,
    artifactDigest: manifest.artifact.digest,
    baseline
  });
  const existing = registry.entries.find((item) => item.releaseId === manifest.releaseId);
  if (existing) {
    if (existing.identityDigest !== identityDigest
      || existing.sourceSha !== sourceSha
      || existing.source?.commit !== sourceSha
      || existing.source?.dirty !== false
      || existing.artifactDigest !== manifest.artifact.digest) {
      throw new Error(`Immutable release identity collision: ${manifest.releaseId}`);
    }
    return {
      created: false,
      entry: existing,
      registry,
      verification: verifyRegistry(registry, { root, verifyBackups: options.verifyBackups, integrationBaseline: baseline, manifest })
    };
  }

  const previous = registry.entries.at(-1);
  const payload = {
    sequence: registry.entries.length + 1,
    releaseId: manifest.releaseId,
    sourceSha,
    sourceDirty: false,
    source: {
      commit: sourceSha,
      dirty: false
    },
    artifactDigest: manifest.artifact.digest,
    baseline: structuredClone(baseline),
    identityDigest,
    registeredAt: options.registeredAt || new Date().toISOString(),
    backup,
    previousReleaseId: previous?.releaseId || "",
    previousArtifactDigest: previous?.artifactDigest || "",
    previousEntryDigest: previous?.entryDigest || "",
    state: "software-candidate",
    externalAttestation: {
      required: true,
      recorded: false,
      evidenceRef: "",
      evidenceDigest: "",
      recordedAt: "",
      recordedBy: ""
    }
  };
  const entry = { ...payload, entryDigest: sha256(stableStringify(payload)) };
  registry.entries.push(entry);

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    const temporary = `${registryPath}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(registry, null, 2), "utf8");
    fs.renameSync(temporary, registryPath);
    fs.mkdirSync(path.dirname(markdownPath), { recursive: true });
    fs.writeFileSync(markdownPath, renderMarkdown(registry), "utf8");
  }

  return {
    created: true,
    entry,
    registry,
    verification: verifyRegistry(registry, { root, verifyBackups: options.verifyBackups, integrationBaseline: baseline, manifest })
  };
}

function renderMarkdown(registry, verification = verifyRegistry(registry, { verifyBackups: false })) {
  const rows = registry.entries.map((entry) => `| ${entry.sequence} | ${entry.releaseId} | ${entry.sourceSha} | ${entry.artifactDigest} | ${entry.state} |`);
  const checks = verification.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail).replaceAll("|", "/")} |`);
  return [
    "# Local release artifact registry",
    "",
    `- Result: ${verification.ok ? "PASS" : "FAIL"}`,
    `- Releases: ${registry.entries.length}`,
    `- Unique integration baseline: ${registry.integrationBaseline?.integrationBranch || "missing"} / ${registry.integrationBaseline?.tag || "missing"} / ${registry.integrationBaseline?.commit || "missing"}`,
    "- Boundary: this hash-chained local ledger verifies immutable release identity but does not replace the production artifact registry, signing service, controlled site evidence, or formal approval.",
    "",
    "## Releases",
    "",
    "| Sequence | Release ID | Source SHA | Artifact digest | State |",
    "|---:|---|---|---|---|",
    ...rows,
    "",
    "## Verification",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checks,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "register", ...args] = argv;
  const flags = {};
  args.forEach((arg) => {
    if (!arg.startsWith("--")) return;
    const [key, ...rest] = arg.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return { command, flags };
}

function runCli() {
  const { command, flags } = parseArgs();
  const registryPath = path.resolve(ROOT, String(flags.registry || DEFAULT_REGISTRY));
  const markdownPath = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  if (command === "register") {
    const result = registerRelease({
      packagePath: flags.package,
      backupDir: flags.backup,
      registryPath,
      markdownPath
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.verification.ok) process.exitCode = 1;
    return;
  }
  const registry = readRegistry(registryPath);
  if (command === "verify") {
    const verification = verifyRegistry(registry);
    console.log(JSON.stringify(verification, null, 2));
    if (!verification.ok) process.exitCode = 1;
    return;
  }
  if (command === "latest") {
    console.log(JSON.stringify(registry.entries.at(-1) || null, null, 2));
    return;
  }
  throw new Error("Usage: release-registry.js register [--package=path] [--backup=dir] [--registry=path] [--markdown=path] | verify [--registry=path] | latest [--registry=path]");
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DIGEST_PATTERN,
  REGISTRY_SCHEMA,
  SHA_PATTERN,
  buildBackupEvidence,
  emptyRegistry,
  findLatestBackup,
  parseArgs,
  readRegistry,
  registerRelease,
  releaseIdentityDigest,
  renderMarkdown,
  resolveIntegrationBaseline,
  stableStringify,
  validExternalAttestation,
  verifyRegistry
};
