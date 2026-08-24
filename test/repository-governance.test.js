"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertExpectedMarkdown,
  buildPdfInventory,
  buildRepositoryGovernanceReport,
  canonicalTextSha256,
  classifyMarkdown,
  loadConfig,
  parseGitPaths,
  verifyWorkflow
} = require("../scripts/repository-governance");
const processManifest = require("../config/process-workstreams.json");

const config = loadConfig();

test("Git path inventory preserves non-ASCII and delimiter-sensitive names", () => {
  assert.deepEqual(
    parseGitPaths("docs/路由模块化与并行开发边界-2026-08-03.md\0docs/name with spaces.md\0"),
    ["docs/name with spaces.md", "docs/路由模块化与并行开发边界-2026-08-03.md"]
  );
});

test("Markdown snapshot digests are invariant across checkout line endings", () => {
  assert.equal(canonicalTextSha256("第一行\r\n第二行\r\n"), canonicalTextSha256("第一行\n第二行\n"));
  assert.notEqual(canonicalTextSha256("第一行\n第二行\n"), canonicalTextSha256("第一行\n内容已改变\n"));
});

test("every governed Markdown path is classified once and the closed inventory is current", () => {
  const report = buildRepositoryGovernanceReport();
  assert.equal(report.ok, true);
  assert.equal(report.markdown.total, 265);
  assert.deepEqual(
    Object.fromEntries(Object.entries(report.markdown.byClassification).map(([key, value]) => [key, value.count])),
    { current: 196, snapshot: 68, superseded: 1 }
  );
  assert.equal(report.markdown.entries.length, new Set(report.markdown.entries.map((item) => item.path)).size);
  assert.equal(report.markdown.entries.every((item) => ["current", "snapshot", "superseded"].includes(item.classification)), true);
  assert.equal(
    report.markdown.entries.find((item) => item.path === "docs/路由模块化与并行开发边界-2026-08-03.md").classification,
    "snapshot"
  );
  assert.equal(
    report.markdown.entries.find((item) => item.path === "docs/adr/2026-08-19-ci-comprehensive-test-time-budget.md").classification,
    "superseded"
  );
});

test("Markdown governance rejects overlapping rules and snapshot content drift", () => {
  const overlapping = structuredClone(config.markdown);
  overlapping.rules.push({
    id: "forged-second-current-rule",
    classification: "current",
    exactPaths: ["AGENTS.md"]
  });
  assert.throws(() => classifyMarkdown(["AGENTS.md"], overlapping), /exactly one markdown rule/);

  const report = buildRepositoryGovernanceReport();
  assert.throws(() => assertExpectedMarkdown({
    ...report.markdown,
    snapshotContentDigest: "0".repeat(64)
  }, config.markdown.expected), /snapshot content drift/);
});

test("current workflow uses origin main while the immutable tag is evidence-only", () => {
  const workflow = verifyWorkflow(config);
  assert.equal(workflow.integrationBranch, "main");
  assert.equal(workflow.developmentBase, "origin/main");
  assert.notEqual(workflow.developmentBase, workflow.evidenceBaselineTag);
  assert.equal(workflow.mergeDirection, "process-branch-to-main");

  const staleManifest = structuredClone(processManifest);
  staleManifest.developmentBase = staleManifest.baselineTag;
  staleManifest.developmentPolicy.mergeDirection = "process-branch-to-integration-branch";
  assert.throws(() => verifyWorkflow(config, { processManifest: staleManifest }), /workflow drifted/);

  const staleProgram = require("../config/platform-iteration-program.json");
  assert.throws(() => verifyWorkflow(config, {
    iterationProgram: { ...staleProgram, developmentBase: staleProgram.baselineTag }
  }), /baseline purpose drifted/);
});

test("all tracked PDFs are immutable digest-bound historical artifacts with honest generator status", () => {
  const report = buildPdfInventory(config);
  assert.equal(report.manualEditAllowed, false);
  assert.equal(report.entries.length, 3);
  assert.deepEqual(report.entries.map((item) => item.pages), [2, 5, 4]);
  assert.equal(config.pdf.artifacts.every((item) => item.generation.status === "untracked-historical"), true);
  assert.equal(config.pdf.artifacts.every((item) => item.retentionReason && item.generation.provenanceEvidence), true);

  const forged = structuredClone(config);
  forged.pdf.artifacts[0].sha256 = "0".repeat(64);
  assert.throws(() => buildPdfInventory(forged), /binary digest, size or page count drift/);
});
