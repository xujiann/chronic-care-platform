"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  assessReleaseEvidenceFreshness,
  verifyReleaseEvidenceProvenance
} = require("../src/platform/governance/release-evidence-freshness");

function fixture(t, generatedAt = "2026-08-16T01:01:00.000Z") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "release"));
  fs.writeFileSync(path.join(root, "release", "one.json"), JSON.stringify({ generatedAt, ok: true }));
  return root;
}

const source = {
  sourceCommit: "a".repeat(40),
  sourceCommittedAt: "2026-08-16T01:00:00.000Z",
  sourceDirty: false,
  now: "2026-08-16T01:02:00.000Z",
  evidenceFiles: ["release/one.json"]
};

test("fresh evidence binds a clean source commit and exact document digest", (t) => {
  const root = fixture(t);
  const report = assessReleaseEvidenceFreshness({ root, ...source });
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(verifyReleaseEvidenceProvenance(report, { root, ...source }).ok, true);
});

test("stale, dirty, tampered and escaping evidence fail closed", (t) => {
  const root = fixture(t, "2026-08-16T00:59:59.000Z");
  assert.equal(assessReleaseEvidenceFreshness({ root, ...source }).ok, false);
  const cleanRoot = fixture(t);
  const report = assessReleaseEvidenceFreshness({ root: cleanRoot, ...source });
  assert.equal(assessReleaseEvidenceFreshness({ root: cleanRoot, ...source, sourceDirty: true }).ok, false);
  fs.writeFileSync(path.join(cleanRoot, "release", "one.json"), JSON.stringify({ generatedAt: "2026-08-16T01:01:30.000Z" }));
  assert.equal(verifyReleaseEvidenceProvenance(report, { root: cleanRoot, ...source }).ok, false);
  assert.throws(() => assessReleaseEvidenceFreshness({ root: cleanRoot, ...source, evidenceFiles: ["release/../package.json"] }), /invalid release evidence path/);
});
