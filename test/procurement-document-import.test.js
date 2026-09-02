"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildControlledImportBatch,
  buildControlledImportDocument,
  inspectPdf,
  preflightPdfSource,
  withinRoot
} = require("../src/platform/productization/procurement-document-import");
const { main: runImportCli, validateBatchAggregates, validateBatchManifest, writeResult } = require("../scripts/procurement-requirement-import");

function controlledPdfFixture(t, body = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "procurement-pdf-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, "source.pdf");
  fs.writeFileSync(filePath, body);
  return { body: Buffer.from(body), filePath, root };
}

function extractionManifest(overrides = {}) {
  return {
    schemaVersion: "procurement-pdf-extraction-v2",
    seriesId: "SRC-000000000003",
    revision: 1,
    supersedesDocumentId: null,
    reviewedPageCount: 12,
    extractionMode: "human-verified-pages",
    textQuality: "reviewable",
    candidates: [{
      id: "PR-SAMPLE-003-R001",
      logicalRequirementId: "REQ-000000000006",
      semanticDigest: `sha256:${"6".repeat(64)}`,
      sourceAnchor: { pageStart: 2, pageEnd: 4, sectionCode: "SEC-SERVICE" },
      targetCapabilityIds: ["C-DATA-PLATFORM"],
      productClass: "CORE",
      decision: "ENHANCE",
      priority: "P0",
      ownerProcess: "T02",
      evidenceStatus: "source-verified"
    }],
    ...overrides
  };
}

test("controlled PDF inspection verifies identity, digest and fail-closed metadata", (t) => {
  const fixture = controlledPdfFixture(t);
  const source = preflightPdfSource(fixture.filePath, { allowedRoot: fixture.root, maximumPdfBytes: 1024 });
  const inspection = inspectPdf(fixture.filePath, { allowedRoot: fixture.root, maximumPdfBytes: 1024, expectedIdentity: source.identity });
  assert.equal(inspection.sha256, `sha256:${crypto.createHash("sha256").update(fixture.body).digest("hex")}`);
  assert.equal(inspection.mediaType, "application/pdf");
  assert.equal(inspection.byteSize, fixture.body.length);
  assert.equal(inspection.securityStatus, "unscanned-external-source");
  assert.equal(inspection.scanEvidenceDigest, null);
  assert.equal(inspection.productionReady, false);
  assert.equal(Object.isFrozen(inspection), true);
  assert.match(source.pathIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(source, "realPath"), false);
  assert.throws(
    () => inspectPdf(fixture.filePath, { allowedRoot: fixture.root, expectedIdentity: { ...source.identity, size: source.identity.size + 1 } }),
    /changed after batch preflight/
  );
});

test("controlled PDF inspection rejects paths outside the allowlist and active content", (t) => {
  const safe = controlledPdfFixture(t);
  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "procurement-pdf-other-"));
  t.after(() => fs.rmSync(otherRoot, { recursive: true, force: true }));
  assert.equal(withinRoot(safe.filePath, safe.root), true);
  assert.equal(withinRoot(safe.filePath, otherRoot), false);
  assert.throws(() => inspectPdf(safe.filePath, { allowedRoot: otherRoot }), /outside the allowlisted source root/);

  const active = controlledPdfFixture(t, "%PDF-1.4\n1 0 obj<</OpenAction 2 0 R>>endobj\n%%EOF\n");
  assert.throws(
    () => inspectPdf(active.filePath, { allowedRoot: active.root }),
    (error) => error.code === "PROCUREMENT_PDF_ACTIVE_CONTENT" && error.markers.includes("/OpenAction")
  );
});

test("controlled import creates a path-free document and validates capability mappings", (t) => {
  const fixture = controlledPdfFixture(t);
  const inspection = inspectPdf(fixture.filePath, { allowedRoot: fixture.root });
  const document = buildControlledImportDocument(inspection, extractionManifest());
  assert.equal(document.id, `DOC-${inspection.sha256.slice(7, 19).toUpperCase()}`);
  assert.equal(document.sourceAlias, "需求来源 000000000003");
  assert.equal(document.seriesId, "SRC-000000000003");
  assert.equal(document.candidates[0].targetCapabilityIds[0], "C-DATA-PLATFORM");
  assert.equal(JSON.stringify(document).includes(fixture.root), false);
  assert.equal(document.status, "candidate-review");

  assert.throws(
    () => buildControlledImportDocument(inspection, extractionManifest({ sourceAlias: "C:\\source\\document.pdf" })),
    /unknown fields: sourceAlias/
  );
  assert.throws(
    () => buildControlledImportDocument(inspection, extractionManifest({
      candidates: [{ ...extractionManifest().candidates[0], targetCapabilityIds: ["UNKNOWN-CAPABILITY"] }]
    })),
    /unregistered capability/
  );
});

