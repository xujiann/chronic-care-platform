"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildControlledImportDocument,
  inspectPdf,
  withinRoot
} = require("../src/platform/productization/procurement-document-import");

function controlledPdfFixture(t, body = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "procurement-pdf-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filePath = path.join(root, "source.pdf");
  fs.writeFileSync(filePath, body);
  return { body: Buffer.from(body), filePath, root };
}

function extractionManifest(overrides = {}) {
  return {
    schemaVersion: "procurement-pdf-extraction-v1",
    sourceAlias: "需求样本文档 003",
    reviewedPageCount: 12,
    extractionMode: "human-verified-pages",
    textQuality: "reviewable",
    candidates: [{
      id: "PR-SAMPLE-003-R001",
      title: "统一服务目录治理",
      sourceAnchor: { pageStart: 2, pageEnd: 4, section: "服务目录" },
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
  const inspection = inspectPdf(fixture.filePath, { allowedRoot: fixture.root, maximumPdfBytes: 1024 });
  assert.equal(inspection.sha256, `sha256:${crypto.createHash("sha256").update(fixture.body).digest("hex")}`);
  assert.equal(inspection.mediaType, "application/pdf");
  assert.equal(inspection.byteSize, fixture.body.length);
  assert.equal(inspection.securityStatus, "unscanned-external-source");
  assert.equal(inspection.productionReady, false);
  assert.equal(Object.isFrozen(inspection), true);
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
  assert.equal(document.sourceAlias, "需求样本文档 003");
  assert.equal(document.candidates[0].targetCapabilityIds[0], "C-DATA-PLATFORM");
  assert.equal(JSON.stringify(document).includes(fixture.root), false);
  assert.equal(document.status, "candidate-review");

  assert.throws(
    () => buildControlledImportDocument(inspection, extractionManifest({ sourceAlias: "C:\\source\\document.pdf" })),
    /sourceAlias must be neutral and path-free/
  );
  assert.throws(
    () => buildControlledImportDocument(inspection, extractionManifest({
      candidates: [{ ...extractionManifest().candidates[0], targetCapabilityIds: ["UNKNOWN-CAPABILITY"] }]
    })),
    /unregistered capability/
  );
});
