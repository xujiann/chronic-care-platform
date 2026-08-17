"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildProductionDeploymentPackage } = require("../scripts/production-deployment-package");
const { createBackup } = require("../scripts/storage-admin");
const {
  emptyRegistry,
  isControlledBaselineTransition,
  parseArgs,
  registerRelease,
  renderMarkdown,
  resolveIntegrationBaseline,
  verifyRegistry
} = require("../scripts/release-registry");

const ROOT = path.resolve(__dirname, "..");

test("only a dated T00 baseline branch may bridge an unpublished governance tag", () => {
  assert.equal(isControlledBaselineTransition("process/t00-enhancement-baseline-20260817"), true);
  assert.equal(isControlledBaselineTransition("main"), false);
  assert.equal(isControlledBaselineTransition("process/t02-enhancement-baseline-20260817"), false);
  assert.equal(isControlledBaselineTransition("process/t00-enhancement-baseline-latest"), false);
});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-registry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "db.json"), JSON.stringify({
    residents: [{ id: "r1", name: "Demo" }],
    careOrders: [{ id: "o1", residentId: "r1" }]
  }), "utf8");
  fs.writeFileSync(path.join(root, "data", "health-city.sqlite"), "sqlite-fixture", "utf8");
  const backup = createBackup({
    dataDir: path.join(root, "data"),
    backupRoot: path.join(root, "data", "backups"),
    label: "test"
  });
  return { root, backup };
}

function manifestFixture(sourceSha = "a".repeat(40), releaseId = "release-registry-001") {
  return buildProductionDeploymentPackage({
    root: ROOT,
    source: { commit: sourceSha, dirty: false },
    releaseId
  });
}

test("release registry binds one baseline, source SHA, artifact digest and immutable identity", (t) => {
  const { root, backup } = fixture(t);
  const manifest = manifestFixture();
  const registryPath = path.join(root, "release", "registry.json");
  const markdownPath = path.join(root, "release", "registry.md");
  const first = registerRelease({
    root: ROOT,
    manifest,
    backupDir: backup.destination,
    registryPath,
    markdownPath,
    registeredAt: "2026-08-03T00:00:00.000Z"
  });
  const second = registerRelease({
    root: ROOT,
    manifest,
    backupDir: backup.destination,
    registryPath,
    markdownPath
  });

  assert.equal(first.created, true);
  assert.equal(first.verification.ok, true);
  assert.deepEqual(first.registry.integrationBaseline, resolveIntegrationBaseline(ROOT));
  assert.equal(first.entry.sourceSha, "a".repeat(40));
  assert.equal(first.entry.sourceDirty, false);
  assert.deepEqual(first.entry.source, { commit: "a".repeat(40), dirty: false });
  assert.equal(first.entry.artifactDigest, manifest.artifact.digest);
  assert.match(first.entry.identityDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(first.entry.entryDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.entry.backup.dataQualityPassed, true);
  assert.equal(first.entry.externalAttestation.recorded, false);
  assert.equal(second.created, false);
  assert.deepEqual(second.entry, first.entry);
  assert.equal(second.verification.checks.find((item) => item.id === "registry:deployment-package-binding").passed, true);
  assert.match(fs.readFileSync(markdownPath, "utf8"), /does not replace the production artifact registry/);
});

test("release registry rejects dirty, abbreviated, and mutable source identities", (t) => {
  const { backup } = fixture(t);
  const dirty = manifestFixture();
  dirty.source.dirty = true;
  assert.throws(() => registerRelease({
    root: ROOT,
    manifest: dirty,
    backupDir: backup.destination,
    registry: emptyRegistry(),
    write: false
  }), /source must be clean/);

  const abbreviated = manifestFixture("abc123", "release-registry-short-sha");
  assert.throws(() => registerRelease({
    root: ROOT,
    manifest: abbreviated,
    backupDir: backup.destination,
    registry: emptyRegistry(),
    write: false
  }), /full 40 or 64 character Git SHA/);

  const original = registerRelease({
    root: ROOT,
    manifest: manifestFixture(),
    backupDir: backup.destination,
    registry: emptyRegistry(),
    write: false
  });
  const changedSource = manifestFixture("b".repeat(40));
  assert.throws(() => registerRelease({
    root: ROOT,
    manifest: changedSource,
    backupDir: backup.destination,
    registry: original.registry,
    write: false
  }), /Immutable release identity collision/);
});

test("one artifact digest cannot be rebound to a different release id", (t) => {
  const { backup } = fixture(t);
  const first = registerRelease({
    root: ROOT,
    manifest: manifestFixture(),
    backupDir: backup.destination,
    registry: emptyRegistry(),
    write: false
  });
  const secondRelease = manifestFixture("a".repeat(40), "release-registry-002");
  assert.equal(secondRelease.artifact.digest, first.entry.artifactDigest);
  assert.throws(() => registerRelease({
    root: ROOT,
    manifest: secondRelease,
    backupDir: backup.destination,
    registry: first.registry,
    write: false
  }), /Artifact digest is already bound/);
});

test("registry verification detects baseline, chain, package binding, and attestation tampering", (t) => {
  const { backup } = fixture(t);
  const manifest = manifestFixture();
  const result = registerRelease({
    root: ROOT,
    manifest,
    backupDir: backup.destination,
    registry: emptyRegistry(),
    write: false,
    registeredAt: "2026-08-03T00:00:00.000Z"
  });

  const sourceTampered = structuredClone(result.registry);
  sourceTampered.entries[0].sourceSha = "c".repeat(40);
  assert.equal(verifyRegistry(sourceTampered, {
    root: ROOT,
    verifyBackups: false,
    manifest
  }).ok, false);

  const baselineTampered = structuredClone(result.registry);
  baselineTampered.integrationBaseline.commit = "d".repeat(40);
  assert.equal(verifyRegistry(baselineTampered, {
    root: ROOT,
    verifyBackups: false,
    manifest
  }).checks.find((item) => item.id === "registry:unique-baseline").passed, false);

  const attestationTampered = structuredClone(result.registry);
  attestationTampered.entries[0].externalAttestation.recorded = true;
  assert.equal(verifyRegistry(attestationTampered, {
    root: ROOT,
    verifyBackups: false
  }).checks.find((item) => item.id === "registry:entry-1:attestation-shape").passed, false);
});

test("release registry parser and markdown expose the external evidence boundary", () => {
  assert.deepEqual(parseArgs(["verify", "--registry=release/registry.json"]), {
    command: "verify",
    flags: { registry: "release/registry.json" }
  });
  const registry = emptyRegistry();
  const markdown = renderMarkdown(registry, {
    ok: false,
    checks: [{ id: "registry:entries", passed: false, detail: "0 registered releases" }]
  });
  assert.match(markdown, /controlled site evidence/i);
  assert.match(markdown, /0 registered releases/);
});
