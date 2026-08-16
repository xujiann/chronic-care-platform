"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "release-evidence-provenance-v1";
const DEFAULT_EVIDENCE_FILES = Object.freeze([
  "release/release-report.json",
  "release/release-artifact-manifest.json",
  "release/platform-capability-map.json",
  "release/regional-configuration-readiness.json",
  "release/regional-site-evidence-readiness.json",
  "release/regional-cutover-dossier.json",
  "release/production-db-readiness-report.json",
  "release/production-security-readiness-report.json",
  "release/production-go-no-go-readiness-report.json",
  "release/production-release-evidence-readiness.json"
]);

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function normalizeCommit(value) {
  const commit = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new TypeError("source commit must be a full git SHA-1");
  return commit;
}

function resolveEvidencePath(root, relativeFile) {
  const relative = String(relativeFile || "").replace(/\\/g, "/");
  if (!/^release\/[A-Za-z0-9._/-]+\.json$/.test(relative) || relative.includes("..")) {
    throw new TypeError(`invalid release evidence path: ${relative}`);
  }
  const releaseRoot = path.resolve(root, "release");
  const target = path.resolve(root, relative);
  if (target !== releaseRoot && !target.startsWith(`${releaseRoot}${path.sep}`)) {
    throw new TypeError(`release evidence escapes release directory: ${relative}`);
  }
  return { relative, target };
}

function evidenceGeneratedAt(document) {
  return document?.generatedAt
    || document?.verifiedAt
    || document?.checkedAt
    || document?.productionDbReadiness?.generatedAt
    || document?.productionSecurity?.generatedAt
    || document?.productionGoNoGo?.generatedAt
    || "";
}

function assessReleaseEvidenceFreshness(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const sourceCommit = normalizeCommit(options.sourceCommit);
  const committedAt = Date.parse(options.sourceCommittedAt || "");
  const evaluatedAt = Date.parse(options.now || new Date().toISOString());
  if (!Number.isFinite(committedAt)) throw new TypeError("source commit timestamp is invalid");
  if (!Number.isFinite(evaluatedAt)) throw new TypeError("evaluation timestamp is invalid");
  const evidenceFiles = options.evidenceFiles || DEFAULT_EVIDENCE_FILES;
  const artifacts = evidenceFiles.map((file) => {
    const resolved = resolveEvidencePath(root, file);
    if (!fs.existsSync(resolved.target)) {
      return Object.freeze({ file: resolved.relative, present: false, validJson: false, fresh: false, digest: "", generatedAt: "" });
    }
    const stat = fs.lstatSync(resolved.target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return Object.freeze({ file: resolved.relative, present: false, validJson: false, fresh: false, digest: "", generatedAt: "" });
    }
    const bytes = fs.readFileSync(resolved.target);
    let document = null;
    try { document = JSON.parse(bytes.toString("utf8")); } catch {}
    const generatedAt = evidenceGeneratedAt(document);
    const generatedTime = Date.parse(generatedAt);
    const fresh = Number.isFinite(generatedTime)
      && generatedTime >= committedAt
      && generatedTime <= evaluatedAt + 5 * 60 * 1000;
    return Object.freeze({
      file: resolved.relative,
      present: true,
      validJson: Boolean(document && typeof document === "object"),
      fresh,
      digest: sha256(bytes),
      generatedAt
    });
  });
  const clean = options.sourceDirty !== true;
  const checks = Object.freeze([
    { id: "releaseEvidence:sourceClean", passed: clean, detail: clean ? sourceCommit : "working tree is dirty" },
    { id: "releaseEvidence:documentsPresent", passed: artifacts.every((item) => item.present), detail: `${artifacts.filter((item) => item.present).length}/${artifacts.length}` },
    { id: "releaseEvidence:documentsValid", passed: artifacts.every((item) => item.validJson), detail: `${artifacts.filter((item) => item.validJson).length}/${artifacts.length}` },
    { id: "releaseEvidence:documentsFresh", passed: artifacts.every((item) => item.fresh), detail: `${artifacts.filter((item) => item.fresh).length}/${artifacts.length} generated at or after ${new Date(committedAt).toISOString()}` }
  ]);
  const ok = checks.every((item) => item.passed);
  const body = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date(evaluatedAt).toISOString(),
    ok,
    productionReady: false,
    source: Object.freeze({ commit: sourceCommit, committedAt: new Date(committedAt).toISOString(), dirty: !clean }),
    summary: Object.freeze({ artifacts: artifacts.length, present: artifacts.filter((item) => item.present).length, fresh: artifacts.filter((item) => item.fresh).length }),
    artifacts: Object.freeze(artifacts),
    checks,
    boundary: "Fresh repository evidence proves source provenance only; it cannot authorize production deployment."
  };
  return Object.freeze({ ...body, provenanceDigest: sha256(JSON.stringify(body)) });
}

function verifyReleaseEvidenceProvenance(provenance, options = {}) {
  if (provenance?.schemaVersion !== SCHEMA_VERSION) throw new TypeError("release evidence provenance schema is invalid");
  const current = assessReleaseEvidenceFreshness({
    ...options,
    evidenceFiles: provenance.artifacts.map((item) => item.file)
  });
  const expected = new Map(provenance.artifacts.map((item) => [item.file, item.digest]));
  const digestMatches = current.artifacts.every((item) => expected.get(item.file) === item.digest);
  const commitMatches = current.source.commit === provenance.source?.commit;
  return Object.freeze({
    schemaVersion: "release-evidence-provenance-verification-v1",
    ok: current.ok && provenance.ok === true && digestMatches && commitMatches,
    productionReady: false,
    sourceCommit: current.source.commit,
    checks: Object.freeze([
      ...current.checks,
      { id: "releaseEvidence:commitBinding", passed: commitMatches, detail: current.source.commit },
      { id: "releaseEvidence:digestBinding", passed: digestMatches, detail: `${current.artifacts.length} evidence digests checked` }
    ])
  });
}

module.exports = {
  DEFAULT_EVIDENCE_FILES,
  SCHEMA_VERSION,
  assessReleaseEvidenceFreshness,
  verifyReleaseEvidenceProvenance
};
