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
  assert.equal(report.markdown.total, config.markdown.expected.total);
  assert.deepEqual(
    Object.fromEntries(Object.entries(report.markdown.byClassification).map(([key, value]) => [key, value.count])),
    Object.fromEntries(Object.entries(config.markdown.expected.byClassification).map(([key, value]) => [key, value.count]))
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
  assert.equal(
    report.markdown.entries.find((item) => item.path === "docs/adr/2026-08-30-insurance-payment-independent-product-line.md").classification,
    "current"
  );
  assert.equal(
    report.markdown.entries.find((item) => item.path === "docs/architecture/PLATFORM_FUNCTION_MAP.md").classification,
    "current"
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

test("TEST032 Markdown totals and path digests each fail closed independently", () => {
  const baseline = buildRepositoryGovernanceReport().markdown;
  assert.doesNotThrow(() => assertExpectedMarkdown(baseline, config.markdown.expected));

  const countDrift = structuredClone(baseline);
  countDrift.total += 1;
  assert.throws(() => assertExpectedMarkdown(countDrift, config.markdown.expected), {
    name: "Error",
    message: `tracked Markdown count drift: ${baseline.total + 1} != ${baseline.total}`
  });

  const pathDrift = structuredClone(baseline);
  assert.notEqual(pathDrift.pathDigest, "0".repeat(64));
  pathDrift.pathDigest = "0".repeat(64);
  assert.throws(() => assertExpectedMarkdown(pathDrift, config.markdown.expected), {
    name: "Error", message: "tracked Markdown path inventory drift"
  });

  for (const classification of ["current", "snapshot", "superseded"]) {
    for (const field of ["count", "pathDigest"]) {
      const drifted = structuredClone(baseline);
      if (field === "count") drifted.byClassification[classification].count += 1;
      else {
        assert.notEqual(drifted.byClassification[classification].pathDigest, "0".repeat(64));
        drifted.byClassification[classification].pathDigest = "0".repeat(64);
      }
      assert.throws(() => assertExpectedMarkdown(drifted, config.markdown.expected), {
        name: "Error", message: `${classification} Markdown inventory drift`
      }, `${classification}.${field}`);
    }
  }
  assert.doesNotThrow(() => assertExpectedMarkdown(baseline, config.markdown.expected));
});

test("TEST032 PDF inventory rejects a missing or extra tracked path", () => {
  const paths = config.pdf.artifacts.map((artifact) => artifact.path).sort();
  const baseline = buildPdfInventory(config, { paths });
  for (const driftedPaths of [
    paths.slice(1),
    [...paths, "output/pdf/TEST032-unregistered-synthetic.pdf"].sort()
  ]) {
    assert.throws(() => buildPdfInventory(config, { paths: driftedPaths }), {
      name: "Error", message: "tracked PDF inventory differs from the governed artifact list"
    });
  }
  assert.deepEqual(buildPdfInventory(config, { paths }), baseline);
});

test("TEST032 PDF editing policy and provenance fields each fail closed independently", () => {
  const paths = config.pdf.artifacts.map((artifact) => artifact.path).sort();
  const artifactPath = config.pdf.artifacts[0].path;
  for (const [label, mutate, message] of [
    ["manualEditAllowed", (value) => { value.pdf.manualEditAllowed = true; }, "tracked PDFs must prohibit manual editing"],
    ["retentionReason", (value) => { value.pdf.artifacts[0].retentionReason = ""; }, `${artifactPath} lacks retention or introducing commit provenance`],
    ["introducedCommit", (value) => { value.pdf.artifacts[0].introducedCommit = "not-a-commit"; }, `${artifactPath} lacks retention or introducing commit provenance`],
    ["generation.status", (value) => { value.pdf.artifacts[0].generation.status = "available"; }, `${artifactPath} must state the observed generator availability without guessing`],
    ["generation.producer", (value) => { value.pdf.artifacts[0].generation.producer = ""; }, `${artifactPath} lacks generator provenance evidence`],
    ["generation.provenanceEvidence", (value) => { value.pdf.artifacts[0].generation.provenanceEvidence = ""; }, `${artifactPath} lacks generator provenance evidence`]
  ]) {
    const drifted = structuredClone(config);
    mutate(drifted);
    assert.throws(() => buildPdfInventory(drifted, { paths }), { name: "Error", message }, label);
  }
  assert.doesNotThrow(() => buildPdfInventory(config, { paths }));
});

test("TEST032 PDF verifier and declared source paths must exist", () => {
  const paths = config.pdf.artifacts.map((artifact) => artifact.path).sort();
  for (const field of ["verifier", "sourcePaths"]) {
    const drifted = structuredClone(config);
    const missing = `test/repository-governance.test.js/TEST032-missing-${field}.js`;
    if (field === "verifier") drifted.pdf.artifacts[0].generation.verifier = missing;
    else drifted.pdf.artifacts[0].generation.sourcePaths[0] = missing;
    assert.throws(() => buildPdfInventory(drifted, { paths }), {
      name: "Error", message: `${config.pdf.artifacts[0].path} source is missing: ${missing}`
    }, field);
  }
  assert.doesNotThrow(() => buildPdfInventory(config, { paths }));
});

test("TEST032 PDF byte size and page count drift are rejected with the correct digest", () => {
  const paths = config.pdf.artifacts.map((artifact) => artifact.path).sort();
  for (const field of ["bytes", "pages"]) {
    const drifted = structuredClone(config);
    drifted.pdf.artifacts[0][field] += 1;
    assert.equal(drifted.pdf.artifacts[0].sha256, config.pdf.artifacts[0].sha256);
    const unchangedField = field === "bytes" ? "pages" : "bytes";
    assert.equal(drifted.pdf.artifacts[0][unchangedField], config.pdf.artifacts[0][unchangedField]);
    assert.throws(() => buildPdfInventory(drifted, { paths }), {
      name: "Error", message: `${config.pdf.artifacts[0].path} binary digest, size or page count drift`
    }, field);
  }
  assert.doesNotThrow(() => buildPdfInventory(config, { paths }));
});