test("controlled paths reject forward-slash network and device namespaces before filesystem access", (t) => {
  const fixture = controlledPdfFixture(t);
  for (const unsafe of ["//server/share/source.pdf", "//?/C:/source.pdf"]) {
    assert.throws(() => preflightPdfSource(unsafe, { allowedRoot: fixture.root }), /device or network namespace/);
    assert.throws(() => writeResult(unsafe, { ok: true }), /device or network namespace/);
  }
});

test("controlled paths reject network namespaces after real-path resolution", (t) => {
  const fixture = controlledPdfFixture(t);
  const originalRealpath = fs.realpathSync.native;
  try {
    fs.realpathSync.native = (value) => path.resolve(value) === path.resolve(fixture.root) ? "//server/share" : originalRealpath(value);
    assert.throws(() => preflightPdfSource(fixture.filePath, { allowedRoot: fixture.root }), /resolved allowlisted source root path must not use a device or network namespace/);
  } finally {
    fs.realpathSync.native = originalRealpath;
  }
  const outputPath = path.join(fixture.root, "resolved-output.json");
  try {
    fs.realpathSync.native = (value) => path.resolve(value) === path.resolve(fixture.root) ? "//server/share" : originalRealpath(value);
    assert.throws(() => writeResult(outputPath, { ok: true }), /resolved output parent path must not use a device or network namespace/);
  } finally {
    fs.realpathSync.native = originalRealpath;
  }
});

test("controlled PDF inspection rejects a parent link that resolves outside the source root", (t) => {
  const allowed = controlledPdfFixture(t);
  const external = controlledPdfFixture(t, "%PDF-1.4\n1 0 obj<</Type/Catalog /External true>>endobj\n%%EOF\n");
  const linkedDirectory = path.join(allowed.root, "linked-source");
  try {
    fs.symlinkSync(external.root, linkedDirectory, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`directory links are unavailable in this environment: ${error.code || error.message}`);
    return;
  }
  t.after(() => {
    try { fs.unlinkSync(linkedDirectory); } catch {}
  });
  assert.throws(
    () => inspectPdf(path.join(linkedDirectory, "source.pdf"), { allowedRoot: allowed.root }),
    /outside the allowlisted source root/
  );
});

test("controlled PDF inspection fails closed for scanner policy and binds clean attestations", (t) => {
  const fixture = controlledPdfFixture(t);
  assert.throws(
    () => inspectPdf(fixture.filePath, { allowedRoot: fixture.root, scanPolicy: "required-clean" }),
    (error) => error.code === "PROCUREMENT_PDF_SCAN_REQUIRED"
  );
  const inspection = inspectPdf(fixture.filePath, {
    allowedRoot: fixture.root,
    scanPolicy: "required-clean",
    scanPdf: ({ sha256, byteSize, mediaType }) => ({
      verdict: "clean",
      artifactDigest: sha256,
      byteSize,
      mediaType,
      evidenceDigest: `sha256:${"a".repeat(64)}`,
      engineVersion: "scanner-1",
      signatureVersion: "signatures-1",
      scannedAt: "2026-09-02T09:00:00.000Z"
    })
  });
  assert.equal(inspection.securityStatus, "scanner-attested-clean");
  assert.equal(inspection.scanEvidenceDigest, `sha256:${"a".repeat(64)}`);
  assert.throws(
    () => inspectPdf(fixture.filePath, {
      allowedRoot: fixture.root,
      scanPdf: ({ byteSize, mediaType }) => ({
        verdict: "clean",
        artifactDigest: `sha256:${"0".repeat(64)}`,
        byteSize,
        mediaType,
        evidenceDigest: `sha256:${"b".repeat(64)}`,
        engineVersion: "scanner-1",
        signatureVersion: "signatures-1",
        scannedAt: "2026-09-02T09:00:00.000Z"
      })
    }),
    (error) => error.code === "PROCUREMENT_PDF_SCAN_INVALID"
  );
});

test("controlled batch is atomic and derives added changed and withdrawn requirements", (t) => {
  const firstFixture = controlledPdfFixture(t, "%PDF-1.4\n1 0 obj<</Type/Catalog /Version/1>>endobj\n%%EOF\n");
  const secondFixture = controlledPdfFixture(t, "%PDF-1.4\n1 0 obj<</Type/Catalog /Version/2>>endobj\n%%EOF\n");
  const firstInspection = inspectPdf(firstFixture.filePath, { allowedRoot: firstFixture.root });
  const secondInspection = inspectPdf(secondFixture.filePath, { allowedRoot: secondFixture.root });
  const first = extractionManifest({
    candidates: [
      extractionManifest().candidates[0],
      { ...extractionManifest().candidates[0], id: "PR-SAMPLE-003-R002", logicalRequirementId: "REQ-000000000007", semanticDigest: `sha256:${"7".repeat(64)}` },
      { ...extractionManifest().candidates[0], id: "PR-SAMPLE-003-R003", logicalRequirementId: "REQ-000000000009", semanticDigest: `sha256:${"9".repeat(64)}` }
    ]
  });
  const firstDocumentId = `DOC-${firstInspection.sha256.slice(7, 19).toUpperCase()}`;
  const second = extractionManifest({
    revision: 2,
    supersedesDocumentId: firstDocumentId,
    candidates: [
      { ...extractionManifest().candidates[0], id: "PR-SAMPLE-003-V2-R001", priority: "P1" },
      { ...extractionManifest().candidates[0], id: "PR-SAMPLE-003-V2-R003", logicalRequirementId: "REQ-000000000008", semanticDigest: `sha256:${"8".repeat(64)}` },
      { ...extractionManifest().candidates[0], id: "PR-SAMPLE-003-V2-R004", logicalRequirementId: "REQ-000000000009", semanticDigest: `sha256:${"9".repeat(64)}`, sourceAnchor: { pageStart: 5, pageEnd: 6, sectionCode: "SEC-RELOCATED" } }
    ]
  });
  const batch = buildControlledImportBatch([
    { inspection: firstInspection, extraction: first },
    { inspection: secondInspection, extraction: second }
  ]);
  assert.equal(batch.schemaVersion, "procurement-controlled-import-batch-v2");
  assert.deepEqual(batch.revisionComparisons[0].summary, { added: 1, changed: 1, withdrawn: 1, unchanged: 1 });
  assert.match(batch.revisionComparisons[0].changed[0].comparisonDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(batch.revisionComparisons[0].changed[0], "semanticDigest"), false);
  assert.equal(batch.summary.documents, 2);
  assert.equal(JSON.stringify(batch).includes(firstFixture.root), false);
  assert.equal(batch.productionReady, false);
});

test("offline batch CLI validates its manifest and writes one non-overwriting artifact", (t) => {
  const fixture = controlledPdfFixture(t);
  const extractionPath = path.join(fixture.root, "extraction.json");
  const batchPath = path.join(fixture.root, "batch.json");
  const outputPath = path.join(fixture.root, "result.json");
  fs.writeFileSync(extractionPath, JSON.stringify(extractionManifest()));
  const manifest = {
    schemaVersion: "procurement-pdf-batch-v1",
    items: [{ pdf: fixture.filePath, extraction: extractionPath }]
  };
  fs.writeFileSync(batchPath, JSON.stringify(manifest));
  assert.equal(validateBatchManifest(manifest).length, 1);
  runImportCli([
    `--allowed-root=${fixture.root}`,
    `--batch=${batchPath}`,
    `--output=${outputPath}`
  ]);
  const output = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(output.schemaVersion, "procurement-controlled-import-batch-v2");
  assert.equal(output.summary.documents, 1);
  assert.equal(output.documents[0].sourceAlias, "需求来源 000000000003");
  assert.equal(JSON.stringify(output).includes(fixture.root), false);
  assert.throws(
    () => runImportCli([`--allowed-root=${fixture.root}`, `--batch=${batchPath}`, `--output=${outputPath}`]),
    /never overwrites/
  );
  assert.throws(
    () => validateBatchManifest({ ...manifest, unexpected: true }),
    /schema is invalid/
  );
  assert.throws(
    () => validateBatchAggregates([{ source: { byteSize: 11 }, extractionManifest: { candidates: [], reviewedPageCount: 1 } }], {
      maximumBatchBytes: 10,
      maximumBatchCandidates: 10,
      maximumBatchReviewedPages: 10
    }),
    /before PDF inspection/
  );
  assert.deepEqual(fs.readdirSync(fixture.root).filter((name) => name.includes(".tmp")), []);
});
